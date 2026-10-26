import 'package:flutter/material.dart';
import 'package:townow_core/townow_core.dart';

import '../widgets.dart';
import 'completed_screen.dart';
import 'tracking_screen.dart';

/// Booking history with status filters.
class BookingsScreen extends StatefulWidget {
  const BookingsScreen({super.key});

  @override
  State<BookingsScreen> createState() => _BookingsScreenState();
}

class _BookingsScreenState extends State<BookingsScreen> {
  String _filter = 'all';
  int _version = 0;

  static const _filters = {
    'all': 'All',
    'active': 'Active',
    'completed': 'Completed',
    'cancelled': 'Cancelled',
  };

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
          child: Text('My tows', style: Theme.of(context).textTheme.headlineSmall),
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Row(
            children: [
              for (final e in _filters.entries) ...[
                ChoiceChip(
                  label: Text(e.value),
                  selected: _filter == e.key,
                  showCheckmark: false,
                  selectedColor: TnColors.navy,
                  labelStyle: TextStyle(
                    color: _filter == e.key ? TnColors.white : TnColors.text,
                    fontWeight: FontWeight.w700,
                  ),
                  backgroundColor: TnColors.white,
                  side: const BorderSide(color: TnColors.border),
                  onSelected: (_) => setState(() {
                    _filter = e.key;
                    _version++;
                  }),
                ),
                const SizedBox(width: 8),
              ],
            ],
          ),
        ),
        Expanded(
          child: Loader<List<Booking>>(
            key: ValueKey(_version),
            load: () => context.api.bookings(status: _filter == 'all' ? null : _filter),
            builder: (context, bookings, reload) => RefreshIndicator(
              onRefresh: reload,
              child: bookings.isEmpty
                  ? ListView(
                      children: const [
                        EmptyState(
                          icon: Icons.receipt_long_rounded,
                          title: 'No tows here yet',
                          message: 'Your bookings and receipts will appear here.',
                        ),
                      ],
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.all(20),
                      itemCount: bookings.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 12),
                      itemBuilder: (context, i) => _BookingCard(
                        booking: bookings[i],
                        onTap: () async {
                          final b = bookings[i];
                          await Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => b.status == 'completed'
                                  ? CompletedScreen(bookingId: b.id)
                                  : TrackingScreen(bookingId: b.id),
                            ),
                          );
                          reload();
                        },
                      ),
                    ),
            ),
          ),
        ),
      ],
    );
  }
}

class _BookingCard extends StatelessWidget {
  const _BookingCard({required this.booking, required this.onTap});

  final Booking booking;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final b = booking;
    final date = MaterialLocalizations.of(context).formatMediumDate(b.createdAt);
    final time = TimeOfDay.fromDateTime(b.createdAt).format(context);
    return TnCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(serviceFor(b.towType).icon, color: TnColors.navy, size: 20),
              const SizedBox(width: 8),
              Text(b.bookingNumber, style: const TextStyle(fontWeight: FontWeight.w800)),
              const Spacer(),
              StatusChip(b.status),
            ],
          ),
          const SizedBox(height: 12),
          _place(Icons.trip_origin, b.pickup.address),
          Padding(
            padding: const EdgeInsets.only(left: 9),
            child: Container(width: 2, height: 10, color: TnColors.border),
          ),
          _place(Icons.flag_rounded, b.dropoff.address),
          const Divider(height: 24),
          Row(
            children: [
              Expanded(
                child: Text(
                  '$date · $time · ${b.vehicle.title}',
                  style: const TextStyle(color: TnColors.muted, fontSize: 13),
                ),
              ),
              MoneyText(b.fare.totalFils, size: 16),
            ],
          ),
        ],
      ),
    );
  }

  Widget _place(IconData icon, String text) => Row(
    children: [
      Icon(icon, size: 20, color: TnColors.muted),
      const SizedBox(width: 10),
      Expanded(child: Text(text, maxLines: 1, overflow: TextOverflow.ellipsis)),
    ],
  );
}
