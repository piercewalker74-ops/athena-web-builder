import { Router } from 'express';
import { randomUUID } from 'crypto';
import {
  readLeads, upsertLead, getLead, deleteLead,
  readRuns, upsertRun, readConfig, writeConfig,
} from '../pipeline/leadStore.js';
import { verifyWebStatus } from '../pipeline/webVerifier.js';
import { qualifyLead } from '../pipeline/leadQualifier.js';
import { buildAndDeploySite } from '../pipeline/siteBuilder.js';
import { sendMissionReport } from '../pipeline/telegramReport.js';
import type { Lead, PipelineRun, BuildStage } from '../pipeline/types.js';
import { BUILD_STAGES } from '../pipeline/types.js';
import { readQueue, runningJob, pendingCount, recentJobs, cancelJob } from '../pipeline/buildQueue.js';
import { readAuto, nextEligibleAt } from '../pipeline/buildScheduler.js';
import { execFile } from 'child_process';
import { existsSync, readFileSync, createReadStream } from 'fs';
import { join, basename } from 'path';

const router = Router();

// ─── Asset pull (real Google listing photos + YouTube gallery videos) ──────────
// Manual, on-demand counterpart to the circuit's STEP-1 auto-pull. Shells the same
// deterministic tools the circuit uses, so the operator can preview a lead's real
// media before committing to a build.
const HOME_DIR = process.env.USERPROFILE ?? process.env.HOME ?? '';
const TOOLS_DIR = join(HOME_DIR, 'projects', 'athena', 'backend', 'tools');
const CLIENT_ROOTS = [
  join(HOME_DIR, 'websites', 'clients'),
  join(HOME_DIR, 'projects', 'athena', 'clients'),
  // ~/.openclaw/workspace/clients EXCLUDED — OpenClaw's territory.
];
function leadSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 40);
}
function clientDirFor(slug: string): string {
  return CLIENT_ROOTS.map(r => join(r, slug)).find(d => existsSync(d))
    || join(HOME_DIR, 'projects', 'athena', 'clients', slug);
}
function runTool(script: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile('node', [join(TOOLS_DIR, script), ...args], { timeout: 120_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (e, stdout, stderr) => resolve({ ok: !e, out: String(stdout || ''), err: String(stderr || '') }));
  });
}

// POST /leads/:id/photos  → pull real Google Business listing photos for this lead.
router.post('/leads/:id/photos', async (req, res) => {
  const lead = getLead(req.params.id);
  if (!lead) { res.status(404).json({ error: 'Not found' }); return; }
  const { query, placeId, max } = (req.body ?? {}) as { query?: string; placeId?: string; max?: number };
  const slug = leadSlug(lead.businessName);
  const q = placeId || lead.placeId || query || [lead.businessName, lead.city, lead.state].filter(Boolean).join(' ');
  const r = await runTool('place-photos.mjs', [slug, q, String(Math.min(Number(max) || 12, 20))]);
  const manifestPath = join(clientDirFor(slug), '_refs', 'photos.json');
  let manifest: unknown = null;
  if (existsSync(manifestPath)) { try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { /* ignore */ } }
  if (!r.ok && !manifest) { res.status(502).json({ ok: false, slug, error: (r.err || r.out || 'tool failed').slice(0, 500) }); return; }
  res.json({ ok: true, slug, leadId: lead.id, manifest });
});

// GET /leads/:id/photos/:file  → serve a pulled photo (preview thumbnails in the UI).
router.get('/leads/:id/photos/:file', (req, res) => {
  const lead = getLead(req.params.id);
  if (!lead) { res.status(404).end(); return; }
  const file = basename(req.params.file);
  if (!/^[0-9a-z_-]+\.(jpg|jpeg|png|webp)$/i.test(file)) { res.status(400).end(); return; }
  const p = join(clientDirFor(leadSlug(lead.businessName)), '_refs', 'photos', file);
  if (!existsSync(p)) { res.status(404).end(); return; }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=300');
  createReadStream(p).pipe(res);
});

// POST /leads/:id/youtube  → pull the business's YouTube uploads into the gallery.
// Body: { channel: "<channel url | @handle | UC-id>" }. Detection is the operator's
// call (paste the channel link); if the business has none, don't call this.
router.post('/leads/:id/youtube', async (req, res) => {
  const lead = getLead(req.params.id);
  if (!lead) { res.status(404).json({ error: 'Not found' }); return; }
  const { channel, max } = (req.body ?? {}) as { channel?: string; max?: number };
  if (!channel || !channel.trim()) { res.status(400).json({ ok: false, error: 'channel (url / @handle / UC-id) required' }); return; }
  const slug = leadSlug(lead.businessName);
  const r = await runTool('youtube-videos.mjs', [slug, channel.trim(), String(Math.min(Number(max) || 8, 15))]);
  const manifestPath = join(clientDirFor(slug), '_refs', 'youtube.json');
  let manifest: unknown = null;
  if (existsSync(manifestPath)) { try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { /* ignore */ } }
  if (!r.ok && !manifest) { res.status(502).json({ ok: false, slug, error: (r.err || r.out || 'tool failed').slice(0, 500) }); return; }
  res.json({ ok: true, slug, leadId: lead.id, manifest });
});

// A build is "live" if the lane has a tracked running job — OR a lead is actively
// progressing WITHOUT one. The circuit agent often outlives its own tracking (its
// launcher shell dies early on Windows, orphaning the build), so relying on the job
// alone made the chat/board wrongly say "nothing running" while a site was building.
// This makes the pipeline drive status off reality: a freshly-updated in-progress lead.
const INPROGRESS = ['scraped', 'verifying', 'qualified', 'calibrate', 'architect', 'building', 'deployed'];
function liveBuild(): { active: boolean; running: { id: string; mode: string; slug?: string; label: string; leadId?: string; startedAt?: number; source: string } | null } {
  const job = runningJob();
  if (job) return { active: true, running: { id: job.id, mode: job.mode, slug: job.slug, label: job.label, leadId: job.leadId, startedAt: job.startedAt, source: job.source } };
  // 45-min window: covers long quiet phases (full-site build, QA screenshots) where
  // the circuit legitimately doesn't post a stage ping, without flagging stale leads.
  const live = readLeads()
    .filter(l => INPROGRESS.includes(l.status) && Date.now() - (l.updatedAt || 0) < 45 * 60_000)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (live) return { active: true, running: { id: 'orphan:' + live.id, mode: live.buildMode || 'circuit', label: live.businessName, leadId: live.id, startedAt: live.buildStageAt || live.updatedAt, source: 'circuit' } };
  return { active: false, running: null };
}

// ─── Build lane (the single queue) ─────────────────────────────────────────────
// The runner drains ONE job at a time. This exposes the lane to the UI + Telegram.
router.get('/queue', (_req, res) => {
  const lb = liveBuild();
  res.json({
    active: lb.active,
    running: lb.running,
    pending: pendingCount(),
    queued: readQueue().filter(j => j.status === 'queued').map(j => ({ id: j.id, mode: j.mode, slug: j.slug, label: j.label, enqueuedAt: j.enqueuedAt, source: j.source })),
    recent: recentJobs(20),
  });
});

router.delete('/queue/:id', (req, res) => {
  const j = cancelJob(req.params.id);
  if (!j) { res.status(400).json({ ok: false, error: 'job not queued (already running/done can\'t be pulled here)' }); return; }
  res.json({ ok: true, canceled: j.id });
});

// ─── Sites completed today + ACTIVE/IDLE (the new pipeline board) ──────────────
router.get('/today', (_req, res) => {
  const leads = readLeads();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const dayStart = startOfDay.getTime();
  const doneToday = leads
    .filter(l => (l.status === 'delivered' || l.status === 'deployed' || l.status === 'reported') &&
      (l.deployedAt ? new Date(l.deployedAt).getTime() : l.updatedAt) >= dayStart)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(l => ({ id: l.id, businessName: l.businessName, city: l.city, state: l.state,
      status: l.status, siteUrl: l.siteUrl ?? l.currentSiteUrl, buildMode: l.buildMode, updatedAt: l.updatedAt }));
  const lb = liveBuild();
  const auto = readAuto();
  res.json({
    active: lb.active,
    running: lb.running ? { label: lb.running.label, mode: lb.running.mode, slug: lb.running.slug, startedAt: lb.running.startedAt } : null,
    pending: pendingCount(),
    queued: readQueue()
      .filter(j => j.status === 'queued')
      .sort((a, b) => a.enqueuedAt - b.enqueuedAt)
      .map(j => ({ id: j.id, label: j.label, mode: j.mode, slug: j.slug, source: j.source, enqueuedAt: j.enqueuedAt })),
    completedToday: doneToday,
    countToday: doneToday.length,
    auto: { enabled: auto.enabled, everyHours: auto.minSpacingMs / 3_600_000, nextEligibleAt: nextEligibleAt(auto).at, disabledReason: auto.disabledReason },
  });
});

// ─── Pipeline summary ─────────────────────────────────────────────────────────
router.get('/summary', (_req, res) => {
  const leads = readLeads();
  const byStatus = leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1;
    return acc;
  }, {});

  const runs = readRuns();
  const lastRun = runs[0];

  res.json({
    total: leads.length,
    byStatus,
    lastRun: lastRun
      ? { id: lastRun.id, status: lastRun.status, startedAt: lastRun.startedAt, qualified: lastRun.qualified }
      : null,
    config: readConfig(),
  });
});

// ─── Leads CRUD ───────────────────────────────────────────────────────────────
router.get('/leads', (_req, res) => {
  res.json({ leads: readLeads().sort((a, b) => b.updatedAt - a.updatedAt) });
});

router.get('/leads/inbox', (_req, res) => {
  // Qualified + approved leads awaiting human action
  const inbox = readLeads()
    .filter(l => l.status === 'qualified' || l.status === 'approved')
    .sort((a, b) => b.qualificationScore - a.qualificationScore);
  res.json({ leads: inbox });
});

router.get('/leads/pipeline', (_req, res) => {
  // All leads in active pipeline stages
  const stages = ['qualified', 'approved', 'building', 'deployed', 'reported', 'delivered'];
  const active = readLeads().filter(l => stages.includes(l.status));
  res.json({ leads: active });
});

router.get('/leads/:id', (req, res) => {
  const lead = getLead(req.params.id);
  if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
  res.json({ lead });
});

router.post('/leads', (req, res) => {
  const body = req.body as Partial<Lead>;
  const now = Date.now();
  const lead: Lead = {
    businessName: body.businessName ?? 'Unknown',
    phone: body.phone ?? '',
    address: body.address ?? '',
    city: body.city ?? '',
    state: body.state ?? '',
    industry: body.industry ?? '',
    rating: body.rating ?? 0,
    reviewCount: body.reviewCount ?? 0,
    webStatus: body.webStatus ?? 'unknown',
    qualifyingSignals: body.qualifyingSignals ?? [],
    disqualifyingReasons: body.disqualifyingReasons ?? [],
    qualificationScore: body.qualificationScore ?? 0,
    status: body.status ?? 'scraped',
    ...body,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  upsertLead(lead);
  res.json({ lead });
});

router.patch('/leads/:id', (req, res) => {
  const lead = getLead(req.params.id);
  if (!lead) { res.status(404).json({ error: 'Not found' }); return; }
  const updated: Lead = { ...lead, ...(req.body as Partial<Lead>), id: lead.id, updatedAt: Date.now() };
  upsertLead(updated);
  res.json({ lead: updated });
});

router.delete('/leads/:id', (req, res) => {
  deleteLead(req.params.id);
  res.json({ ok: true });
});

// ─── Fine-grained build stage (drives the live BUILD TRACKER reticle) ──────────
// The NEOFORM automation posts its exact circuit position here as it works, so
// the tracker steps through calibrate → architect → build → qa distinctly rather
// than jumping between coarse statuses. Targets an explicit leadId, else the most
// recently-updated active lead.
router.post('/stage', (req, res) => {
  const { leadId, stage } = req.body as { leadId?: string; stage?: string };
  const s = String(stage ?? '').toLowerCase() as BuildStage;
  if (!BUILD_STAGES.includes(s)) {
    res.status(400).json({ error: 'invalid stage', valid: BUILD_STAGES });
    return;
  }
  let lead = leadId ? getLead(leadId) : undefined;
  if (!lead) {
    const leads = readLeads();
    const active = leads
      .filter(l => l.status !== 'delivered' && l.status !== 'dropped')
      .sort((a, b) => b.updatedAt - a.updatedAt);
    lead = active[0] ?? leads.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }
  if (!lead) { res.status(404).json({ error: 'no lead to attach stage to' }); return; }
  const now = Date.now();
  const updated: Lead = { ...lead, buildStage: s, buildStageAt: now, updatedAt: now };
  upsertLead(updated);
  res.json({ ok: true, leadId: lead.id, stage: s });
});

// ─── Verify a lead's web status ───────────────────────────────────────────────
router.post('/leads/:id/verify', async (req, res) => {
  const lead = getLead(req.params.id);
  if (!lead) { res.status(404).json({ error: 'Not found' }); return; }

  const url = (req.body as { url?: string }).url ?? lead.currentSiteUrl ?? '';
  const result = await verifyWebStatus(url);

  const updated: Lead = {
    ...lead,
    webStatus: result.status,
    currentSiteUrl: result.finalUrl ?? lead.currentSiteUrl,
    status: lead.status === 'verifying' ? 'scraped' : lead.status,
    updatedAt: Date.now(),
  };
  upsertLead(updated);
  res.json({ lead: updated, verification: result });
});

// ─── Qualify a lead ───────────────────────────────────────────────────────────
router.post('/leads/:id/qualify', (_req, res) => {
  const lead = getLead(_req.params.id);
  if (!lead) { res.status(404).json({ error: 'Not found' }); return; }

  const result = qualifyLead(lead);
  const updated: Lead = {
    ...lead,
    qualificationScore: result.score,
    qualifyingSignals: result.signals,
    disqualifyingReasons: result.disqualifiers,
    status: result.pass ? 'qualified' : 'dropped',
    updatedAt: Date.now(),
  };
  upsertLead(updated);
  res.json({ lead: updated, qualification: result });
});

// ─── Approve a lead for site build ────────────────────────────────────────────
router.post('/leads/:id/approve', (_req, res) => {
  const lead = getLead(_req.params.id);
  if (!lead) { res.status(404).json({ error: 'Not found' }); return; }
  if (lead.status !== 'qualified') {
    res.status(400).json({ error: 'Lead must be in qualified status to approve' });
    return;
  }
  upsertLead({ ...lead, status: 'approved', updatedAt: Date.now() });
  res.json({ ok: true, lead: getLead(_req.params.id) });
});

// ─── Drop a lead ──────────────────────────────────────────────────────────────
router.post('/leads/:id/drop', (req, res) => {
  const lead = getLead(req.params.id);
  if (!lead) { res.status(404).json({ error: 'Not found' }); return; }
  const { reason } = req.body as { reason?: string };
  upsertLead({
    ...lead,
    status: 'dropped',
    disqualifyingReasons: [...(lead.disqualifyingReasons ?? []), ...(reason ? [reason] : [])],
    updatedAt: Date.now(),
  });
  res.json({ ok: true });
});

// ─── Build & deploy site ──────────────────────────────────────────────────────
router.post('/leads/:id/build', async (req, res) => {
  const lead = getLead(req.params.id);
  if (!lead) { res.status(404).json({ error: 'Not found' }); return; }
  if (!['approved', 'qualified'].includes(lead.status)) {
    res.status(400).json({ error: 'Lead must be approved or qualified' });
    return;
  }

  // Mark as building immediately
  upsertLead({ ...lead, status: 'building', updatedAt: Date.now() });

  // Stream progress via SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const send = (msg: string) => res.write(`data: ${JSON.stringify({ msg })}\n\n`);

  try {
    send(`Building site for ${lead.businessName}…`);
    const result = await buildAndDeploySite(lead);

    if (result.ok) {
      const now = Date.now();
      const updated: Lead = {
        ...lead,
        status: 'deployed',
        siteUrl: result.deployUrl,
        vercelProjectId: result.projectId,
        deployedAt: new Date(now).toISOString(),
        updatedAt: now,
      };
      upsertLead(updated);
      send(`Deployed: ${result.deployUrl}`);
      send('Sending Telegram report…');

      const reportResult = await sendMissionReport(updated);
      if (reportResult.ok) {
        upsertLead({ ...updated, status: 'reported', telegramSentAt: new Date().toISOString(), updatedAt: Date.now() });
        send('Report sent!');
      } else {
        send(`Report error: ${reportResult.error}`);
      }
    } else {
      upsertLead({ ...lead, status: 'approved', updatedAt: Date.now() }); // rollback
      send(`Build failed: ${result.error}`);
    }
  } catch (err: unknown) {
    send(`Error: ${err instanceof Error ? err.message : String(err)}`);
    upsertLead({ ...lead, status: 'approved', updatedAt: Date.now() });
  }

  res.write('data: [DONE]\n\n');
  res.end();
});

// ─── Send Telegram report for already-deployed lead ───────────────────────────
router.post('/leads/:id/report', async (req, res) => {
  const lead = getLead(req.params.id);
  if (!lead) { res.status(404).json({ error: 'Not found' }); return; }

  const result = await sendMissionReport(lead);
  if (result.ok) {
    upsertLead({ ...lead, status: 'reported', telegramSentAt: new Date().toISOString(), updatedAt: Date.now() });
  }
  res.json(result);
});

// ─── Pipeline runs ────────────────────────────────────────────────────────────
router.get('/runs', (_req, res) => {
  res.json({ runs: readRuns() });
});

// ─── Config ───────────────────────────────────────────────────────────────────
router.get('/config', (_req, res) => {
  res.json({ config: readConfig() });
});

router.patch('/config', (req, res) => {
  // SECURITY: only allow updating keys that ALREADY exist in the config — no injecting
  // arbitrary/unknown keys (e.g. path overrides like siteTemplatePath) through this write.
  const current = readConfig() as unknown as Record<string, unknown>;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(body)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (Object.prototype.hasOwnProperty.call(current, k)) patch[k] = body[k];
  }
  writeConfig(patch as Parameters<typeof writeConfig>[0]);
  res.json({ config: readConfig() });
});

export default router;
