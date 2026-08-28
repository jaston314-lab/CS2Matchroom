# CS2 Matchroom

A small self-hosted app for organizing casual CS2 5v5s with friends, backed
by a CS2 dedicated server running [MatchZy Enhanced](https://github.com/sivert-io/MatchZy-Enhanced).

Steam-login players join a shareable room, self-organize into two teams,
ready up, and a host starts the match — which builds a MatchZy/Get5-style
JSON config, serves it to the CS2 server, and pushes an RCON
`matchzy_loadmatch_url` to load it. MatchZy's webhook system reports match
events back so the room page shows live score/map/connected players.

No ELO/ranking system, no brackets, single server only — this intentionally
does a lot less than MatchZy Auto Tournament (MAT).

## Stack

Next.js (App Router, TypeScript) + SQLite via Prisma + Tailwind — one
container, one volume. See [`CS2 Matchroom — Self-Hosted MatchZy Front-End`](.)
in the repo history / commit messages for the full design rationale if you
want it; the short version is in `src/lib/*` doc comments.

## Roles

- **Admin** — manage users/roles, view/manage all rooms, configure RCON +
  webhook settings.
- **Host** — create rooms, configure map pool/format/knife round/overtime,
  manage teams (captains, scramble, balance), run veto, start/cancel matches.
- **Player** — join a room by code/link, pick a team, ready up, watch live
  status.

Everyone logs in via Steam. **The first person ever to log in becomes
Admin** — no manual DB editing needed on a fresh install. An admin promotes
others to Host/Admin from `/admin/users`.

## Local development

```bash
npm install
cp .env.example .env
# fill in APP_SECRET (see the comment in .env.example for how to generate
# one) and STEAM_API_KEY (https://steamcommunity.com/dev/apikey)
npx prisma migrate dev
npm run dev
```

Open http://localhost:3000, sign in with Steam (you'll become admin), then
visit `/admin/server` to point the app at your CS2 server's RCON and save —
that also pushes `matchzy_server_id` / `matchzy_remote_log_url*` to the
server so its webhook events start flowing back here.

Run the unit tests (the map-veto sequencer, the team-balance algorithm, and
the match-config builder) with:

```bash
npm test
```

## Networking — read this before deploying

`APP_PUBLIC_URL` (set in `.env` and/or `/admin/server`) **must be an address
the CS2 server can reach**, not `localhost`. It's used two ways:

1. The RCON `matchzy_loadmatch_url <url>` command tells the CS2 server to
   *fetch* the match config from `<APP_PUBLIC_URL>/api/matchzy/config/...`.
2. `matchzy_remote_log_url` is set to `<APP_PUBLIC_URL>/api/matchzy/webhook`
   so the server can POST events back.

If the app and the CS2 server are both on your LAN, a LAN IP or hostname
(e.g. `http://192.168.100.50:3000`) works fine — they don't need to be
publicly reachable, just reachable from each other.

## Deploying with Docker / Portainer

```bash
cp .env.example .env   # fill in APP_SECRET, STEAM_API_KEY, APP_PUBLIC_URL
docker compose up -d --build
```

The SQLite database lives in a named volume (`data`, mounted at
`/app/data`) so it survives container recreation/redeploys. Migrations run
automatically on container start (see `docker-entrypoint.sh`).

To deploy via Portainer: point a Portainer **Stack** at this repo (or paste
`docker-compose.yml`), and set `APP_SECRET`, `STEAM_API_KEY`, and
`APP_PUBLIC_URL` as stack environment variables (same names as `.env`).

RCON host/port/password and the webhook shared secret don't need to be env
vars at all — set them once from `/admin/server` after the first deploy;
they're stored (RCON password encrypted) in the SQLite DB, editable anytime.

## Steam Web API key

Used only to fetch a player's display name/avatar on login
(`GetPlayerSummaries`). Get one at https://steamcommunity.com/dev/apikey —
the app still works without it, it just shows a generic "Player 1234" name.

## Rating / team balancing

"Balance teams" tries [Leetify's public API](https://api-public.cs-prod.leetify.com)
(`/v3/profile?steamId=...`) for each player's Premier rating first. If a
player has never used Leetify (or their profile is private), it falls back
to whatever rating they've entered on their own `/profile` page. Per
Leetify's API guidelines, that value is fetched fresh each time and never
stored in the DB — so it also won't show up cached/stale.
