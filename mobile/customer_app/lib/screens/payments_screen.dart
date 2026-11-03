import 'package:flutter/material.dart';
import 'package:townow_core/townow_core.dart';

import 'completed_screen.dart';
import 'tracking_screen.dart';

const _methodLabels = {'cash': 'Cash', 'card': 'Card', 'apple_pay': 'Apple Pay'};
const _paymentLabels = {
  'captured': 'Paid',
  'authorized': 'Card held',
  'pending': 'Awaiting payment',
  'refunded': 'Refunded',
  'failed': 'Payment failed',
  'cancelled': 'Cancelled',
};

/// Every payment on my tows, straight from the server: what was paid, the VAT in it, how,
/// and the receipt. TowNow holds no customer balance — each tow is paid on its own.
class PaymentsScreen extends StatefulWidget {
  const PaymentsScreen({super.key});

  @override
  State<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends State<PaymentsScreen> {
  List<Booking>? _paid;
  bool _capped = false; // the API returns the latest 50 tows
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final all = await context.api.bookings();
      if (!mounted) return;
      setState(() {
        _capped = all.length >= 50;
        _paid = all.where((b) => b.payment != null).toList()
          ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final paid = _paid;
    return Scaffold(
      appBar: AppBar(title: const Text('Payments & receipts')),
      body: paid == null
          ? (_error == null
                ? const SkeletonList(count: 3)
                : ErrorState(message: _error!, onRetry: _load))
          : RefreshIndicator(
              onRefresh: _load,
              child: paid.isEmpty
                  ? ListView(
                      children: const [
                        SizedBox(height: 80),
                        EmptyState(
                          icon: Icons.receipt_long_rounded,
                          title: 'No payments yet',
                          message: 'Payments and receipts for your tows will appear here.',
                        ),
                      ],
                    )
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
                      children: [
                        _summary(paid),
                        if (_capped)
                          const Padding(
                            padding: EdgeInsets.only(top: 8),
                            child: Text(
                              'Showing your latest 50 tows; totals cover these tows only.',
                              style: TextStyle(color: TnColors.muted, fontSize: 12),
                            ),
                          ),
                        const SectionTitle('Payments'),
                        for (final b in paid) _row(b),
                      ],
                    ),
            ),
    );
  }

  Widget _summary(List<Booking> paid) {
    final captured = paid.where((b) => b.payment!.status == 'captured');
    final total = captured.fold<int>(0, (s, b) => s + b.payment!.amountFils);
    final vat = captured.fold<int>(0, (s, b) => s + b.fare.vatFils);
    return TnCard(
      key: const Key('payments-summary'),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Total paid', style: TextStyle(color: TnColors.muted)),
                const SizedBox(height: 4),
                MoneyText(total, size: 24),
                Text(
                  '${captured.length} paid tow${captured.length == 1 ? '' : 's'}',
                  style: const TextStyle(color: TnColors.muted),
                ),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              const Text('Incl. VAT (5%)', style: TextStyle(color: TnColors.muted)),
              const SizedBox(height: 4),
              Text(formatAed(vat), style: const TextStyle(fontWeight: FontWeight.w700)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _row(Booking b) {
    final p = b.payment!;
    final date = MaterialLocalizations.of(context).formatMediumDate(b.createdAt);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: TnCard(
        child: InkWell(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => b.status == 'completed'
                  ? CompletedScreen(bookingId: b.id)
                  : TrackingScreen(bookingId: b.id),
            ),
          ),
          child: Row(
            children: [
              Icon(
                p.method == 'cash' ? Icons.payments_rounded : Icons.credit_card_rounded,
                color: TnColors.deepNavy,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(b.bookingNumber, style: const TextStyle(fontWeight: FontWeight.w800)),
                    Text(
                      '$date · ${_methodLabels[p.method] ?? p.method} · ${_paymentLabels[p.status] ?? p.status}',
                      style: const TextStyle(color: TnColors.muted),
                    ),
                    if (b.status == 'completed')
                      const Text(
                        'Tap for the receipt',
                        style: TextStyle(color: TnColors.muted, fontSize: 12),
                      ),
                  ],
                ),
              ),
              MoneyText(p.amountFils, size: 16),
            ],
          ),
        ),
      ),
    );
  }
}
