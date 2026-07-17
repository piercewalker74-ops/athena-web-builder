import { useEffect, useRef, useState } from 'react';
import { soundEngine } from '../audio/SoundEngine';

interface Pack { id: string; name: string; tagline: string; }

/**
 * UPGRADE — per-project dropdown that queues a visual upgrade edit on the build lane.
 *   Add Features ▸  → pick one of the themed feature packs (Athena applies it with continuity)
 *   Redundancy Check → Athena varies up sections that look too alike
 *   Add Section ▸    → describe a new section to build + insert
 * Lives next to the EDIT / live buttons on the project card. Stops card-click propagation.
 */
export function UpgradeMenu({ slug, onQueued }: { slug: string; onQueued?: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'menu' | 'packs' | 'section'>('menu');
  const [packs, setPacks] = useState<Pack[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && packs.length === 0) {
      fetch('/api/pipeline/upgrade/packs').then(r => r.json())
        .then((d: { packs?: Pack[] }) => setPacks(d.packs ?? [])).catch(() => { /* offline */ });
    }
  }, [open, packs.length]);

  const send = async (body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true); soundEngine.motionPing();
    try {
      const r = await fetch('/api/pipeline/upgrade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, ...body }),
      });
      const d = await r.json() as { ok?: boolean; message?: string; error?: string };
      setDone(d.ok ? '⬆ queued' : (d.error ?? 'failed'));
      if (d.ok) onQueued?.(d.message ?? '');
      setTimeout(() => { setOpen(false); setView('menu'); setDone(''); setText(''); }, 1500);
    } catch { setDone('offline'); }
    finally { setBusy(false); }
  };

  const close = () => { if (!busy) { setOpen(false); setView('menu'); } };

  return (
    <div ref={ref} className="pv-up" onMouseLeave={close} onClick={e => e.stopPropagation()}>
      <button className={`pv-card__upgrade${open ? ' pv-card__upgrade--open' : ''}`} onClick={() => { setOpen(o => !o); soundEngine.keyClack(); }}>
        ⬆ UPGRADE
      </button>
      {open && (
        <div className="pv-up-menu" role="menu">
          {done ? (
            <div className="pv-up-done">{done}</div>
          ) : busy ? (
            <div className="pv-up-done">◌ queuing…</div>
          ) : view === 'menu' ? (
            <>
              <button className="pv-up-item" role="menuitem" onClick={() => setView('packs')}>✦ Add Features ▸</button>
              <button className="pv-up-item" role="menuitem" onClick={() => void send({ mode: 'redundancy' })}>◫ Redundancy Check</button>
              <button className="pv-up-item" role="menuitem" onClick={() => setView('section')}>＋ Add Section ▸</button>
            </>
          ) : view === 'packs' ? (
            <>
              <div className="pv-up-head">FEATURE PACK</div>
              {packs.length === 0 && <div className="pv-up-done">loading…</div>}
              {packs.map(p => (
                <button key={p.id} className="pv-up-item pv-up-pack" onClick={() => void send({ mode: 'features', packId: p.id })}>
                  <b>{p.name}</b><span>{p.tagline}</span>
                </button>
              ))}
              <button className="pv-up-back" onClick={() => setView('menu')}>← back</button>
            </>
          ) : (
            <>
              <div className="pv-up-head">DESCRIBE THE SECTION</div>
              <textarea
                className="pv-up-text" autoFocus rows={3}
                placeholder="what you're picturing… (e.g. a financing / gift-card banner, an FAQ, a fleet-services block)"
                value={text} onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) void send({ mode: 'section', description: text }); }}
              />
              <div className="pv-up-row">
                <button className="pv-up-back" onClick={() => setView('menu')}>← back</button>
                <button className="pv-up-go" disabled={busy || !text.trim()} onClick={() => void send({ mode: 'section', description: text })}>Queue ▸</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
