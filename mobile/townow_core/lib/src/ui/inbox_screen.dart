import 'package:flutter/material.dart';

import '../endpoints.dart';
import '../models.dart';
import 'app_scope.dart';
import 'design.dart';

IconData _iconFor(String type) {
  if (type.startsWith('offer')) return Icons.notifications_active_rounded;
  if (type.startsWith('kyc')) return Icons.verified_user_rounded;
  if (type.startsWith('dispute')) return Icons.support_agent_rounded;
  if (type.endsWith('completed')) return Icons.flag_rounded;
  if (type.endsWith('cancelled')) return Icons.cancel_rounded;
  return Icons.local_shipping_rounded;
}

/// The user's notifications (the same ones sent as push), newest first.
class InboxScreen extends StatefulWidget {
  const InboxScreen({super.key});

  @override
  State<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends State<InboxScreen> {
  int _version = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          TextButton(
            onPressed: () async {
              await context.guard(context.api.markAllRead);
              if (mounted) setState(() => _version++);
            },
            child: const Text('Mark all read'),
          ),
        ],
      ),
      body: Loader<Inbox>(
        key: ValueKey(_version),
        load: context.api.inbox,
        builder: (context, inbox, reload) => RefreshIndicator(
          onRefresh: reload,
          child: inbox.items.isEmpty
              ? ListView(
                  children: const [
                    EmptyState(
                      icon: Icons.notifications_none_rounded,
                      title: 'You\'re all caught up',
                      message: 'Trip updates and messages from TowNow appear here.',
                    ),
                  ],
                )
              : ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: inbox.items.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (_, i) {
                    final n = inbox.items[i];
                    final unread = n.readAt == null;
                    return TnCard(
                      borderColor: unread ? TnColors.navy : null,
                      child: InfoRow(
                        icon: _iconFor(n.type),
                        iconBg: unread ? TnColors.lime : TnColors.bg,
                        title: n.title,
                        subtitle: n.body,
                        trailing: Text(
                          _ago(n.createdAt),
                          style: const TextStyle(color: TnColors.muted, fontSize: 12),
                        ),
                      ),
                    );
                  },
                ),
        ),
      ),
    );
  }

  static String _ago(DateTime t) {
    final d = DateTime.now().difference(t);
    if (d.inMinutes < 1) return 'now';
    if (d.inHours < 1) return '${d.inMinutes}m';
    if (d.inDays < 1) return '${d.inHours}h';
    return '${d.inDays}d';
  }
}
