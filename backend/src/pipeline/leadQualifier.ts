import type { Lead } from './types.js';
import { isWeakOrNone } from './webVerifier.js';

// ─── NEOFORM Qualification Engine (grounded in the spec) ─────────────────────

interface QualificationResult {
  pass: boolean;
  score: number;                // 0–100
  signals: string[];            // Positive signals found
  disqualifiers: string[];      // Hard-stop failures
  tier: 'A' | 'B' | 'C' | 'skip';
}

// Hard stops from the spec (all four must pass, or drop it)
function checkHardStops(lead: Partial<Lead>): string[] {
  const fails: string[] = [];

  // 1. Actively operating (reviews within ~60 days)
  if (!lead.lastReviewDate) {
    fails.push('No recent reviews — cannot confirm active');
  } else {
    const lastReview = new Date(lead.lastReviewDate);
    const daysSince = (Date.now() - lastReview.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 90) {
      fails.push(`Last review ${Math.round(daysSince)} days ago — may be inactive`);
    }
  }

  // 2. Direct phone number
  if (!lead.phone || lead.phone.trim() === '') {
    fails.push('No confirmed phone number');
  }

  // 3. Confirmed owner name
  if (!lead.ownerName || lead.ownerName.trim() === '') {
    fails.push('Owner name not confirmed');
  }

  // 4. Real web gap (none or weak)
  if (!lead.webStatus || !isWeakOrNone(lead.webStatus)) {
    fails.push('No real web gap — already has a good site');
  }

  return fails;
}

// Buying signals from the spec
function scoreBuyingSignals(lead: Partial<Lead>): string[] {
  const signals: string[] = [];

  // Already pays for a bad website — BEST signal
  if (lead.webStatus && lead.webStatus.startsWith('weak_') && lead.webStatus !== 'weak_parked') {
    signals.push('Already paying for a bad website (warm upgrade sell)');
  }

  // Booking-dependent business
  const bookingIndustries = ['detail', 'tint', 'wash', 'pressure', 'mobile mechanic', 'glass'];
  if (bookingIndustries.some(k => lead.industry?.toLowerCase().includes(k))) {
    signals.push('Booking-dependent business (direct revenue lever)');
  }

  // Already markets himself (social footprint)
  if (lead.facebookUrl || lead.instagramUrl) {
    signals.push('Active social presence (marketing-aware owner)');
  }

  // Strong rating with recent reviews = growth mode
  if (lead.rating && lead.rating >= 4.5 && (lead.reviewCount ?? 0) >= 20) {
    signals.push(`Premium reputation (${lead.rating}⭐ × ${lead.reviewCount} reviews)`);
  }

  // Mobile business = higher urgency
  if (lead.industry?.toLowerCase().includes('mobile')) {
    signals.push('Mobile business (strong inbound dependency)');
  }

  // Weak social only — already believes in web presence
  if (lead.webStatus === 'weak_social') {
    signals.push('Social-only web presence (has proven digital adoption)');
  }

  // Active on Google (high review count)
  if ((lead.reviewCount ?? 0) >= 50) {
    signals.push('High review volume (established, active operator)');
  }

  return signals;
}

// Score the lead 0–100
function computeScore(lead: Partial<Lead>): number {
  let score = 50; // Baseline if it passes hard stops

  // Web status bonus
  if (lead.webStatus === 'none')           score += 10;
  if (lead.webStatus === 'weak_template')  score += 20; // Best warm signal
  if (lead.webStatus === 'weak_social')    score += 15;
  if (lead.webStatus === 'weak_booking')   score += 12;
  if (lead.webStatus === 'weak_parked')    score += 8;

  // Rating quality
  if (lead.rating && lead.rating >= 4.8)   score += 10;
  else if (lead.rating && lead.rating >= 4.5) score += 7;
  else if (lead.rating && lead.rating >= 4.0) score += 4;

  // Review volume
  if ((lead.reviewCount ?? 0) >= 100)      score += 8;
  else if ((lead.reviewCount ?? 0) >= 50)  score += 5;
  else if ((lead.reviewCount ?? 0) >= 20)  score += 3;
  else if ((lead.reviewCount ?? 0) < 10)   score -= 10; // Too small

  // Social presence
  if (lead.facebookUrl && lead.instagramUrl) score += 5;
  else if (lead.facebookUrl || lead.instagramUrl) score += 3;

  // Mobile business
  if (lead.industry?.toLowerCase().includes('mobile')) score += 5;

  return Math.max(0, Math.min(100, score));
}

// Determine tier
function determineTier(score: number, signals: string[]): QualificationResult['tier'] {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  return 'skip';
}

export function qualifyLead(lead: Partial<Lead>): QualificationResult {
  const disqualifiers = checkHardStops(lead);

  if (disqualifiers.length > 0) {
    return {
      pass: false,
      score: 0,
      signals: [],
      disqualifiers,
      tier: 'skip',
    };
  }

  // Also check hard-skip conditions from spec
  const hardSkip: string[] = [];

  // Franchise/chain
  const chainNames = ['Tint World', 'Ziebart', 'Midas', 'Maaco', 'Pep Boys', 'Jiffy Lube', 'Valvoline'];
  if (chainNames.some(c => lead.businessName?.toLowerCase().includes(c.toLowerCase()))) {
    hardSkip.push('Franchise/chain — corporate owns web');
  }

  // Very low reviews
  if ((lead.reviewCount ?? 0) < 10) {
    hardSkip.push('Too few reviews (<10) — likely underfunded');
  }

  // Corporate-sounding
  if (/\s+(group|inc\.?|llc\.?|corp\.?|co\.)\s*$/i.test(lead.businessName ?? '')) {
    hardSkip.push('Corporate entity ("Group"/"Inc" tier)');
  }

  if (hardSkip.length > 0) {
    return { pass: false, score: 0, signals: [], disqualifiers: hardSkip, tier: 'skip' };
  }

  const signals = scoreBuyingSignals(lead);
  const score = computeScore(lead);
  const tier = determineTier(score, signals);

  return {
    pass: tier !== 'skip',
    score,
    signals,
    disqualifiers: [],
    tier,
  };
}
