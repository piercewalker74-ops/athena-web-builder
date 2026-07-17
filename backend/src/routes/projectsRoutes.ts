import { Router, raw } from 'express';
import { homedir } from 'os';
import { join, basename, extname } from 'path';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'fs';

// Projects API — backs the Feature Director (edit view) + the P4 launch checkpoint.
// A "project" is a built client site under ~/projects/athena/clients/<slug>/.
// Its layout lives in manifest.json (P4 output); section thumbnails in sections/;
// client-supplied media in uploads/.

const router = Router();
// Resolve a project slug across the same roots the canonical GET /api/projects list scans.
const ROOTS = [
  join(homedir(), 'websites', 'clients'),
  join(homedir(), 'projects', 'athena', 'clients'),
  join(homedir(), '.openclaw', 'workspace', 'clients'),
];

function slugDir(slug: string): string | null {
  const safe = basename(slug);              // no path traversal
  for (const root of ROOTS) {
    const dir = join(root, safe);
    if (existsSync(dir) && statSync(dir).isDirectory()) return dir;
  }
  return null;
}
function readJson<T>(p: string, fallback: T): T {
  try { return JSON.parse(readFileSync(p, 'utf8')) as T; } catch { return fallback; }
}

// GET /api/projects (the list) is served by the canonical handler in server.ts.
// This router adds the per-project sub-routes below.

// ─── Create a fresh project (＋ NEW PROJECT — Business or Personal) ─────────────
router.post('/', (req, res) => {
  const b = (req.body ?? {}) as {
    name?: string; kind?: string; industry?: string; category?: string;
    googleMapsUrl?: string; phone?: string; city?: string; address?: string;
  };
  const name = (b.name ?? '').trim();
  if (!name) { res.status(400).json({ error: 'name required' }); return; }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `project-${Date.now()}`;
  const dir = join(homedir(), 'projects', 'athena', 'clients', slug);
  if (existsSync(dir)) { res.status(409).json({ error: 'a project with that name already exists', slug }); return; }
  const kind = b.kind === 'business' ? 'business' : 'personal';
  try {
    mkdirSync(join(dir, 'uploads'), { recursive: true });
    mkdirSync(join(dir, 'sections'), { recursive: true });
    const cfg: Record<string, unknown> = {
      businessName: name, name, kind, industry: b.industry ?? '', category: b.category ?? '',
      source: 'neoform', live_url: '', createdAt: Date.now(),
    };
    if (kind === 'business') {                     // richer intake for real businesses
      cfg.googleMapsUrl = b.googleMapsUrl ?? '';
      cfg.phone = b.phone ?? '';
      cfg.city = b.city ?? '';
      cfg.address = b.address ?? '';
    }
    writeFileSync(join(dir, 'site.config.json'), JSON.stringify(cfg, null, 2));
    // start BLANK — the editor opens an empty canvas the operator composes by drag
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(
      { label: `${name}${b.industry ? ' · ' + b.industry : ''}`, cat: b.category ?? '', url: '', sections: [] }, null, 2));
    res.json({ ok: true, slug, kind });
  } catch (e) { res.status(500).json({ error: String((e as Error).message) }); }
});

// ─── Feature-Director metadata for one project (manifest presence + shots) ─────
router.get('/:slug/meta', (req, res) => {
  const dir = slugDir(req.params.slug);
  if (!dir) { res.status(404).json({ error: 'project not found' }); return; }
  const shotsDir = join(dir, 'sections');
  const shots = existsSync(shotsDir)
    ? readdirSync(shotsDir).filter(f => /\.(png|jpg|webp)$/i.test(f)) : [];
  const cfg = readJson<Record<string, unknown>>(join(dir, 'site.config.json'), {});
  res.json({
    slug: basename(dir),
    hasManifest: existsSync(join(dir, 'manifest.json')),
    sectionShots: shots,
    liveUrl: (cfg.live_url as string) ?? (cfg.liveUrl as string) ?? '',
  });
});

// ─── Manifest (the current layout the editor reads/writes) ─────────────────────
router.get('/:slug/manifest', (req, res) => {
  const dir = slugDir(req.params.slug);
  if (!dir) { res.status(404).json({ error: 'project not found' }); return; }
  const p = join(dir, 'manifest.json');
  if (!existsSync(p)) { res.status(404).json({ error: 'no manifest yet' }); return; }
  res.json(readJson(p, {}));
});

router.post('/:slug/manifest', (req, res) => {
  const dir = slugDir(req.params.slug);
  if (!dir) { res.status(404).json({ error: 'project not found' }); return; }
  try {
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String((e as Error).message) }); }
});

// ─── Section screenshots (served to the edit view; the injector <img> hits this) ─
router.get('/:slug/sections/:file', (req, res) => {
  const dir = slugDir(req.params.slug);
  if (!dir) { res.status(404).end(); return; }
  const file = basename(req.params.file);
  const p = join(dir, 'sections', file);
  if (!existsSync(p)) { res.status(404).end(); return; }
  const type = extname(file).toLowerCase() === '.webp' ? 'image/webp'
    : extname(file).toLowerCase() === '.jpg' ? 'image/jpeg' : 'image/png';
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-cache');
  res.end(readFileSync(p));
});

// ─── Client media upload (behind the injector's UPLOAD prompt) ──────────────────
// Raw body (octet-stream); filename via ?name=. Dependency-free (no multer).
router.post('/:slug/upload', raw({ type: '*/*', limit: '40mb' }), (req, res) => {
  const dir = slugDir(req.params.slug);
  if (!dir) { res.status(404).json({ error: 'project not found' }); return; }
  const name = basename(String(req.query.name ?? `upload-${Date.now()}`));
  // SECURITY: media only. An allowlist blocks dropping .html/.js/.svg (script-carrying)
  // files into a project dir that gets served. Note: svg is intentionally excluded.
  if (!/\.(png|jpe?g|webp|gif|avif|mp4|webm|mov|pdf)$/i.test(name)) {
    res.status(415).json({ error: 'unsupported file type (images/video/pdf only)' }); return;
  }
  const uploads = join(dir, 'uploads');
  try {
    if (!existsSync(uploads)) mkdirSync(uploads, { recursive: true });
    const body = req.body as Buffer;
    if (!body || !body.length) { res.status(422).json({ error: 'empty body' }); return; }
    writeFileSync(join(uploads, name), body);
    res.json({ ok: true, file: `uploads/${name}`, bytes: body.length });
  } catch { res.status(500).json({ error: 'upload failed' }); } // scrubbed: no path leak
});

// ─── P4 launch-checkpoint (human-in-the-loop schematic review) ─────────────────
// The circuit writes manifest.json at P4, POSTs review {action:'request'} to pause,
// then polls GET review until the human approves in the Feature Director. Approving
// saves the (possibly edited) manifest and flips status → the circuit reads it + builds.
router.get('/:slug/review', (req, res) => {
  const dir = slugDir(req.params.slug);
  if (!dir) { res.status(404).json({ error: 'project not found' }); return; }
  const p = join(dir, 'review.json');
  res.json(existsSync(p) ? readJson(p, { status: 'none' }) : { status: 'none' });
});

router.post('/:slug/review', (req, res) => {
  const dir = slugDir(req.params.slug);
  if (!dir) { res.status(404).json({ error: 'project not found' }); return; }
  const { action, manifest } = (req.body ?? {}) as { action?: string; manifest?: unknown };
  try {
    if (manifest) writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const status = action === 'approve' ? 'approved'
      : action === 'reject' ? 'rejected'
      : action === 'request' ? 'awaiting' : 'none';
    writeFileSync(join(dir, 'review.json'), JSON.stringify({ status, at: Date.now() }, null, 2));
    res.json({ ok: true, status });
  } catch (e) { res.status(500).json({ error: String((e as Error).message) }); }
});

export default router;
