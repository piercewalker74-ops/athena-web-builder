// Google Business listing photo puller — ASSET LADDER rung 2 (LAW 1).
//   node backend/tools/place-photos.mjs <slug> "<business name> <city> <state>" [maxPhotos]
//   node backend/tools/place-photos.mjs <slug> "ChIJ...placeId..."            [maxPhotos]
//
// Resolves the business on Google Places API (New) v1, downloads up to N real
// listing photos to clients/<slug>/_refs/photos/NN.jpg, and writes photos.json
// carrying each photo's Google authorAttributions (LAW 1: keep in metadata AND
// render an on-page credit). The whole _refs/photos/ set is deleted with the
// project if the client declines. These are the honest preview set, swappable
// for the owner's own originals.
//
// Needs GOOGLE_PLACES_API_KEY (falls back to GOOGLE_MAPS_API_KEY), read from the
// process env or ~/.openclaw/.env.
import { homedir } from 'os';
import { join, basename } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';

const [, , slugArg, queryArg, maxArg] = process.argv;
if (!slugArg || !queryArg) {
  console.error('usage: place-photos.mjs <slug> "<business name> <city> <state>" | "<placeId>" [maxPhotos]');
  process.exit(1);
}
const slug = basename(slugArg);
const query = String(queryArg).trim();
const MAX = Math.min(Number(maxArg) || 12, 20); // Places returns at most ~10 per place; cap defensively

// ─── API key (process env → ~/.openclaw/.env) ────────────────────────────────
function keyFromEnvFile() {
  const p = join(homedir(), '.openclaw', '.env');
  if (!existsSync(p)) return '';
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*(GOOGLE_PLACES_API_KEY|GOOGLE_MAPS_API_KEY)\s*=\s*(.*?)\s*$/);
    if (m) return m[2].replace(/^["']|["']$/g, '');
  }
  return '';
}
const KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || keyFromEnvFile();
if (!KEY) { console.error('no GOOGLE_PLACES_API_KEY / GOOGLE_MAPS_API_KEY (env or ~/.openclaw/.env)'); process.exit(1); }

// ─── Output dir (existing client dir, else create under athena/clients) ──────
const ROOTS = [
  join(homedir(), 'websites', 'clients'),
  join(homedir(), 'projects', 'athena', 'clients'),
  join(homedir(), '.openclaw', 'workspace', 'clients'),
];
const clientDir = ROOTS.map(r => join(r, slug)).find(d => existsSync(d))
  || join(homedir(), 'projects', 'athena', 'clients', slug);
const outDir = join(clientDir, '_refs', 'photos');
mkdirSync(outDir, { recursive: true });

const PLACES_FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress',
  'places.googleMapsUri', 'places.rating', 'places.userRatingCount', 'places.photos',
].join(',');
const DETAILS_FIELDS = [
  'id', 'displayName', 'formattedAddress', 'googleMapsUri',
  'rating', 'userRatingCount', 'photos',
].join(',');

const isPlaceId = /^(places\/)?ChIJ[\w-]+$/.test(query);

async function resolvePlace() {
  if (isPlaceId) {
    const id = query.replace(/^places\//, '');
    const r = await fetch(`https://places.googleapis.com/v1/places/${id}`, {
      headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': DETAILS_FIELDS },
    });
    const j = await r.json();
    if (j.error) throw new Error(`details: ${j.error.status} ${j.error.message}`);
    return j;
  }
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': PLACES_FIELDS },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`searchText: ${j.error.status} ${j.error.message}`);
  const place = j.places?.[0];
  if (!place) throw new Error('no place matched the query');
  return place;
}

async function downloadPhoto(photo, idx) {
  // skipHttpRedirect → JSON { photoUri, authorAttributions } (no image bytes yet)
  const metaRes = await fetch(
    `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=1600&skipHttpRedirect=true&key=${KEY}`,
  );
  const meta = await metaRes.json();
  if (meta.error || !meta.photoUri) throw new Error(meta.error?.message || 'no photoUri');
  const imgRes = await fetch(meta.photoUri);
  if (!imgRes.ok) throw new Error(`image ${imgRes.status}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const file = `${String(idx + 1).padStart(2, '0')}.jpg`;
  writeFileSync(join(outDir, file), buf);
  const attr = (photo.authorAttributions || meta.authorAttributions || [])
    .map(a => ({ displayName: a.displayName, uri: a.uri }));
  return {
    file, bytes: buf.length,
    widthPx: photo.widthPx, heightPx: photo.heightPx,
    resourceName: photo.name, attribution: attr,
  };
}

(async () => {
  try {
    const place = await resolvePlace();
    const photos = (place.photos || []).slice(0, MAX);
    if (!photos.length) {
      writeFileSync(join(clientDir, '_refs', 'photos.json'),
        JSON.stringify({ placeId: place.id, displayName: place.displayName?.text, count: 0, photos: [], note: 'listing has no photos' }, null, 2));
      console.log(JSON.stringify({ ok: true, count: 0, note: 'listing has no photos', place: place.displayName?.text }));
      return;
    }
    const results = [];
    for (let i = 0; i < photos.length; i++) {
      try { results.push(await downloadPhoto(photos[i], i)); }
      catch (e) { results.push({ index: i, error: String(e.message || e) }); }
    }
    const ok = results.filter(r => r.file);
    const manifest = {
      placeId: place.id,
      displayName: place.displayName?.text,
      formattedAddress: place.formattedAddress,
      googleMapsUri: place.googleMapsUri,
      rating: place.rating,
      userRatingCount: place.userRatingCount,
      source: 'google-listing',
      swappable: true,
      fetchedAtIso: new Date().toISOString(),
      count: ok.length,
      dir: '_refs/photos',
      photos: ok,
    };
    // photos.json lives at _refs/ so the build's harvest step finds it beside other refs.
    writeFileSync(join(clientDir, '_refs', 'photos.json'), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({
      ok: true, place: manifest.displayName, placeId: manifest.placeId,
      downloaded: ok.length, failed: results.length - ok.length,
      dir: outDir, manifest: join(clientDir, '_refs', 'photos.json'),
    }));
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: String(e.message || e) }));
    process.exit(1);
  }
})();
