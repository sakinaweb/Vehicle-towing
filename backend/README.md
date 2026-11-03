# TowNow API

Backend for the TowNow UAE towing marketplace — a NestJS **modular monolith** (REST + Socket.IO)
on PostgreSQL/PostGIS, Redis and BullMQ.

| Layer | Choice |
|---|---|
| Runtime | Node.js 22, TypeScript 6 (strict), native ES modules |
| Framework | NestJS 12 |
| Database | PostgreSQL 16 + PostGIS 3.4, TypeORM 1.x (migrations only, `synchronize` off) |
| Cache / queues | Redis 7, BullMQ 6 |
| Realtime | Socket.IO 4 (namespace `/realtime`) |
| Docs | OpenAPI 3 at `/api/docs` |
| Tests | Vitest (unit + e2e against real infrastructure) |

## Quick start

```bash
cp .env.example .env          # local defaults work as-is
npm install
npm run db:up                 # PostgreSQL/PostGIS on :5433, Redis on :6380 (Docker)
npm run migration:run         # build + apply migrations
npm run start:dev             # http://localhost:4000/api
```

- Liveness: `GET /api/health/live` · Readiness: `GET /api/health/ready` (database, PostGIS, Redis, BullMQ)
- API docs: http://localhost:4000/api/docs (JSON: `/api/docs-json`)
- Run everything in containers: `docker compose --profile api up -d --build`

## Scripts

| Script | Purpose |
|---|---|
| `npm run build` / `start:dev` / `start:prod` | Compile / watch mode / run compiled build |
| `npm run typecheck` · `npm run lint` | `tsc --noEmit` · ESLint + Prettier |
| `npm test` | Unit tests (no infrastructure needed) |
| `npm run test:e2e` | End-to-end tests — requires `npm run db:up` and migrations |
| `npm run migration:generate -- src/database/migrations/<Name>` | Generate a migration from entity changes |
| `npm run migration:run` · `migration:revert` · `migration:show` | Apply / roll back / list migrations |
| `npm run migration:check` | Fails if entities and database schema have drifted |
| `npm run admin:create -- <mobile> [name]` | Provision an admin (admins sign in by SMS code but are never created by signing in) |

## Structure

```
src/
  main.ts, app.setup.ts     bootstrap + HTTP pipeline (helmet, CORS, versioning, validation, errors, Swagger)
  config/                   validated environment (fails fast on bad config)
  common/                   base entity, shared enums, global exception filter
  database/                 TypeORM options, CLI data source, migrations/
  infrastructure/           redis/, queue/ (BullMQ), realtime/ (Socket.IO)
  health/                   liveness + readiness probes
  modules/                  domain modules — each owns its tables:
    auth users customers drivers vehicles bookings locations
    pricing payments notifications chat admin audit
```

## Authentication

Customers and drivers sign in with their UAE mobile number and a 6-digit SMS code.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/v1/auth/otp/request` | public | Send a code (`{ phone }`, any common UAE format) |
| `POST /api/v1/auth/otp/verify` | public | Verify (`{ phone, code, role: customer\|driver }`); creates the account + profile on first sign-in |
| `POST /api/v1/auth/refresh` | public | Rotate the refresh token, get a new access token |
| `POST /api/v1/auth/logout` · `logout-all` | bearer | End this session · all sessions |
| `GET/PATCH /api/v1/customers/me` | customer | Customer profile |
| `GET/PATCH /api/v1/drivers/me` | driver | Driver profile, KYC status, trucks |
| `GET/POST /api/v1/drivers/me/tow-trucks`, `PATCH/DELETE …/:id` | driver | Tow trucks the driver operates |

- **Every route requires a valid access token** unless marked `@Public()`; `@Roles(...)` restricts by role.
- **Access token**: HS256 JWT, 15 min, held in memory by clients. **Refresh token**: opaque
  `<sessionId>.<secret>`, 30 days, rotated on every use; reuse of an old token revokes the session.
  Web clients receive it as an `HttpOnly; SameSite=Strict` cookie (`townow_rt_<role>`); mobile apps send
  `X-Client-Type: mobile` and get it in the body. Logout takes effect immediately (Redis denylist).
- **OTP**: CSPRNG codes, stored only as HMAC-SHA256 with `OTP_SECRET`; 5-minute expiry, 5 attempts,
  single use, newest code only; 30 s resend cooldown and per-number / per-IP hourly limits.
- **SMS**: `SMS_PROVIDER=log` prints messages to the API log (development only — refused in production);
  `SMS_PROVIDER=twilio` sends real SMS with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SENDER`;
  `twilio_verify` and `infobip` are also available. `SMS_BACKUP_PROVIDER` (twilio | infobip) takes over
  automatically when the primary fails, delivering the same locally generated code (with Verify as
  primary, the backup's code is checked locally, never by Twilio). `OTP_COUNTRIES` (AE, IN) picks which
  countries' mobiles may sign in. With `SMS_STATUS_CALLBACK_BASE_URL` set, Twilio (signature-checked)
  and Infobip (secret path token) delivery reports are logged under `SMS:status`.
  A Twilio **trial** account only delivers to verified numbers — upgrade it (and register a UAE sender
  ID) for production. New gateways implement `SmsProvider` (`src/infrastructure/sms`).
- Sign-ins, sign-outs and refresh-token reuse are written to `audit_logs`.

## Chat, SOS & admin insights

- **Chat** (`/bookings/:id/messages`, `…/read`): customer ↔ assigned driver while the job is
  active (read-only before/after); admins can read. Socket events `chat:message`, `chat:read`;
  the recipient also gets an inbox entry/push. An app-generated `clientId` makes retries idempotent.
- **SOS** (`POST /sos`, `GET /me/sos`, `GET /admin/sos`, `POST /admin/sos/:id/acknowledge|resolve`):
  stored in `sos_alerts` with optional GPS + job, audited (`sos.*`), every active admin alerted via
  `sos:new` (+ inbox), the raiser told via `sos:updated`.
- **Admin** read-only views: `GET /admin/driver-locations` (live map), `GET /admin/payments`
  (VAT, driver earning, commission = subtotal − driver earning), `GET /admin/audit-logs`.

## Vehicles, pricing & bookings

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET/POST /api/v1/customers/me/vehicles`, `GET/PATCH/DELETE …/:id` | customer | My cars/motorbikes (delete = soft delete, blocked while a tow is active) |
| `GET /api/v1/pricing/tariffs` | public | Current tariff per tow type (fils) |
| `POST /api/v1/bookings/quotes` | customer | Server fare quote, guaranteed 15 min |
| `POST /api/v1/bookings` | customer | Book a quote — **idempotent per `quoteId`** (replay → 200 + `Idempotent-Replayed: true`) |
| `GET /api/v1/bookings?status=active\|completed\|cancelled&page&limit` | customer | My bookings |
| `GET /api/v1/bookings/:id` · `POST …/:id/cancel` | customer | Details with status history · cancel with a reason |

- **Pricing** (`src/modules/pricing/fare.calculator.ts`): `subtotal = max(minimum, base + distance×perKm + tow-type surcharge + night surcharge)`,
  `VAT = round(subtotal × 5%)`, all integer fils. Night = 00:00–05:59 UAE time.
- **Tariffs are seeded** by migration `SeedPricingRules` (flatbed AED 150 + AED 50, wheel-lift / bike carrier AED 120,
  AED 4.80/km, AED 150 minimum, AED 35 night, 5% VAT). To change prices add a new `pricing_rules` row with a later
  `effective_from`; bookings keep their own `fare_snapshot`, so history never changes.
- **Distance**: PostGIS geodesic distance × 1.3 road factor (`RoutingService`); swap in a routing provider there.
  Pickup/drop-off must lie inside the UAE outline (PostGIS `ST_Covers`), 100 m – 500 km apart.
- **Rules**: cars → flatbed / wheel-lift; motorbikes → bike carrier / flatbed. One active tow per vehicle (DB-enforced).
  Customers may cancel until the truck is on scene; once a driver is assigned a fee may apply (charged in the payments phase).
- Booking numbers come from `booking_number_seq`: `TN-100001`, `TN-100002`, …

## Dispatch, trips, live tracking & KYC

| Endpoint / event | Auth | Purpose |
|---|---|---|
| `GET/PUT /api/v1/drivers/me/availability` | driver | Go online/offline (needs approved KYC + an active truck) |
| `POST /api/v1/drivers/me/location` · socket `driver:location` | driver | Report GPS (driver always taken from the token) |
| `GET …/drivers/me/offers/current` · `POST …/offers/:id/accept` · `…/decline` | driver | Job offers (accept is idempotent) |
| `GET …/drivers/me/jobs/current` | driver | Job in progress, incl. inspection progress |
| `POST …/drivers/me/jobs/:bookingId/en-route` · `arrived` · `start-tow` · `complete` | assigned driver | Trip steps (validated, idempotent) |
| `PUT …/jobs/:bookingId/inspections/:stage` · `POST …/:stage/photos` · `DELETE …/photos/:id` · `POST …/:stage/submit` | assigned driver | Pickup/return inspection |
| `GET/PUT /api/v1/drivers/me/documents[/:type]` | driver | KYC documents (multipart upload) |
| `GET /api/v1/bookings/:id/driver-location` | booking customer | Live driver position, freshness and ETA |
| `GET /api/v1/bookings/:id/inspections[/photos/:photoId]` | booking customer | Inspections and photos |
| `GET /api/v1/admin/drivers?kycStatus=` · `GET …/:driverId` · `GET …/documents/:id/file` | admin | KYC queue, driver details, documents |
| `POST /api/v1/admin/drivers/:driverId/kyc/approve` · `…/kyc/reject` | admin | KYC decision (audited) |
| Socket `/realtime` → `offer:new` `offer:closed` `job:cancelled` `kyc:updated` | driver | Own offers, jobs and KYC result |
| Socket `/realtime` → `booking:updated` `trip:location` | customer | Own booking status and driver position |

- **Matching**: BullMQ queue `matching` (`match`, `offer-timeout`). PostgreSQL decides who owns a booking;
  rows are always locked booking → offer → driver. Nearest online, approved driver with a fresh location and a
  truck of the requested tow type gets one offer at a time; decline/timeout/offline moves to the next.
- **Trip**: `driver_assigned → driver_arriving → driver_arrived → in_transit → completed`. Starting the tow needs the
  submitted pickup inspection, completing needs the return inspection. `vehicle_loaded` is reserved (not used).
- **Inspections**: odometer, fuel level, 6-item checklist, notes; front/back/left/right photos required, up to
  6 extras, 8 MB each, type detected from the file bytes. Submitted inspections are locked. Return odometer ≥ pickup.
- **Files** (`STORAGE_PROVIDER`): `local` (dev only, refused in production) or `s3` (AWS S3 / R2 / MinIO).
  Only server-generated keys are stored; files are streamed to authorised callers, never public URLs.
- **Location**: every fix goes to Redis (`driver:location:<id>`, expires after `DRIVER_LOCATION_MAX_AGE_SECONDS`);
  PostGIS is written at most every `DRIVER_LOCATION_DB_WRITE_INTERVAL_SECONDS`. Older fixes are refused atomically.
- **ETA** (`ROUTING_PROVIDER`): `none` returns an explicit `unavailable` ETA (never a guess); `google` (Routes API)
  or `mapbox` (Directions) with a server-side key. Results are cached per booking for 30 s.
- **Audit** (`audit_logs`): trip steps, inspection submitted, KYC uploaded/approved/rejected, denied location access.

## Payments, invoices & driver settlement (Stripe)

| Endpoint / event | Auth | Purpose |
|---|---|---|
| `POST /api/v1/bookings/:id/payment` | booking customer | Stripe Payment Element data (client secret, publishable key); idempotent |
| `POST /api/v1/bookings/:id/payment/sync` | booking customer | Re-read the payment from Stripe (when a webhook is late) |
| `GET /api/v1/bookings/:id/invoice` | customer / driver / admin | Invoice of a completed tow |
| `POST /api/v1/payments/webhooks/stripe` | Stripe signature | Webhook endpoint (no user token) |
| `POST /api/v1/drivers/me/jobs/:id/cash-collected` | assigned driver | Confirm the full cash fare after completion (idempotent) |
| `GET /api/v1/drivers/me/earnings` | driver | Settlement balance + ledger |
| `POST /api/v1/admin/payments/:id/refund` · `GET /api/v1/admin/drivers/:id/ledger` | admin | Full refund (audited) · a driver's ledger |
| Socket `payment:updated` | customer | Their booking's payment status changed |

- **Flow (card / Apple Pay)**: booking → Stripe PaymentIntent with `capture_method=manual` (funds held) →
  customer confirms on Stripe's form → webhook (or `/payment/sync`) marks it `authorized` → **only then is the booking
  dispatched**. On trip completion the hold is captured by a BullMQ job (`payments` queue, retried). Cancelling releases
  the hold (no fee — no cancellation-fee rule is approved yet). Unpaid card bookings are cancelled by the system after
  `PAYMENT_AUTH_TIMEOUT_MINUTES`. Cash bookings are dispatched immediately.
- **Safety**: one payment per booking (unique index); every Stripe write has an Idempotency-Key; webhooks are verified
  (HMAC-SHA256, 5-minute replay window) against the raw body, de-duplicated by event id (`payment_webhook_events`), and
  intents whose amount/currency differ from the booking are ignored and audited. Status changes follow
  `payment.rules.ts` (`pending → authorized → captured → refunded`; `failed` may be retried; `cancelled`/`refunded` are final),
  so duplicate or out-of-order events cannot move a payment backwards. The client's word is never taken: the app's
  "payment done" triggers a server-side read from Stripe. Live keys are refused outside production.
- **Invoices** (`invoices`, `invoice_number_seq` → `INV-000001`): issued in the same transaction as trip completion, from the
  booking's fare snapshot: trip amount excl. VAT, 5% VAT, total, payment method. **Without `INVOICE_TRN` the document is a
  receipt marked "not a tax invoice"** — set the 15-digit TRN before issuing production tax invoices.
- **Driver ledger** (`driver_ledger_entries`, one entry per booking and type): `trip_earning` = fare excl. VAT − commission
  (`pricing_rules.platform_commission_bps`, default 2000 = 20%), posted at completion; `cash_collected` = − total when the driver
  confirms cash. Balance > 0: TowNow owes the driver; < 0: the driver owes TowNow commission + VAT from cash jobs.
- **Setup**: Stripe account (UAE entity, AED), test keys in `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY`, a webhook endpoint for
  `https://<api>/api/v1/payments/webhooks/stripe` with events `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`,
  `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded` → its signing secret in `STRIPE_WEBHOOK_SECRET`;
  `PAYMENT_PROVIDER=stripe`. Local testing: `stripe listen --forward-to localhost:4000/api/v1/payments/webhooks/stripe`
  (prints a `whsec_…`), test card `4242 4242 4242 4242`, decline `4000 0000 0000 0002`. Apple Pay additionally needs domain
  verification in the Stripe dashboard.
- **Not yet**: partial refunds, cancellation fees, driver payouts (bank transfers), refund → driver clawback rules,
  authorisations older than Stripe's hold window (~7 days) for very long trips, PDF invoices (download is plain text).

Conventions: API routes are versioned (`/api/v1/...`); money is stored as integer **fils**
(1 AED = 100 fils) and rates in basis points; geodata uses PostGIS `geography(…, 4326)` with GiST
indexes; enum values match the frontend types in `../src/types/index.ts`.

## Operations, support & notifications (architecture plan)

| Endpoint | Who | What |
|---|---|---|
| `POST /bookings/:id/rating` | customer | Rate a completed tow once (1–5); updates `drivers.rating` |
| `POST /bookings/:id/disputes` · `GET /me/disputes` | customer / assigned driver | Raise a dispute (one open per job) |
| `GET /admin/disputes` · `POST /admin/disputes/:id/resolve` | admin | Decide disputes (audited; raiser notified) |
| `GET /admin/overview` · `GET /admin/bookings` · `GET /admin/bookings/:id` | admin | Dashboard counters, live job monitoring, timeline |
| `POST /admin/bookings/:id/cancel` | admin | Cancel a stuck job at any stage (driver released) |
| `GET /admin/commissions` · `POST /admin/drivers/:id/settlements` | admin | Driver balances; record remittance/payout (idempotent by reference) |
| `GET/POST /admin/pricing-rules` | admin | Versioned fares (new version effective now; VAT not editable) |
| `PUT/DELETE /me/devices` · `GET /me/notifications` | any user | FCM device tokens and in-app inbox |
| `GET /locations/search?q=` | any user | UAE address search via the routing provider's geocoder |

Push: booking/offer/KYC/dispute events are mirrored to the inbox and, with `PUSH_PROVIDER=fcm`
(service-account vars `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`), sent through FCM
HTTP v1 by the `notifications` BullMQ queue. Dead tokens are removed automatically.

Workers: `RUN_WORKERS=false` runs the API without BullMQ workers; `node dist/worker.js` runs them in
a separate process. Socket events from the worker reach clients through the Socket.IO Redis adapter.
Production compose: `deploy/`.
