# Foxtail — notes for future sessions

Store-performance dashboard for Foxtail Coffee Co. Displays business metrics from in-store cameras:
customers entered, line length, wait time, counter staffing, security alerts, and traffic compared
with register (POS) sales. This is a **frontend-only** application that calls the Omni Foxtail API
(Eye of Omni's backend) for all data.

## Rules from the owner (always apply)
- Production is only ever built from `main` (CI → image). Never deploy by copying files to a server.
- Ask before anything that costs money (servers, domains) or touches Eye of Omni's live server/database.
- Numbers must be real. A store without counting shows "not set up", never zeros. There is **no demo
  mode** (owner chose "no demo data"). Never seed fake numbers.
- Branding is Foxtail Coffee Co.'s own (from foxtailcoffee.com): black/white, teal accent
  `#4F979A`/`#69C9CD` (`#3B7B7E` behind white text), rust `#9E3B1B`, script wordmark in
  `apps/portal/public/foxtail-*.png`, Gotham → Montserrat → system font. Colors live only in
  `apps/portal/src/index.css` tokens.

## Layout (npm workspaces)
- `packages/shared` — roles (`roles.ts`), coffee-shop counting config: area types, metrics, rules,
  targets, opening hours, validation (`counting.ts`). Build it before portal (`npm install` does this).
- `apps/portal` — React 19 + Vite 6 + Tailwind 3, deployed as a static site via nginx.

## API Contract
The Omni Foxtail API is documented in `docs/omni-foxtail-api.yaml` (OpenAPI 3.1). All endpoints
live under `/api/v1/auth/*` and `/api/v1/foxtail/*`. The portal expects the base URL configured
via `VITE_OMNI_API_BASE_URL`.

## Access model (enforced by Omni)
- Roles: `corporate_admin` (everything, the only role that changes settings/logins/POS uploads),
  `corporate_viewer` (all stores, read only), `franchise_owner` (only stores whose `franchisee_id`
  equals their own, read + downloads).
- Store scoping is enforced server-side: a store outside scope returns 404, indistinguishable from
  "does not exist". The portal never filters stores itself—it shows whatever the API returns.
- JWT Bearer auth; token in localStorage (`foxtail_token`).

## Cameras and video
- Camera list, status, and thumbnails come from the API (`/foxtail/stores/:siteId/cameras`).
- Live video: `camera.hlsUrl` points to Omni's HLS endpoint (when video mode is 'live').
- Thumbnails: `camera.thumbnailUrl` for the latest snapshot.
- Portal: `pages/Cameras.tsx` (all locations + camera wall), `components/CameraViews.tsx` (tile,
  hls.js player). CSP allows `media-src/worker-src blob:` for hls.js.

## Security / Alerts
- First nav item. Shows open alerts across all stores in scope with severity filtering.
- Camera health section shows online/offline status across stores.
- Corporate admins can acknowledge alerts with optional notes.

## Commands
- `npm run dev` — Vite dev server at http://localhost:5173. Set `VITE_OMNI_API_BASE_URL` in `.env`.
- `npm test` — shared unit tests. `npm run typecheck`, `npm run build`.

## Not done yet / decisions pending
- Deploy: Dockerfile builds nginx image; host, domain and deploy workflow need the owner's OK.
- POS upload is corporate-admin only (franchise owners read the comparison). Revisit if franchisees
  should upload their own POS exports.
