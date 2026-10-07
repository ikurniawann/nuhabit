# Deploying the Go API

The Go API runs on the same host as the Next container and serves every
`/api` route. Next stays the only public entry point: its proxy forwards the
routes in `frontend/src/lib/go-routes.generated.json` to `BACKEND_URL`. Unset
`BACKEND_URL` and Next serves every route from the TS handlers, which stay in
the codebase as the rollback path.

## Docker script (.gitlab/deploy-docker.sh)

One run does this, in order:

1. Builds the Next image and the API image while the old containers keep
   serving. The running images are tagged `:previous` first.
2. Applies pending migrations with the `migrate` binary from the new API
   image (`-apply`, under a Postgres advisory lock), then runs
   `migrate -verify` (see below). A failed migration or schema drift stops
   the deploy here, with the old containers untouched.
3. Replaces `<CONTAINER_NAME>-api`: uid 1001, `STORAGE_DIR` mounted at
   `/app/storage` (the uploads Next uses), `APP_ENV=production`,
   `PUBLIC_ORIGIN=http://<CONTAINER_NAME>:3000`, a 30 s stop timeout for the
   graceful shutdown, on the network `<CONTAINER_NAME>-net`. It waits for the
   image health check.
4. Replaces the Next container with `BACKEND_URL=http://<CONTAINER_NAME>-api:8080`
   and waits for `/login`.
5. Requests `/api/auth/me` through Next and looks for `X-Request-Id`, a header
   only Go sets. If the API was unhealthy or the proxy does not reach it, the
   script restarts Next without `BACKEND_URL` (TS serves everything) and exits
   1, so the pipeline shows the failure while the site stays up.

Both containers rotate their Docker logs (5 files of 50 MB). On SIGTERM the
API stops accepting connections, closes the desktop SSE streams at once (the
browsers reconnect to the new container) and gives other requests up to 20 s.

The host that builds the images needs at least 6 GB of memory for Docker:
`next build` peaked at 4.1 GB resident on a local run, and a Docker VM with
4 GB killed it.

| Variable | Default | Effect |
|---|---|---|
| `BACKEND_ENABLED` | `1` | `0` deploys Next alone and stops the API container (rollback). |
| `MIGRATE_ON_DEPLOY` | `1` | `0` skips migrations and the drift check. |
| `MIGRATE_VERIFY` | `1` | `0` skips the drift check only. |

The API reads the same env file as Next (`ENV_FILE`). It needs
`NEXT_PUBLIC_APP_URL` for payment callback and share links, plus the
integration keys Next uses (Xendit, WhatsApp gateway, Meta, OpenAI, VAPID).
At startup it logs one warning listing the integrations that stay off, as
Next does, and exits when `DATABASE_URL` is not a `postgres://` URL.

## Schema drift check

`migrate -verify` creates a scratch database on the target's server
(`nuhabit_verify_<random>`, dropped afterwards), replays every migration into
it and compares the two catalogs: schemas, tables, columns with type and
nullability, constraints, indexes, enums, and the bodies of views, functions
and triggers.

- `[missing]` and `[differs]` lines fail the check (exit 3). They mean a
  migration is recorded in `schema_migrations` but its effect is absent or was
  changed afterwards (a restored dump, a manual hotfix, an edited file).
- `[extra]` lines list objects only the target has. They do not fail it.
- Any other failure (exit 1), such as a role without `CREATEDB`, makes the
  deploy script print a warning and continue. Pass `-shadow <url>` with an
  empty database to run the check without `CREATEDB`.

Run it by hand against a copy of production before the first cutover:

```bash
MIGRATE_DATABASE_URL=postgresql://... go -C backend run ./cmd/migrate -allow-remote -verify
```

To fix drift, write a new delta migration that recreates the missing or
changed objects; never edit an applied file.

## Rollback

- Back to the TS handlers: redeploy with `BACKEND_ENABLED=0`.
- Back to the previous build without rebuilding, on the host:

  ```bash
  docker tag <image>:previous <image>:latest
  docker tag <image>-api:previous <image>-api:latest
  ```

  then `docker rm -f` both containers and rerun the `docker run` lines of the
  script, or rerun the deploy job for the previous commit.

Migrations do not roll back. The deltas from `20261004192000` on add objects,
widen checks and replace functions, so an older build keeps working on the
newer schema with one exception: `crm.crm_forms.default_source` now rejects
`'website'`, which builds from `development` before this branch send as the
default for a new form. Creating a public form fails on those builds until
they pick another source.

## Compose (ci-cd-template deploys)

CI pushes `$CI_REGISTRY_IMAGE_PUSH/api:<channel>` (jobs `build-api-*`). The
template's compose deploy does not run migrations; run them from the same
image before restarting the services:

```bash
docker run --rm --env-file /etc/arkiv/production.env \
  -e MIGRATE_DATABASE_URL=postgresql://... -e ALLOW_REMOTE_DB=1 \
  --entrypoint /usr/local/bin/migrate <registry>/<project>/api:production -apply
```

Add a service next to `arkiv` in the host's compose file:

```yaml
  arkiv-api:
    image: <registry>/<project>/api:production
    restart: unless-stopped
    user: "1001:65533"
    stop_grace_period: 30s
    env_file: /etc/arkiv/production.env
    environment:
      APP_ENV: production
      DATABASE_URL: postgresql://...      # same as arkiv
      STORAGE_DIR: /app/storage
      PUBLIC_ORIGIN: http://arkiv:3000    # Next serves public/
    volumes:
      - /srv/arkiv/storage:/app/storage   # same host dir as arkiv
    extra_hosts:
      - host.docker.internal:host-gateway
    logging:
      options: {max-size: 50m, max-file: "5"}
```

and on the `arkiv` service set `BACKEND_URL: http://arkiv-api:8080` (both
services share the compose network). The API exposes no host port.

`PUBLIC_ORIGIN` is where the API fetches Next's `public/` files, which ship
only in the Next image: the GoFood photo converter
(`/api/public/gofood-image/...`) reads a `/products/...` photo from
`PUBLIC_DIR` first and falls back to `PUBLIC_ORIGIN` over HTTP (that host
only, 10 s timeout, 15 MB cap). Without it, those photos answer 404.

## CI gates

`test-api` and `test-web` run in the `.pre` stage of every pipeline, before
the builds: gofmt, `go vet`, Go unit tests, the route manifest against
`go run ./cmd/api -routes`, then ESLint, `tsc` and Vitest. Go integration
tests need a seeded database and run locally with `make -C backend test`.

## Scaling

Several API replicas may run behind one `BACKEND_URL` (a load balancer or a
compose `deploy.replicas`): rate limits, live-interview signaling, interview
recording appends (an advisory lock per part file) and the outbox all
coordinate through Postgres. `MODULES=<names>` mounts a subset when one module
should run as its own service. Each replica opens its own pgx pool (default
size: the larger of 4 and the CPU count); set `pool_max_conns` in
`DATABASE_URL` to keep Next plus all replicas under the server's
`max_connections`.
