# Database backups

Two scripts in `backend/database/scripts/` cover the Postgres database:

- `backup.sh` writes a `pg_dump` custom-format file
  (`<BACKUP_DIR>/nuhabit_<UTC timestamp>.dump`), checks that `pg_restore`
  can read it, deletes local dumps older than `BACKUP_KEEP` days and hands
  the new file to `BACKUP_UPLOAD_CMD` for the off-host copy.
- `restore-check.sh` restores the newest dump into a scratch database,
  prints row counts for core tables and drops the scratch database again.

Both read the connection from the environment, move the password out of the
URL into `PGPASSWORD` before calling `pg_dump`, `pg_restore` or `psql`, and
never print it. They exit non-zero on any failure, so cron mail or a
systemd `OnFailure=` unit sees it. Uploaded files under `STORAGE_DIR` are not
in the database; back that directory up separately.

## Settings

| Variable | Default | Used by | Meaning |
|---|---|---|---|
| `DATABASE_URL` | none | both | database to dump; also the fallback server for the restore check |
| `BACKUP_DIR` | `/var/backups/nuhabit` | both | dump directory, created with mode 700 |
| `BACKUP_KEEP` | `14` | backup | days of local dumps to keep |
| `BACKUP_PREFIX` | `nuhabit` | both | file name prefix |
| `BACKUP_UPLOAD_CMD` | unset | backup | shell command run after each dump; the path is `$1` and `$BACKUP_FILE` |
| `RESTORE_DATABASE_URL` | `DATABASE_URL` | restore-check | server for the scratch database; the role needs `CREATEDB` |
| `RESTORE_CHECK_TABLES` | core tables | restore-check | space-separated `schema.table` list to count |
| `PG_BIN` | `PATH` | both | directory with `pg_dump`, `pg_restore` and `psql` |

`pg_dump` must be the server's major version or newer (Postgres 17 today).
On Debian or Ubuntu install `postgresql-client-17` from the PostgreSQL apt
repository and set `PG_BIN=/usr/lib/postgresql/17/bin`. pgx-only URL
settings such as `pool_max_conns` are dropped before libpq sees the URL, so
the API's `DATABASE_URL` works as is.

## Schedule on the deploy host

Postgres runs on the deploy host (the containers reach it as
`host.docker.internal`), so the backup runs there too. Keep the settings in
a root-owned file outside the checkout:

```bash
sudo install -d -m 700 /etc/nuhabit /var/backups/nuhabit
sudo install -m 600 /dev/null /etc/nuhabit/backup.env
sudoedit /etc/nuhabit/backup.env
```

```bash
# /etc/nuhabit/backup.env
DATABASE_URL=postgresql://postgres:<url-encoded password>@127.0.0.1:5432/<DATABASE_NAME>
BACKUP_DIR=/var/backups/nuhabit
BACKUP_KEEP=14
PG_BIN=/usr/lib/postgresql/17/bin
# Single quotes: systemd and a shell `.` both strip them and keep "$1".
BACKUP_UPLOAD_CMD='rclone copy "$1" offsite:nuhabit-db/'
```

Copy the two scripts and `pg-url.sh` to `/opt/nuhabit/db-scripts/` (or run
them from a checkout), then pick cron or systemd.

### systemd timer (preferred)

```ini
# /etc/systemd/system/nuhabit-backup.service
[Unit]
Description=NüHabit Postgres backup
After=postgresql.service

[Service]
Type=oneshot
EnvironmentFile=/etc/nuhabit/backup.env
ExecStart=/opt/nuhabit/db-scripts/backup.sh
User=postgres
Nice=10
IOSchedulingClass=idle
```

```ini
# /etc/systemd/system/nuhabit-backup.timer
[Unit]
Description=Daily NüHabit Postgres backup

[Timer]
# 02:30 Asia/Jakarta, outside opening hours.
OnCalendar=*-*-* 02:30:00 Asia/Jakarta
RandomizedDelaySec=10m
Persistent=true

[Install]
WantedBy=timers.target
```

Add a weekly restore check the same way (`nuhabit-restore-check.service`
with `ExecStart=/opt/nuhabit/db-scripts/restore-check.sh` and
`OnCalendar=Sun *-*-* 04:00:00 Asia/Jakarta`), then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nuhabit-backup.timer nuhabit-restore-check.timer
sudo systemctl start nuhabit-backup.service   # first run by hand
journalctl -u nuhabit-backup.service -n 20
```

The user running the scripts must own `BACKUP_DIR`:
`sudo chown postgres: /var/backups/nuhabit`. systemd reads
`EnvironmentFile` as root, so `backup.env` can stay root-only.

### cron

```cron
# /etc/cron.d/nuhabit-backup
CRON_TZ=Asia/Jakarta
MAILTO=ops@example.com
30 2 * * *  postgres  set -a; . /etc/nuhabit/backup.env; /opt/nuhabit/db-scripts/backup.sh
0 4 * * 0   postgres  set -a; . /etc/nuhabit/backup.env; /opt/nuhabit/db-scripts/restore-check.sh
```

cron sources the file as the `postgres` user, so that user needs read
access: `sudo chown root:postgres /etc/nuhabit/backup.env && sudo chmod 640
/etc/nuhabit/backup.env`.

## Retention

- Local: `BACKUP_KEEP` days (default 14) of daily dumps in `BACKUP_DIR`.
  The sweep runs after a successful dump only, so a failing dump never
  removes the last good file.
- Off-host: the bucket or remote keeps its own history. Set a lifecycle rule
  there, for example daily copies for 35 days and the first dump of each
  month for 12 months. `backup.sh` never deletes anything off-host.

Size the local disk for `BACKUP_KEEP + 1` dumps; `backup.sh` logs each size.

## Off-host copy

A dump on the database host does not survive the loss of that host.
`BACKUP_UPLOAD_CMD` runs after each dump with the file path as `$1`; any
non-zero exit makes `backup.sh` exit 1 and keeps the local file. Examples:

```bash
BACKUP_UPLOAD_CMD='rclone copy "$1" offsite:nuhabit-db/'
BACKUP_UPLOAD_CMD='aws s3 cp "$1" s3://<bucket>/nuhabit-db/ --storage-class STANDARD_IA'
BACKUP_UPLOAD_CMD='scp -q "$1" backup@<other-host>:/srv/backups/nuhabit/'
```

Use credentials that can write but not delete (an S3 policy without
`s3:DeleteObject`, object lock, or an rclone remote with `--immutable`), so
an attacker on the host cannot wipe the copies. The dumps hold member and
employee personal data: keep the bucket private and encrypted at rest.

## Restore runbook

Pick the dump first. `ls -lt /var/backups/nuhabit` lists the local ones;
download an off-host one into a scratch directory when the host is gone.

1. Prove the file restores before touching production:

   ```bash
   set -a; . /etc/nuhabit/backup.env; set +a
   /opt/nuhabit/db-scripts/restore-check.sh /var/backups/nuhabit/nuhabit_<ts>.dump
   ```

2. Stop both containers so no request writes during the swap:

   ```bash
   docker stop <CONTAINER_NAME> <CONTAINER_NAME>-api
   ```

3. Restore into a new database next to the old one, so the old one stays as
   a fallback:

   ```bash
   createdb -h 127.0.0.1 -U postgres nuhabit_restored
   pg_restore -h 127.0.0.1 -U postgres --no-owner --exit-on-error \
     --jobs=4 --dbname=nuhabit_restored /var/backups/nuhabit/nuhabit_<ts>.dump
   ```

   Drop `--no-owner` when the server has the same roles as the source.

4. Swap the names and start the containers:

   ```sql
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE datname IN ('<DATABASE_NAME>', 'nuhabit_restored') AND pid <> pg_backend_pid();
   ALTER DATABASE "<DATABASE_NAME>" RENAME TO "<DATABASE_NAME>_before_restore";
   ALTER DATABASE nuhabit_restored RENAME TO "<DATABASE_NAME>";
   ```

   ```bash
   docker start <CONTAINER_NAME>-api <CONTAINER_NAME>
   ```

5. Check the result: `curl` the API's `/ready`, sign in to the dashboard,
   and run the drift check against the restored database
   (`migrate -verify`, see DEPLOY.md). A dump older than the running build
   lacks newer migrations; run `migrate -apply` before starting the API.

6. Keep `<DATABASE_NAME>_before_restore` until the restore is confirmed,
   then drop it.

To recover rows of one table without a full restore, restore the dump into
a scratch database (step 3, containers running), export the rows you need
with `\copy (SELECT ...) TO 'rows.csv' CSV` from the scratch database and
load them into production with `\copy ... FROM` inside a transaction.
