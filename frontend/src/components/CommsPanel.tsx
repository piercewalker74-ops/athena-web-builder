import { useCallback, useEffect, useRef, useState } from 'react';
import { soundEngine } from '../audio/SoundEngine';
import { AmbientBackground } from './AmbientBackground';

// ─── Session persistence ───────────────────────────────────────────────────────
const HISTORY_KEY = 'athena:comms:history';
function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch { return []; }
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  ts: string;
  streaming?: boolean;
  error?: boolean;
}

type GatewayStatus = 'connecting' | 'online' | 'offline';

// ─── Local command: "athena start the neoform build according to the schematics" ─
// Intercepted before the gateway so a plain-language build order actually kicks the
// pipeline: it resolves the target project (a named one, else the schematic currently
// open in the Feature Director via localStorage) and POSTs the build. Returns the
// assistant reply text, or null if this isn't a build command.
// Answer "is a build running / build status / what's building" straight from the
// build lane — so Athena is authoritative on pipeline state instead of guessing.
async function runPipelineQuery(text: string): Promise<string | null> {
  const t = text.toLowerCase();
  const asksStatus =
    (/\b(is|are|any|anything|what'?s?|whats|hows|how'?s)\b/.test(t) && /\b(build|building|builds|circuit|deploy(ing)?|running|in progress|going|pipeline|active)\b/.test(t) && /\b(run|running|build|building|progress|going|status|happening|active|now|currently)\b/.test(t)) ||
    /\bbuild status\b/.test(t) ||
    /\bstatus of (the )?(build|pipeline|circuit|lane)\b/.test(t) ||
    /\b(anything|something|a build|any builds?)\b[^.]*\b(running|building|in progress|going|active)\b/.test(t);
  // don't hijack an actual "start/run a build" order
  const isOrder = /\b(start|run|kick ?off|begin|execute|launch|fire|initiate)\b[^.]*\bbuild\b/.test(t);
  if (!asksStatus || isOrder) return null;
  try {
    const [q, today] = await Promise.all([
      fetch('/api/pipeline/queue').then(r => r.json()),
      fetch('/api/pipeline/today').then(r => r.json()).catch(() => ({} as Record<string, unknown>)),
    ]);
    const a = (today as { auto?: { enabled: boolean; everyHours: number } }).auto;
    const autoTxt = a ? (a.enabled ? `AUTO is **ON** (every ${a.everyHours}h).` : 'AUTO scheduling is off.') : '';
    if (q.active && q.running) {
      const mins = q.running.startedAt ? Math.round((Date.now() - q.running.startedAt) / 60000) : null;
      const mode = q.running.mode === 'schematic' ? 'schematic build' : 'full circuit';
      return `▶ **Yes — a build is running.** **${q.running.label}** (${mode})${mins != null ? `, started ${mins} min ago` : ''}. ${q.pending ? `${q.pending} more queued behind it.` : 'Nothing else queued.'} ${autoTxt}`.trim();
    }
    const done = (today as { countToday?: number }).countToday ?? 0;
    return `◌ **No build is running right now** — the lane is idle.${q.pending ? ` ${q.pending} queued and waiting.` : ''}${done ? ` ${done} site(s) shipped today.` : ''} ${autoTxt}`.trim();
  } catch (e) {
    return `Couldn't reach the pipeline lane — ${e instanceof Error ? e.message : String(e)}.`;
  }
}

async function runBuildCommand(text: string): Promise<string | null> {
  const t = text.toLowerCase();
  const isBuild =
    /\b(start|run|kick ?off|begin|execute|launch|fire|initiate|go)\b[^.]*\bbuild\b/.test(t) ||
    /\bbuild\b[^.]*\b(according to|from|to|per|off|using)\b[^.]*\b(schematic|schema|manifest|layout|editor|plan|it)\b/.test(t) ||
    /\bneoform build\b/.test(t) ||
    /\b(start|run|launch|kick ?off)\b[^.]*\bneoform\b/.test(t);
  if (!isBuild) return null;

  let target: { slug: string; label?: string } | null = null;
  try {
    const raw = await fetch('/api/projects').then(r => r.json());
    const list: Array<{ slug: string; businessName?: string; name?: string }> = Array.isArray(raw) ? raw : (raw.projects ?? []);
    const named = list.find(p =>
      (p.slug && t.includes(p.slug.replace(/-/g, ' '))) ||
      (p.businessName && t.includes(p.businessName.toLowerCase())) ||
      (p.name && t.includes(p.name.toLowerCase())));
    if (named) target = { slug: named.slug, label: named.businessName ?? named.name ?? named.slug };
  } catch { /* offline — fall through to editing context */ }
  if (!target) {
    try { const e = JSON.parse(localStorage.getItem('athena:editing') ?? 'null'); if (e?.slug) target = e; } catch { /* none */ }
  }
  if (!target) {
    return '▶ **NEOFORM BUILD** — I couldn\'t tell which schematic to build. Open a project in the Feature Director (Pipeline ▸ Projects ▸ EDIT), or name it — e.g. *"start the neoform build for the demo site"*.';
  }
  try {
    const r = await fetch(`/api/projects/${target.slug}/build`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'athena-chat' }),
    });
    const j = await r.json() as { ok?: boolean; message?: string; label?: string; sections?: number; error?: string };
    if (j?.ok) return `${j.message}\n\nWatch the **BUILD TRACKER** — it's locked on **${j.label}** now, and the pipeline board updated to BUILDING.`;
    return `▶ Build could not start — ${j?.error ?? 'HTTP ' + r.status}.`;
  } catch (e) {
    return `▶ Build request failed — ${e instanceof Error ? e.message : String(e)}.`;
  }
}

// ─── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  sessionKey?: string;
  onSessionChange?: (key: string) => void;
}

// ─── Typing indicator ─────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <span className="typing-dots" aria-label="Processing">
      <span />
      <span />
      <span />
    </span>
  );
}

// ─── Message renderer with markdown-ish formatting ───────────────────────────
function MessageContent({ text, streaming }: { text: string; streaming?: boolean }) {
  // Basic inline code and bold support
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i} className="inline-code">{part.slice(1, -1)}</code>;
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
      {streaming && <span className="cursor">█</span>}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export function CommsPanel({ sessionKey = 'athena:comms', onSessionChange }: Props) {
  const [messages, setMessages]   = useState<ChatMessage[]>(loadHistory);
  const [gwStatus, setGwStatus]   = useState<GatewayStatus>('connecting');
  const [draft, setDraft]         = useState('');
  const [streaming, setStreaming] = useState(false);
  const endRef     = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const abortRef   = useRef<AbortController | null>(null);
  const greetedRef = useRef(false);

  // ── Persist history to localStorage ──────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-120))); }
    catch { /* quota */ }
  }, [messages]);

  // ── Diagnostic greeting (once per browser session when empty) ─────────────
  useEffect(() => {
    if (gwStatus !== 'online') return;
    if (greetedRef.current) return;
    if (messages.length > 0) { greetedRef.current = true; return; }
    greetedRef.current = true;
    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    setMessages([{
      id: 'athena:diagnostic',
      role: 'assistant',
      text: `MU/TH/UR DIAGNOSTIC COMPLETE\n────────────────────────────────\n**GATEWAY LINK** · ESTABLISHED\n**DATE** · ${dateStr}\n**STATUS** · ALL SYSTEMS NOMINAL\n────────────────────────────────\nTransmit when ready.`,
      ts,
    }]);
  }, [gwStatus, messages.length]);

  // ── Check gateway availability on mount ───────────────────────────────────
  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const r = await fetch('/api/gateway/status', { signal: AbortSignal.timeout(4000) });
        if (!mounted) return;
        setGwStatus(r.ok ? 'online' : 'offline');
      } catch {
        if (mounted) setGwStatus('offline');
      }
    };
    check();
    const iv = setInterval(check, 30_000);
    return () => { mounted = false; clearInterval(iv); };
  }, []);

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = draft.trim();
    if (!text || streaming) return;

    // Abort any previous request
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text,
      ts: new Date().toLocaleTimeString('en-US', { hour12: false }),
    };

    setMessages(prev => [...prev, userMsg]);
    soundEngine.commSend();
    setDraft('');

    // ── Local build-order interception (kick the NEOFORM pipeline directly) ──
    const cmdReply = await runPipelineQuery(text) ?? await runBuildCommand(text);
    if (cmdReply != null) {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(), role: 'assistant', text: cmdReply,
        ts: new Date().toLocaleTimeString('en-US', { hour12: false }),
      }]);
      soundEngine.commChirp();
      return;
    }

    setStreaming(true);
    soundEngine.startAutoType();  // real typing clips during AI response

    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      text: '',
      ts: new Date().toLocaleTimeString('en-US', { hour12: false }),
      streaming: true,
    };
    setMessages(prev => [...prev, assistantMsg]);

    // Build history for context (last 20 messages)
    const history = messages
      .filter(m => !m.error && !m.streaming)
      .slice(-20)
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionKey, history }),
        signal: abort.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      setGwStatus('online');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') break;

          try {
            const chunk = JSON.parse(payload) as { type: string; content?: string; message?: string; offline?: boolean };

            if (chunk.type === 'delta' && chunk.content) {
              fullText += chunk.content;
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId
                    ? { ...m, text: fullText, streaming: true }
                    : m
                )
              );
            }

            if (chunk.type === 'error') {
              throw new Error(chunk.message ?? 'Gateway error');
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== '[object Object]') {
              throw parseErr;
            }
          }
        }
      }

      // Finalize message
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId ? { ...m, streaming: false } : m
        )
      );
      soundEngine.commChirp();

    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setMessages(prev => prev.filter(m => m.id !== assistantId));
        return;
      }

      const errorText = err instanceof Error ? err.message : 'Transmission failed';
      const isOffline = errorText.includes('fetch') || errorText.includes('network') || errorText.includes('HTTP 5');

      if (isOffline) setGwStatus('offline');

      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, text: `[TRANSMISSION ERROR: ${errorText}]`, streaming: false, error: true }
            : m
        )
      );
    } finally {
      setStreaming(false);
      soundEngine.stopAutoType();  // stop auto-type clips when response ends
    }
  }, [draft, streaming, messages, sessionKey]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      soundEngine.userTypeKey();
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const handleClear = () => {
    setMessages([]);
    greetedRef.current = false; // allow greeting to reappear
    soundEngine.hydraulicHiss();
  };

  const isOffline = gwStatus === 'offline';
  const isOnline  = gwStatus === 'online';

  return (
    <div className="comms">
      <AmbientBackground variant="mixed" density={0.7} seed={11} />

      {/* Message area */}
      <div className="comms__messages" data-tour="comms-messages">
        {/* Gateway offline splash */}
        {isOffline && messages.length === 0 && (
          <div className="comms__offline">
            <span className="comms__offline-badge">GATEWAY OFFLINE</span>
            <p className="comms__offline-msg">
              The OpenClaw gateway is not running or chat completions are not enabled.
              <br /><br />
              To enable:
              <br />
              1. Run: <code style={{ color: 'var(--amber-dim)' }}>openclaw gateway start</code>
              <br />
              2. Set config: <code style={{ color: 'var(--amber-dim)' }}>gateway.http.endpoints.chatCompletions.enabled = true</code>
            </p>
          </div>
        )}

        {/* Connecting */}
        {gwStatus === 'connecting' && messages.length === 0 && (
          <div className="comms__offline">
            <span className="comms__offline-badge" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
              PROBING ARRAY…
            </span>
            <p className="comms__offline-msg">Establishing gateway link…</p>
          </div>
        )}

        {/* Online, empty */}
        {isOnline && messages.length === 0 && (
          <div className="comms__empty">
            <div className="comms__satellite-wrap" aria-hidden="true">
              <span className="comms__empty-icon">📡</span>
              <div className="comms__signal-ring" />
              <div className="comms__signal-ring" />
              <div className="comms__signal-ring" />
            </div>
            <span className="comms__empty-text">Gateway online — standing by</span>
            <span style={{ fontSize: 10, color: 'var(--amber-ghost)', letterSpacing: '0.08em' }}>
              Type a message to begin transmission
            </span>
          </div>
        )}

        {/* Offline but has messages — allow review */}
        {isOffline && messages.length > 0 && (
          <div className="comms__offline-banner">
            <span>⚠</span> GATEWAY OFFLINE — last session archived
          </div>
        )}

        {/* Messages */}
        {messages.map((msg) => (
          <div key={msg.id} className={`msg msg--${msg.role}${msg.error ? ' msg--error' : ''}`}>
            <span className="msg__meta">
              {msg.role === 'user' ? 'OPERATOR' : 'ATHENA'} · {msg.ts}
              {msg.streaming && <span style={{ marginLeft: 8, color: 'var(--amber-dim)', fontSize: 9 }}>RECEIVING…</span>}
            </span>
            <div className="msg__bubble">
              {msg.streaming && !msg.text
                ? <TypingDots />
                : <MessageContent text={msg.text} streaming={msg.streaming} />
              }
            </div>
          </div>
        ))}

        <div ref={endRef} />
      </div>

      {/* Input row */}
      <div className="comms__input-area">
        {/* Status dot */}
        <span
          title={`Gateway ${gwStatus}`}
          className="comms__status-dot"
          style={{
            background: isOnline ? 'var(--green)' : isOffline ? 'var(--alert)' : 'var(--amber)',
            boxShadow: isOnline
              ? 'var(--glow-green)'
              : isOffline
                ? 'var(--glow-alert)'
                : 'var(--glow-amber-sm)',
          }}
        />

        <textarea
          ref={inputRef}
          data-tour="comms-input"
          className="comms__input"
          placeholder={isOffline ? 'GATEWAY OFFLINE' : 'TRANSMIT MESSAGE … (Enter to send, Shift+Enter for newline)'}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKey}
          disabled={streaming}
          rows={1}
          aria-label="Message input"
        />

        {streaming ? (
          <button className="comms__send comms__send--stop" onClick={handleStop} aria-label="Stop">
            ■ ABORT
          </button>
        ) : (
          <button
            className="comms__send"
            onClick={() => void sendMessage()}
            disabled={!draft.trim()}
            aria-label="Send message"
          >
            TRANSMIT ▶
          </button>
        )}

        <button className="comms__clear" data-tour="comms-clear" onClick={handleClear} title="Clear conversation" aria-label="Clear">
          CLR
        </button>
      </div>
    </div>
  );
}
