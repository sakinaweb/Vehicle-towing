import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The signed-in user as the API returns it.
class AppUser {
  AppUser({required this.id, required this.phone, required this.role, this.fullName, this.email});

  factory AppUser.fromJson(Map<String, dynamic> j) => AppUser(
    id: j['id'] as String,
    phone: j['phone'] as String,
    role: j['role'] as String,
    fullName: j['fullName'] as String?,
    email: j['email'] as String?,
  );

  final String id;
  final String phone;
  final String role;
  final String? fullName;
  final String? email;

  Map<String, dynamic> toJson() => {
    'id': id,
    'phone': phone,
    'role': role,
    'fullName': fullName,
    'email': email,
  };
}

class Session {
  Session({
    required this.user,
    required this.accessToken,
    required this.refreshToken,
    this.isNewUser = false,
  });

  factory Session.fromJson(Map<String, dynamic> j) => Session(
    user: AppUser.fromJson(j['user'] as Map<String, dynamic>),
    accessToken: j['accessToken'] as String,
    refreshToken: j['refreshToken'] as String,
    isNewUser: j['isNewUser'] as bool? ?? false,
  );

  final AppUser user;
  final String accessToken;
  final String refreshToken;
  final bool isNewUser;

  Map<String, dynamic> toJson() => {
    'user': user.toJson(),
    'accessToken': accessToken,
    'refreshToken': refreshToken,
  };
}

/// Where the session lives between app launches.
abstract class SessionStore {
  Session? get current;
  Future<Session?> load();
  Future<void> save(Session session);
  Future<void> clear();
}

/// Keychain (iOS) / Keystore-backed storage (Android). Tokens never go to plain prefs.
class SecureSessionStore implements SessionStore {
  SecureSessionStore(this.key);

  /// Separate per app, e.g. "townow.customer.session".
  final String key;
  final _storage = const FlutterSecureStorage();
  Session? _current;

  @override
  Session? get current => _current;

  @override
  Future<Session?> load() async {
    try {
      final raw = await _storage.read(key: key);
      _current = raw == null ? null : Session.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      _current = null; // unreadable after an OS restore → sign in again
    }
    return _current;
  }

  @override
  Future<void> save(Session session) async {
    _current = session;
    await _storage.write(key: key, value: jsonEncode(session.toJson()));
  }

  @override
  Future<void> clear() async {
    _current = null;
    await _storage.delete(key: key);
  }
}

/// For tests and scripts.
class MemorySessionStore implements SessionStore {
  @override
  Session? current;

  @override
  Future<Session?> load() async => current;

  @override
  Future<void> save(Session session) async => current = session;

  @override
  Future<void> clear() async => current = null;
}
