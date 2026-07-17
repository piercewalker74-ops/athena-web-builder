import { useEffect } from 'react';
import { type NavPage } from './NavRail';
import { soundEngine } from '../audio/SoundEngine';

/* A distinct techy-retro animation that plays briefly when each section opens,
   then fades to reveal the content. One custom SVG per section. */

const LABELS: Record<NavPage, string> = {
  comms:      'SIGNAL LINK',
  operations: 'AUTOMATION CORE',
  missions:   'DATA STREAM',
  inbox:      'INBOUND QUEUE',
  pipeline:   'PIPELINE FLOW',
  showcase:   'FEATURE LIBRARY',
  memory:     'NEURAL RECALL',
};

// gear ring: N radial teeth around a hub
function Gear({ cx, cy, r, teeth = 10 }: { cx: number; cy: number; r: number; teeth?: number }) {
  const items = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const x1 = cx + Math.cos(a) * r, y1 = cy + Math.sin(a) * r;
    const x2 = cx + Math.cos(a) * (r + 7), y2 = cy + Math.sin(a) * (r + 7);
    items.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />);
  }
  return <>{items}<circle cx={cx} cy={cy} r={r} /><circle cx={cx} cy={cy} r={r * 0.4} /></>;
}

// neural graph: fixed nodes + edges (brain)
const NODES = [ [40,60],[95,40],[150,65],[55,120],[110,110],[160,130],[95,165] ];
const EDGES = [ [0,1],[1,2],[0,3],[1,4],[2,5],[3,4],[4,5],[3,6],[4,6],[5,6],[1,3] ];

function Art({ page }: { page: NavPage }) {
  switch (page) {
    case 'comms':
      return (
        <svg viewBox="0 0 200 200" className="si-svg si-svg--comms">
          {[0,1,2,3].map(i => <circle key={i} cx="100" cy="100" r="16" className="si-ring" style={{ animationDelay: `${i*0.16}s` }} />)}
          <circle cx="100" cy="100" r="5" className="si-core" />
        </svg>
      );
    case 'operations':
      return (
        <svg viewBox="0 0 200 200" className="si-svg">
          <g className="si-gear si-gear--cw"><Gear cx={82} cy={100} r={34} teeth={12} /></g>
          <g className="si-gear si-gear--ccw"><Gear cx={140} cy={70} r={22} teeth={9} /></g>
        </svg>
      );
    case 'missions':
      return (
        <svg viewBox="0 0 200 200" className="si-svg">
          {[30,60,90,120,150,170].map((x,i) => (
            <g key={i} className="si-col" style={{ animationDelay: `${(i%3)*0.12}s`, animationDuration: `${1+i*0.08}s` }}>
              {[0,1,2,3,4,5].map(j => <rect key={j} x={x} y={j*30} width="14" height="8" />)}
            </g>
          ))}
        </svg>
      );
    case 'inbox':
      return (
        <svg viewBox="0 0 200 200" className="si-svg">
          {[[20,30],[180,50],[15,150],[185,160],[100,10]].map(([x,y],i) => (
            <rect key={i} x={x} y={y} width="16" height="11" className="si-packet"
              style={{ ['--fx' as string]: `${100-x}px`, ['--fy' as string]: `${100-y}px`, animationDelay: `${i*0.14}s` }} />
          ))}
          <rect x="82" y="90" width="36" height="24" className="si-tray" />
        </svg>
      );
    case 'pipeline':
      return (
        <svg viewBox="0 0 200 200" className="si-svg">
          <line x1="20" y1="100" x2="180" y2="100" className="si-track" />
          {[40,80,120,160].map((x,i) => <circle key={i} cx={x} cy="100" r="8" className="si-node" style={{ animationDelay:`${i*0.15}s` }} />)}
          <circle cx="20" cy="100" r="6" className="si-flow" />
        </svg>
      );
    case 'memory':
      return (
        <svg viewBox="0 0 200 200" className="si-svg">
          {EDGES.map(([a,b],i) => (
            <line key={i} x1={NODES[a][0]} y1={NODES[a][1]} x2={NODES[b][0]} y2={NODES[b][1]} className="si-synapse" style={{ animationDelay:`${i*0.09}s` }} />
          ))}
          {NODES.map(([x,y],i) => <circle key={i} cx={x} cy={y} r="6" className="si-neuron" style={{ animationDelay:`${i*0.12}s` }} />)}
        </svg>
      );
  }
}

export function SectionIntro({ page }: { page: NavPage }) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Staggered keyClack burst — content typing into view (matches scan-in animation delay)
    const clackDelays = [360, 430, 510, 600, 690, 790];
    const clackTimers = clackDelays.map(d => setTimeout(() => soundEngine.keyClack(), d));
    // Section-specific cue after content is fully revealed
    const cueId = setTimeout(() => {
      switch (page) {
        case 'comms':      soundEngine.commChirp(); break;
        case 'operations': soundEngine.motionPing(); break;
        case 'missions':   soundEngine.bootBeep(880); break;
        case 'inbox':      soundEngine.transmitReceived(); break;
        case 'pipeline':   soundEngine.bootBeep(330); break;
        case 'memory':     soundEngine.klaxon(); break;
      }
    }, 860);
    return () => { clackTimers.forEach(clearTimeout); clearTimeout(cueId); };
  }, [page]);

  return (
    <div className={`section-intro si--${page}`} aria-hidden="true">
      <Art page={page} />
      <div className="si-label">{LABELS[page]}</div>
    </div>
  );
}
