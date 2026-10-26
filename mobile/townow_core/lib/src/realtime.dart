import 'package:socket_io_client/socket_io_client.dart' as io;

import 'api_client.dart';

/// Live events from /realtime (Socket.IO). The access token authenticates the socket;
/// REST stays the source of truth, so a missed event is caught up by the next fetch.
class Realtime {
  Realtime(this.api);

  final ApiClient api;
  io.Socket? _socket;
  final _handlers = <String, List<void Function(Map<String, dynamic>)>>{};

  bool get connected => _socket?.connected ?? false;

  /// Socket.IO origin, e.g. http://10.0.2.2:4000 for http://10.0.2.2:4000/api/v1.
  String get _origin => Uri.parse(api.baseUrl).replace(path: '').toString();

  void connect() {
    if (_socket != null) return;
    var retriedAuth = false;
    final socket = io.io(
      '$_origin/realtime',
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuthFn((cb) => cb({'token': api.accessToken ?? ''}))
          .enableReconnection()
          .build(),
    );
    socket.onConnectError((err) async {
      // Expired access token: refresh once, then reconnect with the new one.
      if ('$err'.contains('unauthorized') && !retriedAuth) {
        retriedAuth = true;
        try {
          if (await api.refresh() != null) socket.connect();
        } catch (_) {}
      }
    });
    socket.onConnect((_) => retriedAuth = false);
    socket.onAny((event, data) {
      for (final h in [...?_handlers[event]]) {
        h(_asMap(data));
      }
    });
    _socket = socket;
  }

  /// Registers a handler (before or after connect). Returns a function that removes it.
  void Function() on(String event, void Function(Map<String, dynamic>) handler) {
    _handlers.putIfAbsent(event, () => []).add(handler);
    return () => _handlers[event]?.remove(handler);
  }

  void disconnect() {
    _socket?.dispose();
    _socket = null;
  }

  static Map<String, dynamic> _asMap(dynamic data) =>
      data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
}

/// Event names, as emitted by the API.
abstract final class RealtimeEvents {
  static const offerNew = 'offer:new';
  static const offerClosed = 'offer:closed';
  static const jobCancelled = 'job:cancelled';
  static const bookingUpdated = 'booking:updated';
  static const kycUpdated = 'kyc:updated';
  static const tripLocation = 'trip:location';
  static const paymentUpdated = 'payment:updated';
  static const disputeUpdated = 'dispute:updated';
}
