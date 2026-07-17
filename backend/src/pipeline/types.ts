// ─── NEOFORM Pipeline Types ───────────────────────────────────────────────────

export type WebStatus =
  | 'none'           // No website at all
  | 'weak_template'  // Wix/GoDaddy/Squarespace/Weebly/Google Sites
  | 'weak_social'    // Facebook/Instagram page only
  | 'weak_booking'   // Booksy/Square/Vagaro/booking page only
  | 'weak_parked'    // Domain registered but parked/coming soon
  | 'has_site'       // Real website, drop this lead
  | 'unknown';       // Couldn't determine

export type PipelineStatus =
  | 'scraped'        // Found on Maps, not yet verified
  | 'verifying'      // Currently being verified
  | 'qualified'      // Passed all 4 must-haves
  | 'dropped'        // Failed qualification
  | 'approved'       // Human approved for site build
  | 'building'       // Site being built
  | 'deployed'       // Site live on Vercel
  | 'reported'       // Telegram report sent
  | 'delivered';     // Complete

// Fine-grained circuit position the automation posts to /api/pipeline/stage.
// Drives Athena's live BUILD TRACKER reticle through steps the coarse
// PipelineStatus can't distinguish (calibrate / architect / build / qa).
export type BuildStage =
  | 'scout' | 'verify' | 'qualify' | 'calibrate' | 'architect'
  | 'build' | 'qa' | 'deploy' | 'report' | 'deliver';

export const BUILD_STAGES: BuildStage[] = [
  'scout', 'verify', 'qualify', 'calibrate', 'architect',
  'build', 'qa', 'deploy', 'report', 'deliver',
];

export interface Lead {
  id: string;
  businessName: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip?: string;
  industry: string;
  mapsUrl?: string;
  placeId?: string;
  rating: number;
  reviewCount: number;
  lastReviewDate?: string;         // ISO date of most recent review
  webStatus: WebStatus;
  currentSiteUrl?: string;         // The URL they have (weak or none)
  currentSiteType?: string;        // 'wix' | 'godaddy' | 'facebook' | 'booksy' etc.
  ownerName?: string;
  ownerSource?: string;            // 'reviews' | 'facebook' | 'bbb' | 'llc'
  email?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  qualifyingSignals: string[];     // Positive signals from the spec
  disqualifyingReasons: string[];  // Why it was dropped
  qualificationScore: number;      // 0–100
  status: PipelineStatus;
  buildMode?: 'schematic' | 'circuit'; // which path is building this lead (drives the tracker's stage ring)
  buildStage?: BuildStage;         // Fine-grained live circuit position (BUILD TRACKER)
  buildStageAt?: number;           // ms timestamp of the last stage post
  siteUrl?: string;                // Deployed Vercel URL
  vercelProjectId?: string;
  deployedAt?: string;
  telegramSentAt?: string;
  telegramMessageId?: number;
  notes?: string;
  rawMapsData?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface PipelineRun {
  id: string;
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'ok' | 'error';
  queries: string[];               // Search queries used
  scraped: number;
  qualified: number;
  dropped: number;
  built: number;
  reported: number;
  log: string[];
  error?: string;
}

export interface PipelineConfig {
  enabled: boolean;
  targetIndustries: string[];
  targetCities: Array<{ city: string; state: string }>;
  vercelTeamId?: string;
  siteTemplatePath: string;
  maxLeadsPerRun: number;
  requireApprovalBeforeBuild: boolean;
}

export const DEFAULT_CONFIG: PipelineConfig = {
  enabled: true,
  targetIndustries: [
    'mobile auto detailing',
    'window tint',
    'mobile window tint',
    'mobile pressure washing',
    'auto detailing',
    'car detailing',
    'ceramic coating',
    'paint protection film',
  ],
  targetCities: [
    { city: 'Example City', state: 'ST' },
    { city: 'Another Town', state: 'ST' },
  ],
  siteTemplatePath: process.env.SITE_TEMPLATE_PATH ?? '../neoform-site-template',
  maxLeadsPerRun: 5,
  requireApprovalBeforeBuild: true,
};
