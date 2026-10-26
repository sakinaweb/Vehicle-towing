import 'package:flutter/material.dart';
import 'package:townow_core/townow_core.dart';

const _entryLabels = {
  'trip_earning': 'Trip earning',
  'cash_collected': 'Cash collected from customer',
  'remittance': 'Paid to TowNow',
  'payout': 'Paid out to you',
};

const _entryIcons = {
  'trip_earning': Icons.local_shipping_rounded,
  'cash_collected': Icons.payments_rounded,
  'remittance': Icons.north_east_rounded,
  'payout': Icons.south_west_rounded,
};

/// Settlement balance from the server ledger: + TowNow owes you, − you owe TowNow.
/// Every figure is summed from real ledger entries; nothing is estimated.
class EarningsScreen extends StatelessWidget {
  const EarningsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Loader<DriverLedger>(
      load: context.api.earnings,
      builder: (context, ledger, reload) {
        final owes = ledger.balanceFils < 0;
        final now = DateTime.now();
        bool isToday(DateTime d) => d.year == now.year && d.month == now.month && d.day == now.day;
        final trips = ledger.entries.where((e) => e.type == 'trip_earning').toList();
        final todayFils = trips
            .where((e) => isToday(e.createdAt))
            .fold<int>(0, (a, e) => a + e.amountFils);
        final totalFils = trips.fold<int>(0, (a, e) => a + e.amountFils);
        final cashFils = ledger.entries
            .where((e) => e.type == 'cash_collected')
            .fold<int>(0, (a, e) => a + e.amountFils.abs());
        return RefreshIndicator(
          onRefresh: reload,
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Text('Earnings', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 16),
              TnCard(
                color: TnColors.navy,
                borderColor: TnColors.navy,
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Settlement balance', style: TextStyle(color: Colors.white70)),
                    const SizedBox(height: 4),
                    MoneyText(
                      ledger.balanceFils.abs(),
                      size: 36,
                      color: owes ? const Color(0xFFFF8A8A) : TnColors.lime,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      ledger.balanceFils == 0
                          ? 'All settled'
                          : owes
                          ? 'You owe TowNow (commission and VAT on cash jobs you collected)'
                          : 'TowNow owes you · paid out by TowNow operations',
                      style: const TextStyle(color: Colors.white70),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  _stat('Today', MoneyText(todayFils, size: 18)),
                  const SizedBox(width: 10),
                  _stat('All trips (${trips.length})', MoneyText(totalFils, size: 18)),
                  const SizedBox(width: 10),
                  _stat('Cash collected', MoneyText(cashFils, size: 18)),
                ],
              ),
              const SizedBox(height: 8),
              const Text(
                'Trip earnings are the fare excluding VAT, minus TowNow\'s 20% commission.',
                style: TextStyle(color: TnColors.muted, fontSize: 12),
              ),
              const SectionTitle('Activity'),
              if (ledger.entries.isEmpty)
                const TnCard(
                  child: EmptyState(
                    icon: Icons.account_balance_wallet_rounded,
                    title: 'No earnings yet',
                    message: 'Completed jobs and settlements appear here.',
                  ),
                )
              else
                TnCard(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                  child: Column(
                    children: [
                      for (var i = 0; i < ledger.entries.length; i++) ...[
                        _entryRow(context, ledger.entries[i]),
                        if (i < ledger.entries.length - 1) const Divider(),
                      ],
                    ],
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _stat(String label, Widget value) => Expanded(
    child: TnCard(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: TnColors.muted, fontSize: 12)),
          const SizedBox(height: 4),
          FittedBox(child: value),
        ],
      ),
    ),
  );

  Widget _entryRow(BuildContext context, LedgerEntry e) {
    final date = MaterialLocalizations.of(context).formatMediumDate(e.createdAt);
    final time = TimeOfDay.fromDateTime(e.createdAt).format(context);
    final negative = e.amountFils < 0;
    return InfoRow(
      icon: _entryIcons[e.type] ?? Icons.receipt_rounded,
      iconBg: negative ? const Color(0xFFFBE9E9) : const Color(0xFFE3F5EC),
      iconColor: negative ? TnColors.error : TnColors.success,
      title: _entryLabels[e.type] ?? e.type,
      subtitle: '$date · $time${e.reference == null ? '' : ' · ${e.reference}'}',
      trailing: MoneyText(
        e.amountFils,
        size: 15,
        signed: true,
        color: negative ? TnColors.error : TnColors.success,
      ),
    );
  }
}
