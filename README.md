# Foxtail

Store performance for Foxtail Coffee Co. Foxtail turns the cameras already in each store into
business numbers: customers entered, line length, wait time, front-counter staffing, and traffic
compared with register sales.

- **Corporate**: all stores side by side, totals, worst-performing hours, and all settings.
- **Franchise owners**: their own stores only, plus report downloads.

Foxtail stores counts only. It keeps no recordings and identifies no one.

## Run it locally

Requires Node 20+. For recorder tests, also install ffmpeg/ffprobe.

```sh
npm install
npm run dev            # embedded Postgres + API (:3001) + portal (http://localhost:5173)
npm run user:create -w @foxtail/api -- --email you@example.com --name "Your Name"
```

Sign in with the temporary password it prints; you'll be asked to choose your own. Then:

1. Add franchisees, stores and logins.
2. On each store, connect its recorder and cameras under **Settings**.
3. Draw the counting areas and turn counting on.

Counting also needs `ROBOFLOW_API_KEY` and `PERSON_MODEL_ID` (see `.env.example`).

## Checks

```sh
npm run typecheck
npm test               # uses a throwaway embedded Postgres; CI uses a Postgres service
npm run build
```

See `CLAUDE.md` for how the parts fit together and the rules the project follows.
