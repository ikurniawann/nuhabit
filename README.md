# NüHabit

HYROX gym and membership platform with supporting ERP modules (POS, HRIS, purchasing, accounting, CRM).

## Layout

| Path | What |
|---|---|
| `frontend/` | Next.js app: member app (`/member`), staff dashboard, OS desktop, public pages. Also serves the API routes that are not yet ported to Go. |
| `backend/` | Go modular monolith. One module per bounded context under `internal/modules`, each liftable into its own service (`MODULES=` env). |
| `backend/database/` | PostgreSQL migrations (`migrations/bootstrap`, `migrations/deltas`), seeders and SQL ops scripts. |
| `services/wa-gateway` | WhatsApp gateway sidecar (Baileys). |
| `tools/` | POS NFC bridge and print worker. |
| `mobile/` | Expo app. |
| `docs/` | Documentation, HR/KPI templates. |

The frontend forwards every API route the Go backend registers to `BACKEND_URL` (see `frontend/src/lib/backend-routes.ts`), so the browser calls one origin. Next keeps no TypeScript copy of those routes.

## Commands

```bash
pnpm dev                 # frontend (Next.js) on :3000
pnpm backend:dev         # Go API
pnpm test                # frontend tests + go test ./...
pnpm db:migrate:apply    # apply pending SQL migrations
pnpm db:seed <script>    # e.g. pnpm db:seed db:seed:super-admin
```

Env: `frontend/.env.local` for the app, `backend/.env.local` for the Go API and database tooling. See each folder's `.env.example`.
