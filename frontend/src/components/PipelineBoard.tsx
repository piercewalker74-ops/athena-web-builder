import { useCallback, useEffect, useState } from 'react';
import { soundEngine } from '../audio/SoundEngine';
import { ProjectDirectory } from './ProjectDirectory';

interface DoneLead {
  id: string;
  businessName: string;
  city: string;
  state: string;
  status: string;
  siteUrl?: string;
  buildMode?: 'schematic' | 'circuit';
  updatedAt: number;
}

interface Today {
  active: boolean;
  running: { label: string; mode: string; slug?: string; startedAt?: number } | null;
  pending: number;
  queued?: Array<{ id: string; label: string; mode: string; slug?: string; source: string; enqueuedAt: number }>;
  completedToday: DoneLead[];
  countToday: number;
  auto?: { enabled: boolean; everyHours: number; nextEligibleAt: number; disabledReason?: string };
}

function countdown(target: number): string {
  const ms = target - Date.now();
  if (ms <= 0) return 'due';
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

interface Summary {
  total: number;
  byStatus: Record<string, number>;
  lastRun?: { id: string; status: string; startedAt: number; qualified: number } | null;
}

const STATUS_COLOR: Record<string, string> = {
  delivered: 'var(--green)', deployed: 'var(--green)', reported: 'var(--holo)',
};

function DoneRow({ lead }: { lead: DoneLead }) {
  const col = STATUS_COLOR[lead.status] ?? 'var(--amber)';
  return (
    <div className="today-row">
      <span className="today-row__dot" style={{ background: col, boxShadow: `0 0 6px ${col}` }} />
      <span className="today-row__name">{lead.businessName}</span>
      <span className="today-row__meta">{[lead.city, lead.state].filter(Boolean).join(', ')}</span>
      {lead.buildMode && <span className="today-row__mode">{lead.buildMode === 'schematic' ? 'SCHEMATIC' : 'CIRCUIT'}</span>}
      <span className="today-row__status" style={{ color: col }}>{lead.status.toUpperCase()}</span>
      {lead.siteUrl
        ? <a href={lead.siteUrl} target="_blank" rel="noopener noreferrer" className="today-row__link">↗ live</a>
        : <span className="today-row__link today-row__link--none">—</span>}
    </div>
  );
}

export function PipelineBoard() {
  const [today, setToday]     = useState<Today | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView]       = useState<'today' | 'stats' | 'projects'>('today');

  const load = useCallback(async () => {
    try {
      const [todayRes, summaryRes] = await Promise.all([
        fetch('/api/pipeline/today'),
        fetch('/api/pipeline/summary'),
      ]);
      if (todayRes.ok) setToday(await todayRes.json() as Today);
      if (summaryRes.ok) setSummary(await summaryRes.json() as Summary);
    } catch { /* backend offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const iv = setInterval(() => void load(), 8_000);  // faster tick so ACTIVE/IDLE + queue feel live
    return () => clearInterval(iv);
  }, [load]);

  // LAUNCH BUILD enqueues the full automatic circuit on the single lane.
  const [launching, setLaunching] = useState(false);
  const launch = async () => {
    if (launching) return;
    setLaunching(true);
    soundEngine.keyClack();
    try {
      const r = await fetch('/api/pipeline/launch', { method: 'POST' });
      if (!r.ok) throw new Error('launch failed');
      setTimeout(() => void load(), 1500);
    } catch { /* backend offline */ }
    finally { setTimeout(() => setLaunching(false), 4000); }
  };

  const active = today?.active ?? false;
  const pending = today?.pending ?? 0;
  const auto = today?.auto;

  const toggleAuto = async () => {
    soundEngine.keyClack();
    try {
      await fetch('/api/pipeline/auto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !(auto?.enabled) }),
      });
      setTimeout(() => void load(), 400);
    } catch { /* offline */ }
  };

  return (
    <div className="pipeline-view">
      {/* Header */}
      <div className="pipeline-view__header" data-tour="pipeline-header">
        <div className="section-header">PROJECT PIPELINE — NEOFORM</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button className={`mission-filter-btn${view === 'today' ? ' mission-filter-btn--active' : ''}`} onClick={() => setView('today')}>TODAY</button>
          <button className={`mission-filter-btn${view === 'stats' ? ' mission-filter-btn--active' : ''}`} onClick={() => setView('stats')}>STATS</button>
          <button className={`mission-filter-btn${view === 'projects' ? ' mission-filter-btn--active' : ''}`} onClick={() => { setView('projects'); soundEngine.keyClack(); }}>PROJECTS</button>
          <button className={`mission-filter-btn${launching ? '' : ' mission-filter-btn--active'}`} data-tour="pipeline-launch" onClick={launch} disabled={launching} title="Enqueue a full NEOFORM circuit on the build lane">
            {launching ? '◌ LAUNCHING…' : '▶ LAUNCH BUILD'}
          </button>
          <button className="ops-refresh" onClick={() => { void load(); soundEngine.keyClack(); }}>↻</button>
        </div>
      </div>

      {/* Stats view */}
      {view === 'stats' && summary && (
        <div className="pipeline-stats">
          <div className="pipeline-stat-grid">
            <div className="pipeline-stat">
              <span className="pipeline-stat__val">{summary.total}</span>
              <span className="pipeline-stat__label">TOTAL LEADS</span>
            </div>
            {Object.entries(summary.byStatus).map(([status, count]) => (
              <div key={status} className="pipeline-stat">
                <span className="pipeline-stat__val">{count}</span>
                <span className="pipeline-stat__label">{status.toUpperCase()}</span>
              </div>
            ))}
          </div>
          {summary.lastRun && (
            <div className="pipeline-last-run">
              <div className="section-header" style={{ marginBottom: 6 }}>LAST RESEARCH RUN</div>
              <div style={{ fontSize: 10, color: 'var(--amber-dim)' }}>
                {new Date(summary.lastRun.startedAt).toLocaleString('en-US', { hour12: false })}
                · {summary.lastRun.status.toUpperCase()} · {summary.lastRun.qualified} qualified
              </div>
            </div>
          )}
        </div>
      )}

      {/* Projects directory */}
      {view === 'projects' && <ProjectDirectory />}

      {/* TODAY view — sites completed today + ACTIVE/IDLE + queue depth */}
      {view === 'today' && (
        <div className="today-wrap">
          {/* status strip */}
          <div className="today-strip" data-tour="pipeline-lane">
            <div className={`today-ind${active ? ' today-ind--active' : ''}`}>
              <span className="today-ind__dot" />
              <span className="today-ind__txt">{active ? 'ACTIVE' : 'IDLE'}</span>
            </div>
            <div className="today-strip__detail">
              {active && today?.running
                ? <>building <b>{today.running.label}</b> <span className="today-mode-tag">{today.running.mode === 'schematic' ? 'SCHEMATIC' : 'CIRCUIT'}</span></>
                : <span style={{ color: 'var(--amber-dim)' }}>build lane clear — nothing running</span>}
            </div>
            <div className="today-strip__queue" data-tour="pipeline-queue">
              QUEUE <b style={{ color: pending ? 'var(--amber-br,#ffce4d)' : 'var(--amber-dim)' }}>{pending}</b>
            </div>
            <button className={`today-auto${auto?.enabled ? ' today-auto--on' : ''}`} data-tour="pipeline-auto" onClick={toggleAuto}
              title={auto?.disabledReason ?? 'Toggle the automatic scheduled circuit'}>
              AUTO {auto?.enabled
                ? <><b>ON</b> · every {auto.everyHours}h · next {active ? '—' : countdown(auto.nextEligibleAt)}</>
                : <b>OFF</b>}
            </button>
          </div>

          {/* queued — what's waiting on the lane, in order */}
          {(today?.queued?.length ?? 0) > 0 && (
            <>
              <div className="today-head">
                <span className="section-header">QUEUED</span>
                <span className="today-count today-count--q">{today!.queued!.length}</span>
              </div>
              <div className="today-list today-list--q">
                {today!.queued!.map((j, i) => (
                  <div key={j.id} className="q-row">
                    <span className="q-row__pos">{i + 1}</span>
                    <span className="q-row__name">{j.label}</span>
                    <span className="q-row__mode">{j.mode === 'circuit' ? 'CIRCUIT' : j.mode === 'edit' ? 'EDIT' : 'SCHEMATIC'}</span>
                    <span className="q-row__src">{j.source}</span>
                    <span className="q-row__wait">{i === 0 ? 'next up' : `#${i + 1} in line`}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* completed today */}
          <div className="today-head" data-tour="pipeline-today">
            <span className="section-header">SITES COMPLETED TODAY</span>
            <span className="today-count">{today?.countToday ?? 0}</span>
          </div>

          {loading && <div className="ops-loading"><span className="cursor">█</span> LOADING…</div>}

          {!loading && (
            <div className="today-list">
              {(today?.completedToday.length ?? 0) === 0
                ? <div className="today-empty">— no sites shipped yet today —</div>
                : today!.completedToday.map(l => <DoneRow key={l.id} lead={l} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
