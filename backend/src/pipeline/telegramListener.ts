// ─── Inbound Telegram build orders (OPTIONAL, off by default) ──────────────────
// Long-polls the Telegram bot for the owner's build/edit commands and drops them
// on the single build lane via POST /api/pipeline/enqueue.
//
//   "build acme"                → schematic build for the matched project
//   "edit the demo site"         → same (edit = rebuild to the current schematic)
//   "start <name> build"            → same
//   "launch circuit" / "new build"  → full automatic circuit
//   "queue" / "status"              → reply with the lane state
//
// ⚠ Telegram allows ONE consumer per bot. OpenClaw's own Telegram channel is
// enabled and already polls this bot, so this listener is DISABLED unless you set
// NEOFORM_TG_LISTENER=1 (only safe if OpenClaw's telegram channel is turned off).
// The recommended wiring is to let OpenClaw's agent receive the message and call
// the /api/pipeline/enqueue endpoint itself — same lane, no polling conflict.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? '';
const OFFSET_FILE = join(HOME, '.openclaw', 'neoform', 'tg-offset.json');
const PORT = Number(process.env.PORT ?? 3001);

const BOT = process.env.TELEGRAM_BOT_TOKEN ?? '';
const OWNER = process.env.TELEGRAM_OWNER_CHAT_ID ?? '';
const ENABLED = process.env.NEOFORM_TG_LISTENER === '1';

interface TgUpdate { update_id: number; message?: { chat?: { id: number }; text?: string }; }

function readOffset(): number {
  try { return (JSON.parse(readFileSync(OFFSET_FILE, 'utf-8')) as { offset: number }).offset ?? 0; } catch { return 0; }
}
function writeOffset(offset: number) {
  try { mkdirSync(join(HOME, '.openclaw', 'neoform'), { recursive: true }); writeFileSync(OFFSET_FILE, JSON.stringify({ offset }), 'utf-8'); } catch { /* ignore */ }
}

async function reply(text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: OWNER, text, disable_web_page_preview: true }),
    });
  } catch { /* best effort */ }
}

// Classify an owner message: info (queue), stop (cancel the held edit), or a free-form
// command routed to /api/pipeline/command (which resolves the site + queues the edit).
type Action = { info: 'queue' } | { stop: true } | { command: string };
function parse(text: string): Action | null {
  const t = text.trim();
  if (!t) return null;
  const low = t.toLowerCase();
  if (/^(queue|status)\b/.test(low)) return { info: 'queue' };
  if (/^(stop|cancel|abort|no|nvm|nevermind|never mind)\b/.test(low)) return { stop: true };
  // Everything else is a natural-language order — let /command resolve it.
  return { command: t };
}

async function post(path: string, body: Record<string, unknown>): Promise<string> {
  try {
    const r = await fetch(`http://localhost:${PORT}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await r.json() as { message?: string; error?: string };
    return d.message ?? d.error ?? (r.ok ? 'ok' : 'failed');
  } catch (e) { return `error: ${e instanceof Error ? e.message : String(e)}`; }
}

async function poll() {
  let offset = readOffset();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${BOT}/getUpdates?timeout=50&offset=${offset + 1}`);
      const d = await r.json() as { ok: boolean; result?: TgUpdate[] };
      for (const u of d.result ?? []) {
        offset = Math.max(offset, u.update_id);
        writeOffset(offset);
        const chatId = String(u.message?.chat?.id ?? '');
        const text = u.message?.text ?? '';
        if (!text || (OWNER && chatId !== OWNER)) continue; // owner-only
        const action = parse(text);
        if (!action) continue;
        if ('info' in action) {
          try {
            const q = await (await fetch(`http://localhost:${PORT}/api/pipeline/queue`)).json() as { running?: { label?: string }; pending?: number };
            await reply(q.running ? `▶ building ${q.running.label} · ${q.pending ?? 0} queued` : `◌ lane idle · ${q.pending ?? 0} queued`);
          } catch { await reply('queue: unavailable'); }
        } else if ('stop' in action) {
          await reply(await post('/api/pipeline/command/cancel', {}));
        } else {
          await reply(await post('/api/pipeline/command', { text: action.command, source: 'telegram' }));
        }
      }
    } catch {
      await new Promise(res => setTimeout(res, 5000)); // backoff on network error
    }
  }
}

export async function startTelegramBuildListener() {
  if (!ENABLED) return;
  if (!BOT || !OWNER) { console.log('[neoform] TG listener enabled but TELEGRAM_BOT_TOKEN / OWNER_CHAT_ID missing'); return; }
  console.log('[neoform] inbound Telegram build listener ONLINE (owner-only)');
  void poll();
}
