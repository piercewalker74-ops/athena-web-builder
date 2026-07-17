import { useEffect, useRef, useState } from 'react';
import { soundEngine } from '../audio/SoundEngine';
import { UpgradeMenu } from './UpgradeMenu';
import '../styles/projects-view.css';

/**
 * PROJECTS — the full-page takeover of the pipeline section. Lists every built
 * client site; EDIT opens the Feature Director (the manifest-driven visual editor)
 * for that project, embedded full-bleed. While open the large BuildTracker is
 * hidden (PipelineSection unmounts it) and the movable mini tracker stays visible.
 */

interface Project {
  slug: string;
  source?: string;
  name?: string;
  businessName?: string;
  business_name?: string;
  industry?: string;
  live_url?: string;
  liveUrl?: string;
  status?: string;
  reviewStatus?: string;
  deployed?: boolean;
  deployReady?: boolean;
  deployKind?: 'static' | 'next' | null;
  deployStatus?: string;
  updatedAt?: number;
}

const nameOf = (p: Project) => p.businessName ?? p.business_name ?? p.name ?? p.slug;
const urlOf = (p: Project) => p.live_url ?? p.liveUrl ?? '';

interface Props { onExit: () => void; }

export function ProjectsView({ onExit }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<'choose' | 'personal' | 'business'>('choose');
  const [newName, setNewName] = useState('');
  const [biz, setBiz] = useState({ mapsUrl: '', phone: '', industry: '', city: '' });
  const [busy, setBusy] = useState(false);
  const [deploying, setDeploying] = useState<Record<string, string>>({});  // slug → status/message
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const deploy = async (p: Project) => {
    if (deploying[p.slug]) return;
    setDeploying(d => ({ ...d, [p.slug]: 'deploying' }));
    soundEngine.motionPing();
    try {
      const r = await fetch(`/api/projects/${encodeURIComponent(p.slug)}/deploy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json() as { ok?: boolean; deploying?: boolean; alreadyDeployed?: boolean; error?: string };
      if (!j.ok) setDeploying(d => ({ ...d, [p.slug]: `error: ${j.error ?? r.status}` }));
      // else leave 'deploying' — the 15s poll flips it to live when deploy.json/live_url land
    } catch (e) {
      setDeploying(d => ({ ...d, [p.slug]: `error: ${e instanceof Error ? e.message : 'offline'}` }));
    }
  };

  const resetCreate = () => { setCreating(false); setKind('choose'); setNewName(''); setBiz({ mapsUrl: '', phone: '', industry: '', city: '' }); };

  const createProject = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    const body: Record<string, string> = { name, kind: kind === 'business' ? 'business' : 'personal', industry: biz.industry };
    if (kind === 'business') { body.googleMapsUrl = biz.mapsUrl; body.phone = biz.phone; body.city = biz.city; }
    try {
      const r = await fetch('/api/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await r.json() as { ok?: boolean; slug?: string; error?: string };
      if (d.slug) { resetCreate(); soundEngine.motionPing(); setEditing(d.slug); }
    } catch { /* offline */ }
    finally { setBusy(false); }
  };

  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/projects')
      .then(r => r.json())
      .then((d: Project[] | { projects: Project[] }) => { if (alive) setProjects(Array.isArray(d) ? d : d.projects ?? []); })
      .catch(() => { /* backend offline */ })
      .finally(() => alive && setLoading(false));
    void load();
    const iv = setInterval(() => void load(), 15_000);  // surface 'awaiting review' as runs pause
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // Hide anything older than 2 months (keep awaiting-review items regardless), then
  // filter by search, then sort most-recent → least.
  const cutoff = Date.now() - 60 * 24 * 3600 * 1000;
  const filtered = projects
    .filter(p => p.reviewStatus === 'awaiting' || p.updatedAt == null || p.updatedAt >= cutoff)
    .filter(p => !q || nameOf(p).toLowerCase().includes(q.toLowerCase()) || p.slug.includes(q.toLowerCase()))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  // ── Editor takeover ──
  if (editing) {
    return (
      <div className="pv pv--editor">
        <div className="pv-editbar">
          <button className="pv-back" onClick={() => { setEditing(null); soundEngine.hydraulicHiss(); }}>◄ PROJECTS</button>
          <span className="pv-editslug">EDIT · {editing}</span>
          <span className="pv-sp" />
          <button className="pv-back" onClick={onExit}>◄◄ PIPELINE</button>
        </div>
        <iframe
          ref={frameRef}
          className="pv-frame"
          src={`/feature-injector.html?slug=${encodeURIComponent(editing)}`}
          title={`Feature Director — ${editing}`}
        />
      </div>
    );
  }

  // ── Project list ──
  return (
    <div className="pv">
      <div className="pv-head">
        <div className="section-header">PROJECTS — FEATURE DIRECTOR</div>
        <button className="pv-new" onClick={() => { setCreating(c => !c); soundEngine.keyClack(); }}>＋ NEW PROJECT</button>
        <input className="pv-search" placeholder="filter…" value={q} onChange={e => setQ(e.target.value)} />
        <span className="pv-count">{filtered.length} SITES</span>
        <button className="pv-back" onClick={onExit}>◄ PIPELINE</button>
      </div>

      {creating && (
        <div className="pv-create">
          {kind === 'choose' && (<>
            <span className="pv-create__label">NEW PROJECT ·</span>
            <button className="pv-kind" onClick={() => setKind('personal')}>◆ PERSONAL</button>
            <button className="pv-kind" onClick={() => setKind('business')}>▣ BUSINESS</button>
            <button className="pv-create__x" onClick={resetCreate}>cancel</button>
            <span className="pv-create__hint">personal = blank canvas you compose · business = adds intake (maps, phone, city…)</span>
          </>)}

          {kind === 'personal' && (<>
            <span className="pv-create__label">◆ PERSONAL ·</span>
            <input className="pv-create__input" autoFocus placeholder="site / project name…"
              value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void createProject(); if (e.key === 'Escape') setKind('choose'); }} />
            <button className="pv-create__go" disabled={busy || !newName.trim()} onClick={() => void createProject()}>
              {busy ? '◌ creating…' : 'CREATE BLANK & MAP ▸'}
            </button>
            <button className="pv-create__x" onClick={() => setKind('choose')}>← back</button>
            <span className="pv-create__hint">→ opens an EMPTY canvas · drag sections in, name them, arrange parts</span>
          </>)}

          {kind === 'business' && (<>
            <span className="pv-create__label">▣ BUSINESS ·</span>
            <input className="pv-create__input" autoFocus placeholder="business name…" value={newName} onChange={e => setNewName(e.target.value)} />
            <input className="pv-create__field" placeholder="Google Maps link" value={biz.mapsUrl} onChange={e => setBiz({ ...biz, mapsUrl: e.target.value })} />
            <input className="pv-create__field" placeholder="phone" value={biz.phone} onChange={e => setBiz({ ...biz, phone: e.target.value })} />
            <input className="pv-create__field" placeholder="industry" value={biz.industry} onChange={e => setBiz({ ...biz, industry: e.target.value })} />
            <input className="pv-create__field" placeholder="city" value={biz.city} onChange={e => setBiz({ ...biz, city: e.target.value })} />
            <button className="pv-create__go" disabled={busy || !newName.trim()} onClick={() => void createProject()}>
              {busy ? '◌…' : 'CREATE & MAP ▸'}
            </button>
            <button className="pv-create__x" onClick={() => setKind('choose')}>← back</button>
          </>)}
        </div>
      )}

      <div className="pv-grid">
        {loading && <div className="pv-empty"><span className="cursor">█</span> SCANNING BUILDS…</div>}
        {!loading && filtered.length === 0 && <div className="pv-empty">no projects found</div>}
        {filtered.map(p => (
          <div key={p.slug} className="pv-card" onClick={() => { setEditing(p.slug); soundEngine.keyClack(); }}>
            <div className="pv-card__top">
              <span className="pv-card__name">{nameOf(p)}</span>
              {p.reviewStatus === 'awaiting' && <span className="pv-review">⏸ REVIEW</span>}
              {p.source && <span className={`pv-src pv-src--${p.source}`}>{p.source}</span>}
            </div>
            <div className="pv-card__meta">{p.industry || '—'}</div>
            <div className="pv-card__foot">
              {(() => {
                const dep = deploying[p.slug];
                const isDeploying = dep === 'deploying' || p.deployStatus === 'deploying';
                const deployErr = dep && dep.startsWith('error') ? dep : (p.deployStatus === 'error' ? 'deploy failed' : '');
                if (urlOf(p) || p.deployed) {
                  return <a className="pv-card__link" href={urlOf(p) || '#'} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>↗ live</a>;
                }
                if (isDeploying) {
                  return <span className="pv-card__link pv-card__deploying">◌ deploying…</span>;
                }
                if (p.deployReady) {
                  return (
                    <button className="pv-card__deploy" title={`Deploy (${p.deployKind}) to Vercel`}
                      onClick={e => { e.stopPropagation(); void deploy(p); }}>
                      ▲ DEPLOY{deployErr ? ' ⟲' : ''}
                    </button>
                  );
                }
                return <span className="pv-card__link pv-card__link--none">not built</span>;
              })()}
              <UpgradeMenu slug={p.slug} />
              <span className="pv-card__edit">EDIT ▸</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
