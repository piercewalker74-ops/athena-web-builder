// ─── NEOFORM Build Runner ─────────────────────────────────────────────────────
// The single lane. Drains the build queue ONE JOB AT A TIME by launching the
// EXACT SAME circuit agent the automatic path uses:
//     openclaw agent --message-file <composed> --model claude-cli/claude-opus-4-8
//                    --timeout 7200 --session-key agent:neoform:<jobId>
//
// • Same engine for both modes. A 'schematic' job just prepends a research-skip
//   preamble to the circuit prompt (neoform-schematic-preamble.txt); a 'circuit'
//   job runs the circuit prompt verbatim.
// • Fresh --session-key per job ⇒ a brand-new isolated session ⇒ the agent's
//   memory/cache is cleared between jobs, exactly as required. (Set
//   NEOFORM_RESTART_GATEWAY=1 to additionally bounce the gateway between jobs.)
// • One at a time: the runner won't start a job while another of ours is running,
//   or while a cron circuit is mid-flight (a fresh 'building' lead we don't own).
//
// Kill switch: NEOFORM_RUNNER=off disables spawning entirely (queue still fills).

import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync } from 'fs';
import { join } from 'path';
import {
  readQueue, updateJob, nextQueued, runningJob, type BuildJob,
} from './buildQueue.js';
import { readLeads, getLead, upsertLead } from './leadStore.js';

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? '';
const SCRIPTS_DIR = join(HOME, '.openclaw', 'scripts');
const JOBS_DIR    = join(HOME, '.openclaw', 'neoform', 'jobs');
const CIRCUIT_PROMPT  = join(SCRIPTS_DIR, 'neoform-circuit-prompt.txt');
const SCHEMATIC_PREAMBLE = join(SCRIPTS_DIR, 'neoform-schematic-preamble.txt');
const EDIT_PREAMBLE = join(SCRIPTS_DIR, 'neoform-edit-preamble.txt');
// Where an edit job's target site can live (first match wins).
const CLIENT_ROOTS = [
  join(HOME, 'websites', 'clients'),
  join(HOME, 'projects', 'athena', 'clients'),
  // ~/.openclaw/workspace/clients EXCLUDED — Athena must NEVER edit OpenClaw-owned sites
];

const MODEL = process.env.NEOFORM_MODEL ?? 'claude-cli/claude-opus-4-8';
const TIMEOUT_S = Number(process.env.NEOFORM_TIMEOUT_S ?? 7200);
const RUNNER_ON = (process.env.NEOFORM_RUNNER ?? 'on').toLowerCase() !== 'off';
const RESTART_GATEWAY = (process.env.NEOFORM_RESTART_GATEWAY ?? '') === '1';
const FRESH_BUILD_MS = 150 * 60 * 1000; // a 'building' lead newer than this = a live circuit

function ensureJobsDir() { if (!existsSync(JOBS_DIR)) mkdirSync(JOBS_DIR, { recursive: true }); }

// Locate an existing client project dir by slug (edit jobs target a built site).
function siteDirFor(slug: string): string {
  return CLIENT_ROOTS.map(r => join(r, slug)).find(d => existsSync(d)) || join(CLIENT_ROOTS[1], slug);
}

// Compose the prompt file the agent runs, for this job.
function composePrompt(job: BuildJob): string {
  const circuit = existsSync(CIRCUIT_PROMPT) ? readFileSync(CIRCUIT_PROMPT, 'utf-8') : '';
  if (job.mode === 'circuit') return circuit;
  // edit: a SELF-CONTAINED targeted change to an existing site (no research, no new build).
  if (job.mode === 'edit') {
    let pre = existsSync(EDIT_PREAMBLE) ? readFileSync(EDIT_PREAMBLE, 'utf-8') : '';
    pre = pre
      .replace(/<SLUG>/g, job.slug ?? '')
      .replace(/<SITEPATH>/g, job.slug ? siteDirFor(job.slug) : '')
      .replace(/<INSTRUCTION>/g, job.instruction ?? '')
      .replace(/<LEADID>/g, job.leadId ?? '');
    return pre;
  }
  // schematic: preamble (with slug/leadId filled) + the circuit
  let pre = existsSync(SCHEMATIC_PREAMBLE) ? readFileSync(SCHEMATIC_PREAMBLE, 'utf-8') : '';
  pre = pre.replace(/<SLUG>/g, job.slug ?? '').replace(/<LEADID>/g, job.leadId ?? '');
  return `${pre}\n${circuit}`;
}

// A cron circuit is mid-flight if some lead is 'building', freshly updated, and NO
// Athena job of ours (running OR queued OR any) references it. Only a real external
// (cron) build has a 'building' lead with no job behind it — so we exclude every
// lead that any queue job owns. (Without the 'queued' exclusion, a schematic/edit —
// which flags its lead 'building' the moment it's enqueued — would self-block the
// lane and never launch. That was the deadlock.)
export function externalCircuitBusy(): boolean {
  const now = Date.now();
  const ours = new Set(readQueue().map(j => j.leadId).filter(Boolean));
  return readLeads().some(l =>
    l.status === 'building' &&
    (now - (l.buildStageAt ?? l.updatedAt)) < FRESH_BUILD_MS &&
    !ours.has(l.id));
}

// Is a process still alive? (signal 0 = existence check)
function pidAlive(pid?: number): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException)?.code === 'EPERM'; } // exists but not ours
}

// RELIABLE liveness for a build. The tracked pid is the cmd.exe SHELL wrapper, which
// frequently dies while the real `node openclaw agent` grandchild keeps building
// (Windows). So the authoritative check is: does ANY node/cmd process still carry
// this job's unique session-key (agent:neoform:<jobId>) on its command line? We scan
// by the jobId (a uuid — no shell metachars) and exclude the powershell query itself
// via the Name filter. Falls back to the shell pid if the scan can't run.
export function agentProcAlive(job: BuildJob): boolean {
  // Deliberately do NOT trust job.pid: it's the cmd.exe launcher shell, which can
  // linger as a ZOMBIE for minutes after the real worker has already crashed (seen in
  // the field — a dead build kept the lane "alive" at boot). The only reliable signal
  // is a live `node.exe` running openclaw.mjs with this job's unique id on its command
  // line. If the scan can't run, fall back to the shell pid as a last resort.
  if (process.platform !== 'win32') return pidAlive(job.pid);
  // SECURITY (defense-in-depth): job.id is interpolated into a PowerShell string below.
  // enqueue() already guarantees a UUID shape, but re-assert it here at the actual sink —
  // anything not strictly [0-9a-f-] can never reach the shell.
  if (!/^[0-9a-fA-F-]{36}$/.test(job.id)) return pidAlive(job.pid);
  try {
    const out = execSync(
      `powershell -NoProfile -Command "if (Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -like '*${job.id}*' }) {'ALIVE'} else {'DEAD'}"`,
      { timeout: 9000, windowsHide: true },
    ).toString();
    return out.includes('ALIVE');
  } catch {
    return pidAlive(job.pid); // scan failed — best effort
  }
}

// The set of lead statuses that mean "a build is in flight" (mirrors the pipeline board).
const INPROGRESS_STATUSES = ['scraped', 'verifying', 'qualified', 'calibrate', 'architect', 'building', 'deployed'];

// Resolve the lead that represents THIS job's live progress. schematic/edit jobs
// carry their own leadId; a `circuit` job has none (the agent discovers its lead
// mid-run), so we fall back to the freshest in-progress lead — the same signal the
// pipeline board uses. Without this, a circuit's progress reads as `startedAt` and
// the no-progress guard would wrongly kill every circuit at the 60-min mark.
function progressLead(job: BuildJob) {
  if (job.leadId) return getLead(job.leadId);
  return readLeads()
    .filter(l => INPROGRESS_STATUSES.includes(l.status) && Date.now() - (l.updatedAt || 0) < 45 * 60_000)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

// A build spawned detached SURVIVES a backend restart. Re-adopt it: poll its pid
// and advance the lane only when it actually exits.
function adopt(job: BuildJob) {
  console.log(`[neoform] ↻ re-adopted live job ${job.id} (pid ${job.pid}) after restart`);
  const iv = setInterval(() => {
    // cheap shell-pid check first; only when the shell is gone do we pay for the
    // authoritative session-key scan to confirm the real worker has also exited.
    if (pidAlive(job.pid)) return;
    if (agentProcAlive(job)) return;
    clearInterval(iv);
    // The worker exited. Judge the outcome from its lead: an owned build that reached
    // delivered/reported succeeded; anything else means it vanished mid-flight → error
    // and release the lead so the lane (and the lead) can move on.
    const lead = job.leadId ? getLead(job.leadId) : undefined;
    const ok = !job.leadId || (lead && (lead.status === 'delivered' || lead.status === 'reported'));
    updateJob(job.id, { status: ok ? 'done' : 'error', finishedAt: Date.now(), error: ok ? undefined : 're-adopted build vanished mid-flight' });
    if (!ok && lead && lead.status === 'building') upsertLead({ ...lead, status: 'approved', buildStage: undefined, buildMode: undefined });
    console.log(`[neoform] ${ok ? '✔' : '✖'} re-adopted job ${job.id} ${ok ? 'finished' : 'vanished — freed lane'}`);
    setTimeout(() => void tick(), 1500);
  }, 30_000);
  iv.unref?.();
}

// On boot, reconcile jobs left 'running' by a previous backend process. If the
// build process is STILL ALIVE (detached), re-adopt it instead of killing tracking;
// only if it's truly gone do we error it + free the lead.
function reconcileOrphans() {
  for (const j of readQueue().filter(j => j.status === 'running')) {
    // A detached build survives a backend restart. Detect it via the real worker
    // (session-key scan), not the shell pid which usually dies first — that false
    // "dead" reading is what produced all the "process ended during backend downtime"
    // errors in the history. If the worker is alive, re-adopt; only if truly gone error it.
    if (agentProcAlive(j)) { adopt(j); continue; }
    updateJob(j.id, { status: 'error', finishedAt: Date.now(), error: 'process ended during backend downtime' });
    if (j.leadId) {
      const lead = getLead(j.leadId);
      // free the lead AND clear the build markers so the tracker doesn't show a ghost stage
      if (lead && lead.status === 'building') upsertLead({ ...lead, status: 'approved', buildStage: undefined, buildMode: undefined, updatedAt: Date.now() });
    }
  }
}

// Finalize a stuck/finished job and free the lane.
function finalizeJob(job: BuildJob, status: 'done' | 'error', reason: string) {
  updateJob(job.id, { status, finishedAt: Date.now(), error: status === 'error' ? reason : undefined });
  console.log(`[neoform] watchdog: job ${job.id} → ${status} (${reason})`);
  if (job.leadId && status === 'error') {
    const lead = getLead(job.leadId);
    if (lead && lead.status === 'building') upsertLead({ ...lead, status: 'approved', buildStage: undefined, buildMode: undefined, updatedAt: Date.now() });
  }
  setTimeout(() => void tick(), 1500);
}

// WATCHDOG — the anti-stall guarantee. The detached agent's 'exit' event is
// unreliable on Windows (the shell wrapper can die before the real build ends, or
// the event is lost), which would leave a job 'running' forever and block the lane.
// This runs on an interval and frees the lane off signals that DON'T depend on that
// event: the build drives its own lead to a terminal state, or hard limits trip.
const HARD_CAP_MS = (TIMEOUT_S + 900) * 1000;   // absolute runtime ceiling
const QUIET_PROBE_MS = 8 * 60 * 1000;           // after this much silence, verify the process is actually alive
export function watchdog() {
  const job = runningJob();
  if (!job) return;
  const startedAt = job.startedAt ?? Date.now();
  const runMs = Date.now() - startedAt;
  const lead = progressLead(job);

  // 1) an OWNED build (schematic/edit) reported itself terminal via its lead → free the lane.
  //    (Circuit jobs have no owned lead, so a previously-delivered lead never ends a fresh circuit.)
  if (job.leadId && lead && (lead.status === 'delivered' || lead.status === 'reported' || lead.status === 'dropped')) {
    finalizeJob(job, lead.status === 'dropped' ? 'error' : 'done', `lead ${lead.status}`);
    return;
  }

  // 2) absolute ceiling — always safe to trip.
  if (runMs > HARD_CAP_MS) {
    finalizeJob(job, 'error', 'exceeded max runtime');
    return;
  }

  // 3) liveness-gated stall detection. We ONLY drop a job for "no progress" once the
  //    real build process is CONFIRMED DEAD — never on silence alone. This is the fix
  //    that keeps a healthy-but-quiet circuit (long research/QA phases, no lead pings)
  //    alive, while dropping an actually-crashed build ~8 min after it goes silent
  //    instead of waiting an hour. The process scan runs only after QUIET_PROBE_MS, so
  //    a normally-pinging build never pays for it.
  const quietMs = Date.now() - (lead?.updatedAt ?? startedAt);
  if (runMs > QUIET_PROBE_MS && quietMs > QUIET_PROBE_MS && !agentProcAlive(job)) {
    finalizeJob(job, 'error', `build process gone after ${Math.round(quietMs / 60000)}m silence — crashed`);
  }
}

let ticking = false;

// Launch one job's agent. Non-blocking: spawns the child, returns; the exit
// handler advances the queue.
function launch(job: BuildJob) {
  ensureJobsDir();
  const msgFile = join(JOBS_DIR, `${job.id}.txt`);
  const logFile = join(JOBS_DIR, `${job.id}.log`);
  writeFileSync(msgFile, composePrompt(job), 'utf-8');

  const args = [
    'agent',
    '--message-file', msgFile,
    '--model', MODEL,
    '--timeout', String(TIMEOUT_S),
    '--session-key', `agent:neoform:${job.id}`,
  ];

  let out = 1, err = 2;
  try { out = openSync(logFile, 'a'); err = out; } catch { /* fall back to inherit ints */ }

  let child;
  try {
    // detached + unref: the build survives an athena-backend restart (it runs via
    // the long-lived gateway anyway). reconcileOrphans() re-adopts it on next boot.
    child = spawn('openclaw', args, {
      shell: true,
      detached: true,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', out, err],
    });
    child.unref();
  } catch (e) {
    updateJob(job.id, { status: 'error', finishedAt: Date.now(), error: e instanceof Error ? e.message : String(e) });
    setTimeout(() => void tick(), 500);
    return;
  }

  updateJob(job.id, { status: 'running', startedAt: Date.now(), pid: child.pid });
  // mark the lead building at the right entry stage for its mode
  if (job.leadId) {
    const lead = getLead(job.leadId);
    if (lead) upsertLead({
      ...lead,
      status: 'building',
      buildStage: job.mode === 'schematic' ? 'build' : 'scout',
      buildStageAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  console.log(`[neoform] ▶ launched ${job.mode} job ${job.id}${job.slug ? ' · ' + job.slug : ''} (pid ${child.pid})`);

  const finish = (status: 'done' | 'error', extra: Partial<BuildJob>) => {
    updateJob(job.id, { status, finishedAt: Date.now(), ...extra });
    console.log(`[neoform] ${status === 'done' ? '✔' : '✖'} job ${job.id} ${status}`);
    if (RESTART_GATEWAY) {
      try { spawn('openclaw', ['gateway', 'restart'], { shell: true, windowsHide: true, stdio: 'ignore' }); } catch { /* best effort */ }
      setTimeout(() => void tick(), 8000); // give the gateway a moment to come back
    } else {
      setTimeout(() => void tick(), 1500);
    }
  };

  child.on('exit', (code) => finish(code === 0 ? 'done' : 'error', { exitCode: code ?? -1, error: code === 0 ? undefined : `exit ${code}` }));
  child.on('error', (e) => finish('error', { error: e instanceof Error ? e.message : String(e) }));
}

// The lane pump. Starts the next queued job if nothing is running.
export function tick() {
  if (!RUNNER_ON || ticking) return;
  ticking = true;
  try {
    if (runningJob()) return;              // our lane is busy
    if (externalCircuitBusy()) return;     // a cron circuit is mid-flight — wait
    const job = nextQueued();
    if (!job) return;
    launch(job);
  } finally {
    ticking = false;
  }
}

// Fire the pump immediately (call right after enqueue).
export function kick() { setTimeout(() => void tick(), 100); }

let started = false;
export function startRunner() {
  if (started) return;
  started = true;
  reconcileOrphans();
  if (!RUNNER_ON) { console.log('[neoform] build runner DISABLED (NEOFORM_RUNNER=off) — queue will fill but not fire'); return; }
  console.log(`[neoform] build runner online · model ${MODEL} · timeout ${TIMEOUT_S}s`);
  void tick();
  // watchdog + lane pump every 30s — guarantees the lane never stays stuck
  setInterval(() => { watchdog(); void tick(); }, 30_000).unref();
}
