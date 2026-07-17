import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Lead, PipelineRun, PipelineConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? '';
const NEOFORM_DIR = join(HOME, '.openclaw', 'neoform');
const LEADS_FILE  = join(NEOFORM_DIR, 'leads.json');
const RUNS_FILE   = join(NEOFORM_DIR, 'runs.json');
const CONFIG_FILE = join(NEOFORM_DIR, 'config.json');

function ensureDir() {
  if (!existsSync(NEOFORM_DIR)) mkdirSync(NEOFORM_DIR, { recursive: true });
}

// ─── Leads ────────────────────────────────────────────────────────────────────
export function readLeads(): Lead[] {
  ensureDir();
  if (!existsSync(LEADS_FILE)) return [];
  try { return JSON.parse(readFileSync(LEADS_FILE, 'utf-8')) as Lead[]; }
  catch { return []; }
}

export function writeLeads(leads: Lead[]) {
  ensureDir();
  writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), 'utf-8');
}

export function upsertLead(lead: Lead) {
  const leads = readLeads();
  const idx = leads.findIndex(l => l.id === lead.id);
  if (idx >= 0) leads[idx] = { ...lead, updatedAt: Date.now() };
  else leads.push({ ...lead, updatedAt: Date.now() });
  writeLeads(leads);
}

export function getLead(id: string): Lead | undefined {
  return readLeads().find(l => l.id === id);
}

export function deleteLead(id: string) {
  writeLeads(readLeads().filter(l => l.id !== id));
}

// ─── Pipeline runs ────────────────────────────────────────────────────────────
export function readRuns(): PipelineRun[] {
  ensureDir();
  if (!existsSync(RUNS_FILE)) return [];
  try { return JSON.parse(readFileSync(RUNS_FILE, 'utf-8')) as PipelineRun[]; }
  catch { return []; }
}

export function upsertRun(run: PipelineRun) {
  const runs = readRuns();
  const idx = runs.findIndex(r => r.id === run.id);
  if (idx >= 0) runs[idx] = run;
  else runs.unshift(run); // newest first
  writeFileSync(RUNS_FILE, JSON.stringify(runs.slice(0, 100), null, 2), 'utf-8');
}

// ─── Config ───────────────────────────────────────────────────────────────────
export function readConfig(): PipelineConfig {
  ensureDir();
  if (!existsSync(CONFIG_FILE)) return DEFAULT_CONFIG;
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as Partial<PipelineConfig> };
  } catch { return DEFAULT_CONFIG; }
}

export function writeConfig(config: Partial<PipelineConfig>) {
  ensureDir();
  const current = readConfig();
  writeFileSync(CONFIG_FILE, JSON.stringify({ ...current, ...config }, null, 2), 'utf-8');
}
