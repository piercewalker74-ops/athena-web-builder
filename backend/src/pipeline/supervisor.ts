// ─── NEOFORM Supervisor ───────────────────────────────────────────────────────
// The contingency layer that sits above the runner + scheduler. Its whole job is to
// guarantee the directive: "rather lose a single project than have Athena stall."
//
// Every SUPERVISE_MS it does two things:
//   1) SELF-HEAL — reset an orphaned 'building' lead (a build that crashed without
//      reporting) back to 'approved'. A stuck 'building' lead is what makes
//      externalCircuitBusy() think a cron circuit is mid-flight and silently blocks
//      the whole lane for up to 150 min. We only touch building leads when NO live
//      build is running, so we never disturb an in-flight job.
//   2) ANTI-WEDGE + SELF-REBOOT — if there is queued work, nothing running, and no
//      external circuit, the lane SHOULD be launching. We kick it. If it stays wedged
//      for REBOOT_AFTER_MS despite kicks, the process state is structurally broken, so
//      we do a FRESH REBOOT of the backend (process.exit → PM2 relaunches →
//      reconcileOrphans() re-adopts any live build → tick() resumes the circuit).
//      Rate-limited to once per REBOOT_COOLDOWN_MS via a marker file so it can never
//      reboot-loop.

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { readQueue, runningJob, pendingCount } from './buildQueue.js';
import { tick, agentProcAlive, externalCircuitBusy } from './buildRunner.js';
import { readLeads, upsertLead } from './leadStore.js';

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? '';
const REBOOT_MARKER = join(HOME, '.openclaw', 'neoform', 'last-reboot.json');

const SUPERVISE_MS        = 120 * 1000;        // run every 2 min
const STALE_BUILDING_MS   = 25 * 60 * 1000;    // orphaned 'building' lead, quiet this long ⇒ reset
const REBOOT_AFTER_MS     = 12 * 60 * 1000;    // lane wedged this long despite kicks ⇒ reboot
const REBOOT_COOLDOWN_MS  = 30 * 60 * 1000;    // never reboot more than once per 30 min

const BOT   = process.env.TELEGRAM_BOT_TOKEN ?? '';
const OWNER = process.env.TELEGRAM_OWNER_CHAT_ID ?? '';

let wedgeSince: number | null = null;
let started = false;

async function telegram(text: string) {
  if (!BOT || !OWNER) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: OWNER, text }),
    });
  } catch { /* best effort — a self-recovery must never depend on Telegram being up */ }
}

function lastRebootAt(): number {
  try { return existsSync(REBOOT_MARKER) ? (JSON.parse(readFileSync(REBOOT_MARKER, 'utf-8')).at ?? 0) : 0; }
  catch { return 0; }
}
function markReboot(reason: string) {
  try { writeFileSync(REBOOT_MARKER, JSON.stringify({ at: Date.now(), reason }, null, 2)); } catch { /* ignore */ }
}

// 1) Reset orphaned 'building' leads so a crashed build can't wedge the lane.
function selfHealStaleLeads() {
  const rj = runningJob();
  if (rj && agentProcAlive(rj)) return;   // a live build owns the in-flight lead — hands off
  const now = Date.now();
  for (const l of readLeads()) {
    if (l.status !== 'building') continue;
    const quiet = now - (l.buildStageAt ?? l.updatedAt ?? 0);
    if (quiet > STALE_BUILDING_MS) {
      upsertLead({ ...l, status: 'approved', buildStage: undefined, buildMode: undefined });
      console.log(`[neoform] supervisor: reset orphaned 'building' lead "${l.businessName}" (quiet ${Math.round(quiet / 60000)}m) → approved`);
    }
  }
}

// 2) Detect a wedged lane and, as a last resort, reboot to clear it.
function checkWedge() {
  const rj = runningJob();
  const pending = pendingCount();
  const wedged = pending > 0 && !rj && !externalCircuitBusy();
  if (!wedged) { wedgeSince = null; return; }

  // There is queued work and nothing legitimately holding the lane — it should launch.
  if (wedgeSince == null) wedgeSince = Date.now();
  void tick();   // first remedy: just pump the lane

  const stuckMs = Date.now() - wedgeSince;
  if (stuckMs > REBOOT_AFTER_MS && (Date.now() - lastRebootAt()) > REBOOT_COOLDOWN_MS) {
    const reason = `lane wedged ${Math.round(stuckMs / 60000)}m — ${pending} queued, nothing running`;
    markReboot(reason);
    console.log(`[neoform] supervisor: ♻ SELF-REBOOT — ${reason}. Exiting so PM2 relaunches; reconcile will resume the circuit.`);
    void telegram(`♻️ Athena self-recovering — ${reason}. Rebooting and resuming the queue automatically.`);
    setTimeout(() => process.exit(1), 1500);   // PM2 (autorestart) relaunches → boot reconcile → tick resumes
  }
}

function supervise() {
  try { selfHealStaleLeads(); } catch (e) { console.log('[neoform] supervisor selfHeal error:', e); }
  try { checkWedge(); }        catch (e) { console.log('[neoform] supervisor wedge error:', e); }
}

export function startSupervisor() {
  if (started) return;
  started = true;
  console.log('[neoform] supervisor online — self-heal + anti-wedge + self-reboot');
  setInterval(supervise, SUPERVISE_MS).unref();
  setTimeout(supervise, 20_000);   // first pass shortly after boot (after reconcile settles)
}
