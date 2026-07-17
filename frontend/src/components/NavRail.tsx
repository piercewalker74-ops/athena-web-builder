import { soundEngine } from '../audio/SoundEngine';
import { useEffect, useRef, useState } from 'react';

export type NavPage =
  | 'comms'
  | 'operations'
  | 'pipeline'
  | 'showcase'
  | 'inbox'
  | 'missions'
  | 'memory';

interface NavItem {
  id: NavPage;
  label: string;
  icon: string;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'comms',      label: 'COMMS',       icon: '📡' },
  { id: 'operations', label: 'OPERATIONS',  icon: '⚙️' },
  { id: 'missions',   label: 'MISSION LOG', icon: '📋' },
  { id: 'inbox',      label: 'INBOX',       icon: '📥' },
  { id: 'pipeline',   label: 'PIPELINE',    icon: '🔁' },
  { id: 'showcase',   label: 'SHOWCASE',    icon: '🎬' },
  { id: 'memory',     label: 'MEMORY',      icon: '🧠' },
];

interface Props {
  active: NavPage;
  onChange: (page: NavPage) => void;
  onPalette: () => void;
}

const LOGO = 'ATHENA';
const REDUCED_MOTION = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

export function NavRail({ active, onChange, onPalette }: Props) {
  const [muted, setMuted] = useState(false);
  const [vol,   setVol]   = useState(0.38);
  const [logoText, setLogoText] = useState(REDUCED_MOTION ? LOGO : '');
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (REDUCED_MOTION) return;
    LOGO.split('').forEach((ch, i) => {
      const t = setTimeout(() => {
        setLogoText(LOGO.slice(0, i + 1));
        soundEngine.keyClack();
      }, 400 + i * 110);
      timerRefs.current.push(t);
    });
    return () => timerRefs.current.forEach(clearTimeout);
  }, []);

  const handleNav = (item: NavItem) => {
    soundEngine.hydraulicHiss();
    onChange(item.id);
  };

  const handleMute = () => {
    soundEngine.resume();
    const nowMuted = soundEngine.toggleMute();
    setMuted(nowMuted);
  };

  const handleVol = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVol(v);
    soundEngine.setVolume(v);
  };

  return (
    <nav className="nav-rail" aria-label="Bridge navigation">
      {/* Logo */}
      <div className="nav-rail__logo">
        <span className="nav-rail__logo-name" aria-label="ATHENA">{logoText}<span className="nav-rail__logo-cursor" aria-hidden="true" /></span>
        <span className="nav-rail__logo-sub">Weyland-Yutani Corp</span>
        <span className="nav-rail__logo-sub">Tactical Control Bridge</span>
      </div>

      {/* Navigation links */}
      <div className="nav-rail__links">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            data-tour={`nav-${item.id}`}
            className={`nav-link${active === item.id ? ' nav-link--active' : ''}`}
            onClick={() => handleNav(item)}
            aria-current={active === item.id ? 'page' : undefined}
          >
            <span className="nav-link__icon" aria-hidden="true">{item.icon}</span>
            {item.label}
            {item.badge && <span className="nav-link__badge">{item.badge}</span>}
          </button>
        ))}
      </div>

      <div className="nav-rail__separator" />

      {/* Command palette shortcut */}
      <button className="nav-palette-btn" onClick={onPalette} title="Command palette (Ctrl+K)">
        <span style={{ fontFamily: 'monospace', fontSize: 11 }}>&gt;_</span>
        <span>COMMANDS</span>
        <kbd>⌃K</kbd>
      </button>

      <div className="nav-rail__separator" />

      {/* Audio controls */}
      <div className="nav-rail__audio">
        <div className="section-header" style={{ fontSize: 8, padding: '0 0 0.3rem' }}>
          AUDIO
        </div>
        <div className="audio-row">
          <button className="audio-btn" onClick={handleMute} aria-pressed={muted}>
            {muted ? '🔇 MUTE' : '🔊 SFX'}
          </button>
        </div>
        <div className="audio-row">
          <span style={{ fontSize: 9, color: 'var(--chrome)', letterSpacing: '0.08em', width: 24 }}>VOL</span>
          <input
            type="range"
            className="volume-slider"
            min={0} max={1} step={0.01}
            value={vol}
            onChange={handleVol}
            aria-label="Master volume"
          />
          <span style={{ fontSize: 9, color: 'var(--amber-dim)', width: 26, textAlign: 'right' }}>
            {Math.round(vol * 100)}
          </span>
        </div>
      </div>
    </nav>
  );
}
