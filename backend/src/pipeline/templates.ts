// ─── NEOFORM Example-Template Registry (LAW 0 — CLONE-FROM-EXAMPLE) ────────────
// The "law": before a fresh site is built, we check the business category. If a
// gold-standard EXAMPLE exists for that category, we clone THAT site's page layout +
// component set + animations as a SCHEMATIC, and only the new business's real content
// (copy, photos, reviews, contact, hours, service area) gets swapped in. Counts adapt
// to the REAL business — if it has 3 steps, the clone ships 3, never padded to the
// example's 5. If no example matches the category, the build proceeds fresh as before.
//
// Seed: a gold-standard example site for the window-tint + auto-detailing category.
// We improve the example over time; the registry grows one category at a time.

import { existsSync, mkdirSync, cpSync, statSync } from 'fs';
import { join, basename } from 'path';

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? '';
// Where built client sites live (the circuit saves to the second one).
const CLIENT_ROOTS = [
  join(HOME, 'projects', 'athena', 'clients'),
  join(HOME, 'websites', 'clients'),
];
export const CLIENTS_DIR = CLIENT_ROOTS[0];

export interface SiteTemplate {
  id: string;             // stable category id
  label: string;          // human label
  keywords: string[];     // lowercased substrings matched against a lead's industry
  slug: string;           // the example site's slug (its dir under a client root)
  contentFiles: string[]; // paths (relative to the site) the agent MUST replace with real content
  adaptiveArrays: string[]; // arrays in src/lib/site.ts whose length must match the REAL business
  preserve: string;       // what the clone keeps verbatim
}

// The registry. One entry per category. Add new examples here as they're proven.
export const TEMPLATES: SiteTemplate[] = [
  {
    id: 'tint-detailing',
    label: 'Window Tint & Auto Detailing',
    keywords: [
      'tint', 'window tint', 'window tinting', 'detail', 'detailing', 'auto detail',
      'car detail', 'mobile detail', 'ceramic', 'ceramic coating', 'ppf',
      'paint protection', 'paint correction', 'auto spa', 'car wash',
    ],
    slug: 'example-tint-detailing',
    contentFiles: [
      'src/lib/site.ts',   // ALL business data: name, contact, hours, services, reviews, steps, gallery, service area
      'public/work',       // gallery photos (pull the new business's real photos from Google Maps)
      'hero.jpeg',         // hero image
      'src/app/icon.svg',  // favicon/logo mark
    ],
    adaptiveArrays: ['services', 'processSteps', 'reviews', 'galleryImages', 'serviceArea', 'hours'],
    preserve:
      'Clone the page structure (home + about/services/gallery/contact), the full component set, and EVERY animation/motion signature (Hero, TintReveal squeegee, Sheen card sweep, Process, Gallery, ServiceArea map, Stats, scroll reveals, easing tokens, reduced-motion guards) EXACTLY. Layout + motion are the schematic; only content changes.',
  },
];

// Directories/files never copied into a clone (build artifacts, deps, prior deploy +
// QA state, and the example's own screenshots/refs).
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'out', 'dist', 'coverage', '.turbo', '.vercel', '_qa', '_refs', 'sections']);
const SKIP_FILES = new Set(['deploy.json', 'build.json', 'review.json', 'manifest.json', 'site.config.json', 'details.md', 'tsconfig.tsbuildinfo']);

// Resolve the example site's source directory.
export function templateDir(t: SiteTemplate): string | undefined {
  return CLIENT_ROOTS.map(r => join(r, t.slug)).find(d => existsSync(join(d, 'src')));
}

// Match a category by the lead's industry string (substring, case-insensitive).
export function matchTemplate(industry?: string): SiteTemplate | undefined {
  if (!industry) return undefined;
  const s = industry.toLowerCase();
  return TEMPLATES.find(t => t.slug && t.keywords.some(k => s.includes(k)));
}

// Copy the example → a fresh client dir, minus artifacts/deps/state. Returns the paths
// the agent still has to fill with real content. Never clobbers an existing site.
export function scaffoldFromTemplate(t: SiteTemplate, destSlug: string):
  { ok: boolean; from?: string; dest?: string; contentFiles?: string[]; adaptiveArrays?: string[]; preserve?: string; reason?: string } {
  const src = templateDir(t);
  if (!src) return { ok: false, reason: `example source for "${t.id}" (${t.slug}) not found` };
  const dest = join(CLIENTS_DIR, basename(destSlug)); // SECURITY: basename → no path traversal out of CLIENTS_DIR
  if (existsSync(join(dest, 'src'))) return { ok: false, reason: `target ${destSlug} already has a site — not overwriting` };

  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, {
    recursive: true,
    filter: (from) => {
      const rel = from.slice(src.length + 1);
      if (!rel) return true;
      const segs = rel.split(/[\\/]/);
      if (segs.some(seg => SKIP_DIRS.has(seg))) return false;
      try { if (statSync(from).isFile() && SKIP_FILES.has(segs[segs.length - 1])) return false; } catch { /* ignore */ }
      return true;
    },
  });
  return {
    ok: true,
    from: t.slug,
    dest,
    contentFiles: t.contentFiles,
    adaptiveArrays: t.adaptiveArrays,
    preserve: t.preserve,
  };
}

// Lightweight registry view for the API / UI.
export function listTemplates() {
  return TEMPLATES.map(t => ({
    id: t.id, label: t.label, slug: t.slug,
    available: !!templateDir(t),
    keywords: t.keywords,
  }));
}
