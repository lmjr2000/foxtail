# Foxtail — notes for future sessions

Store-performance dashboard for Foxtail Coffee Co. In-store cameras → customers entered, line
length, wait time, counter staffing, compared with register (POS) sales. **Not** a security product:
no alerts, no monitoring desk, no recordings kept. The original brief is in `START-HERE.md`.

## Rules from the owner (always apply)
- Production is only ever built from `main` (CI → image). Never deploy by copying files to a server.
- Ask before anything that costs money (servers, domains, Roboflow usage at scale), sends email/SMS
  to real people, or touches Eye of Omni's live server/database.
- Numbers must be real. A store without counting shows "not set up", never zeros. There is **no demo
  mode** (owner chose "no demo data"). Never seed fake numbers into a shared database.
- Branding is Foxtail Coffee Co.'s own (from foxtailcoffee.com): black/white, teal accent
  `#4F979A`/`#69C9CD` (`#3B7B7E` behind white text), rust `#9E3B1B`, script wordmark in
  `apps/portal/public/foxtail-*.png`, Gotham → Montserrat → system font. Colors live only in
  `apps/portal/src/index.css` tokens and `BRAND`/`ACCENT` in `apps/api/src/services/reports/pdf.ts`.

## Layout (npm workspaces)
- `packages/shared` — roles (`roles.ts`), coffee-shop counting config: area types, metrics, rules,
  targets, opening hours, validation (`counting.ts`), recorder RTSP paths (`recorders.ts`).
  Build it before the others (`npm install` does this via postinstall).
- `apps/api` — Express 5 + Postgres (`pg`), no ORM. `src/app.ts` builds the app (tests use it),
  `src/index.ts` runs migrations, listens, starts the sampler.
- `apps/portal` — React 19 + Vite 6 + Tailwind 3, design tokens from Eye of Omni.
- `apps/edge-agent` — on-site frame pusher for recorders the cloud cannot reach.

## Access model (the important part)
- Roles: `corporate_admin` (everything, the only role that changes settings/logins/POS uploads),
  `corporate_viewer` (all stores, read only), `franchise_owner` (only stores whose `franchisee_id`
  equals their own, read + downloads; DB constraint forces owners to have a franchisee).
- `middleware/auth.ts` re-reads the user from Postgres on every request; `token_version` bump on
  password change / role / franchisee / disable kills old sessions.
- Every per-store route is under `/api/stores/:storeId` in `routes/stores.ts`, which registers
  `router.param('storeId', storeParam)`. `storeParam` loads via `services/stores.ts#scopedStore`,
  which puts the franchisee filter **in the SQL**; out of scope = 404 identical to "does not exist".
  Handlers use `theStore(req)` only. Sub-resources (cameras, checks) are also filtered by store_id.
- `test/scoping.test.ts` enumerates every `:storeId` route on the router and asserts 404 for another
  franchisee's store. **Any new per-store route must live on that router** so it is covered.
- Overview / all-stores reports use `listScopedStores` — a franchise owner's "all stores" is theirs.

## Real locations, cameras and video
- Stores + cameras come from the EZCloud "Channel Management" CSV (the same file Eye of Omni imported as
  "Foxtail / <store>"): Admin → Import cameras → `POST /api/imports/ezcloud-channels`
  (`services/inventory/ezcloud-import.ts`). One store per EZCloud Device (`stores.source_device_name`),
  one camera per channel, matched on re-import by recorder + channel number (the export's
  "Channel Serial No." is a shared model code, NOT unique). Timezone guessed from the state suffix.
- Camera status: from the export (`status_source='ezcloud'`) or set by Foxtail when it pulls a
  picture/video (`'foxtail'`). Every login that can see a store can see its cameras (owners too);
  recorder address/login are never returned.
- Video needs the store's recorder (Settings → Recorder & cameras): `direct` = live HLS via
  `services/video/live.ts` (on-demand ffmpeg per watched camera, HEVC→H.264 640px/12fps, stops ~45 s
  after the last viewer, served only through `/api/stores/:id/cameras/:id/live/*`); `edge` = latest
  pictures pushed by the edge agent. Pictures: `picture.jpg`, cached 20 s per camera.
- Portal: `pages/Cameras.tsx` (all locations + camera wall), `components/CameraViews.tsx` (tile,
  hls.js player with the auth header via `xhrSetup`). CSP allows `media-src/worker-src blob:` for hls.js.

## Counting pipeline
`services/counting/`: sampler (every N s, open hours only, stores with counting on) → `recorders/capture.ts`
(ffmpeg RTSP for `direct`, newest pushed frame for `edge`) → `detector.ts` (Roboflow, fails closed,
needs `ROBOFLOW_API_KEY` + `PERSON_MODEL_ID`) → `tracking.ts` assigns foot points to area polygons →
`samples` table (counts + anonymous points, never images). `engine.ts`/`compute.ts`/`rules.ts` turn
samples into metrics, hourly buckets, hour-of-day profile, key moments. A missing round is a gap,
never zero. Engine code is carried over from Eye of Omni's business-insights (coffee parts only:
tables, host stand, kitchen, live view and image thumbnails were dropped).
- `insights.ts` — range/hours parsing (store's own timezone) + short cache (cleared on settings save).
- `overview.ts` — per-store rows, totals (counting stores only; wait weighted by #waits), worst hours.
- `pos-csv.ts` / `pos.ts` — Toast/Square/Clover CSV → hourly rows; conversion only over hours with both.
- `accuracy.ts` — manual spot checks vs measured.

## Commands
- `npm run dev` — embedded Postgres (`.data/pg`, git-ignored) + API :3001 + portal :5173 (proxy /api).
- `npm run user:create -w @foxtail/api -- --email you@x.com --name "Name"` — first corporate admin;
  prints a one-time temp password (must be changed at first sign-in). No email is ever sent.
- `npm test` — shared unit tests + API tests on real Postgres (embedded locally; CI uses the
  `postgres:17` service via `DATABASE_URL`). `npm run typecheck`, `npm run build`.
- Migrations: add `apps/api/migrations/NNN_name.sql`; applied in order at startup (`schema_migrations`).
- On Windows, npm's allow-scripts list in root `package.json` must include esbuild and
  `@embedded-postgres/windows-x64` (already there).

## Not done yet / decisions pending
- Deploy (brief step 7): Dockerfile exists; host, domain and deploy workflow need the owner's OK.
- Live video (Eye of Omni's HLS remux) was not carried over; counting only needs snapshots.
- EZCloud cloud API is not used; Uniview/EZCloud recorders connect over RTSP (direct or edge agent).
- POS upload is corporate-admin only (franchise owners read the comparison). Revisit if franchisees
  should upload their own POS exports.
