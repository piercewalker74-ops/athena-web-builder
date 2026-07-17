import { useEffect, useRef, useState } from 'react';
import type { NavPage } from './NavRail';
import { soundEngine } from '../audio/SoundEngine';
import '../styles/sector-map.css';

/**
 * SECTOR MAP — top-left 3D minimap of the bridge (M2 fusion build).
 * A wireframe containment sphere wraps a depth-field constellation:
 * amber ATHENA core, orbit rings, drifting dust particles, and seven
 * conglomerates — one per section. The active one is lit holo-blue
 * with a targeting reticle; clicking another rotates the whole map to
 * bring it front-center and navigates. Plays a cartography boot intro
 * after the bridge boot, and a faster re-scan on every section change.
 */

interface Props {
  active: NavPage;
  onNavigate: (page: NavPage) => void;
  visible: boolean;
}

/* ── World constants (engine space; canvas scales to rail width) ── */
const W = 260, H = 240, CX = W / 2, CY = H / 2 + 4;
const R = 84;                 // conglomerate orbit radius
const F = 300;                // perspective focal length
const SPHERE_R = 106;         // containment sphere radius
const SPHERE_ALPHA = 0.1;
const INTRO_END = 3.2;        // intro duration (intro-clock seconds)
const DEG = Math.PI / 180;

const COL = {
  amber: '#ffb000', amberDim: '#cc8800', amberGhost: '#4d3300',
  holo: '#00c8ff', holoDim: '#0088bb', chrome: '#7a8fa8',
};

const RM = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SatOff { x: number; y: number; z: number; r: number; phase: number; }
interface Sector {
  id: NavPage; label: string; theta: number; yvar: number; satsOff: SatOff[];
}

const SECTORS: Sector[] = ([
  { id: 'comms',      label: 'COMMS',    angle:   0, sats: 5, yvar: -26 },
  { id: 'operations', label: 'OPS',      angle:  60, sats: 4, yvar:  18 },
  { id: 'missions',   label: 'LOG',      angle: 120, sats: 3, yvar:  -8 },
  { id: 'inbox',      label: 'INBOX',    angle: 180, sats: 3, yvar:  28 },
  { id: 'pipeline',   label: 'PIPELINE', angle: 240, sats: 4, yvar: -20 },
  { id: 'memory',     label: 'MEMORY',   angle: 300, sats: 3, yvar: -30 },
] as const).map((s, i) => {
  const rand = mulberry32(i * 7919 + 17);
  return {
    id: s.id, label: s.label,
    theta: (s.angle - 90) * DEG,
    yvar: s.yvar,
    satsOff: Array.from({ length: s.sats }, () => {
      const az = rand() * Math.PI * 2;
      const el = (rand() - 0.5) * Math.PI * 0.7;
      const d = 9 + rand() * 9;
      return {
        x: d * Math.cos(el) * Math.cos(az),
        y: d * Math.sin(el),
        z: d * Math.cos(el) * Math.sin(az),
        r: 1.1 + rand() * 1.2,
        phase: rand() * Math.PI * 2,
      };
    }),
  };
});

const STARS = (() => {
  const rand = mulberry32(4242);
  return Array.from({ length: 46 }, () => {
    const az = rand() * Math.PI * 2;
    const el = (rand() - 0.5) * Math.PI * 0.8;
    const d = 105 + rand() * 40;
    return {
      x: d * Math.cos(el) * Math.cos(az),
      y: d * Math.sin(el),
      z: d * Math.cos(el) * Math.sin(az),
      a: 0.08 + rand() * 0.2,
      tw: 0.4 + rand() * 1.6,
      ph: rand() * Math.PI * 2,
    };
  });
})();

const PARTICLES = (() => {
  const rand = mulberry32(90210);
  return Array.from({ length: 90 }, () => {
    const holoTint = rand() < 0.16;
    return {
      rad:  18 + rand() * 86,
      a0:   rand() * Math.PI * 2,
      spin: (rand() - 0.35) * 0.06,
      y0:   (rand() - 0.5) * 78,
      bobA: 2 + rand() * 5,
      bobF: 0.15 + rand() * 0.35,
      r:    0.4 + rand() * 0.9,
      a:    0.1 + rand() * 0.3,
      tw:   0.3 + rand() * 1.4,
      ph:   rand() * Math.PI * 2,
      col:  holoTint ? COL.holoDim : (rand() < 0.5 ? COL.amberDim : COL.chrome),
    };
  });
})();

const PITCH = 0.56;

function frontAzimuth(s: Sector) {
  return -s.theta - Math.PI / 2;
}

function hubPos(s: Sector) {
  return { x: R * Math.cos(s.theta), y: s.yvar * 0.5, z: R * Math.sin(s.theta) };
}

interface P3 { x: number; y: number; z: number; }
interface P2 { x: number; y: number; s: number; d: number; }

function makeProj(az: number, pitch: number) {
  const ca = Math.cos(az), sa = Math.sin(az);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return (p: P3): P2 => {
    const xr = p.x * ca - p.z * sa;
    const zr = p.x * sa + p.z * ca;
    const yr = p.y * cp - zr * sp;
    const d  = p.y * sp + zr * cp;
    const s  = F / (F + d);
    return { x: CX + xr * s, y: CY + yr * s, s, d };
  };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const easeOutBack = (x: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

interface EngineState {
  activeId: NavPage;
  hoverId: NavPage | null;
  azimuth: number;
  targetAz: number;
  mouseX: number;
  mouseY: number;
  introStart: number;      // performance.now() ms; -Infinity = intro done
  introSpeed: number;
  prevIT: number;
  hubScreens: Partial<Record<NavPage, { x: number; y: number }>>;
}

export function SectorMap({ active, onNavigate, visible }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bootedRef = useRef(false);

  // Draggable position — null = default corner (CSS right/bottom)
  const POS_KEY = 'athena.sector-map.pos';
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
  const posRef = useRef(pos);          // latest position, immune to render lag

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const root = rootRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    dragRef.current = { px: e.clientX, py: e.clientY, ox: r.left, oy: r.top, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
  };

  const onHeaderPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    const root = rootRef.current;
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
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* synthetic event */ }
    wasDragRef.current = !!d?.moved;
    if (d?.moved && posRef.current) {
      try { localStorage.setItem(POS_KEY, JSON.stringify(posRef.current)); } catch { /* ignore */ }
    }
  };

  const onHeaderClick = () => {
    if (wasDragRef.current) { wasDragRef.current = false; return; }  // drag, not a toggle
    setCollapsed(c => !c);
  };

  const onHeaderDoubleClick = () => {
    posRef.current = null;
    setPos(null);                                  // snap back to the corner
    try { localStorage.removeItem(POS_KEY); } catch { /* ignore */ }
  };
  const prevActiveRef = useRef<NavPage>(active);
  const stRef = useRef<EngineState>({
    activeId: active,
    hoverId: null,
    azimuth: frontAzimuth(SECTORS[0]),
    targetAz: frontAzimuth(SECTORS.find(s => s.id === active) ?? SECTORS[0]),
    mouseX: 0, mouseY: 0,
    introStart: -1e15,       // "long finished" until boot triggers it
    introSpeed: 1,
    prevIT: INTRO_END + 1,
    hubScreens: {},
  });
  stRef.current.activeId = active;

  const startIntro = (speed: number) => {
    const st = stRef.current;
    st.introSpeed = speed;
    st.introStart = performance.now();
    st.prevIT = 0;
    if (!RM) st.azimuth = st.targetAz + 2.6;   // swing-in while booting
    const cv = canvasRef.current;
    if (cv) {                                   // restart CRT power-on flicker
      cv.classList.remove('sector-map__canvas--boot');
      void cv.offsetWidth;
      cv.classList.add('sector-map__canvas--boot');
    }
    soundEngine.scanSweep();
  };

  // Boot intro — once, when the bridge becomes visible
  useEffect(() => {
    if (visible && !bootedRef.current) {
      bootedRef.current = true;
      startIntro(1);
    }
  }, [visible]);

  // Section change — rotate to the new conglomerate + fast re-scan
  useEffect(() => {
    const st = stRef.current;
    const sector = SECTORS.find(s => s.id === active);
    if (sector) st.targetAz = frontAzimuth(sector);
    if (prevActiveRef.current !== active) {
      prevActiveRef.current = active;
      if (bootedRef.current) startIntro(1.7);
    }
  }, [active]);

  // Render loop
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    let raf = 0;
    let last = performance.now();

    /* ── draw helpers (engine space) ── */
    const polyline = (pts: { x: number; y: number }[], stroke: string, width: number,
                      alpha: number, dash?: number[], dashOffset?: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      if (dash) {
        ctx.setLineDash(dash);
        if (dashOffset) ctx.lineDashOffset = dashOffset;
      }
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.restore();
    };

    const circlePts = (r: number, y: number, proj: (p: P3) => P2, n = 48) => {
      const pts: P2[] = [];
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push(proj({ x: r * Math.cos(a), y, z: r * Math.sin(a) }));
      }
      return pts;
    };

    const dot = (x: number, y: number, r: number, fill: string, alpha: number, glow?: string | null) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 7; }
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const strokeDepthLine = (pts: P2[], baseAlpha: number, frac = 1) => {
      const n = Math.max(1, Math.round(frac * (pts.length - 1)));
      for (let i = 1; i <= n; i++) {
        const front = (pts[i].d + pts[i - 1].d) / 2 < 0;
        polyline([pts[i - 1], pts[i]], COL.amberGhost, 0.7,
                 front ? baseAlpha * 2.2 : baseAlpha * 0.55);
      }
    };

    const render = (t: number) => {
      const st = stRef.current;
      const IT = RM ? INTRO_END + 1
        : ((performance.now() - st.introStart) / 1000) * st.introSpeed;
      const ramp = (t0: number, t1: number) => clamp01((IT - t0) / (t1 - t0));

      // Intro SFX beat — reticle lock
      if (st.prevIT < 2.5 && IT >= 2.5 && IT < INTRO_END + 0.5) soundEngine.motionPing();
      st.prevIT = IT;

      // Resize backing store to the rail width (canvas scales uniformly)
      const cssW = cv.clientWidth;
      if (cssW === 0) return;                    // collapsed / hidden
      const scale = cssW / W;
      const bw = Math.round(cssW * dpr);
      const bh = Math.round(cssW * (H / W) * dpr);
      if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const sway = RM ? 0 : Math.sin(t * 0.45) * 0.05;
      const az = st.azimuth + sway + st.mouseX * 0.14;
      const proj = makeProj(az, PITCH + st.mouseY * 0.09);

      /* Nebula glow */
      ctx.save();
      ctx.globalAlpha = ramp(0.1, 0.9);
      const g = ctx.createRadialGradient(CX, CY, 4, CX, CY, 118);
      g.addColorStop(0,   'rgba(255,176,0,0.075)');
      g.addColorStop(0.4, 'rgba(255,176,0,0.028)');
      g.addColorStop(1,   'rgba(255,176,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const g2 = ctx.createRadialGradient(CX, CY - 30, 4, CX, CY - 30, 90);
      g2.addColorStop(0, 'rgba(0,200,255,0.035)');
      g2.addColorStop(1, 'rgba(0,200,255,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      /* Stars */
      const starBoot = ramp(0.05, 0.7);
      STARS.forEach(s => {
        const p = proj(s);
        const tw = RM ? 1 : 0.65 + 0.35 * Math.sin(t * s.tw + s.ph);
        dot(p.x, p.y, 0.8 * p.s, COL.chrome, s.a * p.s * tw * starBoot);
      });

      /* Containment sphere — wires sweep in during intro */
      [-60, -30, 0, 30, 60].forEach((la, li) => {
        const f = ramp(0.15 + li * 0.09, 0.85 + li * 0.09);
        if (f <= 0) return;
        const y = -SPHERE_R * Math.sin(la * DEG);
        const r = SPHERE_R * Math.cos(la * DEG);
        strokeDepthLine(circlePts(r, y, proj), SPHERE_ALPHA, f);
      });
      for (let lo = 0, lj = 0; lo < 180; lo += 30, lj++) {
        const f = ramp(0.3 + lj * 0.07, 1.0 + lj * 0.07);
        if (f <= 0) continue;
        const pts: P2[] = [];
        for (let i = 0; i <= 48; i++) {
          const a = (i / 48) * Math.PI * 2;
          pts.push(proj({
            x: SPHERE_R * Math.cos(a) * Math.cos(lo * DEG),
            y: -SPHERE_R * Math.sin(a),
            z: SPHERE_R * Math.cos(a) * Math.sin(lo * DEG),
          }));
        }
        strokeDepthLine(pts, SPHERE_ALPHA, f);
      }

      /* Orbit rings — expand from the core */
      [28, 56, 84, 100].forEach((r, i) => {
        const f = easeOut(ramp(0.55 + i * 0.14, 1.15 + i * 0.14));
        if (f <= 0) return;
        polyline(circlePts(r * f, 0, proj, 64), COL.amberGhost, 0.7,
                 (0.5 - i * 0.09) * f, [2, 4], RM ? 0 : t * (i % 2 ? 1.6 : -1.2));
      });

      /* Dust particles */
      const partBoot = ramp(1.4, 2.8);
      if (partBoot > 0) {
        PARTICLES.forEach(p => {
          const a = p.a0 + (RM ? 0 : t * p.spin);
          const y = p.y0 + (RM ? 0 : Math.sin(t * p.bobF + p.ph) * p.bobA);
          const pr = proj({ x: p.rad * Math.cos(a), y, z: p.rad * Math.sin(a) });
          const tw = RM ? 1 : 0.55 + 0.45 * Math.sin(t * p.tw + p.ph);
          dot(pr.x, pr.y, Math.max(0.3, p.r * pr.s), p.col,
              p.a * tw * Math.min(1.25, pr.s) * partBoot);
        });
      }

      const core = proj({ x: 0, y: 0, z: 0 });

      interface Node {
        d: number; x: number; y: number; r: number;
        fill: string; alpha: number; glow: string | null; core?: boolean;
      }
      const nodes: Node[] = [];
      const labels: { x: number; y: number; text: string; active: boolean; hover: boolean; alpha: number }[] = [];
      st.hubScreens = {};

      SECTORS.forEach((s, si) => {
        const hw = hubPos(s);
        const hp = proj(hw);
        const isActive = s.id === st.activeId;
        const isHover = s.id === st.hoverId;
        st.hubScreens[s.id] = { x: hp.x, y: hp.y };

        const bt = 1.1 + si * 0.16;
        const linkF = easeOut(ramp(bt, bt + 0.3));
        const hubF  = ramp(bt + 0.12, bt + 0.42);
        const satF  = ramp(bt + 0.28, bt + 0.75);
        const labF  = ramp(bt + 0.32, bt + 0.65);
        if (linkF <= 0) return;

        const tip = { x: core.x + (hp.x - core.x) * linkF, y: core.y + (hp.y - core.y) * linkF };
        polyline([core, tip], isActive ? COL.holoDim : COL.amberGhost,
                 isActive ? 0.9 : 0.5, isActive ? 0.8 : 0.45,
                 isActive ? [4, 2] : [1, 3]);

        const drift = RM ? 0 : t * 0.22;
        s.satsOff.forEach(o => {
          const ca = Math.cos(drift + o.phase), sa = Math.sin(drift + o.phase);
          const ox = o.x * ca + o.z * sa, oz = -o.x * sa + o.z * ca;
          const sp = proj({ x: hw.x + ox, y: hw.y + o.y, z: hw.z + oz });
          if (satF > 0) {
            polyline([hp, sp], isActive ? COL.holoDim : COL.amberGhost, 0.45,
                     (isActive ? 0.4 : 0.22) * satF);
            nodes.push({
              d: sp.d, x: sp.x, y: sp.y, r: o.r * sp.s,
              fill: isActive ? COL.holo : (isHover ? COL.amber : COL.amberDim),
              alpha: (isActive ? 0.9 : 0.5) * satF,
              glow: isActive ? 'rgba(0,200,255,0.6)' : null,
            });
          }
        });

        if (hubF > 0) {
          const pop = hubF < 1 ? easeOutBack(hubF) : 1;
          nodes.push({
            d: hp.d, x: hp.x, y: hp.y, r: 3.2 * hp.s * pop,
            fill: isActive ? COL.holo : (isHover ? COL.amber : COL.amberDim),
            alpha: Math.min(1, hubF * 2),
            glow: (isActive || hubF < 1)
              ? (isActive ? 'rgba(0,200,255,0.8)' : 'rgba(255,176,0,0.7)')
              : (isHover ? 'rgba(255,176,0,0.6)' : null),
          });
        }

        if (labF > 0) {
          labels.push({
            x: hp.x, y: hp.y - 13 * hp.s - 4,
            text: s.label, active: isActive, hover: isHover, alpha: labF,
          });
        }

        const retF = ramp(2.5, 2.9);
        if (isActive && retF > 0) {
          const retScale = 1 + (1 - easeOut(retF)) * 1.9;
          ctx.save();
          ctx.globalAlpha = 0.95 * retF;
          ctx.strokeStyle = COL.holo;
          ctx.shadowColor = 'rgba(0,200,255,0.6)';
          ctx.shadowBlur = 5;
          ctx.lineWidth = 0.9;
          ctx.setLineDash([5, 4]);
          ctx.lineDashOffset = RM ? 0 : -t * 6;
          ctx.beginPath();
          ctx.arc(hp.x, hp.y, 12 * hp.s * retScale, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          const gg = 15 * hp.s * retScale;
          ([[-gg, 0, -gg + 5, 0], [gg - 5, 0, gg, 0],
            [0, -gg, 0, -gg + 5], [0, gg - 5, 0, gg]] as const).forEach(([x1, y1, x2, y2]) => {
            ctx.beginPath();
            ctx.moveTo(hp.x + x1, hp.y + y1);
            ctx.lineTo(hp.x + x2, hp.y + y2);
            ctx.stroke();
          });
          ctx.restore();
        }
      });

      /* Core — ignites during intro */
      const coreF = ramp(0.35, 0.7);
      const pulse = RM ? 0 : Math.sin(t * 2) * 1.4;
      if (coreF > 0) {
        ctx.save();
        ctx.globalAlpha = 0.9 * coreF;
        ctx.strokeStyle = COL.amberGhost;
        ctx.beginPath();
        ctx.arc(core.x, core.y, (10 + pulse) * core.s, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        const flash = 1 - ramp(0.5, 1.25);
        if (flash > 0 && flash < 1) {
          ctx.save();
          ctx.globalAlpha = flash * 0.55;
          ctx.strokeStyle = COL.amber;
          ctx.shadowColor = 'rgba(255,176,0,0.7)';
          ctx.shadowBlur = 8;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.arc(core.x, core.y, (6 + (1 - flash) * 38) * core.s, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        nodes.push({
          d: core.d, x: core.x, y: core.y,
          r: 4.6 * core.s * (coreF < 1 ? easeOutBack(coreF) : 1),
          fill: COL.amber, alpha: coreF,
          glow: 'rgba(255,176,0,0.7)', core: true,
        });
      }

      /* Depth sort far → near */
      nodes.sort((a, b) => b.d - a.d);
      nodes.forEach(n => {
        dot(n.x, n.y, Math.max(0.4, n.r), n.fill, n.alpha, n.glow);
        if (n.core) {
          ctx.save();
          ctx.globalAlpha = n.alpha;
          ctx.fillStyle = '#050501';
          ctx.font = 'bold 6.5px Courier New';
          ctx.textAlign = 'center';
          ctx.fillText('Λ', n.x, n.y + 2.4);
          ctx.restore();
        }
      });

      /* Labels */
      labels.forEach(l => {
        ctx.save();
        ctx.globalAlpha = (l.active ? 1 : l.hover ? 0.95 : 0.6) * l.alpha;
        ctx.fillStyle = l.active ? COL.holo : (l.hover ? COL.amber : COL.chrome);
        ctx.font = `${l.active ? 'bold ' : ''}9px Courier New`;
        ctx.textAlign = 'center';
        if (l.active) { ctx.shadowColor = 'rgba(0,200,255,0.55)'; ctx.shadowBlur = 5; }
        ctx.fillText(l.text, l.x, l.y);
        ctx.restore();
      });

      /* Boot text */
      if (IT < 2.4) {
        const msg = 'SECTOR CARTOGRAPHY ONLINE';
        const n = Math.floor(ramp(0.3, 1.5) * msg.length);
        if (n > 0) {
          const fade = 1 - ramp(2.05, 2.4);
          const cursor = Math.floor(t * 3) % 2 === 0 ? '▮' : ' ';
          ctx.save();
          ctx.globalAlpha = fade;
          ctx.fillStyle = COL.amber;
          ctx.shadowColor = 'rgba(255,176,0,0.5)';
          ctx.shadowBlur = 4;
          ctx.font = '9px Courier New';
          ctx.textAlign = 'center';
          ctx.fillText(msg.slice(0, n) + (n < msg.length ? cursor : ''), CX, H - 8);
          ctx.restore();
        }
      }
    };

    const loop = (now: number) => {
      const st = stRef.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      let diff = st.targetAz - st.azimuth;
      diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      st.azimuth += RM ? diff : diff * Math.min(1, dt * 3.6);

      render(now / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ── Pointer interaction ── */
  const toEngine = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (W / rect.width),
      y: (e.clientY - rect.top) * (H / (rect.width * (H / W))),
    };
  };

  const hitTest = (x: number, y: number): Sector | null => {
    let best: Sector | null = null, bestD = 20;
    for (const s of SECTORS) {
      const p = stRef.current.hubScreens[s.id];
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  };

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const st = stRef.current;
    const { x, y } = toEngine(e);
    st.mouseX = (x / W) * 2 - 1;
    st.mouseY = (y / H) * 2 - 1;
    const hit = hitTest(x, y);
    st.hoverId = hit ? hit.id : null;
    e.currentTarget.classList.toggle(
      'sector-map__canvas--hover', !!hit && hit.id !== active);
  };

  const handleLeave = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const st = stRef.current;
    st.mouseX = 0; st.mouseY = 0; st.hoverId = null;
    e.currentTarget.classList.remove('sector-map__canvas--hover');
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = toEngine(e);
    const hit = hitTest(x, y);
    if (hit && hit.id !== active) onNavigate(hit.id);
  };

  const activeLabel = SECTORS.find(s => s.id === active)?.label ?? '';

  return (
    <div className={`sector-map${collapsed ? ' sector-map--collapsed' : ''}`}
         ref={rootRef}
         style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
         role="navigation" aria-label="Sector map">
      <button
        className="sector-map__header"
        onClick={onHeaderClick}
        onDoubleClick={onHeaderDoubleClick}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        title="Drag to move · click to collapse · double-click to reset position"
        aria-expanded={!collapsed}
      >
        <span className="sector-map__header-dot" aria-hidden="true" />
        SECTOR MAP
        <span className="sector-map__header-chev" aria-hidden="true">
          {collapsed ? '▸' : '▾'}
        </span>
      </button>

      <canvas
        ref={canvasRef}
        className="sector-map__canvas"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onClick={handleClick}
        aria-label="3D sector map — click a conglomerate to navigate"
      />

      {!collapsed && (
        <div className="sector-map__readout">
          <span className="sector-map__readout-key">SEC</span>
          <span className="sector-map__readout-val">{activeLabel}</span>
        </div>
      )}
    </div>
  );
}
