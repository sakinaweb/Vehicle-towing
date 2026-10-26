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

- Debug builds allow plain HTTP (dev API); release builds are HTTPS-only.
- `android/gradle.properties` is tuned for a low-RAM PC (1.5 GB Gradle heap, no daemon). Each build needs
  about **1.3 GB free disk** on the project drive (intermediates) plus ~90 MB for the APK, and ~1.5 GB free RAM.
- `--target-platform android-arm64` = real phones. For an x86_64 emulator use `android-x64`.
- Sign-in codes: in development the API logs OTP codes to its console (`SMS_PROVIDER=log`).

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
