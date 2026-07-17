import express from 'express';
import pipelineRoutes from './routes/pipelineRoutes.js';
import projectsRoutes from './routes/projectsRoutes.js';
import { readLeads, upsertLead, getLead } from './pipeline/leadStore.js';
import { enqueue as enqueueBuild, runningJob, pendingCount, readQueue, cancelJob } from './pipeline/buildQueue.js';
import { startRunner, kick as kickRunner } from './pipeline/buildRunner.js';
import { startTelegramBuildListener } from './pipeline/telegramListener.js';
import { startScheduler, readAuto, writeAuto, nextEligibleAt } from './pipeline/buildScheduler.js';
import { startSupervisor } from './pipeline/supervisor.js';
import { packSummaries, composeUpgradeInstruction, UPGRADE_PACKS } from './pipeline/upgradePacks.js';
import { matchTemplate, scaffoldFromTemplate, listTemplates } from './pipeline/templates.js';
import { stageOutreach, getOutreach, listOutreach, sendOutreach, cancelOutreach } from './pipeline/outreach.js';
import type { Lead } from './pipeline/types.js';
import { randomUUID, timingSafeEqual } from 'crypto';
import cors from 'cors';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { exec as execCb, execFile as execFileCb, type ExecOptions } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

const execP = promisify(execCb);
const execFileP = promisify(execFileCb);
// windowsHide keeps backend commands (openclaw/VBoxManage) from flashing a console
// window on every call — they run in the background instead of popping up.
const exec = (cmd: string, opts: ExecOptions = {}) =>
  execP(cmd, { windowsHide: true, ...opts }) as Promise<{ stdout: string; stderr: string }>;
// SECURITY: argv-based exec — no shell is spawned, so interpolated values can NEVER be
// interpreted as shell syntax. Use this (not `exec`) for anything touching user input.
const execFileSafe = (file: string, args: string[], opts: ExecOptions = {}) =>
  execFileP(file, args, { windowsHide: true, ...opts }) as Promise<{ stdout: string; stderr: string }>;
// A plain id/name token: no shell metacharacters, and it can't start with '-' (which
// would let a value masquerade as a CLI flag — argument injection). Reject everything else.
const safeToken = (s: unknown): s is string =>
  typeof s === 'string' && /^[A-Za-z0-9._:][A-Za-z0-9._:-]{0,119}$/.test(s);

// â”€â”€â”€ Load secrets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const HOME = process.env.USERPROFILE ?? process.env.HOME ?? '';
dotenv.config({ path: join(HOME, '.openclaw', '.env') });

const PORT = Number(process.env.PORT ?? 3001);
const GATEWAY_HTTP = 'http://127.0.0.1:18789';
const GATEWAY_WS   = 'ws://127.0.0.1:18789';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
const WORKSPACE_DIR = join(HOME, '.openclaw', 'workspace');
const AGENTS_DIR    = join(HOME, '.openclaw', 'agents');

// Read gateway token
let gatewayToken = '';
try {
  const raw = readFileSync(join(HOME, '.openclaw', 'openclaw.json'), 'utf-8');
  const cfg  = JSON.parse(raw) as Record<string, unknown>;
  const gw   = (cfg.gateway ?? {}) as Record<string, unknown>;
  const auth = (gw.auth ?? {}) as Record<string, unknown>;
  gatewayToken = (auth.token as string) ?? (gw.token as string) ?? '';
} catch { /* no token */ }

const authHeaders: Record<string, string> = gatewayToken
  ? { Authorization: `Bearer ${gatewayToken}` }
  : {};

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function gwFetch(path: string, opts: RequestInit = {}) {
  return fetch(`${GATEWAY_HTTP}${path}`, {
    ...opts,
    headers: { ...authHeaders, ...(opts.headers as Record<string, string> ?? {}) },
    signal: AbortSignal.timeout(5000),
  });
}

// SECURITY: takes an argv array, not a shell string — the openclaw CLI is invoked
// directly with no shell, so no caller can inject shell syntax through an interpolated id.
async function runCli(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileSafe('openclaw', args, {
      env: { ...process.env, FORCE_COLOR: '0' },
      timeout: 15000,
    });
    return stdout.trim();
  } catch (e: unknown) {
    throw new Error(`CLI error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── Remote-access password gate ─────────────────────────────────────────────
// Athena is published through cloudflared (athena.example.com → :3001).
// Cloudflare stamps cf-connecting-ip / cf-ray / x-forwarded-for on every tunneled
// request; we require HTTP Basic Auth (password from backend/.env.local) on those,
// while direct localhost access (no CF headers) stays open. Fail-closed: if a
// tunneled request arrives and no password is configured, it is refused rather
// than exposed. The terminal RCE surface is separately dead on any tunneled
// request (see isLoopbackOnly), so remote access = dashboard only, never the shell.
function loadEnvLocalServer(): Record<string, string> {
  const parsed: Record<string, string> = {};
  const candidates = [
    join(process.cwd(), '.env.local'),
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env.local'),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (line.trim().startsWith('#')) continue;
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) parsed[m[1]] = m[2];
    }
    break;
  }
  return parsed;
}
const REMOTE_PASSWORD = process.env.ATHENA_REMOTE_PASSWORD || loadEnvLocalServer().ATHENA_REMOTE_PASSWORD || '';

function isTunneled(headers: Record<string, unknown>): boolean {
  return !!(headers['cf-connecting-ip'] || headers['x-forwarded-for'] || headers['cf-ray']);
}
// Constant-time check of the Basic-Auth password (username is ignored).
function passwordOk(headers: Record<string, unknown>): boolean {
  if (!REMOTE_PASSWORD) return false;
  const hdr = String(headers['authorization'] ?? '');
  const m = /^Basic (.+)$/.exec(hdr);
  if (!m) return false;
  let pass = '';
  try { const dec = Buffer.from(m[1], 'base64').toString('utf8'); pass = dec.slice(dec.indexOf(':') + 1); } catch { return false; }
  const a = Buffer.from(pass); const b = Buffer.from(REMOTE_PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

// â”€â”€â”€ Express app â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const app = express();
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));

// ─── Outreach approval (token-authed, BEFORE the password gate) ────────────────
// The owner taps a Telegram "Review & Send" button → this page, from their phone.
// It must be reachable over the tunnel WITHOUT the Basic-Auth prompt, so it's gated
// by the unguessable single-use token instead. Nothing here sends until the SEND
// button POSTs; a bare page load never triggers an SMS.
function outreachPage(o: import('./pipeline/outreach.js').Outreach): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const done = o.status === 'sent', canceled = o.status === 'canceled';
  const banner = done ? `<div class="tag ok">✓ SENT to ${esc(o.toPhone)}</div>`
    : canceled ? `<div class="tag no">canceled</div>`
    : o.status === 'failed' ? `<div class="tag no">last attempt failed: ${esc(o.error ?? '')}</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Outreach · ${esc(o.businessName)}</title>
<style>*{box-sizing:border-box}body{margin:0;background:#0a0c10;color:#e7ecf3;font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;padding:20px;max-width:640px;margin:0 auto}
h1{font-size:17px;letter-spacing:.02em;margin:0 0 2px}.sub{color:#8a95a5;font-size:13px;margin-bottom:16px}
textarea{width:100%;min-height:220px;background:#11151c;color:#e7ecf3;border:1px solid #232a35;border-radius:12px;padding:14px;font:14px/1.5 inherit;resize:vertical}
.row{display:flex;gap:10px;margin-top:14px}button{flex:1;padding:14px;border:0;border-radius:12px;font-weight:700;font-size:15px;cursor:pointer}
.send{background:#1f8f4e;color:#fff}.cancel{background:#1a1f27;color:#c2ccd8;border:1px solid #232a35}.send:disabled{opacity:.5}
.tag{display:inline-block;padding:6px 12px;border-radius:999px;font-size:13px;font-weight:700;margin-bottom:14px}.ok{background:#123a24;color:#57d98a}.no{background:#3a1a1a;color:#e88}
.meta{font-size:12px;color:#6b7686;margin-top:14px}#msg{margin-top:12px;font-size:14px}</style></head>
<body><h1>📲 ${esc(o.businessName)}</h1><div class="sub">Text to <b>${esc(o.toPhone)}</b> · preview: ${esc(o.siteUrl)}</div>
${banner}
<textarea id="body" ${done ? 'readonly' : ''}>${esc(o.body)}</textarea>
${done ? '' : `<div class="row"><button class="send" id="send">✅ Send text</button><button class="cancel" id="cancel">Not now</button></div>`}
<div id="msg"></div>
<div class="meta">One-time approval link · ${new Date(o.createdAt).toLocaleString()}</div>
<script>
const T=${JSON.stringify(o.token)};
async function post(p){const b=document.getElementById('body').value;const r=await fetch('/api/pipeline/outreach/'+T+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:b})});return r.json();}
const s=document.getElementById('send');const c=document.getElementById('cancel');const m=document.getElementById('msg');
if(s)s.onclick=async()=>{s.disabled=true;m.textContent='Sending…';try{const j=await post('/send');m.textContent=j.ok?'✓ Sent!':'✗ '+(j.error||'failed');if(!j.ok)s.disabled=false;else{s.textContent='Sent ✓';if(c)c.style.display='none';}}catch(e){m.textContent='✗ '+e;s.disabled=false;}};
if(c)c.onclick=async()=>{await post('/cancel');m.textContent='Canceled.';if(s)s.disabled=true;};
</script></body></html>`;
}
app.get('/outreach/:token', (req, res) => {
  const o = getOutreach(req.params.token);
  if (!o) { res.status(404).send('<body style="background:#0a0c10;color:#8a95a5;font-family:sans-serif;padding:40px">Outreach link not found or expired.</body>'); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(outreachPage(o));
});
app.post('/api/pipeline/outreach/:token/send', express.json(), async (req, res) => {
  const r = await sendOutreach(req.params.token, (req.body ?? {}).body);
  res.json(r);
});
app.post('/api/pipeline/outreach/:token/cancel', express.json(), (req, res) => {
  const o = cancelOutreach(req.params.token);
  res.json({ ok: !!o, status: o?.status });
});

// Password gate for tunneled (remote) requests only — localhost stays open.
app.use((req, res, next) => {
  if (!isTunneled(req.headers)) return next();
  if (passwordOk(req.headers)) return next();
  if (!REMOTE_PASSWORD) { res.status(503).send('Remote access not configured'); return; }
  res.setHeader('WWW-Authenticate', 'Basic realm="Athena", charset="UTF-8"');
  res.status(401).send('Authentication required');
});
app.use(express.json());

// Launch the NEOFORM build circuit on demand from the interface. Works even while
// the cron is disabled (manual, supervised runs — no unwanted 4h auto-firing).
// Registered before the /api/pipeline router mount so this exact path wins.
// LAUNCH BUILD enqueues the FULL circuit (research included) on the single build
// lane — same runner that drives schematic builds, so manual launches serialize
// with everything else. (The scheduled auto-firing stays on the cron below.)
// scheduled auto-fire cron: 1b3f4e44-2c36-41bf-a6ff-a6c7b73cb07d (neoform-web-circuit)
app.post('/api/pipeline/launch', (_req, res) => {
  try {
    const job = enqueueBuild({ mode: 'circuit', label: 'NEOFORM circuit', source: 'launch' });
    kickRunner();
    res.json({ ok: true, launched: true, jobId: job.id, jobStatus: job.status,
      detail: job.status === 'running' ? 'circuit started' : 'circuit queued behind the running build' });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// Serve the curated Alien SFX library (built by tools/audio/build-final.mjs).
// Frontend SoundEngine loads /sfx/sound-map.json and plays /sfx/<file> on events.
const SFX_ROOT = join(HOME, 'sfx', 'Alien', 'final');
app.use('/sfx', express.static(SFX_ROOT));

// ─── Project Directory ───────────────────────────────────────────────────────
// Scans ~/websites/clients (delivered sites) and ~/projects/athena/clients
// (NEOFORM in-progress) for brief.json / site.config.json and returns a list.
// A project's recency (updatedAt) = its own recorded date if present (accurate
// age), else the config file's mtime. Drives newest-first sort + the 2-month cull.
function parseTs(v: unknown): number {
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000; // ms vs s
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; }
  return 0;
}
function projectUpdatedAt(pdir: string, data: Record<string, unknown>): number {
  let best = 0;
  for (const k of ['deliveredAt', 'deployedAt', 'generatedAt', 'updatedAt', 'createdAt']) best = Math.max(best, parseTs(data[k]));
  if (best) return best;
  for (const f of ['deploy.json', 'site.config.json', 'brief.json']) {
    try { return statSync(join(pdir, f)).mtimeMs; } catch { /* next */ }
  }
  try { return statSync(pdir).mtimeMs; } catch { return 0; }
}
app.get('/api/projects', (_req, res) => {
  const WEBSITES_CLIENTS  = join(HOME, 'websites', 'clients');
  const ATHENA_CLIENTS    = join(HOME, 'projects', 'athena', 'clients');
  // ~/.openclaw/workspace/clients is OFF-LIMITS to Athena — OpenClaw-owned sites live there.

  const projects: Record<string, unknown>[] = [];

  const scanDir = (dir: string, source: string) => {
    if (!existsSync(dir)) return;
    for (const slug of readdirSync(dir)) {
      const briefPath  = join(dir, slug, 'brief.json');
      const configPath = join(dir, slug, 'site.config.json');
      const dataPath   = existsSync(briefPath) ? briefPath : existsSync(configPath) ? configPath : null;
      if (!dataPath) continue;
      try {
        const data = JSON.parse(readFileSync(dataPath, 'utf-8')) as Record<string, unknown>;
        let reviewStatus = 'none';
        const rp = join(dir, slug, 'review.json');
        if (existsSync(rp)) { try { reviewStatus = (JSON.parse(readFileSync(rp, 'utf-8')) as { status?: string }).status ?? 'none'; } catch { /* ignore */ } }
        const di = deployInfo(join(dir, slug), data);
        let deployStatus = 'none';
        const dp = join(dir, slug, 'deploy.json');
        if (existsSync(dp)) { try { deployStatus = (JSON.parse(readFileSync(dp, 'utf-8')) as { status?: string }).status ?? 'none'; } catch { /* ignore */ } }
        projects.push({ slug, source, ...data, reviewStatus,
          deployed: di.deployed, deployReady: di.deployReady, deployKind: di.deployKind, deployStatus,
          updatedAt: projectUpdatedAt(join(dir, slug), data) });
      } catch { /* skip malformed */ }
    }
  };

  scanDir(WEBSITES_CLIENTS, 'websites');
  scanDir(ATHENA_CLIENTS, 'neoform');
  // (OpenClaw workspace intentionally NOT scanned — separation)

  res.json(projects);
});


// â”€â”€â”€ SFX Studio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// List every .wav file in the sfx library
app.get('/api/sfx/files', (_req, res) => {
  const files: string[] = [];
  const scan = (dir: string, rel: string) => {
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const relPath = rel ? `${rel}/${entry}` : entry;
        if (statSync(full).isDirectory()) { scan(full, relPath); }
        else if (entry.toLowerCase().endsWith('.wav')) { files.push(relPath); }
      }
    } catch { /* skip unreadable dirs */ }
  };
  scan(SFX_ROOT, '');
  files.sort();
  res.json({ files });
});

// Save a new sound-map (from the studio drag-and-drop)
app.post('/api/sfx/sound-map', (req, res) => {
  try {
    writeFileSync(join(SFX_ROOT, 'sound-map.json'), JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// Serve the SFX studio HTML
app.get('/sfx-studio', (_req, res) => {
  res.send(buildStudioHtml());
});

import { buildStudioHtml } from './studio-html.js';
// â”€â”€â”€ Health â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'online', version: '1.0.0',
    gateway: GATEWAY_HTTP,
    telegram: !!process.env.TELEGRAM_BOT_TOKEN,
    ts: new Date().toISOString(),
  });
});

// â”€â”€â”€ Gateway status proxy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/gateway/status', async (_req, res) => {
  try {
    const r = await gwFetch('/health');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    res.json({ ...data as object, _source: 'gateway' });
  } catch (err: unknown) {
    res.status(503).json({ offline: true, error: err instanceof Error ? err.message : String(err) });
  }
});

// â”€â”€â”€ Aggregated Vitals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/vitals', async (_req, res) => {
  const vitals: Record<string, unknown> = {
    ts: new Date().toISOString(),
    gateway: 'offline',
    model: 'anthropic/claude-sonnet-4-6',
    apiCost: null,
    telegramOk: !!process.env.TELEGRAM_BOT_TOKEN,
  };

  // Gateway status
  try {
    const r = await gwFetch('/health');
    if (r.ok) {
      const data = await r.json() as Record<string, unknown>;
      vitals.gateway = 'online';
      vitals.model = (data.model as string) ?? vitals.model;
    }
  } catch { /* offline */ }

  // API cost from usage file if accessible
  try {
    const r = await gwFetch('/health');
    if (r.ok) {
      const data = await r.json() as Record<string, unknown>;
      const usage = (data.usage as Record<string, unknown>) ?? {};
      const cost = usage.costToday ?? usage.cost ?? null;
      if (cost !== null) vitals.apiCost = `$${Number(cost).toFixed(3)}`;
    }
  } catch { /* no cost data */ }

  res.json(vitals);
});

// â”€â”€â”€ Chat â€” SSE proxy to gateway OpenAI-compat endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/chat â€” streams assistant tokens back as SSE
// Body: { message: string, sessionKey?: string, history?: {role,content}[] }
app.post('/api/chat', async (req, res) => {
  const { message, sessionKey, history = [] } = req.body as {
    message: string;
    sessionKey?: string;
    history?: Array<{ role: string; content: string }>;
  };

  if (!message) {
    res.status(400).json({ error: 'message required' });
    return;
  }

  // Build messages array
  const messages = [
    ...history,
    { role: 'user', content: message },
  ];

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const reqHeaders: Record<string, string> = {
      ...authHeaders,
      'Content-Type': 'application/json',
    };
    if (sessionKey) {
      reqHeaders['x-openclaw-session-key'] = sessionKey;
    }

    const gwRes = await fetch(`${GATEWAY_HTTP}/v1/chat/completions`, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify({
        model: 'openclaw/default',
        messages,
        stream: true,
        user: sessionKey ?? 'athena:comms',
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!gwRes.ok) {
      sendEvent({ type: 'error', message: `Gateway returned ${gwRes.status}`, offline: gwRes.status >= 500 });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (!gwRes.body) {
      sendEvent({ type: 'error', message: 'No response body' });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const reader = gwRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === ':' || trimmed === 'data: [DONE]') {
          if (trimmed === 'data: [DONE]') {
            res.write('data: [DONE]\n\n');
          }
          continue;
        }
        if (trimmed.startsWith('data: ')) {
          const payload = trimmed.slice(6);
          if (payload === '[DONE]') {
            res.write('data: [DONE]\n\n');
            continue;
          }
          try {
            const chunk = JSON.parse(payload) as Record<string, unknown>;
            const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
            const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
            const content = delta?.content as string | undefined;
            if (content) {
              sendEvent({ type: 'delta', content });
            }
            const finishReason = choices?.[0]?.finish_reason;
            if (finishReason === 'stop') {
              res.write('data: [DONE]\n\n');
            }
          } catch { /* parse error, skip */ }
        }
      }
    }

    res.end();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    sendEvent({ type: 'error', message: msg, offline: true });
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ─── Part interpretation — turn a natural-language brief into structured content ─
// POST /api/interpret-part  Body: { partType, raw, section?:{name,arch}, business? }
// Returns { ok, result } where result shape depends on partType. Falls back to a
// local heuristic split when the gateway is offline so the editor still works.
async function collectCompletion(prompt: string): Promise<string> {
  const gwRes = await fetch(`${GATEWAY_HTTP}/v1/chat/completions`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'openclaw/default', messages: [{ role: 'user', content: prompt }], stream: false, user: 'athena:interpret' }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!gwRes.ok) throw new Error(`gateway ${gwRes.status}`);
  const j = await gwRes.json() as { choices?: Array<{ message?: { content?: string } }> };
  return j.choices?.[0]?.message?.content ?? '';
}

function firstJson(raw: string): unknown {
  const s = raw.indexOf('{'); const a = raw.indexOf('[');
  const start = a >= 0 && (a < s || s < 0) ? a : s;
  if (start < 0) return null;
  const open = raw[start]; const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === open) depth++;
    else if (raw[i] === close) { depth--; if (depth === 0) { try { return JSON.parse(raw.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

const INTERPRET_SPEC: Record<string, { schema: string; guide: string }> = {
  List:    { schema: '{"items":["item one","item two", ...]}', guide: 'Expand the brief into the individual list items it implies (e.g. "a list of citrus fruits" → orange, lemon, lime, grapefruit). 3–8 concise items. If the brief already IS a comma/newline list, just clean it into items.' },
  Icon:    { schema: '{"items":[{"icon":"⚡","label":"Fast"}, ...]}', guide: 'Produce icon+label pairs. Pick a single fitting emoji for each. 3–6 items. e.g. "speed, safety, warranty" → ⚡ Fast, 🛡 Safe, ✅ Warranty.' },
  Heading: { schema: '{"value":"the headline","alts":["alt one","alt two"]}', guide: 'Write ONE punchy headline (max ~8 words) from the brief, plus 2 alternates. No period.' },
  Text:    { schema: '{"value":"the paragraph"}', guide: 'Write one tight paragraph (2–4 sentences) of on-brand body copy from the brief.' },
  Button:  { schema: '{"label":"Button Label","href":"#target"}', guide: 'Turn the brief into a button label (2–4 words) and a best-guess href (e.g. #contact, #book, tel:, mailto:).' },
  Video:   { schema: '{"spec":"what the clip shows","suggest":"stock|upload|generate","query":"stock search terms"}', guide: 'Describe the clip the brief asks for, whether to use stock/upload/generate, and stock search terms.' },
  Photo:   { schema: '{"alt":"alt text","suggest":"stock|upload|generate","query":"stock search terms"}', guide: 'Describe the photo, whether to use stock/upload/generate, and stock search terms.' },
  Vision:  { schema: '{"bullets":["directive one","directive two", ...]}', guide: 'Turn the operator\'s free-form vision for this section into 3–6 concrete, buildable directives (layout, imagery, mood, motion, copy) a web-build agent can follow. Imperative voice, each a short line. Do not invent facts about the business — translate intent into build direction.' },
};

function localFallback(partType: string, raw: string): unknown {
  const parts = raw.split(/[,\n;•]|\band\b/gi).map(s => s.trim()).filter(Boolean);
  switch (partType) {
    case 'List':    return { items: parts.length ? parts : [raw.trim()].filter(Boolean) };
    case 'Icon':    return { items: (parts.length ? parts : [raw.trim()]).filter(Boolean).map(p => ({ icon: '◆', label: p })) };
    case 'Heading': return { value: raw.trim(), alts: [] };
    case 'Text':    return { value: raw.trim() };
    case 'Button':  return { label: raw.trim().slice(0, 24) || 'Learn more', href: '#' };
    case 'Video':   return { spec: raw.trim(), suggest: 'stock', query: raw.trim() };
    case 'Photo':   return { alt: raw.trim(), suggest: 'stock', query: raw.trim() };
    case 'Vision':  return { bullets: parts.length ? parts : [raw.trim()].filter(Boolean) };
    default:        return { value: raw.trim() };
  }
}

app.post('/api/interpret-part', async (req, res) => {
  const { partType, raw, section, business } = req.body as { partType?: string; raw?: string; section?: { name?: string; arch?: string }; business?: string };
  if (!partType || !raw || !raw.trim()) { res.status(400).json({ ok: false, error: 'partType and raw required' }); return; }
  const spec = INTERPRET_SPEC[partType];
  if (!spec) { res.json({ ok: true, source: 'local', result: localFallback(partType, raw) }); return; }
  const ctx = [section?.name ? `Section: ${section.name}` : '', section?.arch ? `(${section.arch} block)` : '', business ? `Business: ${business}` : ''].filter(Boolean).join(' ');
  const prompt =
    `You are Athena's content interpreter for a website builder. A "${partType}" element was added to a section and the operator described what they want. ` +
    `Turn their brief into structured content.\n${ctx ? ctx + '\n' : ''}` +
    `Their brief: "${raw.trim()}"\n\n${spec.guide}\n\n` +
    `Output ONLY valid minified JSON in exactly this shape, nothing else:\n${spec.schema}`;
  try {
    const out = await collectCompletion(prompt);
    const parsed = firstJson(out);
    if (parsed && typeof parsed === 'object') { res.json({ ok: true, source: 'athena', result: parsed }); return; }
    res.json({ ok: true, source: 'local', note: 'model returned no JSON', result: localFallback(partType, raw) });
  } catch (err) {
    res.json({ ok: true, source: 'local', note: err instanceof Error ? err.message : 'offline', result: localFallback(partType, raw) });
  }
});

// â”€â”€â”€ Cron Jobs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/cron/jobs', async (_req, res) => {
  // Try gateway WS RPC first; fallback to CLI
  try {
    const r = await gwFetch('/api/cron/list');
    if (r.ok) {
      res.json(await r.json());
      return;
    }
  } catch { /* try CLI */ }

  try {
    const raw = await runCli(['cron', 'list', '--json']);
    res.json(JSON.parse(raw));
  } catch (err: unknown) {
    res.status(503).json({ error: err instanceof Error ? err.message : String(err), jobs: [] });
  }
});

app.get('/api/cron/jobs/:id/runs', async (req, res) => {
  const { id } = req.params;
  if (!safeToken(id)) { res.status(400).json({ error: 'invalid id', runs: [] }); return; }
  // Try gateway REST first
  try {
    const r = await gwFetch(`/api/cron/jobs/${id}/runs`);
    if (r.ok) {
      res.json(await r.json());
      return;
    }
  } catch { /* fall through to CLI */ }

  // CLI fallback â€” note: cron runs has no --json flag; it always outputs JSON
  try {
    const raw = await runCli(['cron', 'runs', '--id', id, '--limit', '50']);
    type CliRun = {
      runId?: string; status?: string;
      runAtMs?: number; startedAtMs?: number;
      durationMs?: number; finishedAtMs?: number;
      summary?: string; output?: string;
    };
    const data = JSON.parse(raw) as { entries?: CliRun[]; runs?: CliRun[] };
    // CLI uses `entries`; normalize to `runs` with the field names the frontend expects
    const raw_runs = data.entries ?? data.runs ?? [];
    const runs = raw_runs.map(r => ({
      ...r,
      startedAtMs: r.runAtMs ?? r.startedAtMs,
      finishedAtMs: r.finishedAtMs ?? (r.runAtMs != null && r.durationMs != null
        ? r.runAtMs + r.durationMs : undefined),
      output: r.summary ?? r.output,
    }));
    res.json({ runs });
  } catch (err: unknown) {
    res.status(503).json({ error: err instanceof Error ? err.message : String(err), runs: [] });
  }
});

app.post('/api/cron/jobs/:id/run', async (req, res) => {
  const { id } = req.params;
  if (!safeToken(id)) { res.status(400).json({ ok: false, error: 'invalid id' }); return; }
  try {
    const raw = await runCli(['cron', 'run', id]);
    res.json({ ok: true, output: raw });
  } catch (err: unknown) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/cron/jobs/:id/toggle', async (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body as { enabled: boolean };
  if (!safeToken(id)) { res.status(400).json({ ok: false, error: 'invalid id' }); return; }
  try {
    const raw = await runCli(['cron', 'edit', id, '--enabled', enabled ? 'true' : 'false']);
    res.json({ ok: true, output: raw });
  } catch (err: unknown) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// â”€â”€â”€ Sessions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/sessions', async (_req, res) => {
  try {
    const sessionsFile = join(AGENTS_DIR, 'main', 'sessions', 'sessions.json');
    const raw = readFileSync(sessionsFile, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;

    const sessions = Object.entries(data)
      .filter(([, v]) => typeof v === 'object' && v !== null)
      .map(([key, v]) => {
        const s = v as Record<string, unknown>;
        return {
          key,
          sessionId: s.sessionId,
          updatedAt: s.updatedAt,
          model: s.model,
          inputTokens: s.inputTokens,
          outputTokens: s.outputTokens,
          totalTokens: s.totalTokens,
        };
      })
      .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));

    res.json({ sessions });
  } catch (err: unknown) {
    res.status(503).json({ error: err instanceof Error ? err.message : String(err), sessions: [] });
  }
});

// â”€â”€â”€ Memory / file browser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/memory/files', (_req, res) => {
  const files: Array<{ name: string; path: string; size: number; mtime: number; category: string }> = [];

  const scan = (dir: string, category: string) => {
    if (!existsSync(dir)) return;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const full = join(dir, entry);
        try {
          const st = statSync(full);
          if (st.isFile() && (entry.endsWith('.md') || entry.endsWith('.json'))) {
            files.push({ name: entry, path: full, size: st.size, mtime: st.mtimeMs, category });
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  };

  scan(WORKSPACE_DIR, 'workspace');
  scan(join(WORKSPACE_DIR, 'memory'), 'memory');

  // Skill SKILL.md files
  const skillsDir = join(HOME, '.agents', 'skills');
  if (existsSync(skillsDir)) {
    try {
      const skills = readdirSync(skillsDir);
      for (const skill of skills) {
        const skillMd = join(skillsDir, skill, 'SKILL.md');
        if (existsSync(skillMd)) {
          const st = statSync(skillMd);
          files.push({ name: `${skill}/SKILL.md`, path: skillMd, size: st.size, mtime: st.mtimeMs, category: 'skill' });
        }
      }
    } catch { /* skip */ }
  }

  files.sort((a, b) => b.mtime - a.mtime);
  res.json({ files });
});

app.get('/api/memory/file', (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }

  // Security: only serve files under known safe dirs
  const safeRoots = [WORKSPACE_DIR, join(HOME, '.agents', 'skills')];
  const isAllowed = safeRoots.some(root => filePath.startsWith(root));
  if (!isAllowed) { res.status(403).json({ error: 'forbidden' }); return; }

  try {
    const content = readFileSync(filePath, 'utf-8');
    res.json({ content, name: basename(filePath) });
  } catch (err: unknown) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── EXECUTE a schematic → hand it to the NEOFORM build + light the pipeline ────
// The Feature Director's ▶ EXECUTE button (and the "athena start neoform build …"
// chat command) POST here. It locks the edited manifest, approves the review, and
// creates/updates a pipeline lead → status 'building' so the BUILD TRACKER, pipeline
// board and review inbox all reflect the running build. Registered before the
// /api/projects router mount so this exact path wins.
const PROJECT_ROOTS = [
  join(HOME, 'websites', 'clients'),
  join(HOME, 'projects', 'athena', 'clients'),
];
function resolveSlugDir(slug: string): string | null {
  const safe = basename(slug);
  for (const root of PROJECT_ROOTS) {
    const d = join(root, safe);
    if (existsSync(d) && statSync(d).isDirectory()) return d;
  }
  return null;
}

// Figure out whether a project is deployed and/or ready to deploy, and how.
// static = a prebuilt folder with index.html; next = a Next/Vite app to build on Vercel.
const VERCEL_SCOPE = process.env.VERCEL_SCOPE ?? '';
function deployInfo(dir: string, cfg: Record<string, unknown>): { deployed: boolean; live: string; deployReady: boolean; deployKind: 'static' | 'next' | null; deployDir: string } {
  const live = String(cfg.live_url ?? cfg.liveUrl ?? cfg.siteUrl ?? '');
  let deployKind: 'static' | 'next' | null = null;
  let deployDir = dir;
  // 1. A framework app (Next/Vite/…): deploy from the ROOT so Vercel builds it and
  //    respects any existing .vercel link — deploying the prebuilt out/ detached would
  //    mint a mis-named project.
  const hasPkg = existsSync(join(dir, 'package.json'));
  const hasFrameworkCfg = ['.vercel', 'next.config.js', 'next.config.mjs', 'vite.config.ts', 'vite.config.js', 'astro.config.mjs'].some(f => existsSync(join(dir, f)));
  if (hasPkg && (hasFrameworkCfg || existsSync(join(dir, 'out')) || existsSync(join(dir, 'dist')))) {
    deployKind = 'next'; deployDir = dir;
  }
  // 2. A raw static site (no framework): deploy the folder that holds index.html.
  if (!deployKind) {
    for (const d of ['out', 'dist', 'build', 'site']) {
      if (existsSync(join(dir, d, 'index.html'))) { deployKind = 'static'; deployDir = join(dir, d); break; }
    }
  }
  if (!deployKind && existsSync(join(dir, 'index.html'))) { deployKind = 'static'; deployDir = dir; }
  return { deployed: !!live, live, deployReady: !!deployKind, deployKind, deployDir };
}

// ─── Deploy a finished-but-undeployed site to Vercel ───────────────────────────
// The Projects list DEPLOY button (and its auto-deploy) POST here. Detects the
// build artifact, runs `vercel deploy --prod`, records the URL back into
// site.config.json + a pipeline lead → deployed. Runs async; the card polls.
app.post('/api/projects/:slug/deploy', (req, res) => {
  const slug = basename(req.params.slug);
  const dir = resolveSlugDir(slug);
  if (!dir) { res.status(404).json({ ok: false, error: 'project not found' }); return; }
  const cfgPath = join(dir, 'site.config.json');
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown> : {};
  const info = deployInfo(dir, cfg);
  if (info.deployed && !req.query.force) { res.json({ ok: true, alreadyDeployed: true, url: info.live, message: `Already live: ${info.live}` }); return; }
  if (!info.deployReady) { res.status(400).json({ ok: false, error: 'no build output to deploy — run the build first (nothing to publish)' }); return; }
  const cwd = info.deployKind === 'next' ? dir : info.deployDir;
  const cmd = info.deployKind === 'next'
    ? `vercel deploy --prod --yes --scope ${VERCEL_SCOPE}`
    : `vercel deploy --prod --yes --scope ${VERCEL_SCOPE}`;
  if (req.query.dry) { res.json({ ok: true, dry: true, slug, kind: info.deployKind, cwd, cmd }); return; }
  try { writeFileSync(join(dir, 'deploy.json'), JSON.stringify({ status: 'deploying', kind: info.deployKind, startedAt: Date.now() }, null, 2)); } catch { /* ignore */ }
  res.json({ ok: true, deploying: true, slug, kind: info.deployKind, message: `▲ Deploying ${slug} (${info.deployKind}) to Vercel…` });
  // fire-and-track: record URL + flip the lead when it lands
  void (async () => {
    try {
      const { stdout, stderr } = await exec(cmd, { cwd, timeout: 300_000, env: { ...process.env, FORCE_COLOR: '0' } });
      const url = ((`${stdout}\n${stderr}`).match(/https:\/\/[^\s]+\.vercel\.app/g) ?? []).pop() ?? '';
      writeFileSync(cfgPath, JSON.stringify({ ...cfg, live_url: url || cfg.live_url, deployedAt: Date.now() }, null, 2));
      writeFileSync(join(dir, 'deploy.json'), JSON.stringify({ status: url ? 'deployed' : 'error', url, at: Date.now() }, null, 2));
      const label = String(cfg.businessName ?? cfg.name ?? slug).split(' · ')[0];
      const now = Date.now();
      const lead = readLeads().find(l => l.businessName === label);
      if (lead) upsertLead({ ...lead, status: 'deployed', buildStage: 'deploy', siteUrl: url || lead.siteUrl, currentSiteUrl: url || lead.currentSiteUrl, deployedAt: new Date(now).toISOString(), updatedAt: now });
    } catch (e) {
      try { writeFileSync(join(dir, 'deploy.json'), JSON.stringify({ status: 'error', error: e instanceof Error ? e.message : String(e), at: Date.now() }, null, 2)); } catch { /* ignore */ }
    }
  })();
});
// Core: lock a composed schematic, approve its review, attach/refresh its lead,
// and drop a 'schematic' job on the SINGLE build lane (buildQueue). The runner
// (buildRunner) launches the SAME NEOFORM circuit agent with the research parts
// cut out. Shared by the EXECUTE button, the Athena-chat build order, and any
// Telegram build order — so everything serializes through one queue.
interface SchematicResult { status: number; body: Record<string, unknown>; }
function startSchematicBuild(slug: string, opts: { manifest?: { label?: string; url?: string; cat?: string; sections?: unknown[] }; source?: string }): SchematicResult {
  const dir = resolveSlugDir(slug);
  if (!dir) return { status: 404, body: { ok: false, error: 'project not found' } };
  const { manifest, source } = opts;
  try {
    // 1. persist the schematic (or read the last-saved one)
    let mani = manifest;
    if (mani) writeFileSync(join(dir, 'manifest.json'), JSON.stringify(mani, null, 2));
    else if (existsSync(join(dir, 'manifest.json'))) mani = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    if (!mani) return { status: 400, body: { ok: false, error: 'no schematic — compose a layout first' } };
    const sections = Array.isArray(mani.sections) ? mani.sections.length : 0;
    if (!sections) return { status: 400, body: { ok: false, error: 'schematic is empty — add at least one section' } };

    // 2. approve the review (the handoff the circuit reads — schematic mode skips the request)
    writeFileSync(join(dir, 'review.json'), JSON.stringify({ status: 'approved', at: Date.now(), source: source ?? 'execute' }, null, 2));

    // 3. attach/update a pipeline lead — buildMode 'schematic' + buildStage 'build'
    //    (schematic skips scout/verify/qualify/architect, so the tracker starts at BUILD)
    const cfg = existsSync(join(dir, 'site.config.json')) ? JSON.parse(readFileSync(join(dir, 'site.config.json'), 'utf8')) as Record<string, unknown> : {};
    const label = String(mani.label ?? cfg.businessName ?? slug).split(' · ')[0];
    const buildPath = join(dir, 'build.json');
    const prev = existsSync(buildPath) ? JSON.parse(readFileSync(buildPath, 'utf8')) as { leadId?: string } : {};
    const now = Date.now();
    const url = String(mani.url ?? cfg.live_url ?? cfg.liveUrl ?? '') || undefined;
    let lead = prev.leadId ? getLead(prev.leadId) : readLeads().find(l => l.businessName === label);
    if (lead) {
      lead = { ...lead, status: 'building', buildMode: 'schematic', buildStage: 'build', buildStageAt: now, currentSiteUrl: url ?? lead.currentSiteUrl, notes: `schematic build · ${sections} sections`, updatedAt: now };
    } else {
      lead = {
        id: randomUUID(), businessName: label, phone: String(cfg.phone ?? ''), address: String(cfg.address ?? ''),
        city: String(cfg.city ?? ''), state: '', industry: String(cfg.industry ?? cfg.category ?? ''),
        rating: 0, reviewCount: 0, webStatus: 'unknown', currentSiteUrl: url,
        qualifyingSignals: ['schematic composed in Feature Director'], disqualifyingReasons: [],
        qualificationScore: 100, status: 'building', buildMode: 'schematic', buildStage: 'build', buildStageAt: now,
        notes: `schematic build · ${sections} sections`, createdAt: now, updatedAt: now,
      } as Lead;
    }
    upsertLead(lead);

    // 4. drop the job on the single lane + kick the runner
    const job = enqueueBuild({ mode: 'schematic', slug, label, leadId: lead.id, sections, source: source ?? 'edit-execute' });
    writeFileSync(buildPath, JSON.stringify({ status: 'queued', leadId: lead.id, jobId: job.id, slug, sections, requestedAt: now, source: source ?? 'edit-execute' }, null, 2));
    kickRunner();

    const running = runningJob();
    const ahead = pendingCount();
    const laneMsg = running && running.id === job.id ? 'building now'
      : running ? `queued behind ${running.label} · ${ahead} in queue — starts when the lane clears`
      : 'queued — starting the lane';
    return { status: 200, body: { ok: true, slug, leadId: lead.id, jobId: job.id, label, sections, mode: 'schematic', jobStatus: job.status,
      message: `▶ ${label} — schematic locked (${sections} sections), review approved · ${laneMsg}.` } };
  } catch (e) { return { status: 500, body: { ok: false, error: e instanceof Error ? e.message : String(e) } }; }
}

app.post('/api/projects/:slug/build', (req, res) => {
  const { manifest, source } = (req.body ?? {}) as { manifest?: { label?: string; url?: string; cat?: string; sections?: unknown[] }; source?: string };
  const r = startSchematicBuild(basename(req.params.slug), { manifest, source });
  res.status(r.status).json(r.body);
});

// Resolve a free-text business name OR slug to a project slug (for Telegram/chat orders).
function resolveBuildTarget(q: string): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (resolveSlugDir(q)) return basename(q);
  const nq = norm(q);
  if (!nq) return null;
  for (const root of PROJECT_ROOTS) {
    if (!existsSync(root)) continue;
    for (const slug of readdirSync(root)) {
      if (norm(slug).includes(nq) || nq.includes(norm(slug))) return slug;
      for (const f of ['site.config.json', 'brief.json', 'manifest.json']) {
        const p = join(root, slug, f);
        if (!existsSync(p)) continue;
        try {
          const d = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
          const nm = norm(String(d.businessName ?? d.name ?? d.label ?? ''));
          if (nm && (nm.includes(nq) || nq.includes(nm))) return slug;
        } catch { /* ignore */ }
        break;
      }
    }
  }
  return null;
}

// Universal build-order entry — one lane for every trigger (chat, Telegram-via-agent,
// external). mode:'circuit' enqueues the full automatic circuit; otherwise a
// schematic build resolved by slug or business name.
app.post('/api/pipeline/enqueue', (req, res) => {
  const b = (req.body ?? {}) as { slug?: string; name?: string; query?: string; mode?: string; source?: string; manifest?: { label?: string; url?: string; cat?: string; sections?: unknown[] } };
  if ((b.mode ?? 'schematic') === 'circuit') {
    const job = enqueueBuild({ mode: 'circuit', label: 'NEOFORM circuit', source: b.source ?? 'launch' });
    kickRunner();
    res.json({ ok: true, jobId: job.id, mode: 'circuit', jobStatus: job.status, message: `▶ NEOFORM circuit ${job.status === 'running' ? 'started' : 'queued'}.` });
    return;
  }
  const q = String(b.slug ?? b.name ?? b.query ?? '').trim();
  if (!q) { res.status(400).json({ ok: false, error: 'provide a slug or business name' }); return; }
  const slug = resolveBuildTarget(q);
  if (!slug) { res.status(404).json({ ok: false, error: `no project matches "${q}"` }); return; }
  const r = startSchematicBuild(slug, { manifest: b.manifest, source: b.source ?? 'telegram' });
  res.status(r.status).json(r.body);
});

// Best-effort Telegram DM to the owner (cancel notices, etc). No-ops if unconfigured.
async function notifyTelegram(text: string): Promise<void> {
  const bot = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_OWNER_CHAT_ID ?? process.env.TELEGRAM_CHAT_ID;
  if (!bot || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(6000),
    });
  } catch { /* best effort */ }
}
function labelFromSlug(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── ONE-LINE COMMAND (the phone → Athena entry) ───────────────────────────────
// Takes a spoken/typed line like "optimize the demo app for mobile", resolves which
// existing site it means, and drops an EDIT job on the single lane WITHOUT approval.
// A hold window (default 60s) keeps the job cancelable (reply STOP / DELETE the job)
// before it starts — protection against a misheard voice command.
app.post('/api/pipeline/command', (req, res) => {
  const b = (req.body ?? {}) as { text?: string; source?: string; holdSeconds?: number };
  // Tolerate a leading ".edit." prefix (the phone app's explicit edit mode).
  const text = String(b.text ?? '').trim().replace(/^\.(edit|command|build)\.\s*/i, '');
  if (!text) { res.status(400).json({ ok: false, error: 'text required' }); return; }
  const source = b.source ?? 'command';

  // Escape hatch: "launch/new/run a circuit" still fires the full automatic circuit.
  if (/\b(launch|new|run|start)\b.*\bcircuit\b|^circuit\b/i.test(text)) {
    const job = enqueueBuild({ mode: 'circuit', label: 'NEOFORM circuit', source });
    kickRunner();
    res.json({ ok: true, understood: { intent: 'circuit' }, jobId: job.id, jobStatus: job.status, message: `▶ NEOFORM circuit ${job.status === 'running' ? 'started' : 'queued'}.` });
    return;
  }

  const slug = resolveBuildTarget(text);
  if (!slug) {
    res.status(404).json({ ok: false, error: 'could not tell which site you meant — include the business/site name', heard: text });
    return;
  }
  const label = labelFromSlug(slug);
  const holdSeconds = Math.max(0, Math.min(Number(b.holdSeconds ?? 60), 600));
  const job = enqueueBuild({
    mode: 'edit', slug, label: `${label} · edit`, instruction: text, source,
    holdUntil: holdSeconds > 0 ? Date.now() + holdSeconds * 1000 : undefined,
  });
  kickRunner();

  if (holdSeconds > 0) {
    void notifyTelegram(`📲 Queued: edit ${label}\n"${text}"\nReply STOP within ${holdSeconds}s to cancel · id ${job.id.slice(0, 8)}`);
  } else {
    void notifyTelegram(`📲 Queued: edit ${label}\n"${text}" · id ${job.id.slice(0, 8)}`);
  }

  res.json({
    ok: true,
    understood: { intent: 'edit', project: slug, label, instruction: text },
    jobId: job.id,
    jobStatus: job.status,
    holdSeconds,
    cancelUrl: `/api/pipeline/queue/${job.id}`,
    message: `▶ Edit queued for ${label} — "${text}".${holdSeconds > 0 ? ` ${holdSeconds}s cancel window (reply STOP or hit cancel).` : ''}`,
  });
});

// STOP handler — cancel the most recent still-cancelable command (a held edit).
// This is what a "STOP" Telegram reply (or the PWA cancel) hits when it doesn't
// carry a specific job id. Only touches queued jobs; a running build is untouched.
// ─── Visual UPGRADE — queue a themed enhancement pass on an existing site ──────
// GET packs (for the dropdown); POST enqueues an 'edit' job whose instruction is the
// composed upgrade directive (a feature pack, a redundancy pass, or a described section).
app.get('/api/pipeline/upgrade/packs', (_req, res) => {
  res.json({ packs: packSummaries() });
});
app.post('/api/pipeline/upgrade', (req, res) => {
  const b = (req.body ?? {}) as { slug?: string; mode?: string; packId?: string; description?: string; source?: string };
  const slug = b.slug ? basename(b.slug) : '';
  if (!slug || !resolveSlugDir(slug)) { res.status(404).json({ ok: false, error: 'project not found' }); return; }
  const mode = (b.mode ?? 'features') as 'features' | 'redundancy' | 'section';
  const instruction = composeUpgradeInstruction(mode, { packId: b.packId, description: b.description });
  if (!instruction) {
    res.status(400).json({ ok: false, error: mode === 'features' ? 'unknown feature pack' : mode === 'section' ? 'describe the section to add' : 'invalid upgrade mode' });
    return;
  }
  const label = labelFromSlug(slug);
  const tag = mode === 'features' ? (UPGRADE_PACKS.find(p => p.id === b.packId)?.name ?? 'features')
    : mode === 'redundancy' ? 'redundancy check' : 'new section';
  const job = enqueueBuild({ mode: 'edit', slug, label: `${label} · upgrade`, instruction, source: b.source ?? 'upgrade' });
  kickRunner();
  const running = runningJob();
  const ahead = pendingCount();
  const laneMsg = running && running.id === job.id ? 'upgrading now'
    : running ? `queued behind ${running.label} · ${ahead} in line`
    : 'queued — starting the lane';
  res.json({ ok: true, slug, jobId: job.id, jobStatus: job.status, mode, tag,
    message: `⬆ ${label} — ${tag} upgrade ${laneMsg}.` });
});
// ─── LAW 0 · CLONE-FROM-EXAMPLE ────────────────────────────────────────────────
// The build agent calls this as the FIRST step of building a fresh site. Given the
// business category (its industry) + the chosen slug, if a gold example exists we
// clone its layout + animations into the client dir and return the content files the
// agent must swap. If nothing matches, cloned:false → the agent builds fresh.
app.get('/api/pipeline/templates', (_req, res) => {
  res.json({ templates: listTemplates() });
});
app.post('/api/pipeline/scaffold', (req, res) => {
  const b = (req.body ?? {}) as { slug?: string; industry?: string; category?: string };
  const slug = b.slug ? basename(b.slug) : '';
  if (!slug) { res.status(400).json({ ok: false, error: 'slug required' }); return; }
  const template = matchTemplate(b.industry ?? b.category);
  if (!template) { res.json({ ok: true, cloned: false, reason: 'no example for this category — build fresh' }); return; }
  const r = scaffoldFromTemplate(template, slug);
  if (!r.ok) { res.json({ ok: true, cloned: false, reason: r.reason, template: { id: template.id, label: template.label } }); return; }
  res.json({
    ok: true, cloned: true, slug,
    template: { id: template.id, label: template.label, from: r.from },
    dest: r.dest,
    contentFiles: r.contentFiles,
    adaptiveArrays: r.adaptiveArrays,
    preserve: r.preserve,
    instruction:
      `CLONED the "${template.label}" gold example into clients/${slug}. DO NOT rebuild the layout, components, or animations — they are the schematic and must be kept EXACTLY. Replace ONLY the content in these files with THIS business's real, verified details (copy, photos from Google Maps, real reviews, contact, hours, service area): ${(r.contentFiles ?? []).join(', ')}. Adapt every list to the REAL business — arrays [${(r.adaptiveArrays ?? []).join(', ')}] must match what this business actually has; if it has 3 steps, ship 3 and delete the extras — never pad to the example's count. QA gate: NO trace of the example business may remain (name, owner, phone, address, city, review authors). Then continue to QA → deploy → report.`,
  });
});

// ─── Outreach staging (agent calls this after deploy) ──────────────────────────
// Composes the SMS pitch for a deployed lead and texts the OWNER a review-&-send
// link. Nothing goes to the business until the owner taps SEND on the approval page.
app.post('/api/pipeline/outreach/draft', (req, res) => {
  const b = (req.body ?? {}) as { leadId?: string };
  const lead = b.leadId ? getLead(b.leadId) : undefined;
  if (!lead) { res.status(404).json({ ok: false, error: 'lead not found' }); return; }
  const rec = stageOutreach(lead);
  if (!rec) { res.json({ ok: false, staged: false, reason: 'lead has no siteUrl or phone — nothing to text' }); return; }
  res.json({ ok: true, staged: true, token: rec.token, to: rec.toPhone, status: rec.status,
    message: `📲 Outreach for ${rec.businessName} staged — approval link sent to your Telegram.` });
});
app.get('/api/pipeline/outreach', (_req, res) => {
  res.json({ outreach: listOutreach().map(o => ({ token: o.token, businessName: o.businessName, toPhone: o.toPhone, status: o.status, createdAt: o.createdAt, sentAt: o.sentAt })) });
});

app.post('/api/pipeline/command/cancel', (_req, res) => {
  const edits = readQueue()
    .filter(j => j.status === 'queued' && j.mode === 'edit')
    .sort((a, b) => b.enqueuedAt - a.enqueuedAt);
  const target = edits.find(j => j.holdUntil && j.holdUntil > Date.now()) ?? edits[0];
  if (!target) { res.json({ ok: false, message: '✓ nothing to cancel (no queued edit in its window)' }); return; }
  const c = cancelJob(target.id);
  res.json({ ok: !!c, canceled: c ? { id: c.id, label: c.label } : null,
    message: c ? `✕ canceled ${c.label}` : 'too late — that build already started' });
});

// ─── ASK — conversational, read-only ".chat." mode (pull live pipeline data) ───
// Answers questions like "what are you building right now?" grounded in the live
// lane/queue/today state. Uses the gateway LLM for phrasing, with a template
// fallback so it still works if the gateway is offline.
function askFallback(s: Record<string, unknown>): string {
  const b = s.building as { site?: string; mode?: string } | null;
  if (b) return `Building now: ${b.site} (${b.mode}).${(s.queued as number) ? ` ${s.queued} more queued.` : ' Nothing else queued.'}`;
  const auto = s.auto as { enabled?: boolean; nextEligibleAt?: number } | undefined;
  const next = auto?.nextEligibleAt ? new Date(auto.nextEligibleAt).toLocaleTimeString() : 'unknown';
  return `Lane idle. ${(s.completedToday as number) ?? 0} sites shipped today. AUTO ${auto?.enabled ? `on — next fires ~${next}` : 'off'}.`;
}
app.post('/api/pipeline/ask', async (req, res) => {
  const text = String((req.body as { text?: string })?.text ?? '').trim().replace(/^\.(chat|ask)\.\s*/i, '');
  if (!text) { res.status(400).json({ ok: false, error: 'text required' }); return; }
  let snap: Record<string, unknown> = {};
  try {
    const [q, today] = await Promise.all([
      fetch(`http://localhost:${PORT}/api/pipeline/queue`).then(r => r.json()) as Promise<Record<string, unknown>>,
      fetch(`http://localhost:${PORT}/api/pipeline/today`).then(r => r.json()) as Promise<Record<string, unknown>>,
    ]);
    const run = q.running as { label?: string; mode?: string; source?: string } | null;
    snap = {
      building: q.active ? { site: run?.label, mode: run?.mode, source: run?.source } : null,
      queued: q.pending,
      queuedJobs: ((q.queued as Array<{ mode: string; label: string }>) ?? []).map(j => ({ mode: j.mode, label: j.label })),
      completedToday: today.countToday,
      recentSites: ((today.completedToday as Array<{ businessName: string; status: string; siteUrl?: string }>) ?? []).slice(0, 6)
        .map(l => ({ name: l.businessName, status: l.status, url: l.siteUrl })),
      auto: today.auto,
    };
  } catch { /* snapshot best-effort */ }

  const prompt =
    `You are Athena, the operator's web-build pipeline, answering on their phone. LIVE STATE (JSON):\n${JSON.stringify(snap)}\n\n` +
    `Operator asks: "${text}"\n\nAnswer in 1-3 short sentences, specific and grounded ONLY in the state above. ` +
    `If they ask what you're building, name the site + mode. If nothing is building, say the lane is idle and when AUTO next fires. ` +
    `No markdown, no preamble, no lists — just the answer.`;
  try {
    const answer = (await collectCompletion(prompt)).trim();
    res.json({ ok: true, mode: 'chat', answer: answer || askFallback(snap), state: snap });
  } catch {
    res.json({ ok: true, mode: 'chat', answer: askFallback(snap), state: snap, offline: true });
  }
});

// Automatic-circuit scheduler control. GET = state + next fire; POST = toggle/tune.
app.get('/api/pipeline/auto', (_req, res) => {
  const cfg = readAuto();
  const { at } = nextEligibleAt(cfg);
  res.json({ ...cfg, everyHours: cfg.minSpacingMs / 3_600_000, cooldownMin: cfg.cooldownMs / 60_000, nextEligibleAt: at });
});
app.post('/api/pipeline/auto', (req, res) => {
  const b = (req.body ?? {}) as { enabled?: boolean; everyHours?: number; cooldownMin?: number };
  const patch: Record<string, unknown> = {};
  if (typeof b.enabled === 'boolean') patch.enabled = b.enabled;
  if (typeof b.everyHours === 'number' && b.everyHours > 0) patch.minSpacingMs = b.everyHours * 3_600_000;
  if (typeof b.cooldownMin === 'number' && b.cooldownMin >= 0) patch.cooldownMs = b.cooldownMin * 60_000;
  const cfg = writeAuto(patch);
  const { at } = nextEligibleAt(cfg);
  res.json({ ok: true, ...cfg, everyHours: cfg.minSpacingMs / 3_600_000, nextEligibleAt: at,
    message: cfg.enabled ? `⏱ auto-circuit ON · every ${cfg.minSpacingMs / 3_600_000}h / +${cfg.cooldownMs / 60_000}m after finish` : '⏸ auto-circuit OFF' });
});

// â”€â”€â”€ Pipeline routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use('/api/pipeline', pipelineRoutes);
app.use('/api/projects', projectsRoutes);

// â”€â”€â”€ HTTP server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const httpServer = createServer(app);

// â”€â”€â”€ WebSocket bridge: browser â†” Athena backend â†” Gateway â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// One WS endpoint on the HTTP server via noServer + upgrade router:
//   /ws  — gateway event bridge (always on)
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  let pathname = '/';
  try { pathname = new URL(req.url ?? '/', 'http://localhost').pathname; } catch { /* keep default */ }

  if (pathname === '/ws') {
    // Tunneled /ws upgrades must carry the same Basic-Auth password (the browser
    // replays stored credentials on the handshake); localhost passes through.
    if (isTunneled(req.headers) && !passwordOk(req.headers)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

wss.on('connection', (clientWs) => {
  console.log('[Athena] Browser WS connected');

  // Connect to gateway WS for real-time events (mission log, cron events, etc.)
  let gwWs: WebSocket | null = null;

  const tryConnectGateway = () => {
    try {
      const gw = new WebSocket(GATEWAY_WS, { headers: authHeaders });

      gw.on('open', () => {
        console.log('[Athena] Gateway WS open');
        gwWs = gw;
        clientWs.send(JSON.stringify({ type: 'system', status: 'gateway_online' }));

        // Send connect handshake as a trusted backend client
        const connectReq = {
          type: 'req',
          id: `athena-connect-${Date.now()}`,
          method: 'connect',
          params: {
            minProtocol: 4,
            maxProtocol: 4,
            client: { id: 'athena-bridge', version: '1.0.0', platform: 'windows', mode: 'operator' },
            role: 'operator',
            scopes: ['operator.read', 'operator.write'],
            caps: [],
            commands: [],
            permissions: {},
            auth: { token: gatewayToken },
            locale: 'en-US',
            userAgent: 'athena-bridge/1.0.0',
          },
        };
        gw.send(JSON.stringify(connectReq));
      });

      gw.on('message', (data) => {
        const raw = typeof data === 'string' ? data : data.toString();
        try {
          const frame = JSON.parse(raw) as Record<string, unknown>;

          // Handle connect challenge
          if (frame.type === 'event' && frame.event === 'connect.challenge') {
            // Re-send connect with nonce â€” simplified (no device key signing)
            // This path requires gateway.controlUi.allowInsecureAuth=true or no device auth
            return;
          }

          // Forward cron events, chat events, health events to client
          const eventType = frame.event as string;
          if (
            eventType?.startsWith('cron') ||
            eventType?.startsWith('chat') ||
            eventType?.startsWith('health') ||
            eventType === 'tick' ||
            eventType === 'heartbeat'
          ) {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: 'gateway_event', payload: frame }));
            }
          }
        } catch { /* non-JSON */ }
      });

      gw.on('close', () => {
        gwWs = null;
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'system', status: 'gateway_offline' }));
        }
      });

      gw.on('error', () => {
        gwWs = null;
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'system', status: 'gateway_offline' }));
        }
      });
    } catch {
      clientWs.send(JSON.stringify({ type: 'system', status: 'gateway_offline' }));
    }
  };

  tryConnectGateway();

  // Client â†’ backend commands
  clientWs.on('message', (data) => {
    try {
      const msg = JSON.parse(typeof data === 'string' ? data : data.toString()) as Record<string, unknown>;

      // Forward certain messages to gateway WS if connected
      if (gwWs?.readyState === WebSocket.OPEN) {
        gwWs.send(typeof data === 'string' ? data : data.toString());
      }
    } catch { /* ignore */ }
  });

  clientWs.on('close', () => {
    gwWs?.close();
  });
});

// Serve built frontend (production / Cloudflare tunnel).
// Dev: Vite proxies /api, /sfx, /ws to this backend.
// Prod: backend IS the origin -- serve the React SPA from frontend/dist.
const __dirnameESM = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = join(__dirnameESM, '..', '..', 'frontend', 'dist');
if (existsSync(FRONTEND_DIST)) {
  // Hashed assets cache forever; index.html + other html must NEVER cache so a
  // rebuilt bundle shows immediately in the Edge --app desktop window.
  app.use(express.static(FRONTEND_DIST, {
    setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-store, must-revalidate'); },
  }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.sendFile(join(FRONTEND_DIST, 'index.html'));
  });
}

// SECURITY: bind to loopback ONLY. The backend runs spawn()/exec() on request, so it must
// never be reachable from the LAN or a forwarded port. Remote access is intended to arrive
// exclusively via the cloudflared tunnel → localhost:3001 (behind the password gate); the
// tunnel runs on this same host, so loopback binding does not affect it.
httpServer.listen(PORT, '127.0.0.1', () => {
  console.log('[Athena] Backend  -> http://127.0.0.1:' + PORT);
  console.log('[Athena] Gateway  -> ' + GATEWAY_WS);
  console.log('[Athena] Telegram -> ' + (process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'NOT SET'));
  // Single-lane NEOFORM build runner: drains the build queue one job at a time.
  startRunner();
  // Automatic-circuit scheduler: enqueues a full circuit on the lane on a cadence.
  startScheduler();
  // Supervisor: self-heals orphaned builds and, as a last resort, reboots to clear a
  // wedged lane — the "never stall, drop a project before wedging" contingency layer.
  startSupervisor();
  // Optional inbound-Telegram build listener (off by default — conflicts with
  // OpenClaw's own Telegram channel poll; enable with NEOFORM_TG_LISTENER=1 only
  // if OpenClaw's telegram channel is disabled).
  void startTelegramBuildListener();
});
