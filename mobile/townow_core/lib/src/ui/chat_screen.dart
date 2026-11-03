import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';

import '../api_client.dart';
import '../endpoints.dart';

import '../models.dart';
import '../realtime.dart';
import 'app_scope.dart';
import 'design.dart';

/// Random UUID v4 (the message's client id, so a retried send is stored once).
String newClientId() {
  final r = Random.secure();
  final b = List<int>.generate(16, (_) => r.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-'
      '${h.substring(16, 20)}-${h.substring(20)}';
}

/// Customer ↔ driver chat for one booking. Live over Socket.IO, with a 15 s refresh as a
/// safety net while the socket reconnects. My messages show sending / sent / read / failed.
class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.bookingId, required this.title, this.canSend = true});

  final String bookingId;

  /// e.g. "Chat with your driver".
  final String title;

  /// False once the job is over: history stays readable.
  final bool canSend;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final _unsubscribe = <void Function()>[];
  List<ChatMessage> _messages = [];
  bool _loading = true;

  /// The server closed the chat (job finished) while this screen was open.
  bool _closed = false;
  bool get _canSend => widget.canSend && !_closed;
  String? _error;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    final rt = context.realtime;
    _unsubscribe.addAll([
      rt.on(RealtimeEvents.chatMessage, (d) {
        if (d['bookingId'] != widget.bookingId || !mounted) return;
        setState(() => _upsert(ChatMessage.fromJson(d)));
        _scrollToEnd();
        if (d['mine'] != true) _markRead();
      }),
      rt.on(RealtimeEvents.chatRead, (d) {
        if (d['bookingId'] != widget.bookingId || !mounted) return;
        final at = DateTime.tryParse('${d['readAt']}')?.toLocal() ?? DateTime.now();
        setState(() {
          for (final m in _messages.where((m) => m.mine && m.delivery == ChatDelivery.sent)) {
            m
              ..readAt = at
              ..delivery = ChatDelivery.read;
          }
        });
      }),
    ]);
    _poll = Timer.periodic(const Duration(seconds: 15), (_) => _load(quiet: true));
    _load();
  }

  @override
  void dispose() {
    _poll?.cancel();
    for (final u in _unsubscribe) {
      u();
    }
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load({bool quiet = false}) async {
    try {
      final server = await context.api.chatMessages(widget.bookingId);
      if (!mounted) return;
      // Keep my messages that have not reached the server yet.
      final pending = _messages.where(
        (m) => m.delivery == ChatDelivery.sending || m.delivery == ChatDelivery.failed,
      );
      setState(() {
        _messages = [
          ...server,
          ...pending.where((p) => !server.any((s) => s.clientId == p.clientId)),
        ];
        _loading = false;
        _error = null;
      });
      _scrollToEnd();
      if (server.any((m) => !m.mine && m.readAt == null)) _markRead();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        if (!quiet || _messages.isEmpty) _error = e.message;
      });
    }
  }

  void _upsert(ChatMessage m) {
    final i = _messages.indexWhere(
      (x) => x.id == m.id || (m.clientId != null && x.clientId == m.clientId),
    );
    if (i >= 0) {
      _messages[i] = m;
    } else {
      _messages.add(m);
    }
  }

  Future<void> _markRead() async {
    try {
      await context.api.markChatRead(widget.bookingId);
    } on ApiException {
      // Not critical: the other side just won't see "read" yet.
    }
  }

  Future<void> _send([ChatMessage? retry]) async {
    final text = retry?.body ?? _input.text.trim();
    if (text.isEmpty) return;
    final local =
        retry ??
        ChatMessage(
          id: 'local-${newClientId()}',
          bookingId: widget.bookingId,
          clientId: newClientId(),
          senderRole: '',
          mine: true,
          body: text,
          createdAt: DateTime.now(),
          delivery: ChatDelivery.sending,
        );
    setState(() {
      local.delivery = ChatDelivery.sending;
      if (retry == null) {
        _messages.add(local);
        _input.clear();
      }
    });
    _scrollToEnd();
    final api = context.api;
    try {
      final saved = await api.sendChat(widget.bookingId, text, local.clientId!);
      if (mounted) setState(() => _upsert(saved));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        local.delivery = ChatDelivery.failed;
        // 409: the job ended while this screen was open — retrying can never work.
        if (e.isConflict) _closed = true;
      });
      if (e.status != 0) context.toast(e.message, error: true); // 0 = offline: the tick says it
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final online = context.realtime.connected;
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Column(
        children: [
          if (!online)
            Container(
              width: double.infinity,
              color: TnColors.warning.withValues(alpha: 0.12),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: const Text(
                'Reconnecting… new messages may take a few seconds.',
                style: TextStyle(color: TnColors.warning, fontWeight: FontWeight.w600),
              ),
            ),
          Expanded(child: _body()),
          if (_canSend) _composer() else _readOnlyNote(),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null && _messages.isEmpty) {
      return ErrorState(message: _error!, onRetry: _load);
    }
    if (_messages.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Text(
            'No messages yet. Say where exactly you are, or anything the other side should know.',
            textAlign: TextAlign.center,
            style: TextStyle(color: TnColors.muted),
          ),
        ),
      );
    }
    return ListView.builder(
      key: const Key('chat-list'),
      controller: _scroll,
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
      itemCount: _messages.length,
      itemBuilder: (_, i) => _bubble(_messages[i]),
    );
  }

  Widget _bubble(ChatMessage m) {
    final bg = m.mine ? TnColors.deepNavy : TnColors.white;
    final fg = m.mine ? TnColors.white : TnColors.deepNavy;
    return Align(
      alignment: m.mine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onTap: m.delivery == ChatDelivery.failed && _canSend ? () => _send(m) : null,
        child: Container(
          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.fromLTRB(14, 10, 12, 8),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(TnRadius.lg),
            border: m.mine ? null : Border.all(color: TnColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: Text(m.body, style: TextStyle(color: fg, fontSize: 15)),
              ),
              const SizedBox(height: 4),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    m.delivery == ChatDelivery.failed
                        ? (_canSend ? 'Not sent · tap to retry' : 'Not sent · chat closed')
                        : _hhmm(m.createdAt),
                    style: TextStyle(
                      fontSize: 11,
                      color: m.delivery == ChatDelivery.failed
                          ? TnColors.error
                          : fg.withValues(alpha: 0.65),
                    ),
                  ),
                  if (m.mine) ...[const SizedBox(width: 4), _tick(m.delivery)],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _tick(ChatDelivery d) => switch (d) {
    ChatDelivery.sending => const Icon(
      Icons.schedule_rounded,
      size: 14,
      color: Colors.white70,
      semanticLabel: 'Sending',
    ),
    ChatDelivery.failed => const Icon(
      Icons.error_outline_rounded,
      size: 14,
      color: TnColors.error,
      semanticLabel: 'Not sent',
    ),
    ChatDelivery.sent => const Icon(
      Icons.done_rounded,
      size: 14,
      color: Colors.white70,
      semanticLabel: 'Sent',
    ),
    ChatDelivery.read => const Icon(
      Icons.done_all_rounded,
      size: 14,
      color: TnColors.lime,
      semanticLabel: 'Read',
    ),
  };

  Widget _composer() => SafeArea(
    top: false,
    child: Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
      decoration: const BoxDecoration(
        color: TnColors.white,
        border: Border(top: BorderSide(color: TnColors.border)),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              key: const Key('chat-input'),
              controller: _input,
              minLines: 1,
              maxLines: 4,
              maxLength: 1000,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(hintText: 'Message', counterText: ''),
              onSubmitted: (_) => _send(),
            ),
          ),
          const SizedBox(width: 6),
          IconButton.filled(
            key: const Key('chat-send'),
            tooltip: 'Send',
            onPressed: () => _send(),
            icon: const Icon(Icons.send_rounded),
          ),
        ],
      ),
    ),
  );

  Widget _readOnlyNote() => const SafeArea(
    top: false,
    child: Padding(
      padding: EdgeInsets.all(16),
      child: Text(
        'This job is closed, so the chat is read-only.',
        style: TextStyle(color: TnColors.muted),
      ),
    ),
  );
}

String _hhmm(DateTime t) =>
    '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
