# Foxtail — start here

This folder is where the new Foxtail software will live. It is a separate product from Eye of Omni.

## How to start it

1. Open a terminal in this folder (`C:\Users\Owner\Desktop\foxtail`).
2. Run `claude`.
3. Paste the prompt below (everything inside the box) as your first message.

Claude will ask you a few questions, then build the first version step by step. Each finished piece gets a pull request you can review.

---

```
You are starting a new product called Foxtail. Read this whole brief before doing anything.

## What Foxtail is
A store-performance dashboard for a coffee franchise (Foxtail Coffee). It turns the cameras already
installed in each store into business numbers: how many customers came in, how long the line was,
how long people waited, whether the store was staffed for the rush, and how traffic compared with
register sales. It is NOT a security or alarm product: no intrusion alerts, no monitoring desk.

## Who uses it
- Corporate (CEO, VPs, district/area managers): the main site is built for them. They see every
  store, compare stores side by side, and are the only ones who can change settings: store targets,
  counting areas, opening hours, which numbers each store shows.
- Franchise owners: their own view of the same product, showing ONLY the stores they own. They can
  read their stores' numbers and download their reports, but cannot see other franchisees' stores
  and cannot change settings. A franchise owner must not be able to tell that other stores exist.
Enforce store access on the server for every request, not just by hiding things in the UI.

## Where to start from
Most of the counting and reporting engine already exists inside Eye of Omni
(GitHub: lmjr2000/spotbox-cloud; local copy C:\Users\Owner\Desktop\eyeofomni-prodsync, which matches
what is live on www.eyeofomni.com). Reuse it by copying code into this new repo, NOT by forking the
whole thing — Eye of Omni carries a lot Foxtail does not need. Worth taking:
- Business insights engine: apps/api/src/services/business-insights/* (zones, sampler that counts
  people per camera area, metrics/rules, POS CSV comparison, accuracy checks, PDF/CSV reports) and
  packages/shared/src/business-templates.ts (keep the COFFEE_SHOP template; drop the rest).
- The Business insights pages and cards in apps/portal (pages/BusinessInsights*.tsx,
  components/business-insights/*) as the starting point for the store dashboard.
- Per-user store scoping: apps/api/src/middleware/site-scope.ts (a login may only see a list of
  site ids; out-of-scope stores return 404). This is exactly the franchise-owner rule.
- Auth (JWT + password, optional Google sign-in), the Postgres migration runner, and the
  design tokens (tailwind.config.js + src/index.css) so it looks finished from day one.
- Getting video from the stores' Uniview/EZCloud recorders: the RTSP/HLS remux
  (scripts/hls-remux.mjs), per-store recorder credentials sealed with AES-GCM
  (services/secret-box.ts), and the on-site edge agent for recorders the cloud cannot reach.
Leave behind: alerts and notifications, Needs a look, Nest/Ring/Blink, tickets/technicians,
safety/weapon/distress detection, construction mode, voice control, the customer home app,
Assist/gate booth, MediaMTX, Replit files. Do not copy any .env files or credentials.

## Ask me first (one short round of questions), then build in this order
1. Repo + skeleton: npm workspaces monorepo (api, portal, shared), TypeScript, Postgres, tests, CI.
   Create a new private GitHub repo for it under my account (lmjr2000) — ask me for the name.
2. Accounts and access: roles corporate_admin, corporate_viewer, franchise_owner; franchise owners
   are assigned to their stores; server-side scoping with tests proving one franchisee cannot read
   another's store by URL or API.
3. Stores: add/edit stores (name, address, franchisee, opening hours), connect each store's recorder.
4. Counting: carry over the coffee-shop zones and sampler; start with customers entered, line length,
   wait time, staff coverage at the counter.
5. Dashboards: corporate overview (all stores ranked, totals, worst-performing hours), store detail,
   franchise-owner home (their stores only).
6. Reports: PDF/CSV per store and for all stores; POS CSV upload to compare traffic with sales.
7. Deploy: a separate server and domain from Eye of Omni. Ask me before buying or creating anything.

## Rules
- Production must always be built from the main branch. Never deploy by copying files onto a server.
- Ask before anything that costs money, sends email/SMS to real people, or touches Eye of Omni's
  live server or database.
- Numbers must be real: if a store has no counting set up, say so — never show made-up figures
  outside a clearly labelled demo mode.
- Write a CLAUDE.md for this repo as you go so future sessions know how it works.
```

---

## Things to decide before or during the first session

- **The name.** I've used "Foxtail". If it should be something else, change it in the prompt.
- **How video gets out of each store.** The Foxtail stores were set up in Eye of Omni with status only, from EZCloud exports, with no video feed. EZCloud has no login API. Counting needs a picture, so each store needs one of these: the recorder reachable over the internet (port forward or DDNS), the small on-site edge agent running on a PC at the store, or recorder credentials entered once per store. Claude will ask which you want.
- **"Corporate can change the stats."** The prompt reads this as: corporate controls each store's settings and targets, and franchise owners can only view their own stores. If franchise owners should be able to adjust their own store's targets, say so in the first session.
