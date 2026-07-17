import { useEffect, useRef, useState } from 'react';
import '../styles/build-tracker-mini.css';

/**
 * BUILD TRACKER — MINI. A floating, movable HUD twin of the Sector Map:
 * identical border + drag/collapse chrome (pointer-drag with localStorage,
 * click to collapse, double-click to reset position). The body is the
 * amber-core / green-atmosphere orbital tracker (three.js) in an iframe,
 * so the run can be watched from any section. Readout polls the pipeline.
 */

const STAGES = ['SCOUT','VERIFY','QUALIFY','CALIBRATE','ARCHITECT','BUILD','QA','DEPLOY','REPORT','DELIVER'];
const STATUS_STAGE: Record<string, number> = { scraped:0,verifying:1,qualified:2,approved:3,building:5,deployed:7,reported:8,delivered:9,dropped:-1 };
const N = STAGES.length;

interface Props { visible: boolean; }

export function MiniTracker({ visible }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [stage, setStage] = useState('—');
  const [pct, setPct] = useState<number | null>(null);

  const POS_KEY = 'athena.build-tracker.pos';
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as { x: number; y: number };
      return {
        x: Math.max(0, Math.min(p.x, window.innerWidth - 100)),
        y: Math.max(0, Math.min(p.y, window.innerHeight - 40)),
      };
    } catch { return null; }
  });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null);
  const wasDragRef = useRef(false);
  const posRef = useRef(pos);

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const root = rootRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    dragRef.current = { px: e.clientX, py: e.clientY, ox: r.left, oy: r.top, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
  };
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current, root = rootRef.current;
    if (!d || !root) return;
    const dx = e.clientX - d.px, dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    const r = root.getBoundingClientRect();
    const next = {
      x: Math.max(0, Math.min(d.ox + dx, window.innerWidth - r.width)),
      y: Math.max(0, Math.min(d.oy + dy, window.innerHeight - r.height)),
    };
    posRef.current = next;
    setPos(next);
  };
  const onHeaderPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* synthetic */ }
    wasDragRef.current = !!d?.moved;
    if (d?.moved && posRef.current) {
      try { localStorage.setItem(POS_KEY, JSON.stringify(posRef.current)); } catch { /* ignore */ }
    }
  };
  const onHeaderClick = () => {
    if (wasDragRef.current) { wasDragRef.current = false; return; }
    setCollapsed(c => !c);
  };
  const onHeaderDoubleClick = () => {
    posRef.current = null;
    setPos(null);
    try { localStorage.removeItem(POS_KEY); } catch { /* ignore */ }
  };

  // Poll the pipeline for the readout strip (stage + %)
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const arr = await (await fetch('/api/pipeline/leads')).json();
        const leads = Array.isArray(arr) ? arr : (arr.leads || []);
        const active = leads.filter((l: any) => l.status !== 'delivered' && l.status !== 'dropped')
          .sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]
          || leads.sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
        if (!alive) return;
        if (!active) { setStage('—'); setPct(null); return; }
        if (active.status === 'dropped') { setStage('DROPPED'); setPct(null); return; }
        let idx = STATUS_STAGE[active.status] ?? -1;
        if (active.status !== 'delivered' && active.buildStage) {
          const fi = STAGES.indexOf(String(active.buildStage).toUpperCase());
          if (fi >= 0) idx = fi;
        }
        setStage(idx >= 0 ? STAGES[idx] : '—');
        setPct(idx < 0 ? null : Math.round(idx / (N - 1) * 100));
      } catch { /* offline */ }
    };
    void poll();
    const iv = setInterval(() => void poll(), 4000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  if (!visible) return null;

  return (
    <div className={`btmini${collapsed ? ' btmini--collapsed' : ''}`}
         ref={rootRef}
         style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
         role="complementary" aria-label="Build tracker">
      <button
        className="btmini__header"
        onClick={onHeaderClick}
        onDoubleClick={onHeaderDoubleClick}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        title="Drag to move · click to collapse · double-click to reset position"
        aria-expanded={!collapsed}
      >
        <span className="btmini__header-dot" aria-hidden="true" />
        BUILD TRACKER
        <span className="btmini__header-chev" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
      </button>

      <div className="btmini__body">
        <iframe className="btmini__frame" src="/build-tracker-mini.html?embed=1"
                title="Build tracker orbital" scrolling="no" />
      </div>

      {!collapsed && (
        <div className="btmini__readout">
          <span className="btmini__readout-key">STG</span>
          <span className="btmini__readout-val">{stage}</span>
          {pct !== null && <span className="btmini__readout-pct">{pct}%</span>}
        </div>
      )}
    </div>
  );
}
