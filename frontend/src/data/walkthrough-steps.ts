import type { WalkthroughStep } from '../components/WalkthroughOverlay';

// ── Overarching tour — navigates through every section ────────────────────────

export const OVERARCHING_STEPS: WalkthroughStep[] = [
  {
    title: 'ATHENA — TACTICAL CONTROL BRIDGE',
    body: 'Your mission control for the NEOFORM lead generation pipeline. Seven sections, one command surface. This tour covers the lay of the land — hit ? on any section header to run a deeper walkthrough of that area.',
    position: 'center',
  },
  {
    target: '[data-tour="nav-comms"]',
    title: 'COMMS',
    body: 'Direct line to the AI. Sessions persist across navigation — the conversation stays open whether you leave and come back, and a diagnostic greeting prints on every fresh start.',
    section: 'comms',
    position: 'right',
  },
  {
    target: '[data-tour="nav-operations"]',
    title: 'OPERATIONS',
    body: 'The automation grid. Cron jobs run your pipeline circuits on schedule — research runs, nightly commits, morning briefings. The UPCOMING TRIGGERS timeline shows exactly when each fires next.',
    section: 'operations',
    position: 'right',
  },
  {
    target: '[data-tour="nav-missions"]',
    title: 'MISSION LOG',
    body: 'Every scheduled job run logged here — status, duration, and full terminal output. OK entries in green, errors in red. Your audit trail for what ran and when.',
    section: 'missions',
    position: 'right',
  },
  {
    target: '[data-tour="nav-inbox"]',
    title: 'REVIEW INBOX',
    body: 'Qualified leads land here after a research circuit completes. Approve to move a lead into the build pipeline, or drop to discard. Expand any card for signals, social links, and actions.',
    section: 'inbox',
    position: 'right',
  },
  {
    target: '[data-tour="nav-pipeline"]',
    title: 'PIPELINE',
    body: 'Where sites get built. Watch the live build radar, see today\'s shipped sites, toggle the AUTO engine, and launch a circuit on demand. Hit the ? on this section for an in-depth, button-by-button walkthrough of the whole build system.',
    section: 'pipeline',
    position: 'right',
  },
  {
    target: '[data-tour="nav-memory"]',
    title: 'MEMORY BROWSER',
    body: 'Browse your OpenClaw workspace files — agent memory, skills, daily notes — rendered inside the bridge. Markdown gets styled headers and bullets; raw files print with a typewriter effect.',
    section: 'memory',
    position: 'right',
  },
  {
    title: 'READY FOR DEPLOYMENT',
    body: 'That\'s the full bridge. Use ? on any section for a deeper walkthrough of that area. Relaunch this tour any time from the GUIDE button at the top of the screen.',
    position: 'center',
  },
];

// ── GUIDE dropdown menu — the list shown when you click GUIDE ─────────────────
// To add a walkthrough later: build its steps (usually a SECTION_STEPS entry) and
// add one line here. `nav` (optional) is the section to jump to before it plays.
export interface GuideMenuItem { label: string; steps: WalkthroughStep[]; nav?: string; }

// ── Section tours — one array per section, easy to extend ────────────────────
// Add more steps to any array to extend that section's walkthrough later.

export const SECTION_STEPS: Partial<Record<string, WalkthroughStep[]>> = {

  comms: [
    {
      target: '[data-tour="comms-messages"]',
      title: 'MESSAGE FEED',
      body: 'Conversation history. The diagnostic greeting prints automatically on first load each session. History is saved to localStorage — it survives page refreshes and navigation between sections.',
      position: 'bottom',
    },
    {
      target: '[data-tour="comms-input"]',
      title: 'COMMAND INPUT',
      body: 'Type your message here. Press Enter to send, Shift+Enter for a new line. The AI has full context of your Athena setup and can help plan a circuit run, answer questions, or trigger ops.',
      position: 'top',
    },
    {
      target: '[data-tour="comms-clear"]',
      title: 'CLEAR SESSION',
      body: 'Wipes the conversation and resets to a fresh start. A new diagnostic greeting prints on the next response. Useful when switching task context or starting a new workflow.',
      position: 'top',
    },
  ],

  operations: [
    {
      target: '[data-tour="ops-grid"]',
      title: 'AUTOMATION GRID',
      body: 'Each card is a cron job managed by the mission-scheduler process. The circular dial shows time elapsed in the current 24-hour window. A pulsing dot means the last run was successful.',
      position: 'bottom',
    },
    {
      target: '[data-tour="ops-timeline"]',
      title: 'UPCOMING TRIGGERS',
      body: 'Countdown to each enabled job\'s next fire time, sorted nearest-first. Updates every 30 seconds. A quick way to see what\'s queued without doing the cron math yourself.',
      position: 'top',
    },
  ],

  missions: [
    {
      target: '[data-tour="missions-filters"]',
      title: 'STATUS FILTERS',
      body: 'Filter the log by ALL, OK, or ERROR. Hit PAUSE to freeze the 10-second auto-refresh — useful when reading a long output without the list jumping to the latest entry.',
      position: 'bottom',
    },
    {
      target: '[data-tour="missions-feed"]',
      title: 'MISSION FEED',
      body: 'Each entry shows job name, run time, status badge, and duration. New entries slide in from the bottom as runs complete. Click any entry to expand the full terminal output.',
      position: 'bottom',
    },
  ],

  inbox: [
    {
      target: '[data-tour="inbox-header"]',
      title: 'REVIEW INBOX',
      body: 'Leads that cleared the qualification threshold after a NEOFORM research circuit. Run neoform-research from Operations or the command palette to populate this queue.',
      position: 'bottom',
    },
    {
      target: '[data-tour="inbox-leads"]',
      title: 'LEAD CARDS',
      body: 'Each card shows the business, location, star rating, and qualification score color-coded by strength. Expand a card to see qualifying signals, social links, and Approve / Drop buttons.',
      position: 'bottom',
    },
    {
      target: '[data-tour="inbox-leads"]',
      title: 'REAL MEDIA — PULL PHOTOS + VIDEO',
      body: 'Expand a card to find the REAL MEDIA block. PULL PHOTOS downloads the business\'s actual Google listing photos (a thumbnail strip, credited "Photos via Google", swappable). Paste a YouTube channel URL and PULL VIDEOS to bring its uploads into the gallery as embeds. These feed the build so the finished site uses the business\'s own photos and footage instead of stock.',
      position: 'bottom',
    },
  ],

  pipeline: [
    {
      title: 'NEOFORM PIPELINE — MISSION CONTROL',
      body: 'This is where every website gets built and shipped. There are two ways a site is made: the AUTOMATIC circuit (Athena finds a real lead, researches it, builds the site, deploys it, and reports back — completely hands-off), and the SCHEMATIC build (you compose the layout yourself, then press EXECUTE). Both run through ONE build lane, one at a time. This screen lets you watch and control all of it. Use ← → or the dots to move through this guide.',
      section: 'pipeline',
      position: 'center',
    },
    {
      target: '[data-tour="pipeline-modebar"]',
      title: '1 · PIPELINE ⇄ PROJECTS',
      body: 'Two modes live here. PIPELINE (where we are now) is the live control room — the build radar and today\'s activity. PROJECTS opens the Feature Director: you pick a client site, drag in the sections and features you want, describe the vision in plain words, and press EXECUTE to build it. Rule of thumb: flip to PROJECTS to compose or edit a build, come back to PIPELINE to watch it run.',
      position: 'bottom',
    },
    {
      target: '[data-tour="pipeline-tracker"]',
      title: '2 · BUILD TRACKER (live radar)',
      body: 'The ring plots the stages of the build that\'s running. The CYAN reticle is the stage happening right now, GREEN dots are finished stages, and the bright arc shows overall progress. The ring ADAPTS to the build type: a full automatic circuit shows all ten stages (SCOUT → … → DELIVER), while a schematic build shows only the six it actually performs (CALIBRATE → BUILD → QA → DEPLOY → REPORT → DELIVER) because the research stages are skipped. The header names the mode; the right-hand panel shows the business, the current stage, and the live site link once it deploys. ACTIVE means a build is live, STBY means the lane is idle.',
      position: 'top',
    },
    {
      target: '[data-tour="pipeline-header"]',
      title: '3 · VIEW TABS + REFRESH',
      body: 'TODAY (the default) shows the build lane and today\'s shipped sites. STATS shows aggregate lead counts by status. PROJECTS lists the client-site directory. The ↻ button forces an immediate refresh — everything here also auto-updates every few seconds, so you rarely need it.',
      position: 'bottom',
    },
    {
      target: '[data-tour="pipeline-launch"]',
      title: '4 · LAUNCH BUILD',
      body: 'Fires a full AUTOMATIC circuit right now: Athena sources and researches a fresh lead, then builds and deploys a complete site for it. It goes onto the same single build lane — so if a build is already running, this one waits in the queue and starts automatically when the lane clears. Use it when you want an extra site on demand without waiting for the schedule.',
      position: 'bottom',
    },
    {
      title: '4.5 · REAL MEDIA — AUTHENTIC PHOTOS + VIDEO',
      body: 'Every build uses the business\'s REAL media, never stock. Athena pulls it automatically at research time: the actual Google Business listing photos (saved with attribution, swappable for the owner\'s own shots) and — if the business has a YouTube channel — its videos, embedded into the gallery. You can also do it by hand from REVIEW INBOX: expand any lead and hit PULL PHOTOS, or paste a YouTube channel and PULL VIDEOS, to preview or refresh what the site will use. No channel found? The video step is simply skipped.',
      position: 'center',
    },
    {
      target: '[data-tour="pipeline-lane"]',
      title: '5 · ACTIVE / IDLE',
      body: 'The live state of the build lane. When a build is running this shows a pulsing green ACTIVE indicator and names the business, tagged with how it\'s being built (SCHEMATIC or CIRCUIT). When nothing is running it reads IDLE — the lane is clear and ready for the next job.',
      position: 'bottom',
    },
    {
      target: '[data-tour="pipeline-queue"]',
      title: '6 · QUEUE',
      body: 'How many builds are waiting behind the one that\'s running. Only ONE build runs at a time — anything you launch or EXECUTE while the lane is busy lands here and fires automatically when the current build finishes. Between jobs the builder starts a completely fresh session, so its memory never piles up across builds.',
      position: 'top',
    },
    {
      target: '[data-tour="pipeline-auto"]',
      title: '7 · AUTO (the automatic engine)',
      body: 'This toggle turns the scheduled circuit on or off — click it to switch. When ON, Athena fires a new circuit every 2 hours, or 15 minutes after the previous build finishes (whichever comes later), and shows a countdown to the next one. This is what makes the pipeline run itself around the clock. Safety net: if a circuit fails three times in a row, AUTO shuts itself off so it can\'t loop on a broken run.',
      position: 'bottom',
    },
    {
      target: '[data-tour="pipeline-today"]',
      title: '8 · SITES COMPLETED TODAY',
      body: 'Every site shipped today, newest first, each with a live ↗ link and a tag for how it was built. The number on the right is today\'s count. This list resets at the start of each day, so it\'s a clean read on the day\'s output.',
      position: 'top',
    },
    {
      title: 'THE WHOLE FLOW',
      body: 'Automatic path: leave AUTO on and Athena finds leads and ships finished sites on its own, one at a time, reporting each to Telegram. Schematic path: open PROJECTS, edit a site\'s layout and features, press EXECUTE, and watch it build right here on the radar. Everything updates live — including through the configured public web address — so you can follow any build from your phone or laptop, anywhere. Relaunch this guide any time with the ? button at the top.',
      position: 'center',
    },
  ],

  memory: [
    {
      target: '[data-tour="memory-list"]',
      title: 'FILE LIST',
      body: 'Your OpenClaw workspace files by category — WORKSPACE (agent memory, config) and SKILL (installed skills). Filter by name or category tab. Sorted by most recently modified.',
      position: 'right',
    },
    {
      target: '[data-tour="memory-viewer"]',
      title: 'FILE VIEWER',
      body: 'Markdown renders with styled headers and bullets. Plain text and JSON print with a typewriter effect — speed adapts to file size so large files don\'t become waiting exercises.',
      position: 'left',
    },
  ],

};

// ── The GUIDE dropdown's contents. Add a line here as new walkthroughs land. ──
export const GUIDE_MENU: GuideMenuItem[] = [
  { label: 'Full Bridge Tour', steps: OVERARCHING_STEPS },
  { label: 'Pipeline — In Depth', steps: SECTION_STEPS.pipeline!, nav: 'pipeline' },
  // more walkthroughs go here as they're built…
];
