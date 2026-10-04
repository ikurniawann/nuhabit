# Deploying the Go API

The Go API runs on the same host as the Next container. Next stays the only
public entry point: its proxy forwards the routes Go serves to `BACKEND_URL`
and handles everything else itself. Unset `BACKEND_URL` and every request goes
back to Next, so cutover and rollback are one variable.

## Before the first cutover

1. Apply pending migrations against the target database:
   `go -C backend run ./cmd/migrate -allow-remote` (dry run), then add `-apply`.
   Or run the `migrate` binary from the API image with `MIGRATE_DATABASE_URL`.
2. Check the database for drift: a local database had migrations recorded as
   applied whose columns were missing. Run the Go test suite against a copy of
   the target database (`TEST_DATABASE_URL=...`) or compare
   `information_schema.columns` with a freshly migrated database.
3. The API reads the same runtime env file as Next. It needs `DATABASE_URL`
   and `NEXT_PUBLIC_APP_URL` (payment callback URLs), plus the integration
   keys Next already uses (Xendit, WhatsApp gateway, Meta, OpenAI).

## Docker script (.gitlab/deploy-docker.sh)

Set `BACKEND_ENABLED=1` for the deploy. The script builds `backend/`, runs
`<CONTAINER_NAME>-api` on the network `<CONTAINER_NAME>-net` as uid 1001 with
`STORAGE_DIR` mounted at `/app/storage` (the same uploads Next uses), waits for
its health check, then starts Next with
`BACKEND_URL=http://<CONTAINER_NAME>-api:8080`. If the API is unhealthy, Next
starts without `BACKEND_URL`.

## Compose (ci-cd-template deploys)

CI pushes `$CI_REGISTRY_IMAGE_PUSH/api:<channel>` (jobs `build-api-*`). Add a
service next to `arkiv` in the host's compose file:

```yaml
  arkiv-api:
    image: <registry>/<project>/api:production
    restart: unless-stopped
    user: "1001:65533"
    env_file: /etc/arkiv/production.env
    environment:
      DATABASE_URL: postgresql://...      # same as arkiv
      STORAGE_DIR: /app/storage
    volumes:
      - /srv/arkiv/storage:/app/storage   # same host dir as arkiv
    extra_hosts:
      - host.docker.internal:host-gateway
```

and on the `arkiv` service set `BACKEND_URL: http://arkiv-api:8080` (both
services share the compose network). The API exposes no host port.

## Scaling

Several API replicas may run behind one `BACKEND_URL` (a load balancer or a
compose `deploy.replicas`): rate limits, live-interview signaling and the
outbox all coordinate through Postgres. `MODULES=<names>` mounts a subset when
one module should run as its own service.
