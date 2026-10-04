# Architecture

## Goal

Move the ~850 Next.js API routes to Go without the frontend noticing. A route
moves when its Go handler returns the same status, JSON and messages as the
TypeScript one, proven by an integration test against a real database. Then
its prefix joins `GO_BACKEND_PREFIXES` in `frontend/src/lib/backend-routes.ts`
and the Next proxy rewrites matching requests to `BACKEND_URL`. The TypeScript
route stays until the Go one has run in production; rollback is removing the
prefix.

## Request path

```
browser -> Next proxy (frontend/src/proxy.ts)
             |-- path matches GO_BACKEND_PREFIXES and BACKEND_URL set
             |      -> NextResponse.rewrite(BACKEND_URL + path + query)
             |           -> Go: request id -> access log -> recover -> auth.Gate -> ServeMux -> module handler
             '-- otherwise -> updateSession (Next auth gate) -> TS route
```

The rewrite happens before the Next auth gate, so `auth.Gate` reproduces it for
`/api/*`: session cookie validated against `auth.sessions` (a DB error fails
closed with 503), Open API Bearer tokens verified by scope and audited (a bad
token is 401 `Token tidak valid atau scope tidak mengizinkan`, even on public
paths), and any other non-public path without a session is 401
`Authentication required`. `auth.PublicAuthPrefixes` mirrors
`PUBLIC_AUTH_PREFIXES`; a test fails when they drift.

Next buffers proxied request bodies up to 10 MB (`proxyClientMaxBodySize`).

## Layers

```
internal/platform   shared kernel, no business rules
  config            env + dotenv loading
  database          pgxpool with the TS search_path and timezone, Querier,
                    WithTx (pool or tx; nested = savepoint), pg error helpers
  httpx             Handle, JSON, Data, DecodeJSON, Error, middleware
  auth              staff session, API token, IAM guards, gate, member session
  iam               generated menu prefixes + pure matchers
  members           shared read of member display fields (pos.pos_customers)
  module            Deps, Route, Module
  testutil          DB, Tx, Deps, CreateStaff, CreateMember, Request, Do
internal/modules/<context>
  domain/           pure Go rules, unit tested, no DB or HTTP
  service.go        use cases; declares Repository and ports as interfaces
  postgres.go       Repository on pgx with SQL ported from the TS route
  http.go           parse, validate, call the service, write JSON
  module.go         New(module.Deps) module.Module
internal/app        the only package that imports every module
```

Dependencies point inward: `http.go -> service.go -> domain`, and
`postgres.go` implements an interface `service.go` owns.

## Module rules

1. **Rules live in `domain`.** Money, quotas, eligibility, state transitions.
   Pure functions with table tests. Handlers and repositories hold no rules.
2. **A module touches only its own tables.** When it needs data from another
   context, it declares a small interface (a port) in its own package and
   `internal/app` passes an adapter. Identity and IAM reads go through
   `platform/auth` only.
3. **Only `internal/app` knows every module.** Modules never import each other.
4. **Parity first.** Same SQL semantics as the TS route, same response field
   names and order, `null` vs missing exactly as the TS writes it, numbers vs
   numeric strings as `pg` returns them (`numeric` and `bigint` arrive as
   strings in node-postgres; `int4` and `float8` as numbers; `timestamptz` and
   `date` as JS Dates, serialized by `toISOString`, so use `httpx.JSTime`).
   The TS pool sets no type parsers, so a `date` column comes out as local
   midnight in UTC form (`2026-10-04T00:00:00.000Z` on a UTC server). Use structs, not maps, when key order matters: `httpx.Data`
   writes `{"success":true,"data":...}` in the TS order.
5. **Errors.** Return `*httpx.Error` for expected failures with the TS status
   and message. PostgreSQL constraint errors map to the same 4xx as
   `frontend/src/lib/api/handler.ts`. Anything else is logged and becomes 500
   `Terjadi kesalahan server`. Member portal routes use
   `deps.Auth.MemberHandler(failMessage, ...)`, which renders the
   `withMemberSession` 401 and 500 bodies.
6. **Time.** Calendar logic uses Asia/Jakarta. Take the clock from `Deps.Now`
   so tests can pin it.

## Adding a module

1. Create `internal/modules/<context>/` with the files above. `module.go`
   exports `const Name = "<module-name>"` and `New(deps module.Deps) module.Module`.
2. Register it in `internal/app/module_<context>.go`:

   ```go
   package app

   import "nuhabit/backend/internal/modules/<context>"

   func init() { Register(<context>.Name, <context>.New) }
   ```

3. Write `*_integration_test.go` with `testutil.Deps`, `testutil.Mux`,
   `testutil.CreateStaff` (grants IAM menus through a throwaway role) and
   `testutil.CreateMember`. Assert the exact TS bodies.
4. Add the path prefix to `GO_BACKEND_PREFIXES` once every route under it is
   ported. A prefix matches whole segments, so `/api/gym` does not catch
   `/api/gymnastics`.

`internal/modules/identity` (`GET /api/auth/me`) is the smallest worked example.

## Splitting a module into its own service

1. **Run it separately.** No code change: `MODULES=gym-credits ./api` mounts
   only that module; a second process runs `MODULES=identity,gym-scheduling`.
   Point the Next proxy (or an ingress) at each process by prefix. Both still
   share the database, so nothing becomes eventually consistent yet.
2. **Move its tables.** Rule 2 guarantees no other module queries them, so the
   schema can move to its own database.
3. **Swap in-process ports for clients.** Where another module consumed this
   one through a port, write an HTTP client that satisfies the same interface
   and change the wiring in `internal/app`. Module code does not change.
4. **Decide what stops being atomic.** Any use case that wrote both modules in
   one transaction must either move to the outbox below or keep the two
   modules in one process.

## Cross-module events: outbox plan

Not built yet; this is the agreed shape for the first cross-module side effect.

- Table `platform.outbox_messages(id uuid, topic text, payload jsonb,
  created_at, available_at, attempts int, delivered_at)`, created by a regular
  migration in `database/migrations/deltas`.
- A module publishes by inserting a row **inside the same transaction** as the
  state change (`database.WithTx`), so the message exists exactly when the
  change committed.
- A dispatcher in `cmd/api` claims rows with `FOR UPDATE SKIP LOCKED`, calls
  the subscribers registered in `internal/app`, sets `delivered_at`, and backs
  off on failure. Several replicas can run it without double delivery.
  Subscribers must be idempotent (key on the message id).
- After a split the dispatcher publishes to a queue instead of calling a
  function. Publishers do not change.

## IAM prefixes

`internal/platform/iam/prefixes_gen.go` is generated from
`frontend/src/lib/iam/prefixes.ts` (`go generate ./internal/platform/iam`).
Each TS key becomes an exported `[]string`, e.g. `iam.GymPackages`. Guards take
them variadically: `deps.Auth.RequireMenuPrefix(r, iam.GymPackages...)`.

## Migrations

`cmd/migrate` is a port of `database/scripts/apply-migrations.js`: every
`*.sql` under `database/migrations` (any depth), unique basenames, ordered by
the leading digits of the basename then the name, one transaction per file,
recorded in `public.schema_migrations(filename, applied_at, checksum)`. The dry
run is read-only. Non-local targets need `-allow-remote` or `ALLOW_REMOTE_DB=1`.
The Node runner and the Go runner share the table, so either can be used.
