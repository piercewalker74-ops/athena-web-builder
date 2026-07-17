import { useEffect, useRef, useState } from 'react';
import { soundEngine } from '../audio/SoundEngine';

// ─── Boot script ─────────────────────────────────────────────────────────────
// delay = absolute ms from boot start; type drives CSS class + SFX
type LineType = 'header' | 'sub' | 'div' | 'blank' | 'normal' | 'check' | 'ready';

interface BootLine { text: string; type: LineType; delay: number; sfx?: 'clack' | 'beep' | 'chirp'; }

const DIVIDER = '─'.repeat(54);

const SCRIPT: BootLine[] = [
  { text: '',                                                    type: 'blank',  delay:    0 },
  { text: 'WEYLAND-YUTANI CORPORATION',                         type: 'header', delay:   80 },
  { text: 'MU/TH/UR 6000  ─  COMMERCIAL INTERFACE SYSTEM',     type: 'sub',    delay:  260 },
  { text: 'ATHENA TACTICAL CONTROL BRIDGE   v1.0.0',            type: 'sub',    delay:  410 },
  { text: DIVIDER,                                              type: 'div',    delay:  530 },
  { text: '',                                                    type: 'blank',  delay:  620 },
  { text: 'INITIATING BOOT SEQUENCE ...',                       type: 'normal', delay:  720 },
  { text: '',                                                    type: 'blank',  delay:  910 },
  { text: '[BIOS]           STAGE 1 CHECKSUM ........... OK',   type: 'check',  delay: 1010, sfx: 'clack' },
  { text: '[MEMORY]         64 KB DIAGNOSTIC ........... PASS', type: 'check',  delay: 1340, sfx: 'clack' },
  { text: '[NEURAL BRIDGE]  HOST SYNC .................. LINK', type: 'check',  delay: 1640, sfx: 'clack' },
  { text: '[COMMS ARRAY]    GATEWAY PROBE .............. ACTIVE',type:'check',  delay: 1940, sfx: 'clack' },
  { text: '[SECURITY]       ENCRYPTION ................. ARMED', type: 'check',  delay: 2240, sfx: 'clack' },
  { text: '[SENSOR GRID]    TELEMETRY .................. NOMINAL',type:'check',  delay: 2540, sfx: 'clack' },
  { text: '[MISSION CLOCK]  UTC SYNC ................... SET',   type: 'check',  delay: 2840, sfx: 'clack' },
  { text: '',                                                    type: 'blank',  delay: 3060 },
  { text: DIVIDER,                                              type: 'div',    delay: 3160 },
  { text: '',                                                    type: 'blank',  delay: 3260 },
  { text: 'ALL SYSTEMS NOMINAL.',                               type: 'normal', delay: 3360, sfx: 'beep' },
  { text: '',                                                    type: 'blank',  delay: 3560 },
  { text: '\u25B6  ATHENA ONLINE  \u2500  STANDING BY',         type: 'ready',  delay: 3720, sfx: 'chirp' },
  { text: '',                                                    type: 'blank',  delay: 3980 },
];

const TOTAL_MS = 4700;

// ─── Reduced-motion detection ────────────────────────────────────────────────
const REDUCED = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
  : false;

// ─── Component ───────────────────────────────────────────────────────────────
interface Props { onComplete: () => void; }

export function BootSequence({ onComplete }: Props) {
  const [count, setCount] = useState(REDUCED ? SCRIPT.length : 0);
  const [hiding, setHiding] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    // Un-suspend AudioContext on first user-visible render
    soundEngine.resume();

    if (REDUCED) {
      const t = setTimeout(() => { setHiding(true); setTimeout(onComplete, 50); }, 300);
      return () => clearTimeout(t);
    }

    // Play the full boot ambient track immediately (background_001.wav)
    soundEngine.playBootAmbient();

    SCRIPT.forEach((line, i) => {
      const t = setTimeout(() => {
        setCount(i + 1);
        if (line.sfx === 'clack') soundEngine.keyClack();
        if (line.sfx === 'beep')  soundEngine.bootBeep(760);
        if (line.sfx === 'chirp') soundEngine.commChirp();
      }, line.delay);
      timers.current.push(t);
    });

    const done = setTimeout(() => {
      setHiding(true);
      setTimeout(onComplete, 700);
    }, TOTAL_MS);
    timers.current.push(done);

    return () => timers.current.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleLines = SCRIPT.slice(0, count);
  const complete     = count >= SCRIPT.length;

  return (
    <div className={`boot${hiding ? ' boot--hidden' : ''}`} aria-live="polite" aria-label="System boot sequence">
      <pre className="boot__terminal" role="log">
        {visibleLines.map((line, i) => (
          <span key={i} className={`boot__line boot__line--${line.type}`}>
            {line.text || '\u00A0'}{'\n'}
          </span>
        ))}
        {!complete && !REDUCED && (
          <span className="cursor" aria-hidden="true">█</span>
        )}
      </pre>
    </div>
  );
}
