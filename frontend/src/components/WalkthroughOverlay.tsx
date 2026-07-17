import { useEffect, useState } from 'react';
import '../styles/walkthrough.css';

export interface WalkthroughStep {
  target?: string;
  title: string;
  body: string;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  section?: string;
}

interface HighlightRect {
  top: number; left: number; width: number; height: number;
}

interface Props {
  steps: WalkthroughStep[];
  onClose: () => void;
  onNavigate?: (section: string) => void;
}

const PAD = 9;
const CARD_W = 340;
const GAP = 15;

export function WalkthroughOverlay({ steps, onClose, onNavigate }: Props) {
  const [idx, setIdx]   = useState(0);
  const [rect, setRect] = useState<HighlightRect | null>(null);

  const step = steps[idx];

  // Measure target after each step change (wait for page nav / render)
  useEffect(() => {
    if (step?.section && onNavigate) onNavigate(step.section);

    const measure = () => {
      if (!step?.target) { setRect(null); return; }
      const el = document.querySelector(step.target) as HTMLElement | null;
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect({
        top: r.top - PAD,
        left: r.left - PAD,
        width: r.width + PAD * 2,
        height: r.height + PAD * 2,
      });
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };

    // Delay allows page navigation to render before querying DOM
    const t = setTimeout(measure, 380);
    return () => clearTimeout(t);
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement))) {
        if (idx < steps.length - 1) setIdx(i => i + 1);
      }
      if (e.key === 'ArrowLeft') {
        if (idx > 0) setIdx(i => i - 1);
      }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, steps.length, onClose]);

  // Tooltip positioning
  const cardStyle = (): React.CSSProperties => {
    const base: React.CSSProperties = { width: CARD_W };

    if (!rect || !step?.target || step.position === 'center') {
      return { ...base, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }

    const pos = step.position ?? 'bottom';
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampX = (x: number) => Math.max(12, Math.min(x, vw - CARD_W - 12));

    switch (pos) {
      case 'bottom':
        return { ...base, top: rect.top + rect.height + GAP, left: clampX(rect.left + rect.width / 2 - CARD_W / 2) };
      case 'top':
        return { ...base, bottom: vh - rect.top + GAP, left: clampX(rect.left + rect.width / 2 - CARD_W / 2) };
      case 'right':
        return { ...base, top: Math.max(12, Math.min(rect.top, vh - 200)), left: Math.min(rect.left + rect.width + GAP, vw - CARD_W - 12) };
      case 'left':
        return { ...base, top: Math.max(12, Math.min(rect.top, vh - 200)), right: Math.max(12, vw - rect.left + GAP) };
      default:
        return { ...base, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }
  };

  return (
    <div className="wt-root" role="dialog" aria-modal="true" aria-label="Bridge walkthrough">
      {/* Click-away backdrop */}
      <div className="wt-backdrop" onClick={onClose} aria-hidden="true" />

      {/* Spotlight cutout around target element */}
      {rect && (
        <div
          className="wt-spotlight"
          aria-hidden="true"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      )}

      {/* Tooltip card */}
      <div className="wt-card" style={cardStyle()}>
        <div className="wt-card__head">
          <span className="wt-card__counter">{String(idx + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</span>
          <span className="wt-card__title">{step.title}</span>
          <button className="wt-card__x" onClick={onClose} aria-label="Close walkthrough">✕</button>
        </div>

        <div className="wt-card__body">{step.body}</div>

        <div className="wt-card__foot">
          <button
            className="wt-nav-btn"
            onClick={() => setIdx(i => i - 1)}
            disabled={idx === 0}
          >← PREV</button>

          <div className="wt-dots" aria-hidden="true">
            {steps.map((_, i) => (
              <button
                key={i}
                className={`wt-dot${i === idx ? ' wt-dot--on' : ''}`}
                onClick={() => setIdx(i)}
                aria-label={`Step ${i + 1}`}
              />
            ))}
          </div>

          {idx < steps.length - 1
            ? (
              <button className="wt-nav-btn wt-nav-btn--next" onClick={() => setIdx(i => i + 1)}>
                NEXT →
              </button>
            ) : (
              <button className="wt-nav-btn wt-nav-btn--done" onClick={onClose}>
                DONE ✓
              </button>
            )
          }
        </div>
      </div>
    </div>
  );
}
