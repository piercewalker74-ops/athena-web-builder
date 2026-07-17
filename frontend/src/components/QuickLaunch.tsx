import { soundEngine } from '../audio/SoundEngine';

interface Props {
  onPalette: () => void;
}

interface DockItem {
  id: string;
  label: string;
  icon: string;
  action: () => void;
  color?: string;
  title: string;
}

export function QuickLaunch({ onPalette }: Props) {
  const items: DockItem[] = [
    {
      id: 'kali',
      label: 'KALI',
      icon: '💻',
      color: 'var(--alert)',
      title: 'Launch Kali VM',
      action: async () => {
        soundEngine.hydraulicHiss();
        await fetch('/api/vbox/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vm: 'kali-linux-2026.2-virtualbox-amd64' }),
        });
      },
    },
    {
      id: 'palette',
      label: 'CMD',
      icon: '>_',
      color: 'var(--holo)',
      title: 'Command palette (Ctrl+K)',
      action: () => { soundEngine.keyClack(); onPalette(); },
    },
    {
      id: 'openclaw-chat',
      label: 'CHAT',
      icon: '📡',
      color: 'var(--green)',
      title: 'Open OpenClaw main chat',
      action: () => {
        soundEngine.commChirp();
        window.open('http://localhost:5173', '_blank');
      },
    },
    {
      id: 'gateway-status',
      label: 'GW',
      icon: '⚡',
      color: 'var(--amber)',
      title: 'Check gateway status',
      action: async () => {
        soundEngine.motionPing();
        const r = await fetch('/api/gateway/status').catch(() => null);
        const status = r?.ok ? 'ONLINE' : 'OFFLINE';
        // Flash status — just a pulse via console for now
        console.log(`[Athena] Gateway: ${status}`);
      },
    },
  ];

  return (
    <div className="quick-launch" role="toolbar" aria-label="Quick launch dock">
      {items.map(item => (
        <button
          key={item.id}
          className="ql-btn"
          onClick={() => void Promise.resolve(item.action())}
          title={item.title}
          aria-label={item.label}
          style={{ '--ql-color': item.color } as React.CSSProperties}
        >
          <span className="ql-btn__icon">{item.icon}</span>
          <span className="ql-btn__label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
