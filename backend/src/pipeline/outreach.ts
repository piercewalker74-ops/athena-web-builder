// ─── NEOFORM Outreach (approval-gated SMS) ─────────────────────────────────────
// Option 1 flow: after a site is deployed, the circuit STAGES a customized SMS pitch
// for the business. Athena does NOT send it automatically — it texts the OWNER a
// draft with a one-tap "Review & Send" link (Telegram URL button → approval page).
// The owner reviews (and can edit) the text, then sends. Only on that approval does
// the SMS actually go to the business, via Twilio. Human-in-the-loop = compliant +
// quality-controlled. Nothing sends without an explicit tap.

import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { Lead } from './types.js';

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? '';
const STORE = join(HOME, '.openclaw', 'neoform', 'outreach.json');

const BOT   = process.env.TELEGRAM_BOT_TOKEN ?? '';
const OWNER = process.env.TELEGRAM_OWNER_CHAT_ID ?? '';
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');

export type OutreachStatus = 'pending' | 'sent' | 'canceled' | 'failed';
export interface Outreach {
  token: string;
  leadId: string;
  businessName: string;
  toPhone: string;      // E.164
  siteUrl: string;
  body: string;
  status: OutreachStatus;
  createdAt: number;
  sentAt?: number;
  messageSid?: string;
  error?: string;
}

function readStore(): Outreach[] {
  try { return existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf-8')) : []; }
  catch { return []; }
}
function writeStore(list: Outreach[]) {
  try { mkdirSync(dirname(STORE), { recursive: true }); } catch { /* exists */ }
  writeFileSync(STORE, JSON.stringify(list, null, 2), 'utf-8');
}

// "555-555-0100" → "+15555550100". Best-effort North-America normalization.
function toE164(raw?: string): string {
  const trimmed = (raw ?? '').trim();
  const d = trimmed.replace(/\D/g, '');
  if (!d) return '';
  if (trimmed.startsWith('+')) return '+' + d;
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return '+' + d;
}

function firstName(lead: Lead): string {
  return (lead.ownerName ?? '').trim().split(/\s+/)[0] || '';
}

// The pitch — the operator's script, personalized with the owner's name, business,
// and the live preview URL.
export function composePitch(lead: Lead): string {
  const hi = firstName(lead) ? `Hi ${firstName(lead)}` : 'Hi there';
  // Adapt the gap line to the real web status so the claim is always true: "no site"
  // leads get "didn't have a website up"; weak/booking/social leads get an upgrade framing.
  const weak = /weak/i.test(String(lead.webStatus ?? ''));
  const gap = weak
    ? 'but figured your current site could use a serious modern upgrade'
    : "but didn't have a website up";
  return `${hi}, my name is Light — I'm a local web designer. I saw ${lead.businessName} is operating with great reviews and a solid social presence, ${gap}. I work with small-to-medium businesses who might not have the time to learn and build an optimized site, so I create modern, curated websites with AI-intelligence integration for business owners. I went ahead and made a quick preview site for you to take a look: ${lead.siteUrl} — if it's something you think could help your business grow, feel free to give me a call, no pressure of course. I'll give you a call tomorrow to follow up as well.`;
}

// A personalized cold-call script for the partner to work from — built from the
// lead's real, researched data (owner, reputation, the web gap, a headline service).
export function composeColdCallScript(lead: Lead): string {
  const owner = firstName(lead) || 'there';
  const biz = lead.businessName;
  const rep = lead.reviewCount
    ? `${lead.rating}★ across ${lead.reviewCount} reviews`
    : 'a strong reputation';
  const gap = lead.currentSiteUrl
    ? 'your current site looked a little dated'
    : "you don't have a website up yet";
  const svc = lead.industry ? lead.industry.toLowerCase() : 'what you do';

  return [
    `OPEN  —  "Hi, is this ${owner}? Hey ${owner}, my name's Light, I'm a local web designer. I came across ${biz} on Google — honestly, ${rep}, that's a fantastic reputation."`,
    ``,
    `HOOK  —  "The reason I'm calling: I noticed ${gap} — and for a shop doing ${svc} at your level, that's leaving a lot on the table. People search you, and there's nothing modern for them to land on."`,
    ``,
    `VALUE —  "So I actually went ahead and built you a full preview site already — no charge, no obligation — just to show you what a modern site for ${biz} could look like. AI-integrated, fast, built to bring you more calls and bookings."`,
    ``,
    `SHOW  —  "I can text you the link right now so you can pull it up while we talk. Take a look — if you like it, we make it yours; if not, no hard feelings."`,
    ``,
    `CLOSE —  "What's the best number to text the preview to — this one? Great, sending it now. When's a good time tomorrow for me to follow up once you've had a look?"`,
    ``,
    `IF "not interested"  —  "Totally fair, no pressure. Mind if I still text you the preview? Costs you nothing to glance at it — if it's not for you, just ignore it."`,
    `IF "how much"        —  "Depends what you want, but it's affordable for a small business and there's no cost to see the preview first. Let's get you looking at it, then we talk numbers."`,
    `IF "I'm busy"        —  "No worries — I'll text the link so you can look whenever. I'll check back tomorrow. Sound good?"`,
  ].join('\n');
}

// Stage an outreach draft for a deployed lead + text the owner the approval link.
// Guards: needs a live URL + a phone; never double-stages the same lead.
export function stageOutreach(lead: Lead): Outreach | null {
  if (!lead?.siteUrl || !lead?.phone) return null;
  const to = toE164(lead.phone);
  if (!to) return null;
  const list = readStore();
  const existing = list.find(o => o.leadId === lead.id && (o.status === 'pending' || o.status === 'sent'));
  if (existing) return existing;
  const rec: Outreach = {
    token: randomUUID(),
    leadId: lead.id,
    businessName: lead.businessName,
    toPhone: to,
    siteUrl: lead.siteUrl,
    body: composePitch(lead),
    status: 'pending',
    createdAt: Date.now(),
  };
  list.push(rec);
  writeStore(list);
  void sendApprovalTelegram(rec);
  return rec;
}

async function sendApprovalTelegram(rec: Outreach) {
  if (!BOT || !OWNER) return;
  const url = `${PUBLIC_BASE}/outreach/${rec.token}`;
  const text = `📲 OUTREACH READY — ${rec.businessName}\nTo: ${rec.toPhone}\n\n"${rec.body}"\n\nReview & send (you can edit the text first):`;
  try {
    await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: OWNER, text, disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: '✅ Review & Send', url }]] },
      }),
    });
  } catch { /* best effort */ }
}

async function twilioSend(to: string, body: string): Promise<{ ok: boolean; sid?: string; error?: string }> {
  const SID = process.env.TWILIO_ACCOUNT_SID, TK = process.env.TWILIO_AUTH_TOKEN, FROM = process.env.TWILIO_FROM_NUMBER;
  if (!SID || !TK || !FROM) {
    return { ok: false, error: 'SMS provider not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER in ~/.openclaw/.env' };
  }
  try {
    const params = new URLSearchParams({ From: FROM, To: to, Body: body });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${SID}:${TK}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    const j = await r.json().catch(() => ({} as Record<string, unknown>)) as { sid?: string; message?: string };
    if (!r.ok) return { ok: false, error: j.message ?? `twilio HTTP ${r.status}` };
    return { ok: true, sid: j.sid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function getOutreach(token: string): Outreach | undefined {
  return readStore().find(o => o.token === token);
}
export function listOutreach(): Outreach[] {
  return readStore().sort((a, b) => b.createdAt - a.createdAt);
}

// The approval action — sends the SMS for real. Optional overrideBody = the owner's
// edited text from the approval page.
export async function sendOutreach(token: string, overrideBody?: string): Promise<{ ok: boolean; sid?: string; error?: string; already?: boolean }> {
  const list = readStore();
  const rec = list.find(o => o.token === token);
  if (!rec) return { ok: false, error: 'not found' };
  if (rec.status === 'sent') return { ok: false, already: true, error: 'already sent' };
  if (rec.status === 'canceled') return { ok: false, error: 'canceled' };
  const body = (overrideBody && overrideBody.trim()) || rec.body;
  const r = await twilioSend(rec.toPhone, body);
  if (!r.ok) { rec.status = 'failed'; rec.error = r.error; writeStore(list); return { ok: false, error: r.error }; }
  rec.status = 'sent'; rec.sentAt = Date.now(); rec.messageSid = r.sid; rec.body = body; rec.error = undefined;
  writeStore(list);
  return { ok: true, sid: r.sid };
}

export function cancelOutreach(token: string): Outreach | undefined {
  const list = readStore();
  const rec = list.find(o => o.token === token);
  if (rec && rec.status !== 'sent') { rec.status = 'canceled'; writeStore(list); }
  return rec;
}
