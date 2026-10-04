# NüHabit monorepo

- `frontend/`: Next.js app (UI plus API routes not yet ported to Go). Read `frontend/AGENTS.md` before writing Next.js code.
- `backend/`: Go modular monolith (`cmd/`, `internal/`), one module per bounded context; `backend/database/` holds migrations, seeders and SQL ops scripts.
- `services/wa-gateway`, `tools/`, `mobile/`: separate apps with their own manifests.

@frontend/AGENTS.md
