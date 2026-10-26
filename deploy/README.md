# TowNow production deployment (Docker Compose on one Ubuntu VPS)

Follows the architecture plan §9: Nginx with TLS in front, the API/WebSockets container,
a **separate BullMQ worker container**, PostgreSQL/PostGIS and Redis (password, AOF) on a
private network only, the Next.js admin dashboard, and nightly database backups.

```
internet ──443──> nginx ──> api (REST + Socket.IO, RUN_WORKERS=false) ─┐
                     └────> admin (Next.js)                             ├─> postgres, redis (private)
                            worker (node dist/worker.js) ───────────────┘
                            backup (pg_dump nightly → ./backups)
```

Socket events raised by the worker reach phones through the Socket.IO Redis adapter.

## Steps

1. Ubuntu LTS VPS in a UAE region (e.g. AWS me-central-1, Azure UAE North) with Docker Engine + Compose plugin.
2. DNS: `API_DOMAIN` and `ADMIN_DOMAIN` → the VPS.
3. TLS: put `fullchain.pem` + `privkey.pem` for each domain in `certs/<domain>/`
   (e.g. certbot with webroot `deploy/nginx/acme`).
4. `cp .env.example .env`, fill in every value (strong random passwords/secrets, Twilio, S3, maps, FCM). `chmod 600 .env`.
5. `docker compose up -d --build` — the API applies database migrations on start.
6. Create the first admin: `docker compose exec api node dist/scripts/create-admin.js 05X XXX XXXX "Ops Admin"`.
7. Copy `./backups` off the server on a schedule and test a restore (`pg_restore`).

Firewall: allow only 22 (restricted), 80 and 443.

## Verified on the dev machine

- `docker compose config` validates the file (7 services; only nginx publishes ports).
- `nginx -t` passes with the rendered template and test certificates.
- Not done here: building/running the production images (no VPS; limited local disk).
