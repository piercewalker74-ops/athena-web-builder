# Athena — Web Builder

Athena is an agent-driven **website production pipeline** with a retro-terminal
control bridge. It finds leads, scaffolds a real multi-page site from a template,
builds and (optionally) deploys it, and reports the result — all from one UI.

> This is a public, scrubbed release of a personal project. All secrets, API
> keys, client data, and finished client sites have been removed. It ships with
> localhost defaults; you bring your own keys and your own site template.

---

## What's in the box

**A React control bridge** (`frontend/`) — a themed, single-page "starship bridge"
UI with these sections:

- **COMMS** — chat console to the agent gateway
- **OPERATIONS** — automation / scheduled-job grid
- **PIPELINE** — the build lane: leads → build → review → deploy, with a live tracker
- **SHOWCASE** — a browsable catalog of ~150 mined UI feature patterns
- **INBOX** — review queue for generated sites
- **MISSION LOG** — live event stream
- **MEMORY** — a file/notes browser

**A Node/Express backend** (`backend/`) — the pipeline engine:

- Lead store, build queue, and a single-lane build runner
- An auto-scheduler ("circuit") that can find and ship sites on a cadence
- Template matching + scaffolding
- Optional deploy to Vercel and reporting to Telegram / SMS via Twilio

## Architecture at a glance

```
 Browser (React bridge)  ──HTTP/WS──►  Express backend  ──spawns──►  OpenClaw agent CLI
        :5173                              :3001                         (build worker)
                                             │
                            Vercel deploy · Telegram/Twilio reports
```

The backend does **not** contain the LLM agent itself. It orchestrates an external
agent worker by shelling out to the [OpenClaw](https://openclaw.ai) CLI + local
gateway. See **Requirements** below.

---

## Requirements

| Need | Why | Required? |
|------|-----|-----------|
| Node.js 20+ | runtime for both apps | **yes** |
| An OpenClaw agent CLI + gateway | the build runner spawns `openclaw agent …` to actually build sites | **yes, to run builds** (the UI runs without it) |
| A site template repo | the starter the builder scaffolds each site from (set `SITE_TEMPLATE_PATH`) | **yes, to build** |
| Vercel token | deploy finished sites | optional |
| Telegram bot / Twilio | send reports & outreach | optional |

Because the pipeline was built around one specific agent harness, treat this repo
as a **reference implementation / starting point** rather than a turnkey product —
you will wire the agent step to your own setup.

## Quick start

```bash
# 1. install (npm workspaces — installs frontend + backend)
npm install

# 2. configure
cp .env.example backend/.env.local
#   …edit backend/.env.local with your values (all optional to boot the UI)

# 3. run both apps (backend :3001, frontend :5173)
npm run dev
```

Open http://localhost:5173.

Build for production:

```bash
npm run build          # builds the frontend
npm --workspace=backend run build   # compiles the backend to dist/
```

## Configuration

Everything is environment-driven — see [`.env.example`](./.env.example) for the
full list with comments. Nothing is hardcoded to any machine, user, or domain.

## Project layout

```
backend/          Express API + pipeline engine
  src/
    server.ts     HTTP/WS server, routes, vitals
    pipeline/     lead store, build queue/runner, scheduler, templates, outreach
    routes/       pipeline + projects API routers
frontend/         React + Vite control bridge
  src/components/ the bridge UI (Comms, Operations, Pipeline, …)
  public/         icons, feature catalog, demos
scripts/          optional cron/setup helpers
```

## License

MIT — see [LICENSE](./LICENSE).
