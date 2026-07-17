import { useState } from 'react';
import { BootSequence } from './components/BootSequence';
import { Bridge }       from './components/Bridge';
import { CRTOverlay }   from './components/CRTOverlay';
import { MobileCommand } from './components/MobileCommand';

// The phone "direct line" — opened at /command or as the installed PWA. Renders a
// standalone mobile console instead of the full desktop bridge (no boot/CRT).
function isCommandMode(): boolean {
  const p = window.location.pathname.replace(/\/+$/, '');
  return p === '/command' || new URLSearchParams(window.location.search).has('command');
}

export default function App() {
  const [booted, setBooted] = useState(false);

  if (isCommandMode()) return <MobileCommand />;

  return (
    <div className="crt-root crt-flicker crt-aberr">
      <CRTOverlay />
      <BootSequence onComplete={() => setBooted(true)} />
      <Bridge visible={booted} />
    </div>
  );
}
