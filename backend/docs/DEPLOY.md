# Deploying the Go API

The Go API runs on the same host as the Next container and owns every route
in `frontend/src/lib/go-routes.generated.json`. Next stays the only public
entry point: its proxy forwards those routes to `BACKEND_URL`. The Next image
has no TypeScript handler for them, so with `BACKEND_URL` unset they answer
503. Next serves only the `/api` routes Go does not register, such as
`/api/health`, `/api/ready` and `/api/files/...`.

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
   only Go sets. If the new API is unhealthy or the proxy does not reach it,
   the script starts the `:previous` API and Next images (the pair from the
   last deploy) and exits 1, so the pipeline shows the failure while members
   keep the last working build. Without `:previous` images, or when the old
   API is unhealthy too, Next runs without `BACKEND_URL` and every Go route
   answers 503 until you fix it (see Rollback).

Both containers rotate their Docker logs (5 files of 50 MB). On SIGTERM the
API stops accepting connections, closes the desktop SSE streams at once (the
browsers reconnect to the new container) and gives other requests up to 20 s.

The host that builds the images needs at least 6 GB of memory for Docker:
`next build` peaked at 4.1 GB resident on a local run, and a Docker VM with
4 GB killed it.

| Variable | Default | Effect |
|---|---|---|
| `BACKEND_ENABLED` | `1` | `0` deploys Next alone and stops the API container. Every Go route then answers 503, so this is no rollback. |
| `MIGRATE_ON_DEPLOY` | `1` | `0` skips migrations and the drift check. |
| `MIGRATE_VERIFY` | `1` | `0` skips the drift check only. |

The API reads the same env file as Next (`ENV_FILE`). It needs
`NEXT_PUBLIC_APP_URL` for payment callback and share links, plus the
integration keys Next uses (Xendit, WhatsApp gateway, Meta, OpenAI, VAPID).
At startup it logs one warning listing the integrations that stay off, as
Next does, and exits when `DATABASE_URL` is not a `postgres://` URL.

Gym pass renewals:

| Variable | Default | Effect |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` (or `NEXT_PUBLIC_BASE_URL`) | none | Where Xendit sends members back after paying a renewal invoice. Any renewal can fall back to an invoice, so with auto-renewing passes and neither set, the renewal job logs an error at startup and on every run, counts `gym_credits_alerts_total{reason="renewal_invoice_no_app_url"}` and leaves the renewals for a later run instead of opening invoices. |
| `XENDIT_SAVED_METHODS_ENABLED` | off | `1` lets members save a card or e-wallet (Metode pembayaran) and pick it for auto-renew. Needs the Xendit gateway active in Settings → Payment Gateways and the Payments API webhooks pointed at `/api/payments/xendit/webhook`; with the flag on and no active gateway the job logs an error and counts `reason="saved_methods_gateway_inactive"`. See [XENDIT_SAVED_METHODS.md](XENDIT_SAVED_METHODS.md). |
| `XENDIT_SAVED_METHOD_CHANNELS` | all | Comma list of Xendit channel codes the hosted linking page offers, e.g. `CARDS,OVO,DANA,SHOPEEPAY`. |

## Metrics

Set `METRICS_ADDR` (in `ENV_FILE`, or `environment:` for compose) and the
API serves Prometheus text-format metrics at `GET /metrics` on that address,
a second listener next to `PORT`. The main port never serves `/metrics`, and
the Next proxy forwards only API routes, so the public site cannot reach it.
The metrics listener has no auth: access control is where it binds.

- Docker script or compose: `METRICS_ADDR=:9090` and no `-p`/`ports:` for
  it. A Prometheus container on the network `<CONTAINER_NAME>-net` (compose:
  the compose network) scrapes `<CONTAINER_NAME>-api:9090`.
- Prometheus on the host instead: publish it on loopback only,
  `-p 127.0.0.1:9090:9090`, and scrape `127.0.0.1:9090`.
- Unset (the default): no listener, no metrics.

A taken or invalid address stops the API at startup.

```yaml
scrape_configs:
  - job_name: nuhabit-api
    static_configs:
      - targets: ["arkiv-api:9090"]
```

| Metric | Type | Labels |
|---|---|---|
| `http_requests_total` | counter | `route`, `method`, `status` |
| `http_request_duration_seconds` | histogram (5 ms to 30 s) | `route`, `method`, `status` |
| `http_requests_in_flight` | gauge | none |
| `pgxpool_acquired_conns`, `_idle_conns`, `_constructing_conns`, `_total_conns`, `_max_conns` | gauge | none |
| `pgxpool_acquires_total`, `_empty_acquires_total`, `_canceled_acquires_total`, `_acquire_duration_seconds_total`, `_empty_acquire_wait_seconds_total`, `_new_conns_total`, `_max_lifetime_destroys_total`, `_max_idle_destroys_total` | counter | none |
| `go_goroutines`, `go_memstats_heap_alloc_bytes`, `go_memstats_sys_bytes`, `go_gc_heap_goal_bytes`, `go_sched_gomaxprocs_threads` | gauge | none |
| `go_gc_cycles_total` | counter | none |
| `job_runs_total`, `job_failures_total`, `job_skipped_total` | counter | `job` |
| `job_last_success_timestamp_seconds` | gauge | `job` |
| `job_duration_seconds` | histogram (50 ms to 5 min) | `job` |
| `gym_credits_alerts_total` | counter | `reason` |

`route` is the ServeMux pattern without its method (`/api/crm/members/{id}`),
or `unmatched` for 404 and 405 answers, so ids never become label values.
`method` is the HTTP method, or `OTHER` for nonstandard ones. `status` is the
class: `2xx`, `3xx`, `4xx`, `5xx`. Requests the auth gate rejects count under
the route they asked for. SSE streams count once, when they end, with their
full duration; leave `route="/api/desktop/stream"` out of latency alerts.

Useful queries:

```promql
sum by (route) (rate(http_requests_total{status="5xx"}[5m]))
histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))
pgxpool_acquired_conns / pgxpool_max_conns
rate(pgxpool_empty_acquire_wait_seconds_total[5m])
increase(job_failures_total[1h]) > 0
increase(gym_credits_alerts_total[1h]) > 0
time() - max by (job) (job_last_success_timestamp_seconds) > 3 * 3600
```

The `job_*` series count this replica only: `job_runs_total` and the
last-success gauge stay flat on a replica whose ticks the others won
(`job_skipped_total` grows instead), so aggregate with `max by (job)` or
`sum by (job)` across replicas.

## Background jobs

The API runs periodic jobs next to the outbox dispatcher. Each mounted module
registers its own jobs in `internal/app/module_<name>.go`
(`RegisterJob(...)`), so `MODULES` decides which jobs a process runs.

| Job | Every | Work |
|---|---|---|
| `gym-credits.purchase-reconcile` | 2 min | Asks Xendit about QRIS, invoice and saved-method purchases still pending after a minute, settles paid ones, closes expired or failed ones. |
| `gym-credits.pass-renewals` | 1 h | Buys the next pass of auto-renewing passes inside `renewalLeadDays` (ARK Coin, saved method or invoice), retries failed or expired renewal payments `renewalRetryCount` times `renewalRetryHours` apart until `renewalGraceDays` after the pass ends, then turns auto-renew off. |
| `gym-credits.reminders` | 1 h | Credit expiry and pass expiry reminders (`expiryReminderDays`), low-balance nudges (`lowBalanceThreshold`). |
| `gym-scheduling.class-reminders` | 5 min | Reminds booked members `classReminderMinutes` before class, unless they turned off booking reminders in the member app. |

- Replicas: a job takes a Postgres advisory lock for the length of a run and
  starts only when its last start (`platform.job_runs`) is at least one
  interval old, so N replicas run each job about once per interval between
  them. `platform.job_runs` also keeps the last error and the last success.
- Reminders are claimed in `platform.reminder_sends` (kind, subject, period)
  in the transaction that writes them, so a rerun never sends twice.
- `JOBS_ENABLED=false` (or `0`, `off`, `no`) stops a replica from running
  jobs; the default is on. Keep it on for at least one replica that mounts
  the gym modules, or purchases stay pending until the member polls and no
  reminder goes out.
- A failed run is logged (`job failed`) and retried on the next tick.

Gym notifications (bookings, waitlist, class changes, check-in, reminders)
land in the member inbox and go out through the outbox to web push
(`VAPID_*`), WhatsApp (any configured provider: `services/wa-gateway`, Meta
or Fonnte) and email (Resend, when `RESEND_API_KEY` and `GYM_FROM_EMAIL` or
`FROM_EMAIL` are set). Members turn WhatsApp and email off in the member app
settings. A delivery failure is logged and never fails the booking or
the job.

## Member sign-in and self sign-up

The Go API decides at runtime whether members can use codes (OTP): self
sign-up, code sign-in, Google sign-in for members without an account and
forgot-password by code. `GET /api/member-portal/config` reports the answer
(`otp_enabled`, `otp_channels`) and the member app, the table order sheet and
the public `/join` checkout read it on load. No rebuild is needed when a
channel is added or removed.

Codes are on when at least one channel is configured:

| Channel | What to configure |
|---|---|
| WhatsApp (preferred) | One provider, the same setup gym notifications use: Meta Cloud API (`META_WA_ACCESS_TOKEN` and `META_WA_PHONE_NUMBER_ID`, with an approved `otp_login` authentication template or `META_WA_OTP_TEMPLATE`), the `services/wa-gateway` token (`WA_GATEWAY_TOKEN`, or `wa_gateway_token` in the dashboard settings, with `WA_GATEWAY_URL` when not the default), or `FONNTE_API_KEY`. `WHATSAPP_PROVIDER` pins one. |
| Email (fallback) | `RESEND_API_KEY` plus a sender in `GYM_FROM_EMAIL` or `FROM_EMAIL` on a domain verified in Resend. Codes then go to the email typed at sign-up or the one on the account; a member without an email gets a 409 and signs in with a password. The public `/join` checkout speaks WhatsApp only, so on an email-only setup it sends new members to the front desk; the member app sign-up works. |

To open self sign-up in production:

1. Configure one channel above in the API container's env (`RUNTIME_CONFIG_CONTENT`).
2. Remove `OTP_ENABLED=false` from the API env and `NEXT_PUBLIC_OTP_ENABLED=false`
   from the build env. Both now only force codes off; `NEXT_PUBLIC_OTP_ENABLED`
   is inlined at `next build`, so dropping it needs a new image.
3. Check `GET /api/member-portal/config` answers `"otp_enabled": true`.

| Variable | Read by | Effect |
|---|---|---|
| `OTP_ENABLED` | Go API, at runtime | `false` keeps member codes off whatever is configured: the OTP routes answer 503. `true` also enables dataroom email verification. Empty or unset leaves member codes to the channels. |
| `NEXT_PUBLIC_OTP_ENABLED` | Next, at `next build` | `false` hides sign-up and code sign-in in this build. `true` also enables dataroom email verification in the UI. |

Abuse limits on code sends: 3 per number per 10 minutes, 10 per number per
day, 30 per network (IP) per 10 minutes and 200 per network per day, plus 5
attempts per code. The per-network and per-number counters live in
`platform.rate_limits`, shared by every replica.

With codes off, members sign in with username (WhatsApp number or email) and
password only. The fallback is the staff reset:
`POST /api/crm/members/{id}/password` (IAM menu `crm.members`, action
`update`) from the member detail page generates a password, ends the
member's sessions, writes an audit row and shows the password once or sends
it by WhatsApp. Members can change their own password afterwards
(`PUT /api/member-portal/password`).

## Go-live checklist

Before the first production cutover, on the production database (or the
copy that becomes it), in this order. [DATA_SETUP.md](DATA_SETUP.md) has
the detail of each step.

1. Migrations applied and `migrate -verify` clean (steps 2 of the deploy
   script, or by hand as below).
2. IAM seeded: `database/seeders/iam-menus.sql`, `iam-role-permissions.sql`
   and `iam-admin-permissions.sql`, then the first super admin
   (`database/seeders/super-admin.js`).
3. Demo content removed: `go run ./cmd/demo-data -remove -dry-run
   -allow-remote` against the target, read the kept rows and their
   reasons, then run it without `-dry-run`. Do this before the real data
   goes in, so nothing real references a demo row by then. Demo accounts
   from `cmd/demo-users` (`demo-*@nuhabit.test`) must not exist on
   production; disable them in Manajemen User if a copy of a demo
   database was promoted.
4. Real data entered in the order of DATA_SETUP.md: companies and branches
   (with their time zones), departments and positions, login accounts and
   employees, class types and coaches, schedule templates (then `Generate
   sekarang`), packages, members with their opening balances. Each import
   writes an `audit.audit_log` row, so the audit page shows who loaded
   what.
5. Gym rules reviewed (Gym > Aturan Gym): credit expiry, cancellation
   deadline, booking window, schedule horizon, `defaultCompanyId`.
6. Deferred revenue of packages sold before the gym journals existed:
   `cmd/gym-opening-balance -dry-run`, then for real
   ([GYM_OPENING_BALANCE.md](GYM_OPENING_BALANCE.md)).
7. A backup taken ([BACKUP.md](BACKUP.md)) once the data is in, before
   members start booking.

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

## Backups

The deploy does not back up the database. `backend/database/scripts/backup.sh`
writes a daily `pg_dump` on the database host and copies it off-host, and
`restore-check.sh` proves each week that the newest dump restores. Set them
up once per host with [BACKUP.md](BACKUP.md), which also holds the restore
runbook. Take a manual dump before a deploy that carries a risky migration:
migrations do not roll back.

## Rollback

Rollback means running the previous Go image. The TypeScript handlers for Go
routes are gone, and `BACKEND_ENABLED=0` leaves those routes answering 503.
Step 1 of the script tags the running images `:previous` before it builds, so
the last good build stays on the host. The script rolls back on its own when
the new API fails its health check or the proxy check (step 5); the steps
below are for a build that deployed cleanly and misbehaves later.

- Previous API only, on the host:

  ```bash
  docker tag <image>-api:previous <image>-api:latest
  ```

  then `docker rm -f <CONTAINER_NAME>-api` and rerun the API `docker run` line
  of the script. Next keeps its `BACKEND_URL`. A route that only the newer
  build registers answers 404 from the older API.
- Previous API and Next: also run `docker tag <image>:previous <image>:latest`,
  remove both containers and rerun both `docker run` lines.
- Or rerun the deploy job for the previous commit, which rebuilds both
  images.

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
`go run ./cmd/api -routes`, then every migration applied to an empty
Postgres 17 service and `migrate -verify` against it, then ESLint, `tsc` and
Vitest. The GitHub workflow runs the same migration replay and drift check
before its Go tests. Go integration tests need a seeded database and run
locally with `make -C backend test`.

## Scaling

Several API replicas may run behind one `BACKEND_URL` (a load balancer or a
compose `deploy.replicas`): rate limits, live-interview signaling, interview
recording appends (an advisory lock per part file) and the outbox all
coordinate through Postgres. `MODULES=<names>` mounts a subset when one module
should run as its own service. Each replica opens its own pgx pool (default
size: the larger of 4 and the CPU count); set `pool_max_conns` in
`DATABASE_URL` to keep Next plus all replicas under the server's
`max_connections`.
