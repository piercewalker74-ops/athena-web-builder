// ─── NEOFORM Build Queue ──────────────────────────────────────────────────────
// A single, persistent, one-lane job queue shared by BOTH build paths:
//   • 'schematic' — operator pressed EXECUTE (or sent a Telegram build order) on a
//     hand-composed schematic. Runs the SAME circuit, research parts cut out.
//   • 'circuit'   — the full automatic lead→site circuit (research included).
// The runner (buildRunner.ts) drains this one job at a time. If a build order
// arrives while one is running, it lands here and fires when the lane clears.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? '';
const NEOFORM_DIR = join(HOME, '.openclaw', 'neoform');
const QUEUE_FILE  = join(NEOFORM_DIR, 'build-queue.json');

export type BuildMode = 'schematic' | 'circuit' | 'edit';
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled';

export interface BuildJob {
  id: string;
  mode: BuildMode;
  slug?: string;        // schematic/edit: the target client dir
  label: string;        // human label for the tracker / list
  leadId?: string;      // pipeline lead this job drives
  status: JobStatus;
  source: string;       // 'edit-execute' | 'athena-chat' | 'telegram' | 'launch' | 'schedule' | 'command'
  sections?: number;    // schematic: section count (info only)
  instruction?: string; // edit: the natural-language change to apply (e.g. "optimize for mobile")
  holdUntil?: number;   // ms timestamp — job is not eligible to start until now >= holdUntil (cancel window)
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  pid?: number;
  exitCode?: number;
  error?: string;
}

interface QueueFile { jobs: BuildJob[]; }

function ensureDir() { if (!existsSync(NEOFORM_DIR)) mkdirSync(NEOFORM_DIR, { recursive: true }); }

export function readQueue(): BuildJob[] {
  ensureDir();
  if (!existsSync(QUEUE_FILE)) return [];
  try { return (JSON.parse(readFileSync(QUEUE_FILE, 'utf-8')) as QueueFile).jobs ?? []; }
  catch { return []; }
}

function writeQueue(jobs: BuildJob[]) {
  ensureDir();
  // keep the tail bounded — last 120 jobs is plenty of history
  writeFileSync(QUEUE_FILE, JSON.stringify({ jobs: jobs.slice(-120) }, null, 2), 'utf-8');
}

// Add a job. Dedups: if an identical schematic slug is already queued/running,
// return that one instead of stacking duplicates.
// SECURITY — the single trust boundary for the build lane. `id` and `slug` propagate
// downstream into shell/PowerShell invocations (buildRunner) and filesystem path joins
// (siteDirFor, scaffoldFromTemplate). Enforce safe shapes HERE so no upstream route can
// drive them into command injection or path traversal. An out-of-shape id is replaced
// with a fresh UUID; an out-of-shape slug is rejected outright.
const JOB_ID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const JOB_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/;
export function enqueue(job: Omit<BuildJob, 'id' | 'status' | 'enqueuedAt'> & Partial<Pick<BuildJob, 'id' | 'status' | 'enqueuedAt'>>): BuildJob {
  if (job.slug != null && !JOB_SLUG_RE.test(job.slug)) throw new Error('invalid slug');
  if (job.id != null && !JOB_ID_RE.test(job.id)) job.id = undefined; // discard a malformed id → fresh UUID below
  const jobs = readQueue();
  if (job.mode === 'schematic' && job.slug) {
    const dup = jobs.find(j => j.slug === job.slug && (j.status === 'queued' || j.status === 'running'));
    if (dup) return dup;
  }
  if (job.mode === 'circuit') {
    const dup = jobs.find(j => j.mode === 'circuit' && (j.status === 'queued' || j.status === 'running'));
    if (dup) return dup;
  }
  if (job.mode === 'edit' && job.slug) {
    // dedup a rapid double-tap of the exact same edit, but allow different edits to the same site.
    const dup = jobs.find(j => j.mode === 'edit' && j.slug === job.slug && j.instruction === job.instruction && (j.status === 'queued' || j.status === 'running'));
    if (dup) return dup;
  }
  const full: BuildJob = {
    id: job.id ?? randomUUID(),
    mode: job.mode,
    slug: job.slug,
    label: job.label,
    leadId: job.leadId,
    status: job.status ?? 'queued',
    source: job.source,
    sections: job.sections,
    instruction: job.instruction,
    holdUntil: job.holdUntil,
    enqueuedAt: job.enqueuedAt ?? Date.now(),
  };
  jobs.push(full);
  writeQueue(jobs);
  return full;
}

export function updateJob(id: string, patch: Partial<BuildJob>): BuildJob | undefined {
  const jobs = readQueue();
  const idx = jobs.findIndex(j => j.id === id);
  if (idx < 0) return undefined;
  jobs[idx] = { ...jobs[idx], ...patch, id };
  writeQueue(jobs);
  return jobs[idx];
}

export function getJob(id: string): BuildJob | undefined {
  return readQueue().find(j => j.id === id);
}

export function runningJob(): BuildJob | undefined {
  return readQueue().find(j => j.status === 'running');
}

export function nextQueued(): BuildJob | undefined {
  const now = Date.now();
  return readQueue()
    // a held job (inside its cancel window) is not yet eligible to start
    .filter(j => j.status === 'queued' && (!j.holdUntil || j.holdUntil <= now))
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt)[0];
}

export function pendingCount(): number {
  return readQueue().filter(j => j.status === 'queued').length;
}

// Cancel a still-queued job (a running job can't be pulled from here — the runner
// owns the child process). Returns the canceled job or undefined.
export function cancelJob(id: string): BuildJob | undefined {
  const job = getJob(id);
  if (!job || job.status !== 'queued') return undefined;
  return updateJob(id, { status: 'canceled', finishedAt: Date.now() });
}

export function recentJobs(n = 40): BuildJob[] {
  return readQueue().slice(-n).reverse();
}
