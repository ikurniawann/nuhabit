# Backup, restore, and health checks

PostgreSQL is the only stateful part of BCD Coffee OS besides the upload volume (`/app/storage`). The Next.js image is rebuilt from the repository, so a lost container costs a redeploy and a lost database costs the business. This runbook covers the dump schedule, retention, the encrypted off-site copy, and a restore drill. Every command in the drill section ran against the local database on port 55432 on 2026-10-03.

## Health endpoints

| Endpoint | Answers | Status codes |
|---|---|---|
| `GET /api/health` | Is the Node process up? It never touches the database. | 200 |
| `GET /api/ready` | Can the app serve? It runs `SELECT 1` on the pool with a 2 s timeout. | 200 ready, 503 database unavailable |

Both paths are public in `src/lib/auth/middleware.ts`. The Dockerfile `HEALTHCHECK` calls `/api/ready`, so Docker marks the container unhealthy when it loses the database. Point load balancers and uptime monitors at `/api/ready`.

## Schedule and retention

| What | When | Keep |
|---|---|---|
| `pg_dump -Fc` of the production database | Nightly at 02:00 WIB, outside POS hours | 14 daily |
| Same dump, promoted | First dump of each week (Monday) | 8 weekly |
| Same dump, promoted | First dump of each month | 12 monthly |
| Manual dump | Before every deploy that adds a migration | Until the next release is verified |
| Upload volume (`/app/storage`) | Nightly, `tar` of the volume | Same as the database |

Keep at least one copy that predates the problem you are fixing. Most data loss is a mistake made days ago and noticed today, so 14 daily copies matter more than a fast restore.

Record two facts next to every dump: the git commit of the running release (a newer dump does not restore into older code) and where the session secret lives. Neither is inside `pg_dump`.

## Nightly job

Run on the database host or any host with network access to it. `PGPASSWORD` or a `~/.pgpass` entry supplies the credentials; the passphrase file is readable only by the backup user.

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%Y%m%d-%H%M)
DIR=/var/backups/nuhabit
mkdir -p "$DIR"

pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -Fc -Z 6 -f "$DIR/nuhabit-$STAMP.dump" "$PGDATABASE"
pg_restore -l "$DIR/nuhabit-$STAMP.dump" > /dev/null          # archive is readable
shasum -a 256 "$DIR/nuhabit-$STAMP.dump" > "$DIR/nuhabit-$STAMP.dump.sha256"
git -C /srv/nuhabit rev-parse HEAD > "$DIR/nuhabit-$STAMP.release"

# Encrypted off-site copy (symmetric AES-256, passphrase kept outside the backup host)
gpg --batch --yes --pinentry-mode loopback --passphrase-file /etc/nuhabit/backup.pass \
    --symmetric --cipher-algo AES256 -o "$DIR/nuhabit-$STAMP.dump.gpg" "$DIR/nuhabit-$STAMP.dump"
rclone copy "$DIR/nuhabit-$STAMP.dump.gpg" offsite:nuhabit-backups/daily/
rclone copy "$DIR/nuhabit-$STAMP.dump.sha256" offsite:nuhabit-backups/daily/
rclone copy "$DIR/nuhabit-$STAMP.release" offsite:nuhabit-backups/daily/

# Local retention: 14 days of plain dumps on the host
find "$DIR" -name 'nuhabit-*.dump*' -mtime +14 -delete
```

Weekly and monthly promotion is a server-side copy in the bucket (`rclone copy offsite:nuhabit-backups/daily/<file> offsite:nuhabit-backups/weekly/`) plus bucket lifecycle rules that expire `daily/` after 14 days, `weekly/` after 56 days, and `monthly/` after 365 days. Use a bucket with object lock or versioning so a compromised app host cannot delete the off-site copies.

Store the passphrase in the team password manager, not on the backup host and not in the repository. Without it the off-site copies are unreadable.

If `gpg` is not available, `openssl` gives the same protection:

```bash
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in nuhabit-$STAMP.dump -out nuhabit-$STAMP.dump.enc -pass file:/etc/nuhabit/backup.pass
```

## Restore drill (verified 2026-10-03)

Run this monthly against a scratch database, and before trusting any new backup setup. These are the exact commands that ran on the local database (`postgres://postgres@localhost:55432/nuhabit`, PostgreSQL 17.9). `B=/opt/homebrew/opt/postgresql@17/bin`.

1. Dump. 3208 TOC entries, 356 tables with data, 1.7 MB, under 1 s.

   ```bash
   STAMP=$(date +%Y%m%d-%H%M)
   $B/pg_dump -h localhost -p 55432 -U postgres -Fc -Z 6 -f nuhabit-$STAMP.dump nuhabit
   $B/pg_restore -l nuhabit-$STAMP.dump | grep -c "TABLE DATA"      # 356
   shasum -a 256 nuhabit-$STAMP.dump | tee nuhabit-$STAMP.dump.sha256
   ```

2. Encrypt and decrypt, then compare checksums. Both tools returned the original SHA-256.

   ```bash
   gpg --batch --yes --pinentry-mode loopback --passphrase-file drill.pass \
       --symmetric --cipher-algo AES256 -o nuhabit-$STAMP.dump.gpg nuhabit-$STAMP.dump
   gpg --batch --yes --pinentry-mode loopback --passphrase-file drill.pass \
       -d -o restored.dump nuhabit-$STAMP.dump.gpg
   shasum -a 256 restored.dump                                       # same hash as step 1

   openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in nuhabit-$STAMP.dump \
       -out nuhabit-$STAMP.dump.enc -pass file:drill.pass
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in nuhabit-$STAMP.dump.enc \
       -out restored-openssl.dump -pass file:drill.pass               # same hash
   ```

3. Restore into a scratch database. `--no-owner` keeps it independent of production roles; `--exit-on-error` stops on the first failure instead of leaving a half-restored database.

   ```bash
   $B/dropdb   -h localhost -p 55432 -U postgres --if-exists nuhabit_restore_drill
   $B/createdb -h localhost -p 55432 -U postgres nuhabit_restore_drill
   $B/pg_restore -h localhost -p 55432 -U postgres -d nuhabit_restore_drill \
       --no-owner --exit-on-error -j 4 restored.dump                 # exit 0, 0.8 s
   ```

4. Compare the restored copy with the source. Every value matched.

   ```bash
   Q="select (select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')),
             (select count(*) from public.schema_migrations),
             (select count(*) from iam.menus),
             to_regclass('audit.audit_log') is not null,
             (select count(*) from pg_trigger where tgname = 'trg_inventory_movement_batches')"
   $B/psql -h localhost -p 55432 -U postgres nuhabit               -At -c "$Q"   # 356|465|294|t|1
   $B/psql -h localhost -p 55432 -U postgres nuhabit_restore_drill -At -c "$Q"   # 356|465|294|t|1

   # Exact row total across all tables: 2580 in both
   R="select sum((xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I',
        schemaname, tablename), false, true, '')))[1]::text::bigint)
      from pg_tables where schemaname not in ('pg_catalog','information_schema')"
   ```

5. Clean up.

   ```bash
   $B/dropdb -h localhost -p 55432 -U postgres nuhabit_restore_drill
   rm -f restored*.dump nuhabit-*.dump.enc nuhabit-*.dump.gpg drill.pass
   ```

Write the drill date, dump file, row totals, and restore duration in the ops log. A dump that has never been restored has not been proven to work.

## Restoring production

1. Stop the app containers so nothing writes during the restore. Leave PostgreSQL running.
2. Take a fresh dump of the current database, even if it is damaged. You may need rows from it later.
3. Fetch the chosen `.dump.gpg`, decrypt it, and check the SHA-256 against its `.sha256` file.
4. Check the `.release` file. Deploy that commit, or a later one whose migrations are additive.
5. Restore into a new database (`createdb nuhabit_restored`, then `pg_restore --no-owner --exit-on-error -j 4`), run the comparison queries from step 4 of the drill, then switch `DATABASE_URL` to it. Restoring over the live database with `--clean` leaves nothing to fall back to if the dump is bad.
6. Run `node database/scripts/apply-migrations.js --apply` to bring the schema up to the deployed release.
7. Start the app and wait for `GET /api/ready` to return 200 before sending traffic.
8. Restore the upload volume from the same night's archive.

`audit.audit_log` rejects UPDATE, DELETE, and TRUNCATE through triggers. `pg_restore` only inserts, so restores work unchanged. If you must prune audit rows during an incident, a superuser has to disable `trg_audit_log_no_update` and `trg_audit_log_no_truncate` explicitly; note who did it and why.
