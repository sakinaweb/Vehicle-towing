import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import 'session.dart';

/// An error the API returned, with the message to show the user.
class ApiException implements Exception {
  ApiException(this.status, this.message);

  final int status;
  final String message;

  bool get isNotFound => status == 404;
  bool get isConflict => status == 409;
  bool get isUnauthorized => status == 401;

  @override
  String toString() => message;
}

/// A file to upload (document scan, inspection photo).
class UploadFile {
  UploadFile({required this.bytes, required this.filename, required this.contentType});

  final List<int> bytes;
  final String filename;

  /// e.g. "image/jpeg", "application/pdf".
  final String contentType;
}

/// REST client for /api/v1. Signs in as a mobile client (refresh token in the body),
/// refreshes the access token once on a 401 and retries the request.
class ApiClient {
  ApiClient({
    required this.baseUrl,
    required this.sessions,
    required this.role,
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  /// e.g. http://10.0.2.2:4000/api/v1 (Android emulator → host machine).
  final String baseUrl;
  final SessionStore sessions;

  /// "customer" or "driver": the role this app signs in as.
  final String role;
  final http.Client _http;
  Future<Session?>? _refreshing;

  /// Called when the session can no longer be refreshed (signed out elsewhere, expired).
  void Function()? onSignedOut;

  Session? get session => sessions.current;
  String? get accessToken => sessions.current?.accessToken;

  // ---------------------------------------------------------------- auth

  Future<void> requestOtp(String phone) =>
      send('POST', '/auth/otp/request', body: {'phone': phone}, auth: false);

  Future<Session> verifyOtp(String phone, String code) async {
    final json =
        await send(
              'POST',
              '/auth/otp/verify',
              body: {'phone': phone, 'code': code, 'role': role},
              auth: false,
            )
            as Map<String, dynamic>;
    final session = Session.fromJson(json);
    await sessions.save(session);
    return session;
  }

  Future<void> signOut() async {
    try {
      if (session != null) await send('POST', '/auth/logout');
    } catch (_) {
      // Signing out locally must always work, even offline.
    }
    await sessions.clear();
  }

  // ---------------------------------------------------------------- requests

  /// JSON request. Returns the decoded body (null for 204).
  Future<dynamic> send(
    String method,
    String path, {
    Object? body,
    Map<String, String>? query,
    bool auth = true,
  }) {
    return _withAuth(auth, (token) async {
      final req = http.Request(method, _uri(path, query));
      _headers(req.headers, token);
      if (body != null) {
        req.headers['Content-Type'] = 'application/json';
        req.body = jsonEncode(body);
      }
      return _http.send(req);
    });
  }

  /// Multipart upload: one file under "file" plus text fields.
  Future<dynamic> upload(
    String method,
    String path, {
    required UploadFile file,
    Map<String, String> fields = const {},
  }) {
    return _withAuth(true, (token) async {
      final req = http.MultipartRequest(method, _uri(path, null));
      _headers(req.headers, token);
      req.fields.addAll(fields);
      req.files.add(
        http.MultipartFile.fromBytes(
          'file',
          file.bytes,
          filename: file.filename,
          contentType: MediaType.parse(file.contentType),
        ),
      );
      return _http.send(req);
    });
  }

  /// Raw bytes (private photos/documents shown in the app).
  Future<List<int>> bytes(String path) async {
    final res = await _withAuthRaw(true, (token) async {
      final req = http.Request('GET', _uri(path, null));
      _headers(req.headers, token);
      return _http.send(req);
    });
    return res.bodyBytes;
  }

  Uri _uri(String path, Map<String, String>? query) =>
      Uri.parse('$baseUrl$path').replace(queryParameters: query);

  void _headers(Map<String, String> h, String? token) {
    h['Accept'] = 'application/json';
    h['X-Client-Type'] = 'mobile';
    if (token != null) h['Authorization'] = 'Bearer $token';
  }

  Future<dynamic> _withAuth(
    bool auth,
    Future<http.StreamedResponse> Function(String? token) call,
  ) async {
    final res = await _withAuthRaw(auth, call);
    if (res.statusCode == 204 || res.bodyBytes.isEmpty) return null;
    return _json(res);
  }

  Future<http.Response> _withAuthRaw(
    bool auth,
    Future<http.StreamedResponse> Function(String? token) call,
  ) async {
    var res = await _send(call, auth ? accessToken : null);
    if (auth && res.statusCode == 401 && session != null) {
      final refreshed = await refresh();
      if (refreshed == null) {
        onSignedOut?.call();
        throw ApiException(401, 'Your session has ended. Please sign in again.');
      }
      res = await _send(call, refreshed.accessToken);
    }
    if (res.statusCode >= 400) throw ApiException(res.statusCode, _message(res));
    return res;
  }

  Future<http.Response> _send(
    Future<http.StreamedResponse> Function(String? token) call,
    String? token,
  ) async {
    try {
      return await http.Response.fromStream(await call(token).timeout(const Duration(seconds: 30)));
    } on TimeoutException {
      throw ApiException(
        0,
        'The TowNow server ($_server) didn\'t answer within 30 seconds. Check your connection and try again.',
      );
    } on http.ClientException catch (e) {
      throw ApiException(0, connectionErrorMessage(e, _server));
    }
  }

  String get _server => Uri.parse(baseUrl).authority;

  /// Tells "server not running" apart from "phone has no network" (status 0 = no HTTP answer).
  static String connectionErrorMessage(Object error, String server) {
    if (error is SocketException) {
      final code = error.osError?.errorCode;
      // Linux/Android, macOS/iOS, Windows errno values.
      const refused = {111, 61, 10061, 1225};
      const unreachable = {101, 113, 51, 65, 10051, 10065, 1231, 1232};
      if (refused.contains(code)) {
        return 'The TowNow server ($server) refused the connection. It may not be running.';
      }
      if (unreachable.contains(code)) {
        return 'Can\'t reach the TowNow server ($server) from this network. '
            'Check you\'re on the right Wi-Fi or mobile data.';
      }
      if (error.message.contains('Failed host lookup')) {
        return 'No internet connection (couldn\'t look up $server). Check Wi-Fi or mobile data.';
      }
    }
    return 'Cannot reach the TowNow server ($server). Check your connection.';
  }

  /// Rotates the refresh token. Concurrent 401s share one refresh. Null = signed out.
  Future<Session?> refresh() {
    final pending = _refreshing;
    if (pending != null) return pending;
    final next = _rotate();
    _refreshing = next;
    // Clear once settled; errors still reach the caller through `next`.
    next.then<void>((_) {}, onError: (Object _) {}).whenComplete(() => _refreshing = null);
    return next;
  }

  Future<Session?> _rotate() async {
    final current = session;
    if (current == null) return null;
    // A network failure throws (session kept); a refused token returns null (signed out).
    final res = await _send((_) {
      final req = http.Request('POST', _uri('/auth/refresh', null));
      _headers(req.headers, null);
      req.headers['Content-Type'] = 'application/json';
      req.body = jsonEncode({'refreshToken': current.refreshToken, 'role': role});
      return _http.send(req);
    }, null);
    if (res.statusCode != 200) {
      await sessions.clear();
      return null;
    }
    final next = Session.fromJson(_json(res) as Map<String, dynamic>);
    await sessions.save(next);
    return next;
  }

  /// JSON is UTF-8 by definition; never fall back to the HTTP default (Latin-1).
  static dynamic _json(http.Response res) => jsonDecode(utf8.decode(res.bodyBytes));

  static String _message(http.Response res) {
    try {
      final m = (_json(res) as Map<String, dynamic>)['message'];
      if (m is List) return m.join('\n');
      if (m is String && m.isNotEmpty) return m;
    } catch (_) {}
    if (res.statusCode >= 500) {
      return 'The TowNow server had a problem (HTTP ${res.statusCode}). Please try again shortly.';
    }
    return 'Something went wrong (HTTP ${res.statusCode}). Please try again.';
  }
}
