# `/api/db/query` allowlist

`createBrowserClient()` (`src/lib/pg/browser-client.ts`) sends every `db.from(...)` call to `POST /api/db/query`. Before this change the route ran any spec from any logged-in staff user. It now runs through `src/lib/pg/query-policy.ts`, which denies by default.

The `db.auth.*` methods do not use these routes. They call `/api/auth/login`, `/api/auth/me` and `/api/auth/logout`, and the policy does not touch them.

## How the route decides

1. No session: 401.
2. The route resolves a bare table name (schema `public` or missing) to its real schema with `to_regclass(quote_ident(table))` on the pool's `search_path`. It then runs the query with that schema, so the table it checks is the table it executes.
3. It reads the caller's role from `configuration.users` and the granted IAM menu codes from `loadGrantedMenuCodesForUser`.
4. `evaluateDbQuery` returns allow (plus filters to inject) or deny. Deny returns 403 `{ data: null, error: { message: "Query not permitted", code: "DB_QUERY_FORBIDDEN" } }` and logs `console.warn("[api/db/query] denied", { userId, schema, table, action, reason })`.

Hard rules that apply before the allowlist lookup:

- `auth.*`, `pg_catalog.*` and `information_schema.*` are refused for every action and every role.
- Writes to `iam.*` and `configuration.users` are refused for every role.
- Schema and table names must match `^[A-Za-z_][A-Za-z0-9_]*$`.
- Filter operators must come from a fixed list (`=`, `<>`, `>`, `>=`, `<`, `<=`, `LIKE`, `ILIKE`, `IS`, `IN`, `@>` and their `NOT` forms). `QueryBuilder` writes the operator into SQL as raw text, so before this change a client could inject SQL through `filters[].op`.
- `update` and `delete` need at least one filter.
- An embed in `select` or `returningSelect` (`brands(name)`, `alias:table!fk(...)`) must be listed under the parent table's `embeds`, and the caller must be able to read the target table. A part that contains parentheses but does not parse as an embed is refused.
- `super_admin` skips the IAM prefix check for `select` on allowlisted tables only. Writes, unlisted tables and `auth.*` stay refused (`SUPER_ADMIN_READ_BYPASS` in the policy file).

## Allowlist

| Table (resolved) | Actions | IAM prefixes | Embeds |
| --- | --- | --- | --- |
| `recruitment.candidates` | select, insert, update, delete | `hris.recruitment` | `brands` -> `item.brands`, `positions` -> `hris.positions` |
| `recruitment.candidate_activities` | select | `hris.recruitment` | none |
| `recruitment.candidate_notes` | select | `hris.recruitment` | none |
| `item.brands` | select | `hris.recruitment` | none |
| `hris.positions` | select | `hris.recruitment` | `brands` -> `item.brands` |
| `hris.departments` | select | `hris.organization`, `hris.master` | none |
| `configuration.users` (own row) | select | none (any staff session) | none |

`configuration.users` self-row reads: the server appends `id = <session user id>` to the filters. The select list must name columns from `id, full_name, role, email, brand_id, status, company_id, branch_id`. `*`, embeds and `pos_pin` are refused.

`/api/db/rpc` was removed on 2026-10-04: no client called `db.rpc`.

## Client inventory (2026-10-04)

Only two callers remain, both reading the caller's own `configuration.users` row: `src/app/(auth)/login/page.tsx` (`role`) and `src/features/os-desktop/hooks/use-desktop-account.ts` (`full_name, role`). `/api/auth/me` returns both fields, so moving these two to it retires the browser client and this route. The HRIS rows in `DB_QUERY_POLICY` have no caller left and can go with it.

## Client inventory (2026-10-03, historical)

Static scan of every import of `@/lib/pg/browser-client` (and its deprecated re-export `@/lib/db-client/client`, which has no importers). Table names come from string literals; no call site builds a table name at runtime.

| File:line | Table (as written) | Resolved | Action | Status |
| --- | --- | --- | --- | --- |
| `src/app/(auth)/login/page.tsx:112` | `users` | `configuration.users` | select `role`, own id | allowed (self-row) |
| `src/components/arkiv/arkiv-os-desktop.tsx:858` | `users` | `configuration.users` | select `full_name, role`, own id | allowed (self-row) |
| `src/features/hris/dashboard/components/recruitment-dashboard-page.tsx:54` | `users` | `configuration.users` | select `role`, own id | allowed (self-row) |
| `src/features/hris/candidates/api.ts:25` | `candidates` + `brands`, `positions` | `recruitment.candidates` | select, count | allowed |
| `src/features/hris/candidates/api.ts:50,198` | `brands` | `item.brands` | select | allowed |
| `src/features/hris/candidates/api.ts:59` | `candidates` + embeds | `recruitment.candidates` | select | allowed |
| `src/features/hris/candidates/api.ts:78` | `candidates` | `recruitment.candidates` | insert, returning `*` | allowed |
| `src/features/hris/candidates/api.ts:103` | `candidates` | `recruitment.candidates` | delete by id | allowed |
| `src/features/hris/candidates/api.ts:111` | `candidates` | `recruitment.candidates` | select | allowed |
| `src/features/hris/candidates/api.ts:124` | `brands` | `item.brands` | select | allowed |
| `src/features/hris/candidates/api.ts:133` | `positions` | `hris.positions` | select | allowed |
| `src/features/hris/candidates/api.ts:151` | `candidate_activities` | `recruitment.candidate_activities` | select | allowed |
| `src/features/hris/candidates/api.ts:162` | `candidate_notes` | `recruitment.candidate_notes` | select | allowed |
| `src/features/hris/candidates/api.ts:213` | `candidates` + `positions(title, brands(name))` | `recruitment.candidates` | select | allowed |
| `src/features/hris/dashboard/api.ts:11` | `brands` | `item.brands` | select | allowed |
| `src/features/hris/org-chart/api.ts:13` | `departments` | `hris.departments` | select | allowed |
| `src/features/hris/pipeline/api.ts:9` | `candidates` + embeds | `recruitment.candidates` | select | allowed |
| `src/features/hris/pipeline/api.ts:19` | `brands` | `item.brands` | select | allowed |
| `src/features/hris/talent-pool/api.ts:12` | `candidates` + embeds | `recruitment.candidates` | select | allowed |
| `src/features/hris/talent-pool/api.ts:27` | `brands` | `item.brands` | select | allowed |
| `src/features/hris/talent-pool/api.ts:37,46` | `candidates` | `recruitment.candidates` | update by id | allowed |
| `src/lib/xp.ts:108-429` | `user_xp_stats`, `xp_activities`, `user_badges`, `xp_challenges`, `xp_rewards`, `xp_redemptions`, rpc `add_xp_to_user`, `unlock_badge`, `claim_challenge_reward`, `get_user_rank`, `redeem_reward` | tables do not exist | select, rpc | denied. `XPService` has no importers and the tables are absent, so nothing breaks. |

`src/hooks/use-candidates.ts` imports `createBrowserClient` but never calls it.

## Adding a table

Prefer a dedicated API route with `requirePosMenu(IAM.<group>)` or `requireIamMenuPrefix`. If a browser-client call is unavoidable, add an entry to `DB_QUERY_POLICY` with the narrowest actions and IAM prefixes, list any embeds, add a test in `src/lib/pg/query-policy.test.ts`, and add a row to the inventory above.
