import { useEffect, useRef, useState } from 'react';
import { soundEngine } from '../audio/SoundEngine';
import { AmbientBackground } from './AmbientBackground';

interface MissionEntry {
  id: string;
  ts: number;
  jobName: string;
  jobId: string;
  status: 'ok' | 'error' | 'running' | 'skipped';
  output?: string;
  duration?: number;
}

interface Props {
  wsRef?: React.MutableRefObject<WebSocket | null>;
}

// Format duration
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

export function MissionLog({ wsRef }: Props) {
  const [entries, setEntries] = useState<MissionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<'all' | 'ok' | 'error'>('all');
  const [paused, setPaused]   = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Initial load from cron runs
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch('/api/cron/jobs');
        if (!r.ok) { setLoading(false); return; }

        const data = await r.json() as { jobs?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>;
        const jobs = Array.isArray(data) ? data : (data as { jobs?: Array<{ id: string; name: string }> }).jobs ?? [];

        const all: MissionEntry[] = [];

        // Fetch runs for each job (parallel, up to 5)
        const chunks: typeof jobs[] = [];
        for (let i = 0; i < jobs.length; i += 5) chunks.push(jobs.slice(i, i + 5));

        for (const chunk of chunks) {
          await Promise.all(chunk.map(async job => {
            try {
              const rr = await fetch(`/api/cron/jobs/${job.id}/runs`);
              if (!rr.ok) return;
              const rd = await rr.json() as { runs?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
              const runs = Array.isArray(rd) ? rd : (rd as { runs?: Array<Record<string, unknown>> }).runs ?? [];
              for (const run of runs.slice(0, 10)) {
                all.push({
                  id: String(run.runId ?? crypto.randomUUID()),
                  ts: Number(run.startedAtMs ?? 0),
                  jobName: job.name,
                  jobId: job.id,
                  status: (run.status as MissionEntry['status']) ?? 'ok',
                  output: run.output ? String(run.output).substring(0, 120) : undefined,
                  duration: run.finishedAtMs
                    ? Number(run.finishedAtMs) - Number(run.startedAtMs ?? 0)
                    : undefined,
                });
              }
            } catch { /* skip */ }
          }));
        }

        all.sort((a, b) => b.ts - a.ts);
        setEntries(all.slice(0, 200));
      } catch { /* no gateway */ }
      finally { setLoading(false); }
    };
    void load();
    const iv = setInterval(() => void load(), 30_000); // auto-refresh so new runs appear
    return () => clearInterval(iv);
  }, []);

  // WebSocket live events
  useEffect(() => {
    if (!wsRef?.current) return;
    const ws = wsRef.current;

    const handler = (ev: MessageEvent<string>) => {
      try {
        const frame = JSON.parse(ev.data) as { type?: string; payload?: Record<string, unknown> };
        if (frame.type !== 'gateway_event') return;
        const payload = frame.payload ?? {};
        if (!String(payload.event ?? '').startsWith('cron')) return;

        const p = (payload.payload ?? {}) as Record<string, unknown>;
        if (p.status) {
          const entry: MissionEntry = {
            id: String(p.runId ?? crypto.randomUUID()),
            ts: Date.now(),
            jobName: String(p.name ?? 'unknown'),
            jobId: String(p.jobId ?? ''),
            status: (p.status as MissionEntry['status']) ?? 'running',
            output: p.output ? String(p.output).substring(0, 120) : undefined,
          };

          if (!paused) {
            setEntries(prev => [entry, ...prev].slice(0, 200));
            if (p.status === 'ok') soundEngine.motionPing();
            if (p.status === 'error') soundEngine.klaxon();
          }
        }
      } catch { /* ignore */ }
    };

    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [wsRef, paused]);

  // Auto-scroll when not paused
  useEffect(() => {
    if (!paused) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, paused]);

  const filtered = filter === 'all'
    ? entries
    : entries.filter(e => e.status === filter);

  return (
    <div className="mission-log">
      <AmbientBackground variant="mixed" density={0.6} seed={77} />
      {/* Header */}
      <div className="mission-log__header">
        <div className="section-header">MISSION LOG</div>
        <div className="mission-log__controls" data-tour="missions-filters">
          {(['all', 'ok', 'error'] as const).map(f => (
            <button
              key={f}
              className={`mission-filter-btn${filter === f ? ' mission-filter-btn--active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.toUpperCase()}
            </button>
          ))}
          <button
            className={`mission-filter-btn${paused ? ' mission-filter-btn--active' : ''}`}
            onClick={() => setPaused(p => !p)}
          >
            {paused ? '▶ RESUME' : '⏸ PAUSE'}
          </button>
        </div>
      </div>

      {/* Log feed */}
      <div className="mission-log__feed" data-tour="missions-feed">
        {loading && (
          <div className="mission-log__status">
            <span className="cursor">█</span> SCANNING RUN HISTORY…
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="mission-log__status" style={{ color: 'var(--amber-ghost)' }}>
            NO MISSIONS LOGGED
          </div>
        )}

        {filtered.map(entry => (
          <div key={entry.id} className={`mission-entry mission-entry--${entry.status}`}>
            <span className="mission-entry__icon">
              {entry.status === 'ok' ? '✓' : entry.status === 'error' ? '✗' : entry.status === 'running' ? '◉' : '—'}
            </span>
            <div className="mission-entry__body">
              <div className="mission-entry__title">
                <span className="mission-entry__name">{entry.jobName}</span>
                <span className="mission-entry__status">{entry.status.toUpperCase()}</span>
                {entry.duration !== undefined && (
                  <span className="mission-entry__duration">{fmtDuration(entry.duration)}</span>
                )}
              </div>
              <div className="mission-entry__meta">
                {new Date(entry.ts).toLocaleString('en-US', {
                  hour12: false,
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </div>
              {entry.output && (
                <div className="mission-entry__output">{entry.output}</div>
              )}
            </div>
          </div>
        ))}

        <div ref={endRef} />
      </div>
    </div>
  );
}
