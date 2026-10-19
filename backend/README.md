# NüHabit backend (Go)

The Go modular monolith that serves the NüHabit API. Each route kept the
TypeScript HTTP contract byte for byte when it moved: same method, path,
status codes, JSON shape and messages. The Next proxy forwards every method
and path this service registers to `BACKEND_URL`
(`frontend/src/lib/backend-routes.ts`). Next has no handler for those routes,
so with `BACKEND_URL` unset they answer 503.

`database/` holds the SQL migrations and Node seeders. They remain the source
of truth for the schema.

## Quick start

```bash
backend/database/scripts/local-pg.sh init    # own Postgres 17 cluster on :55432 (see the script for the seeders)
cp backend/.env.example backend/.env.local   # local Postgres on :55432
pnpm db:migrate                              # dry run: "Semua migrasi sudah diterapkan."
pnpm db:migrate:apply                        # apply pending files
pnpm backend:dev                             # API on :8080
curl localhost:8080/health
curl localhost:8080/ready
```

For a demo of the public site and /apparel, seed sample branches, classes,
content and product images from `backend/`:
`node database/seeders/run-sql-file.js database/seeders/site-demo.sql` (safe to re-run).

Local development needs the API: set `BACKEND_URL=http://localhost:8080` in
`frontend/.env.local`, or every Go route answers 503.

From `backend/` the Makefile wraps the same commands: `make run`, `make test`,
`make lint`, `make migrate`, `make migrate-apply`, `make generate`, `make docker`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | `MIGRATE_DATABASE_URL` | runtime pool |
| `MIGRATE_DATABASE_URL` | `DATABASE_URL` | migration target |
| `ALLOW_REMOTE_DB` | unset | `1` lets `cmd/migrate` touch a non-local host (same as `-allow-remote`) |
| `PORT` | `8080` | HTTP port |
| `MODULES` | `all` | `all` or a comma list of module names to mount |
| `APP_ENV` | `development` | `production` disables the member OTP dev bypass (`NODE_ENV=production` counts too) |
| `TZ` | `Asia/Jakarta` | process zone; the pool also forces `timezone=Asia/Jakarta` per session |
| `LOG_LEVEL` | `info` | slog level; logs are JSON on stdout |
| `METRICS_ADDR` | unset | listen address of the internal Prometheus `/metrics` server (see `docs/DEPLOY.md`); unset serves none |
| `TEST_DATABASE_URL` | unset | enables integration tests |

Values come from the shell first, then `backend/.env.local`, then `backend/.env`.

## Layout

```
cmd/api           HTTP server: /health, /ready, modules, graceful shutdown
cmd/migrate       port of database/scripts/apply-migrations.js
internal/app      module registry and wiring (module_<name>.go per module)
internal/migrate  migration runner
internal/platform config, database, httpx, auth, iam, module, testutil
internal/modules  one package tree per bounded context
database/         SQL migrations and Node seeders (unchanged)
docs/ARCHITECTURE.md
```

## Endpoints owned by the platform

- `GET /health` returns `{"status":"ok","uptime_s":N}` without touching the
  database, like `GET /api/health` in Next. Use it for liveness.
- `GET /ready` returns 200 `{"status":"ready","database":"ok","latency_ms":N}`
  when `SELECT 1` answers within 2 s, else 503 with `"error"`. Use it for
  readiness.
- `GET /api/auth/me` (module `identity`) is the first ported route and
  exercises the whole auth stack.

## Modules

| Module (`MODULES` name) | Routes | Owns |
| --- | --- | --- |
| `identity` | 1 | `GET /api/auth/me` |
| `gym-credits` | 17 | class packages, credit ledger, credit rules, member credit purchases |
| `gym-scheduling` | 29 | class types, coaches, sessions, bookings, check-in, member class catalog |
| `gym-training` | 30 | exercises, HYROX workouts and sessions, races, coach incentives and payouts |
| `athlete` | 30 | member app train tab (activities, feed, clubs, challenges, gear) and home settings |
| `member-portal` | 46 | member OTP sign-in, profile, inbox, push, top-up, engagement, collectibles, app home |
| `pos-sales` | 39 | orders, multi-stall checkout, QRIS, KDS, print jobs, supervisor PIN, GoFood, table order |
| `pos-ops` | 46 | shifts, tables, reservations, POS catalog, customers, dashboard, reports, POS settings |
| `stored-value` | 59 | ARK wallet, top-up, member cards and bills, refunds, gift cards, promo and offers |
| `procurement` | 97 | purchase requests and orders, GRN, QC, deliveries, returns, vendors, payables reports |
| `inventory` | 84 | stock, movements, opnames, transfers, item masters, COGS estimates and landed costs |
| `production` | 25 | production orders, BOM lines, multi-level BOM explosion, material issue, WIP, batch receipts with scrap, batch HPP |
| `accounting` | 61 | chart of accounts, journals, fiscal periods, AP/AR, cash-bank, reports, finance |
| `hris` | 82 | employees, attendance, leave, shifts, overtime, contracts, onboarding, announcements, master data |
| `payroll` | 62 | payroll runs, payslips, salary, loans, KPI, performance reviews, feedback, department tasks |
| `recruitment` | 61 | candidates, psikotes, interviews, offers, job openings, positions, promotion |
| `crm` | 128 | loyalty and XP, members, campaigns, segments, inbox, approvals, workflow rules, reports |
| `ticketing` | 56 | bookings, gate taps, visits, season and staff passes, capacity, channels |
| `files` | 1 | `GET /api/files/{bucket}/{path...}`: public buckets, member-owned photos, staff-only buckets |

The Next app forwards a request to Go when Go registers that method and path
(`frontend/src/lib/go-routes.generated.json`, refreshed by `make generate`).
A Go route never falls back to a TypeScript handler, and
`frontend/src/lib/backend-routes.test.ts` fails when a Next `route.ts` shadows
one. Next keeps three routes of its own: `/api/health` and `/api/ready` probe
the Next container, and `/api/openapi.json` serves the OpenAPI document
committed in the frontend.

## Tests

```bash
cd backend
go vet ./... && gofmt -l .
TEST_DATABASE_URL=postgres://postgres@localhost:55432/nuhabit go test ./... -count=1
```

Integration tests create their own users, sessions, IAM roles and members
through `internal/platform/testutil` and delete them in `t.Cleanup`, so the
local development database is a safe target. Without `TEST_DATABASE_URL` they
skip.

Two drift tests read the frontend source and fail when it changes without the
Go side following: IAM prefixes (`frontend/src/lib/iam/prefixes.ts`, fix with
`make generate`) and the public path list of the auth gate
(`frontend/src/lib/auth/middleware.ts`).

## Container

```bash
docker build -t nuhabit-api backend
docker run --rm -p 8080:8080 -e DATABASE_URL=... nuhabit-api
docker run --rm -e MIGRATE_DATABASE_URL=... -e ALLOW_REMOTE_DB=1 --entrypoint /usr/local/bin/migrate nuhabit-api -apply
```

The runtime image is Debian slim with the `tesseract` CLI (eng and ind) for
OCR, running as `nonroot`. It has no curl, so the Docker `HEALTHCHECK` runs
`api -healthcheck`, which calls the local `/health`. Kubernetes and load balancers should probe `/health` and
`/ready` over HTTP instead.
