import type { WebStatus } from './types.js';

// Patterns that indicate a weak/template site
const WEAK_SITE_PATTERNS: Array<{ pattern: RegExp | string; type: string; label: string }> = [
  // Hosted builders
  { pattern: /wix\.com/i,          type: 'weak_template', label: 'Wix' },
  { pattern: /godaddysites\.com/i, type: 'weak_template', label: 'GoDaddy Sites' },
  { pattern: /squarespace\.com/i,  type: 'weak_template', label: 'Squarespace' },
  { pattern: /weebly\.com/i,       type: 'weak_template', label: 'Weebly' },
  { pattern: /jimdo\.com/i,        type: 'weak_template', label: 'Jimdo' },
  { pattern: /site123\.me/i,       type: 'weak_template', label: 'Site123' },
  { pattern: /wordpress\.com/i,    type: 'weak_template', label: 'WordPress.com' },
  { pattern: /sites\.google\.com/i,type: 'weak_template', label: 'Google Sites' },
  { pattern: /webnode\.com/i,      type: 'weak_template', label: 'Webnode' },
  { pattern: /strikingly\.com/i,   type: 'weak_template', label: 'Strikingly' },
  { pattern: /carrd\.co/i,         type: 'weak_template', label: 'Carrd' },
  { pattern: /shortio\.link/i,     type: 'weak_template', label: 'Short.io' },
  // Social redirects
  { pattern: /facebook\.com/i,     type: 'weak_social',   label: 'Facebook' },
  { pattern: /instagram\.com/i,    type: 'weak_social',   label: 'Instagram' },
  { pattern: /linktr\.ee/i,        type: 'weak_social',   label: 'Linktree' },
  { pattern: /linkin\.bio/i,       type: 'weak_social',   label: 'LinkinBio' },
  { pattern: /beacons\.ai/i,       type: 'weak_social',   label: 'Beacons' },
  // Booking platforms
  { pattern: /booksy\.com/i,       type: 'weak_booking',  label: 'Booksy' },
  { pattern: /square\.site/i,      type: 'weak_booking',  label: 'Square Sites' },
  { pattern: /vagaro\.com/i,       type: 'weak_booking',  label: 'Vagaro' },
  { pattern: /styleseat\.com/i,    type: 'weak_booking',  label: 'StyleSeat' },
  { pattern: /schedulicity\.com/i, type: 'weak_booking',  label: 'Schedulicity' },
  { pattern: /setmore\.com/i,      type: 'weak_booking',  label: 'Setmore' },
  { pattern: /appointy\.com/i,     type: 'weak_booking',  label: 'Appointy' },
  { pattern: /acuityscheduling\.com/i, type: 'weak_booking', label: 'Acuity' },
  // GoDaddy/generic parked
  { pattern: /godaddy\.com\/website/i, type: 'weak_parked', label: 'GoDaddy Parked' },
];

// Server response headers that indicate builders
const WEAK_HEADER_PATTERNS: Array<{ header: string; value: RegExp; type: string; label: string }> = [
  { header: 'x-wix-request-id',   value: /.*/,       type: 'weak_template', label: 'Wix' },
  { header: 'x-squarespace-theme',value: /.*/,       type: 'weak_template', label: 'Squarespace' },
  { header: 'server',             value: /wix/i,     type: 'weak_template', label: 'Wix' },
  { header: 'via',                value: /godaddy/i, type: 'weak_template', label: 'GoDaddy' },
];

// HTML content patterns for builders
const WEAK_CONTENT_PATTERNS: Array<{ pattern: RegExp; type: string; label: string }> = [
  { pattern: /cdn\.wix\.com/i,               type: 'weak_template', label: 'Wix' },
  { pattern: /static1\.squarespace\.com/i,   type: 'weak_template', label: 'Squarespace' },
  { pattern: /weebly\.com\/uploads/i,        type: 'weak_template', label: 'Weebly' },
  { pattern: /wp-content\/themes/i,          type: 'weak_template', label: 'WordPress' },
  { pattern: /powered by shopify/i,          type: 'has_site',      label: 'Shopify' },
  { pattern: /coming soon/i,                 type: 'weak_parked',   label: 'Coming Soon' },
  { pattern: /under construction/i,          type: 'weak_parked',   label: 'Under Construction' },
  { pattern: /parked domain/i,               type: 'weak_parked',   label: 'Parked Domain' },
  { pattern: /domain for sale/i,             type: 'weak_parked',   label: 'Domain for Sale' },
  { pattern: /this domain is for sale/i,     type: 'weak_parked',   label: 'Domain for Sale' },
];

export interface VerificationResult {
  status: WebStatus;
  siteType?: string;
  finalUrl?: string;
  error?: string;
}

export async function verifyWebStatus(url: string): Promise<VerificationResult> {
  if (!url || url.trim() === '') {
    return { status: 'none' };
  }

  // Normalize URL
  let normalizedUrl = url.trim();
  if (!normalizedUrl.startsWith('http')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  // Check URL pattern first (before fetching)
  for (const p of WEAK_SITE_PATTERNS) {
    const matcher = typeof p.pattern === 'string' ? new RegExp(p.pattern) : p.pattern;
    if (matcher.test(normalizedUrl)) {
      return { status: p.type as WebStatus, siteType: p.label, finalUrl: normalizedUrl };
    }
  }

  // SECURITY (SSRF): a lead's URL is external input. Never let it point the backend's
  // fetch at internal/loopback/link-local/metadata addresses. Block those hosts up front.
  try {
    const h = new URL(normalizedUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0'
      || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)
      || /^(fc|fd|fe80)/.test(h)) {
      return { status: 'unknown' as WebStatus, siteType: 'blocked-internal', finalUrl: normalizedUrl };
    }
  } catch { /* unparseable URL — the fetch below will fail safely */ }

  // Try fetching
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(normalizedUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    clearTimeout(timeout);
    const finalUrl = res.url;

    // Check redirect destination
    for (const p of WEAK_SITE_PATTERNS) {
      const matcher = typeof p.pattern === 'string' ? new RegExp(p.pattern) : p.pattern;
      if (matcher.test(finalUrl)) {
        return { status: p.type as WebStatus, siteType: p.label, finalUrl };
      }
    }

    // Check response headers
    for (const hp of WEAK_HEADER_PATTERNS) {
      const headerVal = res.headers.get(hp.header);
      if (headerVal && hp.value.test(headerVal)) {
        return { status: hp.type as WebStatus, siteType: hp.label, finalUrl };
      }
    }

    // Check content
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      const html = await res.text().catch(() => '');
      for (const cp of WEAK_CONTENT_PATTERNS) {
        if (cp.pattern.test(html)) {
          return { status: cp.type as WebStatus, siteType: cp.label, finalUrl };
        }
      }
    }

    // Got a real response — site exists
    if (res.status === 404 || res.status >= 500) {
      return { status: 'none', finalUrl };
    }

    return { status: 'has_site', finalUrl };

  } catch (err: unknown) {
    // undici's fetch reports a bare "fetch failed" and hides the real DNS/connection
    // failure on err.cause, so flatten the whole chain before matching.
    const chain: string[] = [];
    let cur: unknown = err;
    for (let i = 0; cur && i < 5; i++) {
      if (cur instanceof Error) {
        chain.push(cur.message);
        const code = (cur as NodeJS.ErrnoException).code;
        if (code) chain.push(code);
        cur = (cur as { cause?: unknown }).cause;
      } else {
        chain.push(String(cur));
        break;
      }
    }
    const msg = chain.join(' | ');

    if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('getaddrinfo')
      || msg.includes('EAI_AGAIN') || msg.includes('ENODATA')) {
      return { status: 'none', error: msg };
    }
    if (msg.includes('abort') || msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
      return { status: 'unknown', error: 'timeout' };
    }

    return { status: 'unknown', error: msg };
  }
}

export function isWeakOrNone(status: WebStatus): boolean {
  return status === 'none' || status.startsWith('weak_');
}

export function webStatusLabel(status: WebStatus, siteType?: string): string {
  switch (status) {
    case 'none':           return 'NO SITE';
    case 'weak_template':  return `WEAK — ${siteType ?? 'Template'}`;
    case 'weak_social':    return `WEAK — ${siteType ?? 'Social Only'}`;
    case 'weak_booking':   return `WEAK — ${siteType ?? 'Booking Page'}`;
    case 'weak_parked':    return `WEAK — ${siteType ?? 'Parked'}`;
    case 'has_site':       return 'HAS SITE';
    default:               return 'UNKNOWN';
  }
}
