# Scripts — Sulu In Wounderland OS

Operational scripts for migrations, IAM, and dev utilities.

## Database migrations

Requires `DATABASE_URL` in `.env` or `.env.local`.

| Command | Description |
| --- | --- |
| `npm run migrate` | Dry-run legacy public migrations |
| `npm run migrate:apply` | Apply legacy public migrations |
| `npm run migrate:iam` | Dry-run IAM schema migrations |
| `npm run migrate:iam:apply` | Apply IAM migrations (with pre-flight) |
| `./scripts/iam/setup.sh` | IAM migrate + expose API schema |
| `./scripts/iam/expose-api-schema.sh` | Expose `iam` schema to PostgREST |
| `npm run test:iam-connection` | Test REST + Postgres IAM connectivity |

Full guide: [docs/MIGRATIONS.md](../docs/MIGRATIONS.md)

## Dev utilities

| Script | Description |
| --- | --- |
| `./scripts/reset-db.sh` | Truncate purchasing transaction data |
| `./scripts/create_super_user.js` | Create super admin user |
| `./scripts/create_pos_admin.js` | Create POS admin user |

## Legacy wrapper

```bash
./scripts/run-migrations.sh --help
```

Points to npm migration commands above.
