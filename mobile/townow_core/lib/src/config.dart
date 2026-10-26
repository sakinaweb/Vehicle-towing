/// Build-time settings (--dart-define). No secrets live in the app.
abstract final class TowNowConfig {
  /// REST base, e.g. https://api.townow.ae/api/v1. Default: Android emulator → host machine.
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:4000/api/v1',
  );

  /// Set to true once a Google Maps key is in the platform config (AndroidManifest / AppDelegate).
  static const mapsEnabled = bool.fromEnvironment('GOOGLE_MAPS_ENABLED');

  /// Map tiles when Google Maps is off (the default). OpenStreetMap standard tiles are fine for
  /// dev/pilot under https://operations.osmfoundation.org/policies/tiles/ (no SLA); point this at
  /// a commercial or self-hosted provider for production — no code change needed.
  static const mapTileUrl = String.fromEnvironment(
    'MAP_TILE_URL',
    defaultValue: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  );
  static const mapAttribution = String.fromEnvironment(
    'MAP_ATTRIBUTION',
    defaultValue: '© OpenStreetMap contributors',
  );

  /// TowNow support line shown in the apps (optional; hidden when not set).
  static const supportPhone = String.fromEnvironment('SUPPORT_PHONE');

  /// Firebase (FCM) client config. Push stays off until these are provided.
  static const firebaseApiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const firebaseProjectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static const firebaseSenderId = String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID');
  static const firebaseAppId = String.fromEnvironment('FIREBASE_APP_ID');

  static bool get pushConfigured =>
      firebaseApiKey.isNotEmpty &&
      firebaseProjectId.isNotEmpty &&
      firebaseSenderId.isNotEmpty &&
      firebaseAppId.isNotEmpty;
}
