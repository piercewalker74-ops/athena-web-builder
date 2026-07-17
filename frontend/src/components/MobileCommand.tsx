import { useEffect, useRef, useState } from 'react';

// ─── Mobile "direct line to Athena" ─────────────────────────────────────────────
// A full-screen, phone-first console. Speak (or type) one line — "optimize the demo site
// app for mobile" — it posts to /api/pipeline/command, which resolves the site and
// queues an edit with a cancel window. Mounted at /command (also the PWA start_url).

interface Understood { intent: string; project?: string; label?: string; instruction?: string; }
interface CommandResult {
  ok: boolean; understood?: Understood; jobId?: string; jobStatus?: string;
  holdSeconds?: number; cancelUrl?: string; message?: string; error?: string; heard?: string;
  mode?: string; answer?: string;
}
interface Order { at: number; text: string; mode: 'edit' | 'chat'; result: CommandResult; }

// Prefix router: ".chat." / ".ask." → talk to Athena (read-only). ".edit." / none → queue an edit.
const PREFIX_RE = /^\.(chat|ask|edit|build|command)\.\s*/i;
function routeText(raw: string): { mode: 'edit' | 'chat'; clean: string } {
  const m = raw.match(PREFIX_RE);
  const mode: 'edit' | 'chat' = m && /^(chat|ask)$/i.test(m[1]) ? 'chat' : 'edit';
  return { mode, clean: raw.replace(PREFIX_RE, '').trim() };
}

// Web Speech API (Chrome/Android). iOS Safari lacks it — the text field + the
// keyboard's own dictation mic cover that case.
type SR = { start(): void; stop(): void; abort(): void; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null; continuous: boolean; interimResults: boolean; lang: string; };
function getRecognition(): SR | null {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  const r: SR = new Ctor();
  r.continuous = false; r.interimResults = true; r.lang = 'en-US';
  return r;
}

const G = '#4ade80';

export function MobileCommand() {
  const [text, setText]         = useState('');
  const [listening, setListening] = useState(false);
  const [sending, setSending]   = useState(false);
  const [orders, setOrders]     = useState<Order[]>(() => {
    try { return JSON.parse(localStorage.getItem('athena.cmd.orders') || '[]'); } catch { return []; }
  });
  const [pending, setPending]   = useState<{ jobId: string; cancelUrl: string; until: number; label: string } | null>(null);
  const [now, setNow]           = useState(Date.now());
  const recRef = useRef<SR | null>(null);
  const speechOk = useRef<boolean>(!!getRecognition());

  // Countdown tick while a cancel window is open.
  useEffect(() => {
    if (!pending) return;
    const iv = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(iv);
  }, [pending]);
  useEffect(() => {
    if (pending && now >= pending.until) setPending(null);
  }, [now, pending]);

  const persist = (next: Order[]) => {
    setOrders(next);
    try { localStorage.setItem('athena.cmd.orders', JSON.stringify(next.slice(0, 20))); } catch { /* ignore */ }
  };

  const send = async (raw: string) => {
    const t = raw.trim();
    if (!t || sending) return;
    const { mode, clean } = routeText(t);
    setSending(true);
    try {
      const url = mode === 'chat' ? '/api/pipeline/ask' : '/api/pipeline/command';
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean, source: 'pwa' }),
      });
      const d = await r.json() as CommandResult;
      persist([{ at: Date.now(), text: clean, mode, result: d }, ...orders]);
      setText('');
      if (mode === 'edit' && d.ok && d.jobId && d.holdSeconds && d.holdSeconds > 0 && d.cancelUrl) {
        setPending({ jobId: d.jobId, cancelUrl: d.cancelUrl, until: Date.now() + d.holdSeconds * 1000, label: d.understood?.label || d.understood?.project || 'order' });
        setNow(Date.now());
      }
      if (navigator.vibrate) navigator.vibrate(d.ok ? 40 : [60, 40, 60]);
    } catch {
      persist([{ at: Date.now(), text: t, mode, result: { ok: false, error: 'network error — is Athena reachable?' } }, ...orders]);
    } finally { setSending(false); }
  };

  const cancelPending = async () => {
    if (!pending) return;
    try { await fetch(pending.cancelUrl, { method: 'DELETE' }); } catch { /* ignore */ }
    if (navigator.vibrate) navigator.vibrate(30);
    setPending(null);
  };

  const toggleMic = () => {
    if (listening) { recRef.current?.stop(); return; }
    const rec = getRecognition();
    if (!rec) return;
    recRef.current = rec;
    let finalText = '';
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const tr = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += tr; else interim += tr;
      }
      setText((finalText + interim).trim());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      setListening(false);
      const t = finalText.trim();
      if (t) void send(t); // auto-send on a clean voice capture (cancel window is the safety net)
    };
    setListening(true);
    rec.start();
  };

  const remaining = pending ? Math.max(0, Math.ceil((pending.until - now) / 1000)) : 0;

  return (
    <div style={{ minHeight: '100dvh', background: '#04120a', color: '#cffbe0', display: 'flex', flexDirection: 'column',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', WebkitTapHighlightColor: 'transparent', padding: 'env(safe-area-inset-top) 16px env(safe-area-inset-bottom)' }}>
      {/* header */}
      <div style={{ textAlign: 'center', paddingTop: 22, paddingBottom: 6 }}>
        <div style={{ fontSize: 12, letterSpacing: '0.35em', color: G, opacity: 0.85 }}>ATHENA</div>
        <div style={{ fontSize: 10, letterSpacing: '0.2em', color: '#5b7', marginTop: 3 }}>DIRECT LINE</div>
      </div>

      {/* mic */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, marginTop: 18 }}>
        <button
          onClick={speechOk.current ? toggleMic : () => document.getElementById('cmd-input')?.focus()}
          aria-label={listening ? 'Stop listening' : 'Speak a command'}
          style={{
            width: 148, height: 148, borderRadius: '50%', border: `2px solid ${listening ? '#f87171' : G}`,
            background: listening ? 'radial-gradient(circle, rgba(248,113,113,0.25), transparent 70%)' : 'radial-gradient(circle, rgba(74,222,128,0.18), transparent 70%)',
            color: listening ? '#f87171' : G, fontSize: 52, display: 'grid', placeItems: 'center', cursor: 'pointer',
            boxShadow: listening ? '0 0 40px rgba(248,113,113,0.5)' : '0 0 28px rgba(74,222,128,0.35)',
            transition: 'all 0.2s', animation: listening ? 'cmdpulse 1s ease-in-out infinite' : 'none',
          }}
        >{listening ? '■' : '🎙'}</button>
        <div style={{ fontSize: 11, color: '#7c9', minHeight: 16 }}>
          {listening ? 'LISTENING… tap to stop' : speechOk.current ? 'TAP TO SPEAK' : 'TYPE BELOW (tap the keyboard mic to dictate)'}
        </div>
      </div>

      {/* mode chips — prefill the prefix */}
      <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'center' }}>
        {([['▶ EDIT', '.edit. ', G], ['💬 CHAT', '.chat. ', '#38bdf8']] as const).map(([lbl, pre, col]) => {
          const on = text.toLowerCase().startsWith(pre.trim());
          return (
            <button key={pre} onClick={() => { setText(pre); document.getElementById('cmd-input')?.focus(); }}
              style={{ background: on ? col : 'transparent', color: on ? '#04120a' : col, border: `1px solid ${col}`,
                borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '5px 14px', letterSpacing: '0.05em' }}>
              {lbl}
            </button>
          );
        })}
      </div>

      {/* text line + send */}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input
          id="cmd-input"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void send(text); }}
          placeholder='".edit. optimize the demo site" · ".chat. what are you building?"'
          enterKeyHint="send"
          style={{ flex: 1, background: '#02170d', border: `1px solid ${G}55`, color: '#cffbe0', fontSize: 15,
            padding: '13px 12px', borderRadius: 10, outline: 'none', fontFamily: 'inherit' }}
        />
        <button onClick={() => void send(text)} disabled={sending || !text.trim()}
          style={{ background: G, color: '#04120a', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14,
            padding: '0 16px', opacity: (sending || !text.trim()) ? 0.4 : 1 }}>
          {sending ? '…' : 'SEND'}
        </button>
      </div>

      {/* cancel window */}
      {pending && (
        <div style={{ marginTop: 16, border: '1px solid #f8717155', background: 'rgba(248,113,113,0.08)', borderRadius: 12, padding: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: '#fca5a5', letterSpacing: '0.05em' }}>QUEUED: {pending.label.toUpperCase()}</div>
          <div style={{ fontSize: 11, color: '#9db', margin: '6px 0 10px' }}>starts in {remaining}s — cancel now if this is wrong</div>
          <button onClick={() => void cancelPending()}
            style={{ background: '#f87171', color: '#1a0505', border: 'none', borderRadius: 999, fontWeight: 800, fontSize: 15, padding: '11px 30px' }}>
            ✕ CANCEL ({remaining}s)
          </button>
        </div>
      )}

      {/* order history */}
      <div style={{ marginTop: 22, flex: 1, overflowY: 'auto' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.2em', color: '#5b7', marginBottom: 8 }}>RECENT ORDERS</div>
        {orders.length === 0 && <div style={{ fontSize: 12, color: '#476' }}>none yet — speak or type a command above.</div>}
        {orders.map((o, i) => {
          const ok = o.result.ok;
          const isChat = o.mode === 'chat';
          const accent = !ok ? '#f87171' : isChat ? '#38bdf8' : G;
          const reply = isChat
            ? (ok ? (o.result.answer || '…') : (o.result.error || 'failed'))
            : (ok ? (o.result.message || `queued → ${o.result.understood?.label ?? o.result.understood?.project ?? ''}`) : (o.result.error || 'failed'));
          return (
            <div key={i} style={{ borderLeft: `2px solid ${accent}`, padding: '6px 10px', marginBottom: 8, background: '#02170d88', borderRadius: '0 8px 8px 0' }}>
              <div style={{ fontSize: 12, color: '#89a', display: 'flex', gap: 6 }}>
                <span style={{ color: accent }}>{isChat ? '💬' : '▶'}</span>
                <span style={{ color: '#cffbe0' }}>“{o.text}”</span>
              </div>
              <div style={{ fontSize: isChat ? 13 : 11, color: ok ? (isChat ? '#cde9ff' : '#7c9') : '#fca5a5', marginTop: 4, lineHeight: 1.4 }}>
                {reply}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ textAlign: 'center', fontSize: 9, color: '#365', padding: '8px 0 4px' }}>
        ▶ .edit. queues a build · 💬 .chat. asks Athena · default is edit · {speechOk.current ? 'voice + text' : 'text'}
      </div>

      <style>{`@keyframes cmdpulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
        html, body, #root { background: #04120a; }`}</style>
    </div>
  );
}
