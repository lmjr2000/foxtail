# Foxtail

Store performance dashboard for Foxtail Coffee Co. This frontend application displays business
metrics from in-store cameras: customers entered, line length, wait time, front-counter staffing,
security alerts, and traffic compared with register sales.

- **Corporate**: all stores side by side, totals, worst-performing hours, and all settings.
- **Franchise owners**: their own stores only, plus report downloads.

Foxtail stores counts only. It keeps no recordings and identifies no one.

## Architecture

This is a **frontend-only** application. It calls the Omni Foxtail API (Eye of Omni's backend)
for all data. The API contract is documented in `docs/omni-foxtail-api.yaml`.

The portal is built with React 19 + Vite 6 + Tailwind 3 and deployed as a static site.

## Run it locally

Requires Node 20+.

```sh
npm install
npm run dev            # Vite dev server at http://localhost:5173
```

Set `VITE_OMNI_API_BASE_URL` in `.env` to point to your Omni backend:

```sh
VITE_OMNI_API_BASE_URL=https://omni.example.com/api/v1
```

## Build for production

```sh
npm run build          # outputs to apps/portal/dist/
```

The `Dockerfile` builds an nginx image serving the static files.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

See `CLAUDE.md` for the project structure and rules.
