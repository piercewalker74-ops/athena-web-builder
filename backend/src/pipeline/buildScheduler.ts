// ─── NEOFORM Auto-Circuit Scheduler ───────────────────────────────────────────
// The AUTOMATIC path. Enqueues a full research→build→deploy→report circuit onto
// the SAME single build lane (buildQueue) on a cadence — never fires the agent
// directly, so it can never collide with a schematic build. The runner serializes.
//
// Cadence: fire when  enabled  AND  the lane is idle  AND
//     now >= max(lastCircuitStart + minSpacing[2h], lastAnyBuildFinish + cooldown[15m])
// i.e. a 2-hour floor between circuit starts, but if a build runs long, at least a
// 15-minute breather after it finishes before the next kicks off.
//
// Safety: if a circuit errors, the cooldown becomes errorBackoff (2h) instead of
// 15m; after 3 consecutive circuit errors the scheduler AUTO-DISABLES so a crashing
// circuit can't loop-fire.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { readQueue, runningJob, enqueue, type BuildJob } from './buildQueue.js';
import { kick } from './buildRunner.js';

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? '';
const NEOFORM_DIR = join(HOME, '.openclaw', 'neoform');
const AUTO_FILE = join(NEOFORM_DIR, 'auto.json');

const HOUR = 3_600_000, MIN = 60_000;

export interface AutoConfig {
  enabled: boolean;
  minSpacingMs: number;   // floor between circuit STARTS
  cooldownMs: number;     // breather after any build FINISHES
  errorBackoffMs: number; // longer breather after a circuit ERRORS
  disabledReason?: string;
}

const DEFAULT_AUTO: AutoConfig = {
  enabled: false,
  minSpacingMs: 2 * HOUR,
  cooldownMs: 15 * MIN,
  errorBackoffMs: 2 * HOUR,
};

function ensureDir() { if (!existsSync(NEOFORM_DIR)) mkdirSync(NEOFORM_DIR, { recursive: true }); }

export function readAuto(): AutoConfig {
  ensureDir();
  if (!existsSync(AUTO_FILE)) return { ...DEFAULT_AUTO };
  try { return { ...DEFAULT_AUTO, ...JSON.parse(readFileSync(AUTO_FILE, 'utf-8')) as Partial<AutoConfig> }; }
  catch { return { ...DEFAULT_AUTO }; }
}

export function writeAuto(patch: Partial<AutoConfig>): AutoConfig {
  ensureDir();
  const next = { ...readAuto(), ...patch };
  if (patch.enabled === true) next.disabledReason = undefined; // re-enabling clears the trip reason
  writeFileSync(AUTO_FILE, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

// When the next automatic circuit is allowed to start (ms epoch). Also reports the
// governing cooldown so the UI can explain the wait.
export function nextEligibleAt(cfg = readAuto()): { at: number; circuits: BuildJob[]; lastFinish: number } {
  const jobs = readQueue();
  const circuits = jobs.filter(j => j.mode === 'circuit');
  const lastStart = circuits.reduce((m, j) => Math.max(m, j.startedAt ?? 0), 0);
  // only jobs that actually RAN impose a cooldown (a queued job canceled before it
  // started shouldn't hold the lane back)
  const lastFinish = jobs.filter(j => j.startedAt).reduce((m, j) => Math.max(m, j.finishedAt ?? 0), 0);
  const lastCircuit = circuits[circuits.length - 1];
  // A CRASHED circuit must NOT burn a full 2-hour cadence slot — the directive is "go
  // all night." So when the last circuit errored, the next one is gated only by a short
  // error backoff from when it died, NOT by lastStart + 2h. A healthy circuit keeps the
  // normal every-2-hours cadence (max of start-spacing and the finish cooldown).
  const at = lastCircuit && lastCircuit.status === 'error'
    ? lastFinish + cfg.errorBackoffMs
    : Math.max(lastStart + cfg.minSpacingMs, lastFinish + cfg.cooldownMs);
  return { at, circuits, lastFinish };
}

let ticking = false;

export function schedulerTick(now: number = Date.now()) {
  if (ticking) return; ticking = true;
  try {
    const cfg = readAuto();
    if (!cfg.enabled) return;
    if (runningJob()) return;                                   // lane busy
    const queued = readQueue().some(j => j.mode === 'circuit' && (j.status === 'queued' || j.status === 'running'));
    if (queued) return;                                         // one already waiting/running

    const { at, circuits } = nextEligibleAt(cfg);
    // NEVER auto-disable. A run of failures must not stop the night — the directive is
    // "rather lose a single project than have Athena stall." nextEligibleAt() already
    // applies errorBackoffMs after a failure, so consecutive errors just space out the
    // retries; the circuit keeps trying indefinitely. We only log the streak.
    const tail = circuits.slice(-3);
    if (tail.length >= 3 && tail.every(j => j.status === 'error')) {
      console.log('[neoform] auto-circuit: 3 consecutive errors — backing off but STAYING enabled (self-heal keeps trying)');
    }
    if (now < at) return;                                       // not time yet

    const job = enqueue({ mode: 'circuit', label: 'NEOFORM circuit (auto)', source: 'schedule' });
    console.log(`[neoform] ⏱ auto-circuit enqueued (${job.id})`);
    kick();
  } finally { ticking = false; }
}

let started = false;
export function startScheduler() {
  if (started) return; started = true;
  const cfg = readAuto();
  console.log(`[neoform] auto-circuit scheduler ${cfg.enabled ? 'ENABLED' : 'disabled'}` +
    (cfg.enabled ? ` · every ${Math.round(cfg.minSpacingMs / HOUR)}h / +${Math.round(cfg.cooldownMs / MIN)}m after finish` : ''));
  setInterval(() => schedulerTick(), 60_000).unref();
  setTimeout(() => schedulerTick(), 8_000); // first check shortly after boot
}
