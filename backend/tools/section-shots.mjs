// Per-section screenshotter (P3 / edit-view thumbnails).
//   node backend/tools/section-shots.mjs <slug> [url]
// Captures each section of a built site to <client>/sections/<id>.png and writes a
// best-effort manifest.json (the edit view reads both). Sections are found by
// [data-section-id] (v2 builds emit these); otherwise top-level <section> elements,
// keyed s0..sN. Uses playwright + the cached chromium.
import { chromium } from 'playwright';
import { homedir } from 'os';
import { join, basename } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';

const [, , slugArg, urlArg] = process.argv;
if (!slugArg) { console.error('usage: section-shots.mjs <slug> [url]'); process.exit(1); }
const slug = basename(slugArg);

const ROOTS = [
  join(homedir(), 'websites', 'clients'),
  join(homedir(), 'projects', 'athena', 'clients'),
  join(homedir(), '.openclaw', 'workspace', 'clients'),
];
const dir = ROOTS.map(r => join(r, slug)).find(d => existsSync(d));
if (!dir) { console.error('project not found:', slug); process.exit(1); }

function cfgUrl() {
  const p = join(dir, 'site.config.json');
  if (!existsSync(p)) return '';
  try { const c = JSON.parse(readFileSync(p, 'utf8'));
    return c.live_url || c.liveUrl || c.deployUrl || c.deployment_url || ''; } catch { return ''; }
}
const url = urlArg || cfgUrl();
if (!url) { console.error('no URL (pass one or add live_url to site.config.json)'); process.exit(1); }

const outDir = join(dir, 'sections');
mkdirSync(outDir, { recursive: true });

const run = async () => {
  // Use the installed system Chrome (avoids downloading a playwright browser build).
  const browser = await chromium.launch({ channel: 'chrome' })
    .catch(() => chromium.launch({ executablePath: join(homedir(), '.cache', 'puppeteer', 'chrome', 'win64-131.0.6778.204', 'chrome-win64', 'chrome.exe') }));
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  console.log('→', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1200);

  let handles = await page.$$('[data-section-id]');
  const tagged = handles.length > 0;
  if (!handles.length) handles = await page.$$('main > section, main > div > section, body > section, section');
  if (!handles.length) handles = await page.$$('main > *');
  console.log(`found ${handles.length} sections (${tagged ? 'data-section-id' : 'fallback selectors'})`);

  const sections = [];
  for (let i = 0; i < handles.length; i++) {
    const el = handles[i];
    const id = (tagged ? (await el.getAttribute('data-section-id')) : null) || `s${i}`;
    try {
      await el.scrollIntoViewIfNeeded({ timeout: 3000 });
      await page.waitForTimeout(350);
      const box = await el.boundingBox();
      if (!box || box.height < 24) continue;                 // skip empty/hidden
      await el.screenshot({ path: join(outDir, `${id}.png`) });
      const heading = (await el.evaluate(n => {
        const h = n.querySelector('h1,h2,h3'); return h ? h.textContent.trim().slice(0, 40) : '';
      })) || `Section ${i + 1}`;
      const arch = i === 0 ? 'A' : i === handles.length - 1 ? 'K' : 'D';
      sections.push({ id, arch, name: heading.toUpperCase(), slot: i === 0 || i === handles.length - 1 ? 'anchor' : 'gap',
        desc: 'captured from the live site', variant: null, enhancements: [], media: null, screenshot: `sections/${id}.png` });
      console.log(`  ✓ ${id}  ${heading}`);
    } catch (e) { console.log(`  ✗ ${id}: ${e.message}`); }
  }
  await browser.close();

  // best-effort manifest (v2 builds overwrite this with the real P4 manifest)
  if (!existsSync(join(dir, 'manifest.json'))) {
    writeFileSync(join(dir, 'manifest.json'),
      JSON.stringify({ label: slug, url, cat: '', generatedBy: 'section-shots', sections }, null, 2));
    console.log('  wrote manifest.json (best-effort)');
  } else {
    console.log('  manifest.json exists — left as-is, only refreshed screenshots');
  }
  console.log(`done: ${sections.length} section shots → ${outDir}`);
};
run().catch(e => { console.error(e); process.exit(1); });
