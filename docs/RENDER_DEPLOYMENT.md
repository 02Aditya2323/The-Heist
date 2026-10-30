# Deploy the complete game on Render

The repository uses one Docker web service: built landing/game pages, artwork,
Fastify API, WebSocket sessions and a worker-owned SQLite file. Render terminates
TLS; browser API and `wss` URLs use the same public origin. See Render's
[Docker documentation](https://render.com/docs/docker),
[Blueprint specification](https://render.com/docs/blueprint-spec) and
[WebSocket documentation](https://render.com/docs/websocket).

## Deploy

1. Push the complete project, including the Dockerfile, lockfile, assets and
   `render.yaml`, to your chosen repository. Nothing in the local setup pushes it.
2. In Render, create a **Blueprint**, connect that repository and select the
   intended branch. Keep the repository root as the build context.
3. Review the single free Docker service. The blueprint uses `checksPass` so
   automatic deployments wait for CI. No custom build/start command is required:
   the Dockerfile builds and its `CMD` starts the server.
4. Retrieve `HEIST_ADMIN_PASSWORD` from the service environment. Sign in as
   `heist_owner`. A fresh world starts in the lobby; use Event Control to start it.
5. Verify `/`, `/game.html` and `/health`, then register two distinct players and
   confirm movement/nearby replication and reconnect on the public HTTPS URL.

For an existing Node service, create a new Docker service from this blueprint
rather than assuming synchronisation will change its runtime in place.

## Configuration

| Variable | Configuration |
| --- | --- |
| `PORT` | Provided by Render; Docker fallback is 10000 |
| `HOST` | `0.0.0.0` |
| `NODE_ENV` | `production` |
| `DATABASE_BACKEND` | `sqlite` |
| `DB_URL` | `sqlite:/app/data/heist.db` |
| `MAX_PLAYERS` | `60`, configured demo admission limit, not benchmark capacity |
| `DEBUG_ENDPOINTS` | `false` |
| `HEIST_ADMIN_USERNAME` | `heist_owner` |
| `HEIST_ADMIN_PASSWORD` | Generated private value; do not commit it |

Do not set a separate `EVENT_DB_PATH`, MongoDB URI or frontend API host. Keep one
instance: world state is in process and SQLite has a single-world ownership lease.
The image runs as the non-root `node` user and only `/app/data` needs to be writable.
SIGTERM reaches Node directly for the existing graceful drain/shutdown path.

The free demo deliberately accepts ephemeral storage and cold starts. A replacement
instance may lose accounts and round state. No persistent disk or external database
is required. The published local benchmark is not a free-instance capacity promise.

## Local Docker verification

The application build and essential tests were checked locally. Container build/run
and live Render HTTPS/WSS verification have not been performed in this pass.

```sh
docker build -t the-heist .
docker run --rm --name the-heist-preview -p 8080:10000 the-heist
# In another terminal:
curl --fail http://localhost:8080/health
```

To retain local data and provision an owner, put only runtime configuration in a
private `.env.docker` (including the two owner variables), then run:

```sh
docker run --rm --name the-heist-preview -p 8080:10000 \
  --env-file .env.docker -v heist-data:/app/data the-heist
```

Keep `PORT=10000` and `DB_URL=sqlite:/app/data/heist.db` in that file if specified.
Named volume initialization preserves the image directory ownership. Host bind
mounts require suitable permissions for UID 1000. Do not start two containers
against the same database; after a crash the 30-second lease may need to expire.

## CI policy

Automatic CI retains production builds, client type checking, shared tests, all
server regressions (including auth, authority and SQLite), and the fast dialog
visibility guard. It cancels superseded runs and caches npm downloads. The
separate manual Extended validation workflow retains bot tests, world rebuild and
reachability checks, UI/contract audits and historical deployment-tool tests.
The legacy Azure workflow stays manual and is unrelated to Render.

Docker builds do not run bot campaigns or tests again. They compile only the
shared/server/client workspaces and prune development dependencies. The runtime
stage copies compiled code, frontend assets, the authoritative map and production
dependencies; `.env`, local databases and raw benchmark fixtures are excluded.
