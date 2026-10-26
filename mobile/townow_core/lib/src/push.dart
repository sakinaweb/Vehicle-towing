import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'config.dart';
import 'endpoints.dart';

/// FCM push: registers this install with the API after sign-in. A no-op until the
/// Firebase client config is supplied (--dart-define FIREBASE_*), so the apps run without it.
class Push {
  Push(this.api);

  final ApiClient api;
  String? _token;

  static Future<bool> initialize() async {
    if (!TowNowConfig.pushConfigured) {
      debugPrint('Push disabled: FIREBASE_* dart-defines not set');
      return false;
    }
    try {
      await Firebase.initializeApp(
        options: const FirebaseOptions(
          apiKey: TowNowConfig.firebaseApiKey,
          appId: TowNowConfig.firebaseAppId,
          messagingSenderId: TowNowConfig.firebaseSenderId,
          projectId: TowNowConfig.firebaseProjectId,
        ),
      );
      return true;
    } catch (e) {
      debugPrint('Push disabled: Firebase init failed ($e)');
      return false;
    }
  }

  /// Call after sign-in. Asks for permission, then sends the token to the API.
  Future<void> register() async {
    if (Firebase.apps.isEmpty) return;
    try {
      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission();
      _token = await messaging.getToken();
      if (_token != null) await api.registerDevice(_token!, _platform);
      messaging.onTokenRefresh.listen((t) {
        _token = t;
        api.registerDevice(t, _platform).ignore();
      });
    } catch (e) {
      debugPrint('Push registration failed: $e');
    }
  }

  /// Call once at startup. Android shows nothing for a push while the app is open, so
  /// [onForeground] gets it to show in-app; [onOpen] gets the data of a tapped notification
  /// (also the one that launched the app).
  static void listen({
    required void Function(String title, String body, Map<String, dynamic> data) onForeground,
    required void Function(Map<String, dynamic> data) onOpen,
  }) {
    if (Firebase.apps.isEmpty) return;
    FirebaseMessaging.onMessage.listen(
      (m) => onForeground(m.notification?.title ?? '', m.notification?.body ?? '', m.data),
    );
    FirebaseMessaging.onMessageOpenedApp.listen((m) => onOpen(m.data));
    FirebaseMessaging.instance.getInitialMessage().then((m) {
      if (m != null) onOpen(m.data);
    }).ignore();
  }

  /// Call before sign-out so this phone stops receiving the account's notifications.
  Future<void> unregister() async {
    final token = _token;
    if (token == null) return;
    try {
      await api.removeDevice(token);
    } catch (_) {}
  }

  static String get _platform => Platform.isIOS ? 'ios' : 'android';
}
