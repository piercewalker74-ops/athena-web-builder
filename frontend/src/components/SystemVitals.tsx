import { useEffect, useState } from 'react';

interface VitalState {
  gateway: 'checking' | 'online' | 'offline';
  model: string;
  kali: 'unknown' | 'running' | 'stopped';
  apiCost: string | null;
  telegramOk: boolean;
  ts: string;
}

const INITIAL: VitalState = {
  gateway:   'checking',
  model:     'claude-sonnet-4-6',
  kali:      'unknown',
  apiCost:   null,
  telegramOk: false,
  ts:        '—',
};

interface Props {
  onKaliVmName?: (name: string) => void;
}

export function SystemVitals({ onKaliVmName }: Props) {
  const [vitals, setVitals] = useState<VitalState>(INITIAL);
  const [kaliLoading, setKaliLoading] = useState(false);

  useEffect(() => {
    let mounted = true;

    const check = async () => {
      try {
        const r = await fetch('/api/vitals', { signal: AbortSignal.timeout(6000) });
        if (!mounted) return;
        if (r.ok) {
          const data = await r.json() as {
            gateway: string;
            model?: string;
            kali?: string;
            apiCost?: string | null;
            telegramOk?: boolean;
          };
          setVitals(prev => ({
            ...prev,
            gateway:   data.gateway === 'online' ? 'online' : 'offline',
            model:     (data.model ?? prev.model).replace('anthropic/', '').replace('openai/', ''),
            kali:      (data.kali as VitalState['kali']) ?? prev.kali,
            apiCost:   data.apiCost ?? prev.apiCost,
            telegramOk: data.telegramOk ?? prev.telegramOk,
            ts:        new Date().toLocaleTimeString('en-US', { hour12: false }),
          }));
        }
      } catch {
        if (mounted) setVitals(prev => ({ ...prev, gateway: 'offline' }));
      }
    };

    const t = setTimeout(() => void check(), 800);
    const iv = setInterval(() => void check(), 30_000);
    return () => { mounted = false; clearTimeout(t); clearInterval(iv); };
  }, []);

  const startKali = async () => {
    setKaliLoading(true);
    try {
      await fetch('/api/vbox/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vm: 'kali-linux-2026.2-virtualbox-amd64' }),
      });
      setTimeout(() => {
        setVitals(prev => ({ ...prev, kali: 'running' }));
        setKaliLoading(false);
      }, 3000);
    } catch {
      setKaliLoading(false);
    }
  };

  const gwClass = vitals.gateway === 'online'
    ? 'vitals__val--online'
    : vitals.gateway === 'offline'
      ? 'vitals__val--offline'
      : 'vitals__val--dim';

  return (
    <div className="vitals">
      <div className="vitals__label">// SYSTEM VITALS</div>

      {/* Gateway */}
      <div className="vitals__row">
        <span className="vitals__key">GATEWAY</span>
        <span className={`vitals__val ${gwClass}`}>
          {vitals.gateway !== 'checking' && (
            <span className={`vitals__dot ${vitals.gateway === 'online' ? 'vitals__dot--green' : 'vitals__dot--red'}`} />
          )}
          {vitals.gateway === 'online' ? 'ONLINE' : vitals.gateway === 'offline' ? 'OFFLINE' : 'CHECKING…'}
          <span className={`vitals__bars${vitals.gateway === 'offline' ? ' vitals__bars--offline' : vitals.gateway === 'checking' ? ' vitals__bars--checking' : ''}`}>
            <span className="vitals__bar" />
            <span className="vitals__bar" />
            <span className="vitals__bar" />
          </span>
        </span>
      </div>

      {/* Model */}
      <div className="vitals__row">
        <span className="vitals__key">MODEL</span>
        <span
          className="vitals__val vitals__val--holo"
          title={vitals.model}
          style={{ maxWidth: 115, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {vitals.model}
        </span>
      </div>

      {/* Kali VM */}
      <div className="vitals__row">
        <span className="vitals__key">KALI VM</span>
        <span className="vitals__val" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className={
            vitals.kali === 'running'
              ? 'vitals__val--online'
              : vitals.kali === 'stopped'
                ? 'vitals__val--offline'
                : 'vitals__val--dim'
          }>
            {vitals.kali === 'unknown' ? '——' : vitals.kali.toUpperCase()}
          </span>
          {vitals.kali === 'stopped' && (
            <button
              className="vitals__action-btn"
              onClick={() => void startKali()}
              disabled={kaliLoading}
              title="Start Kali VM"
            >
              {kaliLoading ? '…' : '▶'}
            </button>
          )}
        </span>
      </div>

      {/* API Cost */}
      <div className="vitals__row">
        <span className="vitals__key">API COST</span>
        <span className={`vitals__val ${vitals.apiCost ? 'vitals__val--dim' : 'vitals__val--ghost'}`}>
          {vitals.apiCost ?? '——'}
        </span>
      </div>

      {/* Telegram */}
      <div className="vitals__row">
        <span className="vitals__key">TELEGRAM</span>
        <span className={`vitals__val ${vitals.telegramOk ? 'vitals__val--online' : 'vitals__val--offline'}`}>
          {vitals.telegramOk ? 'ACTIVE' : 'OFFLINE'}
        </span>
      </div>

      {/* Last check */}
      {vitals.ts !== '—' && (
        <div className="vitals__row" style={{ marginTop: '0.15rem' }}>
          <span className="vitals__key" style={{ fontSize: 9, color: 'var(--amber-ghost)' }}>CHK</span>
          <span className="vitals__val" style={{ fontSize: 9, color: 'var(--amber-ghost)' }}>{vitals.ts}</span>
        </div>
      )}
    </div>
  );
}
