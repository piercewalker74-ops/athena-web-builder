import { useEffect, useRef, useState } from 'react';
import { NavRail, type NavPage } from './NavRail';
import { SystemVitals }        from './SystemVitals';
import { CommsPanel }          from './CommsPanel';
import { OperationsPage }      from './OperationsPage';
import { MissionLog }          from './MissionLog';
import { ReviewInbox }         from './ReviewInbox';
import { PipelineSection }     from './PipelineSection';
import { FeatureShowcase }     from './FeatureShowcase';
import { MemoryBrowser }       from './MemoryBrowser';
import { CommandPalette }      from './CommandPalette';
import { QuickLaunch }         from './QuickLaunch';
import { SectionIntro }        from './SectionIntro';
import { SectorMap }           from './SectorMap';
import { MiniTracker }         from './MiniTracker';
import { soundEngine }         from '../audio/SoundEngine';
import { WalkthroughOverlay, type WalkthroughStep } from './WalkthroughOverlay';
import { OVERARCHING_STEPS, SECTION_STEPS, GUIDE_MENU } from '../data/walkthrough-steps';

interface Props { visible: boolean; }

const PAGE_TITLES: Record<NavPage, string> = {
  comms:      'OPEN COMMS',
  operations: 'OPERATIONS — AUTOMATION GRID',
  pipeline:   'PROJECT PIPELINE',
  showcase:   'FEATURE SHOWCASE',
  inbox:      'REVIEW INBOX',
  missions:   'MISSION LOG',
  memory:     'MEMORY BROWSER',
};

const PHASE_LABELS: Record<NavPage, string> = {
  comms:      'PHASE 1 · LIVE',
  operations: 'PHASE 2 · LIVE',
  pipeline:   'PHASE 3 · PENDING CONFIG',
  showcase:   'LIBRARY · LIVE',
  inbox:      'PHASE 3 · PENDING CONFIG',
  missions:   'PHASE 2 · LIVE',
  memory:     'PHASE 5 · LIVE',
};

// Animated ticker
function Ticker() {
  const items = [
    'ATHENA v1.0.0',
    'WEYLAND-YUTANI CORP — TACTICAL CONTROL BRIDGE',
    'LOCAL OPERATION MODE',
    'ALL SYSTEMS NOMINAL',
    new Date().toUTCString(),
  ];
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => setIdx(i => (i + 1) % items.length), 4000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="ticker-bar" aria-hidden="true">
      {items.map((item, i) => (
        <span key={i} style={{ opacity: i === idx ? 1 : 0.3 }}>{item}</span>
      ))}
    </div>
  );
}

export function Bridge({ visible }: Props) {
  const [page, setPage]             = useState<NavPage>('comms');
  const [paletteOpen, setPalette]   = useState(false);
  const [sessionKey, setSessionKey] = useState('athena:comms');
  const [wt, setWt]                 = useState<WalkthroughStep[] | null>(null);
  const [guideOpen, setGuideOpen]   = useState(false);             // GUIDE dropdown
  const [pipelineProjects, setPipelineProjects] = useState(false);  // pipeline sub-mode: Projects takeover
  const wsRef = useRef<WebSocket | null>(null);

  // Global Ctrl+K → command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setPalette(p => !p);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Boot reveal sounds — staggered keyClacks as panels scan in, then a sweep
  useEffect(() => {
    if (!visible) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Nav panel 0–450ms, main area 350–900ms — 12 keyClacks spread across
    const beats = [10, 65, 125, 190, 260, 380, 450, 530, 610, 700, 790, 870];
    const timers = beats.map(d => setTimeout(() => soundEngine.keyClack(), d));
    const sweep  = setTimeout(() => soundEngine.scanSweep(), 920);
    return () => { timers.forEach(clearTimeout); clearTimeout(sweep); };
  }, [visible]);

  // Background ambient — start once bridge is visible (after boot)
  useEffect(() => {
    if (!visible) return;
    // Small delay so it doesn't clash with bootReady() sting
    const t = setTimeout(() => { void soundEngine.startBackground(); }, 3500);
    return () => clearTimeout(t);
  }, [visible]);

  // Mouse-move ambient — loop low_ominous_007 while cursor is moving
  useEffect(() => {
    if (!visible) return;
    let stopTimer: ReturnType<typeof setTimeout> | null = null;
    const onMove = () => {
      void soundEngine.startMouseAmbient();
      if (stopTimer !== null) clearTimeout(stopTimer);
      stopTimer = setTimeout(() => {
        soundEngine.stopMouseAmbient();
        stopTimer = null;
      }, 1500);
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (stopTimer !== null) clearTimeout(stopTimer);
      soundEngine.stopMouseAmbient();
    };
  }, [visible]);

  // WebSocket connection for live events
  useEffect(() => {
    if (!visible) return;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;
      ws.onclose = () => {
        wsRef.current = null;
        setTimeout(connect, 5000);
      };
      ws.onerror  = () => ws.close();
    };

    const t = setTimeout(connect, 500);
    return () => {
      clearTimeout(t);
      wsRef.current?.close();
    };
  }, [visible]);

  // Auto-launch overarching tour on first visit
  useEffect(() => {
    if (!visible) return;
    if (!localStorage.getItem('athena:tour:seen')) {
      const t = setTimeout(() => setWt(OVERARCHING_STEPS), 2200);
      return () => clearTimeout(t);
    }
  }, [visible]);

  const handleNavigate = (newPage: NavPage) => {
    setPage(newPage);
    soundEngine.hydraulicHiss();
  };

  const title = PAGE_TITLES[page];
  const phaseLabel = PHASE_LABELS[page];

  return (
    <div className={`bridge${visible ? ' bridge--visible' : ''}`} role="main">
      {/* ── Left rail ── */}
      <aside style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <NavRail
          active={page}
          onChange={handleNavigate}
          onPalette={() => setPalette(true)}
        />
        <SystemVitals />
      </aside>

      {/* ── Right: title bar + page content ── */}
      <div className="main-area">
        {/* Project title bar */}
        <div className="project-bar">
          <span className="project-bar__label">PROJECT</span>
          <span className="project-bar__title">{title}</span>

          {/* Quick launch dock */}
          <QuickLaunch onPalette={() => setPalette(true)} />

          {/* Section walkthrough trigger */}
          {SECTION_STEPS[page] && (
            <button
              className="wt-section-btn"
              onClick={() => setWt(SECTION_STEPS[page]!)}
              title={`${PAGE_TITLES[page]} walkthrough`}
              aria-label="Section walkthrough"
            >?</button>
          )}

          {/* Global GUIDE — dropdown of available walkthroughs */}
          <div className="wt-guide" onMouseLeave={() => setGuideOpen(false)}>
            <button
              className={`wt-guide-btn${guideOpen ? ' wt-guide-btn--open' : ''}`}
              onClick={() => setGuideOpen(o => !o)}
              title="Walkthroughs"
              aria-haspopup="true"
              aria-expanded={guideOpen}
            >GUIDE ▾</button>
            {guideOpen && (
              <div className="wt-guide-menu" role="menu">
                {GUIDE_MENU.map(item => (
                  <button
                    key={item.label}
                    className="wt-guide-item"
                    role="menuitem"
                    onClick={() => {
                      if (item.nav) setPage(item.nav as NavPage);
                      setGuideOpen(false);
                      setWt(item.steps);
                    }}
                  >{item.label}</button>
                ))}
              </div>
            )}
          </div>

          <span className="project-bar__status">{phaseLabel}</span>
        </div>

        {/* Pages — re-key on nav so each section plays its custom intro animation */}
        <div className="page-content mtr-workspace" key={page}>
          <SectionIntro page={page} />
          {page === 'comms'      && <CommsPanel sessionKey={sessionKey} onSessionChange={setSessionKey} />}
          {page === 'operations' && <OperationsPage />}
          {page === 'missions'   && <MissionLog wsRef={wsRef} />}
          {page === 'inbox'      && <ReviewInbox />}
          {page === 'pipeline'   && <PipelineSection onModeChange={setPipelineProjects} />}
          {page === 'showcase'   && <FeatureShowcase />}
          {page === 'memory'     && <MemoryBrowser />}
        </div>

        <Ticker />
      </div>

      {/* Sector map — bottom-right HUD overlay (mounts after boot).
          Kept outside the aside/main-area so their clip-path scan-in
          animations don't clip the fixed-position panel. */}
      {visible && <SectorMap active={page} onNavigate={handleNavigate} visible={visible} />}

      {/* Build tracker — auto-hidden on Pipeline where the full tracker is visible */}
      {visible && (page !== 'pipeline' || pipelineProjects) && <MiniTracker visible={visible} />}

      {/* Command palette */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPalette(false)}
        onNavigate={handleNavigate}
      />

      {/* Walkthrough overlay */}
      {wt && (
        <WalkthroughOverlay
          steps={wt}
          onClose={() => {
            setWt(null);
            localStorage.setItem('athena:tour:seen', '1');
          }}
          onNavigate={(section) => setPage(section as NavPage)}
        />
      )}
    </div>
  );
}
