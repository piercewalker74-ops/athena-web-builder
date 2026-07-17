import { exec as execCb, execFile as execFileCb, type ExecOptions } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import type { Lead } from './types.js';

const execP = promisify(execCb);
const execFileP = promisify(execFileCb);
// windowsHide: don't flash a console window on npm/vercel calls during a build.
const exec = (cmd: string, opts: ExecOptions = {}) =>
  execP(cmd, { windowsHide: true, ...opts }) as Promise<{ stdout: string; stderr: string }>;

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? '';
const SITES_DIR = join(HOME, 'projects', 'neoform-sites');
const TEMPLATE_DIR = join(HOME, 'projects', 'neoform-site-template');
const VERCEL_TOKEN = process.env.VERCEL_TOKEN ?? '';

// ─── Slug ──────────────────────────────────────────────────────────────────────
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
}

// ─── Copy directory recursively ───────────────────────────────────────────────
function copyDir(src: string, dest: string) {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath  = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(srcPath, destPath);
    }
  }
}

// ─── Industry-specific copy ────────────────────────────────────────────────────
function industryLabel(industry: string): string {
  const lc = industry.toLowerCase();
  if (lc.includes('detail')) return 'Auto Detailing';
  if (lc.includes('tint'))   return 'Window Tinting';
  if (lc.includes('wash'))   return 'Pressure Washing';
  if (lc.includes('glass'))  return 'Auto Glass';
  if (lc.includes('ceramic')) return 'Ceramic Coating';
  if (lc.includes('ppf') || lc.includes('paint protection')) return 'Paint Protection';
  return industry.charAt(0).toUpperCase() + industry.slice(1);
}

function tagline(industry: string, city: string): string {
  const label = industryLabel(industry);
  const taglines: Record<string, string[]> = {
    'Auto Detailing': [
      `${city}'s Premier Mobile Auto Detailing`,
      `Professional Auto Detailing in ${city}`,
      `Showroom Finish. Your Driveway. ${city}.`,
    ],
    'Window Tinting': [
      `Professional Window Tinting in ${city}`,
      `${city}'s Trusted Tint Specialist`,
      `Beat the Heat. Look Great. ${city}.`,
    ],
    'Pressure Washing': [
      `Professional Pressure Washing in ${city}`,
      `${city}'s #1 Exterior Cleaning Service`,
      `Your Property. Our Pressure. ${city}.`,
    ],
    'Ceramic Coating': [
      `Ceramic Coating Specialists in ${city}`,
      `Long-Term Paint Protection in ${city}`,
      `Protect Your Investment. ${city}.`,
    ],
  };
  const opts = taglines[label] ?? [`Professional ${label} in ${city}`];
  return opts[0];
}

function heroSubtext(industry: string): string {
  const label = industryLabel(industry);
  const texts: Record<string, string> = {
    'Auto Detailing': 'We come to you. Professional results guaranteed. Book your appointment today.',
    'Window Tinting': 'Premium films, perfect installation. Reduce heat, enhance privacy, protect your interior.',
    'Pressure Washing': 'Restore your home, driveway, and fleet to like-new condition. Fast, affordable, reliable.',
    'Ceramic Coating': 'Long-lasting protection against scratches, UV damage, and the elements. Done right.',
  };
  return texts[label] ?? `Professional ${label} services. Quality guaranteed.`;
}

function servicesList(industry: string): Array<{ name: string; description: string }> {
  const label = industryLabel(industry);
  const services: Record<string, Array<{ name: string; description: string }>> = {
    'Auto Detailing': [
      { name: 'Basic Detail', description: 'Full interior vacuum, wipe-down, exterior hand wash and dry.' },
      { name: 'Full Detail', description: 'Deep interior cleaning, extraction, engine bay, paint decontamination.' },
      { name: 'Paint Correction', description: 'Single or multi-stage polish to remove swirls, scratches, and oxidation.' },
      { name: 'Ceramic Coating', description: 'Professional-grade ceramic protection for years of easy maintenance.' },
    ],
    'Window Tinting': [
      { name: 'Automotive Tint', description: 'Cars, trucks, SUVs. All major brands stocked. Lifetime warranty.' },
      { name: 'Residential Tint', description: 'Block UV, reduce heat, and add privacy to your home windows.' },
      { name: 'Commercial Tint', description: 'Office buildings and storefronts. Energy-saving and professional.' },
      { name: 'Paint Protection Film', description: 'Invisible shield for high-impact zones. PPF that lasts.' },
    ],
    'Pressure Washing': [
      { name: 'Driveway & Concrete', description: 'Remove years of grime, oil stains, and mildew buildup.' },
      { name: 'House Washing', description: 'Soft-wash safe for siding, brick, stucco, and painted surfaces.' },
      { name: 'Deck & Fence', description: 'Restore wood and composite surfaces. Pre-treatment included.' },
      { name: 'Fleet Washing', description: 'Trucks, trailers, and equipment. Monthly programs available.' },
    ],
  };
  return services[label] ?? [
    { name: 'Service 1', description: 'Professional quality service.' },
    { name: 'Service 2', description: 'Fast, reliable, guaranteed.' },
    { name: 'Service 3', description: 'Competitive pricing.' },
  ];
}

// ─── Generate site config ─────────────────────────────────────────────────────
function buildSiteConfig(lead: Lead) {
  return {
    businessName: lead.businessName,
    slug: toSlug(lead.businessName),
    phone: lead.phone,
    city: lead.city,
    state: lead.state,
    industry: lead.industry,
    industryLabel: industryLabel(lead.industry),
    tagline: tagline(lead.industry, lead.city),
    heroSubtext: heroSubtext(lead.industry),
    services: servicesList(lead.industry),
    ownerName: lead.ownerName ?? '',
    rating: lead.rating,
    reviewCount: lead.reviewCount,
    address: lead.address,
    mapsUrl: lead.mapsUrl ?? `https://maps.google.com/?q=${encodeURIComponent(lead.businessName + ' ' + lead.city + ' ' + lead.state)}`,
    facebookUrl: lead.facebookUrl ?? '',
    instagramUrl: lead.instagramUrl ?? '',
    generatedAt: new Date().toISOString(),
  };
}

// ─── Main build function ──────────────────────────────────────────────────────
export interface BuildResult {
  ok: boolean;
  siteDir?: string;
  deployUrl?: string;
  projectId?: string;
  error?: string;
}

export async function buildAndDeploySite(lead: Lead): Promise<BuildResult> {
  if (!VERCEL_TOKEN) {
    return { ok: false, error: 'VERCEL_TOKEN not configured' };
  }

  if (!existsSync(TEMPLATE_DIR)) {
    return { ok: false, error: `Site template not found at ${TEMPLATE_DIR}. Run the template setup first.` };
  }

  const slug = toSlug(lead.businessName);
  const siteDir = join(SITES_DIR, slug);

  try {
    // 1. Copy template
    if (!existsSync(SITES_DIR)) mkdirSync(SITES_DIR, { recursive: true });
    copyDir(TEMPLATE_DIR, siteDir);

    // 2. Write site config
    const config = buildSiteConfig(lead);
    writeFileSync(join(siteDir, 'site.config.json'), JSON.stringify(config, null, 2), 'utf-8');

    // 3. Install dependencies
    await exec('npm install --legacy-peer-deps', { cwd: siteDir, timeout: 120_000 });

    // 4. Build
    await exec('npm run build', { cwd: siteDir, timeout: 180_000, env: { ...process.env, NODE_ENV: 'production' } });

    // 5. Deploy to Vercel — SECURITY: the token is passed via ENV (vercel reads
    // VERCEL_TOKEN), never as a --token argv flag. That keeps it out of the process
    // command line (ps/WMI) AND out of any exec error message (which is streamed to
    // the client). argv form (no shell) also removes the projectName injection surface.
    const projectName = `neoform-${slug}`;
    const deployResult = await execFileP(
      'npx', ['vercel', '--yes', '--name', projectName, '--prod'],
      { cwd: siteDir, timeout: 120_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, VERCEL_TOKEN } },
    ) as { stdout: string; stderr: string };

    // Parse the deployment URL from vercel output (stdout or stderr)
    const urlMatch = `${deployResult.stdout}\n${deployResult.stderr}`.match(/https:\/\/[a-z0-9-]+\.vercel\.app/i);
    const deployUrl = urlMatch ? urlMatch[0] : undefined;

    return { ok: true, siteDir, deployUrl, projectId: projectName };

  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), siteDir };
  }
}
