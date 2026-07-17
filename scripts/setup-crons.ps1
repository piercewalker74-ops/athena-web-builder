# NEOFORM Pipeline Cron Setup
# Run once: cd <REPO_DIR> && powershell -ExecutionPolicy Bypass -File scripts\setup-crons.ps1

Write-Host "Setting up NEOFORM cron jobs..." -ForegroundColor Cyan

# ─── 1. NEOFORM Research — runs Mon/Wed/Fri at 6:00 AM AZ time ───────────────
# AZ = UTC-7 (no DST), so 6 AM AZ = 13:00 UTC
$researchPrompt = @"
You are running the NEOFORM lead sourcing pipeline.

TARGET INDUSTRIES (Tier 1 priority): <your industries, e.g. mobile auto detailing, window tint>
TARGET CITIES (rotate through): <your target cities, e.g. City ST, City ST, ...>

TASK:
1. For each city + industry combo (pick 3-4 combos this run), search Google Maps for businesses.
   Use web_search queries like: `"<industry> <City ST> site:google.com/maps OR maps.google.com"`
   Or firecrawl to scrape Google Maps search results directly.

2. For each business found (screen for: rating >= 4.0, review count >= 15, not a chain):
   a. Follow the website URL from Maps. Classify: NO_SITE | WEAK (template/social/booking) | HAS_SITE
   b. Find the owner name from: review text, Google Maps About, Facebook About, BBB listing
   c. Confirm phone number is listed

3. For leads that pass all 4 hard stops (active, phone, owner, web gap):
   POST to http://localhost:3001/api/pipeline/leads with JSON:
   {
     businessName, phone, address, city, state, industry,
     rating, reviewCount, lastReviewDate (ISO),
     webStatus (none/weak_template/weak_social/weak_booking/weak_parked),
     currentSiteUrl, currentSiteType,
     ownerName, ownerSource, facebookUrl, instagramUrl, mapsUrl,
     status: "qualified",
     qualifyingSignals: [...],
     qualificationScore: 0
   }
   Then POST /api/pipeline/leads/{id}/qualify to score it.

4. Report summary to Telegram via the Athena backend:
   POST http://localhost:3001/api/pipeline/leads (then qualify each)

REALISTIC YIELD: 1 in 3-4 candidates survives. Budget to screen 12-16, qualify 3-5.
PRIORITY: weight 70% toward weak-site leads (already buying the premise), 30% no-site.
HARD STOP: Never guess phone, owner, or web status. If unconfirmed, skip the lead.

Report back with: X screened, Y qualified, Z added to pipeline.
"@

Write-Host "Creating neoform-research cron (Mon/Wed/Fri 6AM AZ)..." -ForegroundColor Yellow
openclaw cron add `
  --name "neoform-research" `
  --cron "0 13 * * 1,3,5" `
  --session isolated `
  --message $researchPrompt `
  --announce `
  --channel telegram

# ─── 2. NEOFORM Build — runs daily at 7:00 AM AZ (14:00 UTC) ─────────────────
# Only fires when there are approved leads waiting

$buildPrompt = @"
Check the NEOFORM pipeline inbox for approved leads awaiting site builds.

1. GET http://localhost:3001/api/pipeline/leads/inbox
2. For each lead with status "approved":
   POST http://localhost:3001/api/pipeline/leads/{id}/build
   This will:
   - Build the Next.js 15 site from template
   - Deploy to Vercel
   - Send Telegram mission report
   Stream the build log and report the result.

If no approved leads exist, reply: "NEOFORM BUILD: No approved leads in queue."
"@

Write-Host "Creating neoform-build cron (daily 7AM AZ)..." -ForegroundColor Yellow
openclaw cron add `
  --name "neoform-build" `
  --cron "0 14 * * *" `
  --session isolated `
  --message $buildPrompt `
  --announce `
  --channel telegram

Write-Host ""
Write-Host "Done! Verify with: openclaw cron list" -ForegroundColor Green
Write-Host ""
Write-Host "To run research immediately: openclaw cron run neoform-research" -ForegroundColor Cyan
Write-Host "To run build immediately:    openclaw cron run neoform-build" -ForegroundColor Cyan
