import { useCallback, useEffect, useState } from 'react';
import { soundEngine } from '../audio/SoundEngine';
import { AmbientBackground } from './AmbientBackground';

// ─── Types ────────────────────────────────────────────────────────────────────
interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  scheduleKind: 'at' | 'every' | 'cron';
  schedule: string;
  sessionTarget: string;
  nextRunAtMs?: number;
  lastRunStatus?: 'ok' | 'error' | 'skipped' | 'running' | null;
  lastRunAtMs?: number;
  description?: string;
  message?: string;
}

// Raw shape returned by the backend (gateway or CLI)
interface RawCronJob {
  id: string;
  name: string;
  enabled: boolean;
  description?: string;
  sessionTarget?: string;
  schedule?: { kind?: string; expr?: string; interval?: string; at?: string } | string;
  payload?: { message?: string; argv?: string[] };
  state?: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: 'ok' | 'error' | 'skipped' | 'running' | null;
  };
  // flat variants from gateway REST
  nextRunAtMs?: number;
  lastRunStatus?: 'ok' | 'error' | 'skipped' | 'running' | null;
  lastRunAtMs?: number;
}

/** Turn a raw cron expression into a short human-readable label. */
function friendlyCron(expr: string): string {
  if (!expr) return '—';
  // Already human-readable (e.g. "every 1h")
  if (!/^[0-9*,/-]/.test(expr)) return expr.toUpperCase();

  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;

  const pad = (n: string) => n.padStart(2, '0');
  const hh  = hour === '*' ? '??' : pad(hour);
  const mm  = min  === '*' ? '00' : pad(min);
  const time = `${hh}:${mm}`;

  // Specific day-of-week
  const DOW_NAMES: Record<string, string> = {
    '0':'SUN','1':'MON','2':'TUE','3':'WED','4':'THU','5':'FRI','6':'SAT',
  };
  const friendlyDow = (d: string) => d.split(',').map(x => DOW_NAMES[x] ?? x).join('/');

  if (dom === '*' && mon === '*') {
    if (dow === '*') return `DAILY ${time}`;
    // e.g. Mon/Wed/Fri
    return `${friendlyDow(dow)} ${time}`;
  }
  if (dom !== '*' && mon === '*' && dow === '*') return `MONTHLY D${dom} ${time}`;
  return expr; // fallback
}

function normalizeJob(raw: RawCronJob): CronJob {
  const sched = raw.schedule;
  let scheduleKind: CronJob['scheduleKind'] = 'cron';
  let scheduleStr = '';
  if (typeof sched === 'string') {
    scheduleStr = sched;
  } else if (sched && typeof sched === 'object') {
    const k = sched.kind ?? 'cron';
    scheduleKind = k as CronJob['scheduleKind'];
    scheduleStr = sched.expr ?? sched.interval ?? sched.at ?? k;
  }
  return {
    id:             raw.id,
    name:           raw.name,
    enabled:        raw.enabled,
    description:    raw.description,
    scheduleKind,
    schedule:       scheduleStr,
    sessionTarget:  raw.sessionTarget ?? 'main',
    nextRunAtMs:    raw.state?.nextRunAtMs ?? raw.nextRunAtMs,
    lastRunAtMs:    raw.state?.lastRunAtMs ?? raw.lastRunAtMs,
    lastRunStatus:  raw.state?.lastRunStatus ?? raw.lastRunStatus,
    message:        raw.payload?.message,
  };
}

interface CronRun {
  runId: string;
  jobId: string;
  status: 'ok' | 'error' | 'running' | 'skipped';
  startedAtMs: number;
  finishedAtMs?: number;
  output?: string;
}

// ─── Orbital clock ────────────────────────────────────────────────────────────
function OrbitalClock({ nextRunMs, size = 48 }: { nextRunMs?: number; size?: number }) {
  const [angle, setAngle] = useState(0);

  useEffect(() => {
    if (!nextRunMs) return;
    const update = () => {
      const now = Date.now();
      const diff = nextRunMs - now;
      if (diff <= 0) { setAngle(0); return; }
      // Sweep 0→360 over a 24h window
      const window = 24 * 60 * 60 * 1000;
      setAngle(360 - Math.min(360, (diff / window) * 360));
    };
    update();
    const iv = setInterval(update, 10_000);
    return () => clearInterval(iv);
  }, [nextRunMs]);

  const r = (size / 2) - 4;
  const cx = size / 2;
  const cy = size / 2;
  const rad = (angle - 90) * (Math.PI / 180);
  const dotX = cx + r * Math.cos(rad);
  const dotY = cy + r * Math.sin(rad);

  const formatCountdown = () => {
    if (!nextRunMs) return '——';
    const diff = nextRunMs - Date.now();
    if (diff <= 0) return 'NOW';
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    if (h > 0) return `${h}h${m}m`;
    return `${m}m`;
  };

  return (
    <div className="orbital-clock" style={{ width: size, height: size, position: 'relative' }}>
      <svg width={size} height={size} style={{ position: 'absolute', inset: 0 }}>
        {/* Track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--amber-ghost)" strokeWidth={1} />
        {/* Sweep arc */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="var(--holo)"
          strokeWidth={1.5}
          strokeDasharray={`${(angle / 360) * (2 * Math.PI * r)} ${2 * Math.PI * r}`}
          strokeDashoffset={2 * Math.PI * r * 0.25}
          style={{ filter: 'drop-shadow(0 0 3px var(--holo))' }}
        />
        {/* Dot */}
        <circle cx={dotX} cy={dotY} r={2.5} fill="var(--holo)" style={{ filter: 'drop-shadow(0 0 4px var(--holo))' }} />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, color: 'var(--holo)', letterSpacing: '0.04em',
        textShadow: 'var(--glow-holo)',
      }}>
        {formatCountdown()}
      </div>
    </div>
  );
}

// ─── Single cron card ─────────────────────────────────────────────────────────
function CronCard({ job, onToggle, onRun, onOpen }: {
  job: CronJob;
  onToggle: (id: string, enabled: boolean) => void;
  onRun: (id: string) => void;
  onOpen: (job: CronJob) => void;
}) {
  const statusColor = job.lastRunStatus === 'ok'
    ? 'var(--green)'
    : job.lastRunStatus === 'error'
      ? 'var(--alert)'
      : job.lastRunStatus === 'running'
        ? 'var(--amber)'
        : 'var(--chrome-dark)';

  const scheduleLabel = () => {
    if (job.scheduleKind === 'at') return 'ONE-SHOT';
    if (job.scheduleKind === 'every') return `EVERY ${job.schedule.toUpperCase()}`;
    return friendlyCron(job.schedule);
  };

  return (
    <div
      className={`cron-card${job.enabled ? '' : ' cron-card--disabled'}`}
      onClick={() => onOpen(job)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onOpen(job)}
    >
      {/* Corner decorations */}
      <span className="corner-tl" /><span className="corner-tr" />
      <span className="corner-bl" /><span className="corner-br" />

      {/* Header */}
      <div className="cron-card__header">
        <span
        className={`cron-card__status-dot${job.lastRunStatus === 'ok' ? ' cron-card__status-dot--pulse' : ''}`}
        style={{ background: statusColor, boxShadow: `0 0 4px ${statusColor}` }}
      />
        <span className="cron-card__name">{job.name}</span>
        <button
          className="cron-card__toggle"
          onClick={e => { e.stopPropagation(); onToggle(job.id, !job.enabled); }}
          title={job.enabled ? 'Disable' : 'Enable'}
        >
          {job.enabled ? '■' : '▶'}
        </button>
      </div>

      {/* Schedule */}
      <div className="cron-card__schedule">{scheduleLabel()}</div>

      {/* Orbital clock + actions */}
      <div className="cron-card__body">
        <OrbitalClock nextRunMs={job.nextRunAtMs} size={56} />
        <div className="cron-card__meta">
          {job.lastRunStatus && (
            <span className="cron-card__last-run" style={{ color: statusColor }}>
              LAST: {job.lastRunStatus?.toUpperCase() ?? '——'}
            </span>
          )}
          {job.lastRunAtMs && (
            <span className="cron-card__last-time">
              {new Date(job.lastRunAtMs).toLocaleTimeString('en-US', { hour12: false })}
            </span>
          )}
          <span className="cron-card__session">
            {job.sessionTarget?.toUpperCase() ?? 'MAIN'}
          </span>
        </div>
      </div>

      {/* Run now button */}
      <button
        className="cron-card__run-btn"
        onClick={e => { e.stopPropagation(); onRun(job.id); soundEngine.motionPing(); }}
        title="Run now"
      >
        ⚡ RUN NOW
      </button>
    </div>
  );
}

// ─── Job detail drawer ────────────────────────────────────────────────────────
function JobDetail({ job, runs, onClose }: { job: CronJob; runs: CronRun[]; onClose: () => void }) {
  return (
    <div className="job-detail">
      <div className="job-detail__header">
        <span className="section-header">{job.name}</span>
        <button className="job-detail__close" onClick={onClose}>✕</button>
      </div>

      <div className="job-detail__body">
        <div className="job-detail__row">
          <span className="job-detail__key">ID</span>
          <span className="job-detail__val">{job.id}</span>
        </div>
        <div className="job-detail__row">
          <span className="job-detail__key">SCHEDULE</span>
          <span className="job-detail__val">{job.schedule}</span>
        </div>
        <div className="job-detail__row">
          <span className="job-detail__key">SESSION</span>
          <span className="job-detail__val">{job.sessionTarget}</span>
        </div>
        {job.message && (
          <div className="job-detail__row">
            <span className="job-detail__key">PROMPT</span>
            <span className="job-detail__val job-detail__val--prompt">{job.message}</span>
          </div>
        )}

        <div className="section-header" style={{ marginTop: '1rem' }}>RUN HISTORY</div>

        {runs.length === 0 ? (
          <p style={{ fontSize: 10, color: 'var(--amber-ghost)', marginTop: 8 }}>No runs recorded.</p>
        ) : (
          <div className="run-history">
            {runs.slice(0, 20).map(run => (
              <div key={run.runId} className={`run-row run-row--${run.status}`}>
                <span className="run-row__status">{run.status.toUpperCase()}</span>
                <span className="run-row__time">
                  {new Date(run.startedAtMs).toLocaleString('en-US', { hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                {run.output && (
                  <span className="run-row__output">{run.output.substring(0, 80)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main OperationsPage ──────────────────────────────────────────────────────
export function OperationsPage() {
  const [jobs, setJobs]         = useState<CronJob[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [selected, setSelected] = useState<CronJob | null>(null);
  const [runs, setRuns]         = useState<CronRun[]>([]);
  const [runLoading, setRunLoading] = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      const r = await fetch('/api/cron/jobs');
      if (r.ok) {
        const data = await r.json() as { jobs?: CronJob[]; error?: string } | CronJob[];
        const raw: RawCronJob[] = Array.isArray(data)
          ? (data as RawCronJob[])
          : ((data as { jobs?: RawCronJob[] }).jobs ?? []);
        setJobs(raw.map(normalizeJob));
        setError(null);
      } else {
        setError(`HTTP ${r.status}`);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadJobs(); }, [loadJobs]);

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await fetch(`/api/cron/jobs/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      setJobs(prev => prev.map(j => j.id === id ? { ...j, enabled } : j));
      soundEngine.hydraulicHiss();
    } catch { /* ignore */ }
  };

  const handleRun = async (id: string) => {
    setRunLoading(true);
    try {
      await fetch(`/api/cron/jobs/${id}/run`, { method: 'POST' });
      await loadJobs();
    } finally {
      setRunLoading(false);
    }
  };

  const handleOpen = async (job: CronJob) => {
    setSelected(job);
    soundEngine.hydraulicHiss();
    try {
      const r = await fetch(`/api/cron/jobs/${job.id}/runs`);
      if (r.ok) {
        const data = await r.json() as { runs?: CronRun[] } | CronRun[];
        setRuns(Array.isArray(data) ? data : (data as { runs?: CronRun[] }).runs ?? []);
      }
    } catch { setRuns([]); }
  };

  return (
    <div className="ops-page">
      <AmbientBackground variant="mixed" density={0.55} seed={99} />
      {/* Header */}
      <div className="ops-header">
        <div className="section-header">AUTOMATION GRID</div>
        <button className="ops-refresh" onClick={() => { void loadJobs(); soundEngine.keyClack(); }}>
          ↻ REFRESH
        </button>
      </div>

      {/* Content */}
      <div className="ops-content">
        {/* Job grid */}
        <div className="ops-grid-area">
          {loading && (
            <div className="ops-loading">
              <span className="cursor">█</span> SCANNING CRON ARRAY…
            </div>
          )}

          {!loading && error && (
            <div className="ops-error">
              <span style={{ color: 'var(--alert)' }}>⚠ GATEWAY OFFLINE</span>
              <p style={{ fontSize: 10, color: 'var(--amber-ghost)', marginTop: 4 }}>
                Cron requires gateway mode. Start gateway to manage automations.
              </p>
              <p style={{ fontSize: 9, color: 'var(--chrome)', marginTop: 4 }}>{error}</p>
            </div>
          )}

          {!loading && !error && jobs.length === 0 && (
            <div className="ops-empty">
              <span style={{ fontSize: 24, opacity: 0.25 }}>⚙</span>
              <span style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--amber-ghost)' }}>
                NO AUTOMATIONS CONFIGURED
              </span>
              <span style={{ fontSize: 9, color: 'var(--chrome)', maxWidth: 280, textAlign: 'center', lineHeight: 1.7 }}>
                Create a cron job with <code>openclaw cron add</code> to see it here.
              </span>
            </div>
          )}

          {!loading && jobs.length > 0 && (
            <div className="cron-grid" data-tour="ops-grid">
              {jobs.map(job => (
                <CronCard
                  key={job.id}
                  job={job}
                  onToggle={(id, en) => void handleToggle(id, en)}
                  onRun={(id) => void handleRun(id)}
                  onOpen={handleOpen}
                />
              ))}
            </div>
          )}

          {!loading && jobs.some(j => j.enabled && j.nextRunAtMs) && (
            <div className="ops-timeline" data-tour="ops-timeline">
              <div className="ops-timeline__label">UPCOMING TRIGGERS</div>
              <div className="ops-timeline__track">
                {jobs
                  .filter(j => j.enabled && j.nextRunAtMs)
                  .sort((a, b) => (a.nextRunAtMs ?? 0) - (b.nextRunAtMs ?? 0))
                  .slice(0, 6)
                  .map(job => {
                    const diff = (job.nextRunAtMs ?? 0) - Date.now();
                    const h = Math.floor(diff / 3_600_000);
                    const m = Math.floor((diff % 3_600_000) / 60_000);
                    const label = diff <= 0 ? 'NOW' : h > 0 ? `${h}h ${m}m` : `${m}m`;
                    return (
                      <div key={job.id} className="ops-timeline__entry">
                        <span className="ops-timeline__dot" />
                        <span className="ops-timeline__name">{job.name}</span>
                        <span className="ops-timeline__time">{label}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        {/* Job detail side panel */}
        {selected && (
          <JobDetail
            job={selected}
            runs={runs}
            onClose={() => { setSelected(null); setRuns([]); }}
          />
        )}
      </div>
    </div>
  );
}
