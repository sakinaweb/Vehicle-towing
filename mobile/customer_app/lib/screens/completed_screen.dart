import 'package:flutter/material.dart';
import 'package:townow_core/townow_core.dart';

/// Completed tow: receipt from the server, rating (once), and raising a dispute.
class CompletedScreen extends StatefulWidget {
  const CompletedScreen({super.key, required this.bookingId});

  final String bookingId;

  @override
  State<CompletedScreen> createState() => _CompletedScreenState();
}

class _CompletedScreenState extends State<CompletedScreen> {
  int _version = 0;

  @override
  Widget build(BuildContext context) {
    final api = context.api;
    return Scaffold(
      appBar: AppBar(title: const Text('Trip summary')),
      body: Loader<(Booking, Invoice?)>(
        key: ValueKey(_version),
        load: () async {
          final b = await api.booking(widget.bookingId);
          Invoice? inv;
          try {
            inv = await api.invoice(widget.bookingId);
          } on ApiException {
            inv = null; // issued at completion; absent for cancelled jobs
          }
          return (b, inv);
        },
        builder: (context, data, reload) {
          final (b, inv) = data;
          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 28),
            children: [
              TnCard(
                color: TnColors.navy,
                borderColor: TnColors.navy,
                padding: const EdgeInsets.all(20),
                child: Row(
                  children: [
                    Container(
                      width: 52,
                      height: 52,
                      decoration: const BoxDecoration(color: TnColors.lime, shape: BoxShape.circle),
                      child: const Icon(Icons.check_rounded, color: TnColors.navy, size: 30),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            b.status == 'completed' ? 'Tow completed' : statusLabel(b.status),
                            style: const TextStyle(
                              color: TnColors.white,
                              fontSize: 20,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          Text(
                            '${b.bookingNumber} · ${b.dropoff.address}',
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: Colors.white70),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              if (inv != null) ...[const SectionTitle('Receipt'), _receipt(inv)],
              const SectionTitle('Your driver'),
              if (b.myRating != null)
                TnCard(
                  child: InfoRow(
                    icon: Icons.star_rounded,
                    iconBg: TnColors.lime,
                    title: 'You rated ${b.driver?.firstName ?? 'the driver'} ${b.myRating}★',
                    subtitle: 'Thanks — ratings keep TowNow drivers accountable.',
                  ),
                )
              else if (b.driver != null)
                _RateCard(booking: b, onRated: () => setState(() => _version++)),
              const SizedBox(height: 20),
              OutlinedButton.icon(
                icon: const Icon(Icons.support_agent_rounded),
                label: const Text('Report a problem with this tow'),
                onPressed: () => _dispute(b),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _receipt(Invoice inv) {
    final paid = inv.paymentStatus == 'captured';
    return TnCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '${inv.title} ${inv.invoiceNumber}',
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                ),
              ),
              StatusChip(paid ? 'captured' : 'pending', label: paid ? 'Paid' : 'Due to driver'),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            '${inv.sellerName} · TRN ${inv.sellerTrn ?? 'not registered'}',
            style: const TextStyle(color: TnColors.muted),
          ),
          if (inv.notice != null) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFFDF3E1),
                borderRadius: BorderRadius.circular(TnRadius.sm),
              ),
              child: Text(
                inv.notice!,
                style: const TextStyle(fontSize: 12, color: TnColors.warning),
              ),
            ),
          ],
          const Divider(height: 24),
          KeyValueRow('Towing service (excl. VAT)', formatAed(inv.subtotalFils)),
          KeyValueRow('VAT ${inv.vatRateBps / 100}%', formatAed(inv.vatFils)),
          const Divider(height: 18),
          Row(
            children: [
              const Expanded(
                child: Text('Total', style: TextStyle(fontWeight: FontWeight.w800)),
              ),
              MoneyText(inv.totalFils, size: 24),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Payment: ${inv.paymentMethod == 'cash' ? 'Cash' : inv.paymentMethod}',
            style: const TextStyle(color: TnColors.muted, fontSize: 13),
          ),
        ],
      ),
    );
  }

  Future<void> _dispute(Booking b) async {
    final reason = TextEditingController();
    final api = context.api;
    final sent = await showTnSheet<bool>(
      context,
      builder: (ctx) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('What went wrong?', style: Theme.of(ctx).textTheme.titleLarge),
          const SizedBox(height: 4),
          const Text(
            'TowNow support reviews every report, including the driver\'s inspection photos.',
            style: TextStyle(color: TnColors.muted),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: reason,
            maxLines: 4,
            decoration: const InputDecoration(
              hintText: 'Describe the problem (at least 10 characters)',
            ),
          ),
          const SizedBox(height: 14),
          TnButton(
            label: 'Send to TowNow',
            onPressed: () async {
              final d = await ctx.guard(() => api.raiseDispute(b.id, reason.text.trim()));
              if (d != null && ctx.mounted) Navigator.pop(ctx, true);
            },
          ),
        ],
      ),
    );
    if (sent == true && mounted) {
      context.toast('Sent to TowNow support. We\'ll notify you of the decision.', success: true);
    }
  }
}

class _RateCard extends StatefulWidget {
  const _RateCard({required this.booking, required this.onRated});

  final Booking booking;
  final VoidCallback onRated;

  @override
  State<_RateCard> createState() => _RateCardState();
}

class _RateCardState extends State<_RateCard> {
  int _stars = 0;
  final _comment = TextEditingController();

  @override
  Widget build(BuildContext context) {
    return TnCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'How was ${widget.booking.driver!.firstName}?',
            textAlign: TextAlign.center,
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
          ),
          const SizedBox(height: 6),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var i = 1; i <= 5; i++)
                IconButton(
                  key: Key('star-$i'),
                  iconSize: 36,
                  icon: Icon(
                    i <= _stars ? Icons.star_rounded : Icons.star_outline_rounded,
                    color: i <= _stars ? TnColors.warning : TnColors.border,
                  ),
                  onPressed: () => setState(() => _stars = i),
                ),
            ],
          ),
          TextField(
            controller: _comment,
            decoration: const InputDecoration(labelText: 'Comment (optional)'),
          ),
          const SizedBox(height: 12),
          TnButton(
            key: const Key('submit-rating'),
            label: 'Submit rating',
            onPressed: _stars == 0
                ? null
                : () async {
                    final b = await context.guard(
                      () => context.api.rate(widget.booking.id, _stars, _comment.text.trim()),
                    );
                    if (b != null) widget.onRated();
                  },
          ),
        ],
      ),
    );
  }
}
