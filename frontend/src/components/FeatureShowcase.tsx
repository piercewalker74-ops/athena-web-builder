import { useEffect, useMemo, useState } from 'react';
import { soundEngine } from '../audio/SoundEngine';
import '../styles/feature-showcase.css';

/**
 * SHOWCASE — a standalone, read-only visual library. Every catalog feature has a
 * fullscreen live demo (public/demos/f/<id>.html); this page browses them grouped +
 * filterable, opens each one fullscreen, and shows the upgrade presets as their member
 * feature demos. Pure browse — no editing, no writes. Schematics tab is a placeholder
 * until real schematics exist.
 */

interface Feat {
  id: string; name: string; scope: string; folder: string;
  sectionTypes: string[]; description: string;
}
interface Pack { id: string; name: string; tagline: string; thread?: string; features?: string[]; }
interface Schematic {
  id: string; name: string; section: string; sectionName: string;
  combines: string[]; libs: string[]; description: string; demo: string;
}
type DemoItem = { id: string; name: string; url?: string };

const demoUrl = (id: string) => `/demos/f/${encodeURIComponent(id)}.html`;
const SCOPES = ['all', 'section-variant', 'enhancement', 'page', 'global'];

// Section archetypes (the spine language the builder thinks in). A feature's
// sectionTypes says which of these it can slot into; ALL = works in any section.
const ARCHETYPES: { letter: string; name: string }[] = [
  { letter: 'A', name: 'Hero' }, { letter: 'C', name: 'Marquee' }, { letter: 'D', name: 'Gallery' },
  { letter: 'E', name: 'Pinned' }, { letter: 'F', name: 'Before / After' }, { letter: 'G', name: 'Stat' },
  { letter: 'H', name: 'Testimonial / Proof' }, { letter: 'I', name: 'Ledger' }, { letter: 'J', name: 'Map' },
  { letter: 'K', name: 'CTA' }, { letter: 'L', name: 'Offset' }, { letter: 'ALL', name: 'Any Section' },
];

export function FeatureShowcase() {
  const [feats, setFeats] = useState<Feat[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [schematics, setSchematics] = useState<Schematic[]>([]);
  const [tab, setTab] = useState<'features' | 'sections' | 'presets' | 'schematics'>('features');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('all');
  const [folder, setFolder] = useState('all');
  const [demo, setDemo] = useState<{ list: DemoItem[]; i: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch('/feature-catalog.json').then(r => r.json())
      .then((d: Feat[]) => { if (alive) setFeats(Array.isArray(d) ? d : []); })
      .catch(() => { /* offline */ })
      .finally(() => alive && setLoading(false));
    fetch('/api/pipeline/upgrade/packs').then(r => r.json())
      .then((d: { packs?: Pack[] }) => { if (alive) setPacks(d.packs ?? []); })
      .catch(() => { /* offline */ });
    fetch('/schematics.json').then(r => r.json())
      .then((d: Schematic[]) => { if (alive) setSchematics(Array.isArray(d) ? d : []); })
      .catch(() => { /* none yet */ });
    return () => { alive = false; };
  }, []);

  const folders = useMemo(() => [...new Set(feats.map(f => f.folder))].sort(), [feats]);

  const filtered = useMemo(() => feats.filter(f =>
    (scope === 'all' || f.scope === scope) &&
    (folder === 'all' || f.folder === folder) &&
    (!q || `${f.name} ${f.description} ${f.id}`.toLowerCase().includes(q.toLowerCase())),
  ), [feats, scope, folder, q]);

  const grouped = useMemo(() => {
    const m: Record<string, Feat[]> = {};
    for (const f of filtered) (m[f.folder] ??= []).push(f);
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const open = (list: DemoItem[], i: number) => { soundEngine.motionPing?.(); setDemo({ list, i }); };
  const close = () => { soundEngine.hydraulicHiss?.(); setDemo(null); };
  const step = (d: number) => setDemo(cur => cur && { ...cur, i: Math.max(0, Math.min(cur.list.length - 1, cur.i + d)) });

  useEffect(() => {
    if (!demo) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [demo]);

  const catalogIds = useMemo(() => new Set(feats.map(f => f.id)), [feats]);
  const nameOf = (id: string) => feats.find(f => f.id === id)?.name ?? id;

  return (
    <div className="fsw">
      <div className="fsw-head">
        <div className="section-header">SHOWCASE — FEATURE LIBRARY</div>
        <div className="fsw-tabs">
          {(['features', 'sections', 'presets', 'schematics'] as const).map(t => (
            <button key={t} className={`fsw-tab${tab === t ? ' fsw-tab--on' : ''}`}
              onClick={() => { setTab(t); soundEngine.keyClack?.(); }}>
              {t === 'features' ? `FEATURES · ${feats.length}`
                : t === 'sections' ? `SECTIONS · ${ARCHETYPES.length}`
                : t === 'presets' ? `PRESETS · ${packs.length}` : `SCHEMATICS · ${schematics.length}`}
            </button>
          ))}
        </div>
      </div>

      <div className="fsw-body">
      {/* ── FEATURES ── */}
      {tab === 'features' && (
        <>
          <div className="fsw-controls">
            <input className="fsw-search" placeholder="search features…" value={q} onChange={e => setQ(e.target.value)} />
            <div className="fsw-chips">
              {SCOPES.map(s => (
                <button key={s} className={`fsw-chip${scope === s ? ' fsw-chip--on' : ''}`} onClick={() => setScope(s)}>{s}</button>
              ))}
            </div>
            <select className="fsw-select" value={folder} onChange={e => setFolder(e.target.value)}>
              <option value="all">all folders</option>
              {folders.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <span className="fsw-count">{filtered.length} shown</span>
          </div>

          {loading && <div className="fsw-empty"><span className="cursor">█</span> loading catalog…</div>}
          {!loading && !filtered.length && <div className="fsw-empty">no features match</div>}

          {grouped.map(([fld, items]) => {
            const list: DemoItem[] = items.map(f => ({ id: f.id, name: f.name }));
            return (
              <section key={fld} className="fsw-group">
                <h3 className="fsw-group__h">{fld} <span>· {items.length}</span></h3>
                <div className="fsw-grid">
                  {items.map((f, i) => (
                    <button key={f.id} className="fsw-card" onClick={() => open(list, i)} title="Open fullscreen demo">
                      <div className="fsw-card__name">{f.name}</div>
                      <div className="fsw-card__desc">{f.description}</div>
                      <div className="fsw-card__tags">
                        <span className={`fsw-scope fsw-scope--${f.scope}`}>{f.scope}</span>
                        <span className="fsw-arch">{f.sectionTypes.join(' ')}</span>
                        <span className="fsw-play">▶ demo</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}

      {/* ── SECTIONS (browse the library by section archetype) ── */}
      {tab === 'sections' && (
        <div className="fsw-sections">
          {loading && <div className="fsw-empty"><span className="cursor">█</span> loading…</div>}
          {ARCHETYPES.map(a => {
            const items = feats.filter(f => f.sectionTypes.includes(a.letter));
            if (!items.length) return null;
            const list: DemoItem[] = items.map(f => ({ id: f.id, name: f.name }));
            return (
              <section key={a.letter} className="fsw-group">
                <h3 className="fsw-group__h"><span className="fsw-arch-badge">{a.letter}</span> {a.name} <span>· {items.length}</span></h3>
                <div className="fsw-grid">
                  {items.map((f, i) => (
                    <button key={f.id} className="fsw-card" onClick={() => open(list, i)} title="Open fullscreen demo">
                      <div className="fsw-card__name">{f.name}</div>
                      <div className="fsw-card__desc">{f.description}</div>
                      <div className="fsw-card__tags">
                        <span className={`fsw-scope fsw-scope--${f.scope}`}>{f.scope}</span>
                        <span className="fsw-arch">{f.sectionTypes.join(' ')}</span>
                        <span className="fsw-play">▶ demo</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* ── PRESETS (upgrade packs → their member feature demos) ── */}
      {tab === 'presets' && (
        <div className="fsw-presets">
          {!packs.length && <div className="fsw-empty">no presets</div>}
          {packs.map(p => {
            const members = (p.features ?? []).filter(id => catalogIds.has(id));
            const list: DemoItem[] = members.map(id => ({ id, name: nameOf(id) }));
            return (
              <section key={p.id} className="fsw-preset">
                <div className="fsw-preset__head">
                  <h3 className="fsw-preset__name">{p.name}</h3>
                  <span className="fsw-preset__tag">{p.tagline}</span>
                </div>
                {p.thread && <p className="fsw-preset__thread">{p.thread}</p>}
                {members.length
                  ? <div className="fsw-preset__chips">
                      {members.map((id, i) => (
                        <button key={id + i} className="fsw-preset__chip" onClick={() => open(list, i)}>▶ {nameOf(id)}</button>
                      ))}
                    </div>
                  : <p className="fsw-empty" style={{ padding: '0.5rem 0' }}>member demos unavailable</p>}
              </section>
            );
          })}
        </div>
      )}

      {/* ── SCHEMATICS (composed multi-technique sections) ── */}
      {tab === 'schematics' && (
        schematics.length ? (
          <div className="fsw-sections">
            <p className="fsw-schem-note">Prebuilt sections that layer multiple animations/effects into one — click for the fullscreen live build.</p>
            <div className="fsw-grid fsw-grid--wide">
              {schematics.map((s, i) => (
                <button key={s.id} className="fsw-card fsw-card--schem"
                  onClick={() => open(schematics.map(x => ({ id: x.id, name: x.name, url: x.demo })), i)}
                  title="Open fullscreen build">
                  <div className="fsw-card__top">
                    <span className="fsw-arch-badge">{s.section}</span>
                    <span className="fsw-card__name">{s.name}</span>
                    <span className="fsw-schem-sec">{s.sectionName}</span>
                  </div>
                  <div className="fsw-card__desc">{s.description}</div>
                  <div className="fsw-combines">
                    {s.combines.map(c => <span key={c} className="fsw-combine">{c}</span>)}
                  </div>
                  <div className="fsw-card__tags">
                    <span className="fsw-arch">{s.libs.join(' · ')}</span>
                    <span className="fsw-play">▶ live build</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="fsw-empty fsw-empty--big">
            <div style={{ fontSize: 32, marginBottom: 12 }}>▦</div>
            No schematics yet.
          </div>
        )
      )}

      </div>{/* /fsw-body */}

      {/* ── Fullscreen demo overlay ── */}
      {demo && (() => {
        const cur = demo.list[demo.i];
        return (
          <div className="fsw-viewer" role="dialog" aria-label={`Demo: ${cur.name}`}>
            <div className="fsw-viewer__bar">
              <span className="fsw-viewer__name">{cur.name}</span>
              <span className="fsw-viewer__pos">{demo.i + 1} / {demo.list.length}</span>
              <span className="fsw-sp" />
              <button className="fsw-viewer__btn" disabled={demo.i === 0} onClick={() => step(-1)}>◀ prev</button>
              <button className="fsw-viewer__btn" disabled={demo.i === demo.list.length - 1} onClick={() => step(1)}>next ▶</button>
              <a className="fsw-viewer__btn" href={cur.url ?? demoUrl(cur.id)} target="_blank" rel="noreferrer">↗ new tab</a>
              <button className="fsw-viewer__btn fsw-viewer__x" onClick={close}>✕ esc</button>
            </div>
            <iframe key={cur.id} className="fsw-viewer__frame" src={cur.url ?? demoUrl(cur.id)} title={`${cur.name} demo`} />
          </div>
        );
      })()}
    </div>
  );
}
