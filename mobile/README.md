# TowNow mobile apps (Flutter)

| Folder | What |
|---|---|
| `townow_core/` | Shared package: REST client (mobile sign-in, token refresh), models, Socket.IO, push registration, sign-in / inbox / map widgets |
| `customer_app/` | Customer: sign in, vehicles, request a tow (GPS pickup, address search or map pin), server quote, cash booking, live tracking, cancel, receipt, rating, disputes, notifications |
| `driver_app/` | Operator: sign in, KYC (profile, truck, 4 documents by camera/gallery), online/offline with GPS reporting, offers with countdown, trip steps, pickup/return inspections with camera photos, cash confirmation, settlement balance, notifications |

The server is the source of truth: fares, status changes, inspections and payouts are all
validated by the API; the apps only show what it returns (no invented ETAs or prices).

## Run

```bash
# API running on the host (backend/), then — Android emulator reaches the host at 10.0.2.2:
cd mobile/customer_app   # or driver_app
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000/api/v1
```

Physical phone: use the computer's LAN address, e.g. `--dart-define=API_BASE_URL=http://192.168.1.20:4000/api/v1`
(and run the API with `HOST` reachable on the LAN).

### Optional build settings (no secrets are compiled into the apps)

| Setting | How |
|---|---|
| Map tiles | Default: OpenStreetMap tiles via `flutter_map` (no key, no billing) with visible "© OpenStreetMap contributors" attribution; each app identifies itself to the tile server (`MapView.userAgentPackageName` in `main.dart`). Change provider with `--dart-define=MAP_TILE_URL=https://…/{z}/{x}/{y}.png MAP_ATTRIBUTION="…"`. The public OSM servers have no SLA and forbid offline/bulk use ([tile policy](https://operations.osmfoundation.org/policies/tiles/)) — use a commercial or self-hosted provider for launch. Optional Google Maps instead: `MAPS_API_KEY` (Android) / `GMSServices.provideAPIKey` (iOS) plus `--dart-define=GOOGLE_MAPS_ENABLED=true`. |
| Push (FCM) | `--dart-define=FIREBASE_API_KEY=… FIREBASE_APP_ID=… FIREBASE_MESSAGING_SENDER_ID=… FIREBASE_PROJECT_ID=…` (from the Firebase console). Without them push is off; the in-app inbox and sockets still work. |
| Address search / ETA | Server side: `ROUTING_PROVIDER=google` + `GOOGLE_MAPS_API_KEY` (or Mapbox) in `backend/.env`. |
| Support phone | `--dart-define=SUPPORT_PHONE=+9714xxxxxxx` shows "Call TowNow support" in both apps; hidden when not set. (UAE emergency 999 is always shown.) |

### Design system

Both apps use `townow_core/lib/src/ui/design.dart`: brand tokens (`TnColors` — Midnight Navy
`#101827`, TowNow Lime `#C8F34A`, …), `tnTheme()`, and shared components (`TnButton` with
double-tap protection, `TnCard`, `StatusChip`, `MoneyText`, `BookingTimeline`, `PulseRings`,
skeleton / empty / error states, `showTnSheet`, `confirmAction`). `MapView` shows real
OpenStreetMap tiles with the booking's real points (no drawn route until a routing provider exists).
"Nearby tow trucks" on the customer home comes from `GET /availability/nearby` (counts and
distance rounded to 500 m only — drivers' positions are never exposed).

## Android debug APKs

```bash
cd mobile/driver_app      # or customer_app
# Emulator (10.0.2.2 = the host PC):
flutter build apk --debug --target-platform android-arm64 --dart-define=API_BASE_URL=http://10.0.2.2:4000/api/v1
# Physical phone on the same Wi-Fi (use the PC's LAN IP; the API listens on 0.0.0.0:4000):
flutter build apk --debug --target-platform android-arm64 --dart-define=API_BASE_URL=http://192.168.1.4:4000/api/v1
# → build/app/outputs/flutter-apk/app-debug.apk ; install: adb install -r <apk>
```

- Debug builds allow plain HTTP (dev API); release builds are HTTPS-only unless built with
  `-P CLEARTEXT=true` (LAN test server only — never for a store build).

## Android release (testing) APKs

Release builds sign with `android/key.properties` when it exists (gitignored), else the debug key:

```properties
storePassword=…
keyPassword=…
keyAlias=townow
storeFile=D:/path/to/upload-keystore.jks
```

```bash
cd mobile/customer_app    # or driver_app
flutter build apk --release -P CLEARTEXT=true --dart-define=API_BASE_URL=http://192.168.1.4:4000/api/v1
# Production (HTTPS, no CLEARTEXT): --dart-define=API_BASE_URL=https://<api-host>/api/v1
```

Keep the keystore and its password safe: an installed app only accepts updates signed with the same key.
- `android/gradle.properties` is tuned for a low-RAM PC (1.5 GB Gradle heap, no daemon). Each build needs
  about **1.3 GB free disk** on the project drive (intermediates) plus ~90 MB for the APK, and ~1.5 GB free RAM.
- `--target-platform android-arm64` = real phones. For an x86_64 emulator use `android-x64`.
- Sign-in codes: in development the API logs OTP codes to its console (`SMS_PROVIDER=log`).

## Push notifications (Firebase Cloud Messaging) — setup

The code is complete (token registration + refresh, foreground banner, background/terminated
notifications, tap → the booking / work screen). Push stays off until Firebase is configured:

1. Firebase console → create a project (e.g. `townow`) → **Add app → Android** twice:
   `ae.townow.townow_customer` and `ae.townow.townow_driver`. No `google-services.json` is
   needed — the apps take their config from build defines.
2. For each app, from *Project settings → Your apps*: `apiKey`, `appId`, `messagingSenderId`,
   `projectId`. Build each APK with its own values:
   ```bash
   flutter build apk --release --dart-define=FIREBASE_API_KEY=… --dart-define=FIREBASE_APP_ID=… \
     --dart-define=FIREBASE_MESSAGING_SENDER_ID=… --dart-define=FIREBASE_PROJECT_ID=… [API_BASE_URL …]
   ```
3. API (`backend/.env`): *Project settings → Service accounts → Generate new private key*, then
   `PUSH_PROVIDER=fcm`, `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` (keep `\n` escapes).
   Never commit the key.

Pushed events: new job offer (driver), driver found / on the way / arrived / towing / completed /
cancelled (customer), chat message (the other side), SOS acknowledged/resolved (raiser), new SOS
(admins' inbox), KYC result, dispute decision, stale-GPS warning.

## Chat and SOS

- **Chat**: tracking screen (customer, chat icon) and job screen (driver). Live over Socket.IO,
  15 s refresh fallback; ticks show sending / sent / read, failed sends retry on tap (same client
  id → stored once). Read-only after the job ends. Operations can read it on the admin job page.
- **SOS**: the red SOS icon (tracking), the SOS button (driver job) and *Help → Send SOS* (customer).
  "Call 999" stays first. The alert carries GPS (8 s fix, else last known, else none) and the job,
  is saved, and reaches every admin live (admin panel → SOS) with acknowledge / resolve.

## Verify

```bash
cd mobile/townow_core && flutter analyze && flutter test
cd ../driver_app && flutter analyze && flutter test
cd ../customer_app && flutter analyze && flutter test

# Live end-to-end tow against a running dev API, using the apps' client code:
cd ../townow_core
LIVE_API=http://localhost:4000/api/v1 LIVE_API_LOG=<file with the API's console output> \
  flutter test test/live_flow_test.dart
```

## Not done yet

- Store builds (signing, icons, App Store / Play listings); release APK/IPA builds were not produced on the dev machine.
- Background location for drivers when the app is closed (needs a foreground service on Android / background mode on iOS); location is reported while the app is open.
- Card / Apple Pay in the apps (the business model is cash; the API supports Stripe when enabled).
- Arabic localisation.
