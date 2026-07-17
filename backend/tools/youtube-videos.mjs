// YouTube channel → gallery videos (LAW 1 real media, ToS-compliant EMBED, no download).
//   node backend/tools/youtube-videos.mjs <slug> "<channel url | @handle | UC-id>" [maxVideos]
//
// Resolves a channel to its ID, reads YouTube's KEYLESS public RSS feed
// (/feeds/videos.xml?channel_id=UC…, latest ~15 uploads), and writes
// clients/<slug>/_refs/youtube.json with per-video EMBED info. We never download
// the video — the build embeds via youtube-nocookie.com (the sanctioned method),
// so the gallery shows the business's real footage with thumbnails + a lightbox.
//
// No API key needed (the Google key does NOT have YouTube Data API v3 enabled).
// Detection ("does this business have a channel?") is the research agent's job —
// this tool only runs once a channel URL/handle is known. If none, the circuit
// skips this step entirely.
import { homedir } from 'os';
import { join, basename } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const [, , slugArg, chanArg, maxArg] = process.argv;
if (!slugArg || !chanArg) {
  console.error('usage: youtube-videos.mjs <slug> "<channel url | @handle | UC-id>" [maxVideos]');
  process.exit(1);
}
const slug = basename(slugArg);
const input = String(chanArg).trim();
const MAX = Math.min(Number(maxArg) || 8, 15); // the RSS feed carries ~15 latest

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const HDRS = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1' };

// ─── Output dir ──────────────────────────────────────────────────────────────
const ROOTS = [
  join(homedir(), 'websites', 'clients'),
  join(homedir(), 'projects', 'athena', 'clients'),
  join(homedir(), '.openclaw', 'workspace', 'clients'),
];
const clientDir = ROOTS.map(r => join(r, slug)).find(d => existsSync(d))
  || join(homedir(), 'projects', 'athena', 'clients', slug);
mkdirSync(join(clientDir, '_refs'), { recursive: true });

// ─── Resolve a channel ID from url / handle / raw id ─────────────────────────
async function resolveChannelId(raw) {
  const bareId = raw.match(/UC[A-Za-z0-9_-]{22}/);
  if (/^UC[A-Za-z0-9_-]{22}$/.test(raw)) return raw;
  if (raw.includes('/channel/') && bareId) return bareId[0];

  // Build a page URL to scrape channelId from (handle, /c/, /user/, or full url).
  let url = raw;
  if (!/^https?:\/\//.test(raw)) {
    url = raw.startsWith('@')
      ? `https://www.youtube.com/${raw}`
      : `https://www.youtube.com/@${raw.replace(/^@/, '')}`;
  }
  const res = await fetch(url, { headers: HDRS });
  if (!res.ok) throw new Error(`channel page ${res.status} for ${url}`);
  const html = await res.text();
  const m =
    html.match(/"(?:channelId|externalId|browseId)":"(UC[A-Za-z0-9_-]{22})"/) ||
    html.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/) ||
    html.match(/itemprop="identifier"\s+content="(UC[A-Za-z0-9_-]{22})"/);
  if (m) return m[1];
  throw new Error('could not resolve channelId from the channel page');
}

// ─── Parse the Atom feed (regex; the feed is small + well-formed) ────────────
function parseFeed(xml) {
  const chanTitle = (xml.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1];
  const videos = [];
  const entries = xml.split('<entry>').slice(1);
  for (const e of entries) {
    const vid = (e.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
    if (!vid) continue;
    const title = (e.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1]
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const published = (e.match(/<published>(.*?)<\/published>/) || [, ''])[1];
    const thumb = (e.match(/<media:thumbnail\s+url="(.*?)"/) || [, ''])[1]
      || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
    videos.push({
      videoId: vid,
      title,
      publishedAt: published,
      thumbnail: thumb,
      watchUrl: `https://www.youtube.com/watch?v=${vid}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${vid}`,
    });
  }
  return { channelTitle: chanTitle, videos };
}

(async () => {
  try {
    const channelId = await resolveChannelId(input);
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { headers: HDRS });
    if (!res.ok) throw new Error(`rss feed ${res.status}`);
    const xml = await res.text();
    const { channelTitle, videos } = parseFeed(xml);
    const picked = videos.slice(0, MAX);
    const manifest = {
      source: 'youtube',
      channelId,
      channelTitle,
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
      embedMethod: 'youtube-nocookie',
      note: 'Videos are EMBEDDED, not downloaded (YouTube ToS). Gallery renders thumbnail + lightbox iframe.',
      fetchedAtIso: new Date().toISOString(),
      count: picked.length,
      videos: picked,
    };
    writeFileSync(join(clientDir, '_refs', 'youtube.json'), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({
      ok: true, channelId, channelTitle, videos: picked.length,
      manifest: join(clientDir, '_refs', 'youtube.json'),
    }));
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: String(e.message || e), hint: 'pass the channel URL or @handle found during research; if the business has no channel, skip this step' }));
    process.exit(1);
  }
})();
