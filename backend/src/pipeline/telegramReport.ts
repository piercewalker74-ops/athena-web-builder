import type { Lead } from './types.js';
import { webStatusLabel } from './webVerifier.js';
import { composePitch, composeColdCallScript } from './outreach.js';

// Escape for Telegram HTML parse_mode (also required inside <pre> blocks).
function esc(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN ?? '';
const OWNER_ID   = process.env.TELEGRAM_OWNER_CHAT_ID ?? '';
const PARTNER_ID = process.env.TELEGRAM_PARTNER_CHAT_ID ?? ''; // Optional

async function sendTelegram(chatId: string, text: string, parseMode = 'HTML'): Promise<number | null> {
  if (!BOT_TOKEN || !chatId) return null;

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode, disable_web_page_preview: false }),
  });

  const data = await res.json() as { ok: boolean; result?: { message_id: number } };
  return data.ok ? (data.result?.message_id ?? null) : null;
}

async function sendDocument(chatId: string, content: string, filename: string, caption: string): Promise<void> {
  if (!BOT_TOKEN || !chatId) return;

  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('caption', caption);
  formData.append('parse_mode', 'HTML');
  formData.append('document', new Blob([content], { type: 'text/plain' }), filename);

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
    method: 'POST',
    body: formData,
  });
}

// ─── Mission report ───────────────────────────────────────────────────────────
export interface ReportResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

export async function sendMissionReport(lead: Lead): Promise<ReportResult> {
  if (!BOT_TOKEN || !OWNER_ID) {
    return { ok: false, error: 'Telegram not configured' };
  }

  const webStatus = webStatusLabel(lead.webStatus, lead.currentSiteType);
  const siteUrl = lead.siteUrl ?? '(not deployed)';
  const mapsUrl = lead.mapsUrl ?? `https://maps.google.com/?q=${encodeURIComponent(lead.businessName + ' ' + lead.city + ' ' + lead.state)}`;

  // ── MESSAGE 1 — the SMS pitch, ready to copy & send yourself ──
  // Header (business + number for context) then the pitch inside a <pre> block, which
  // Telegram renders with a tap-to-copy button so you can paste it straight into SMS.
  const pitchMsg = [
    `📲 <b>TEXT TO SEND — ${esc(lead.businessName)}</b>`,
    `To: <b>${esc(lead.phone)}</b>  ·  tap the block to copy`,
    ``,
    `<pre>${esc(composePitch(lead))}</pre>`,
  ].join('\n');

  // ── MESSAGE 2 — business details + a personalized cold-call script ──
  const topSignals = lead.qualifyingSignals.slice(0, 3).map(s => `• ${esc(s)}`).join('\n');
  const briefMsg = [
    `📋 <b>COLD-CALL BRIEF — ${esc(lead.businessName)}</b>`,
    `${esc(lead.city)}, ${esc(lead.state)} · ⭐ ${lead.rating} (${lead.reviewCount} reviews)`,
    ``,
    `📞 <b>${esc(lead.phone)}</b>${lead.ownerName ? `  ·  Owner: <b>${esc(lead.ownerName)}</b>` : ''}`,
    `🌐 Preview: ${esc(siteUrl)}`,
    `📌 Maps: ${esc(mapsUrl)}`,
    `🕳 Web gap: ${esc(webStatus)}${lead.currentSiteUrl ? ` (old: ${esc(lead.currentSiteUrl)})` : ''}`,
    topSignals ? `\n<b>Why them:</b>\n${topSignals}` : '',
    ``,
    `<b>☎️ CALL SCRIPT</b>`,
    `<pre>${esc(composeColdCallScript(lead))}</pre>`,
    `<i>Score ${lead.qualificationScore}/100 · ${new Date().toLocaleDateString()}</i>`,
  ].filter(Boolean).join('\n');

  try {
    // Message 1 → owner only (it's the text YOU copy + send).
    const msgId = await sendTelegram(OWNER_ID, pitchMsg);

    // Message 2 → owner AND partner (the partner works the cold call from it).
    await sendTelegram(OWNER_ID, briefMsg);
    if (PARTNER_ID && PARTNER_ID !== OWNER_ID) {
      await sendTelegram(PARTNER_ID, briefMsg);
    }

    return { ok: true, messageId: msgId ?? undefined };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
}

function buildDetailsFile(lead: Lead): string {
  return `NEOFORM LEAD BRIEF
Generated: ${new Date().toISOString()}
=====================================

BUSINESS: ${lead.businessName}
LOCATION: ${lead.address}, ${lead.city}, ${lead.state}
PHONE:     ${lead.phone}
OWNER:     ${lead.ownerName ?? 'Unknown'}
INDUSTRY:  ${lead.industry}

RATINGS: ${lead.rating}⭐ (${lead.reviewCount} reviews)
LAST REVIEW: ${lead.lastReviewDate ?? 'Unknown'}

WEB STATUS: ${webStatusLabel(lead.webStatus, lead.currentSiteType)}
CURRENT URL: ${lead.currentSiteUrl ?? 'None'}

DEPLOYED SITE: ${lead.siteUrl ?? 'Not yet built'}
VERCEL PROJECT: ${lead.vercelProjectId ?? 'N/A'}

SOCIAL:
  Facebook: ${lead.facebookUrl ?? 'None'}
  Instagram: ${lead.instagramUrl ?? 'None'}

GOOGLE MAPS: ${lead.mapsUrl ?? 'N/A'}

QUALIFICATION SCORE: ${lead.qualificationScore}/100

QUALIFYING SIGNALS:
${lead.qualifyingSignals.map(s => `  + ${s}`).join('\n') || '  (none listed)'}

PIPELINE HISTORY:
  Created:  ${new Date(lead.createdAt).toLocaleString()}
  Updated:  ${new Date(lead.updatedAt).toLocaleString()}
  Deployed: ${lead.deployedAt ? new Date(lead.deployedAt).toLocaleString() : 'N/A'}

NOTES: ${lead.notes ?? ''}
`.trim();
}
