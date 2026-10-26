import 'package:flutter/material.dart';
import 'package:townow_core/townow_core.dart';

import '../widgets.dart';
import 'inspection_screen.dart';

/// The accepted job, step by step. Every step is checked by the server (order,
/// inspections submitted) — the buttons only offer what the server will accept.
class JobScreen extends StatefulWidget {
  const JobScreen({super.key, required this.job, required this.onChanged});

  final DriverJob job;
  final Future<void> Function() onChanged;

  @override
  State<JobScreen> createState() => _JobScreenState();
}

class _JobScreenState extends State<JobScreen> {
  DriverJob get job => widget.job;

  Future<void> _step(String step) async {
    final api = context.api;
    final navigator = Navigator.of(context);
    final updated = await context.guard(() => api.advance(job.bookingId, step));
    if (updated == null) return;
    if (updated.status == 'completed') {
      await navigator.push(
        MaterialPageRoute<void>(builder: (_) => CompletedJobScreen(job: updated)),
      );
    }
    await widget.onChanged();
  }

  Future<void> _inspect(String stage) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => InspectionScreen(job: job, stage: stage),
      ),
    );
    await widget.onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final toPickup = ['driver_assigned', 'driver_arriving'].contains(job.status);
    final towing = job.status == 'in_transit' || job.status == 'vehicle_loaded';
    return RefreshIndicator(
      onRefresh: widget.onChanged,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
        children: [
          Row(
            children: [
              Text(
                job.bookingNumber,
                style: const TextStyle(color: TnColors.muted, fontWeight: FontWeight.w700),
              ),
              const Spacer(),
              StatusChip(job.status),
            ],
          ),
          const SizedBox(height: 6),
          Text(statusLabel(job.status), style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 14),
          TripProgress(status: job.status),
          const SizedBox(height: 18),
          MapView(
            height: 200,
            markers: [
              MapMarker(
                'pickup',
                job.pickup.lat,
                job.pickup.lng,
                'Pickup',
                icon: Icons.trip_origin,
                note: job.pickup.address,
              ),
              MapMarker(
                'dropoff',
                job.dropoff.lat,
                job.dropoff.lng,
                'Drop-off',
                hue: 120,
                icon: Icons.flag_rounded,
                note: job.dropoff.address,
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (toPickup || towing)
            TnButton(
              kind: TnButtonKind.dark,
              icon: Icons.navigation_rounded,
              label: toPickup ? 'Navigate to pickup' : 'Navigate to drop-off',
              onPressed: () => navigateTo(toPickup ? job.pickup : job.dropoff),
            ),
          const SectionTitle('Job'),
          TnCard(
            child: Column(
              children: [
                InfoRow(
                  icon: towIcons[job.towType] ?? Icons.local_shipping_rounded,
                  iconBg: TnColors.lime,
                  title: job.vehicleTitle,
                  subtitle: '${job.vehiclePlate} · ${job.issue}',
                ),
                const Divider(height: 20),
                RouteBlock(pickup: job.pickup.address, dropoff: job.dropoff.address),
                if (job.notes != null) ...[
                  const Divider(height: 20),
                  InfoRow(
                    icon: Icons.sticky_note_2_rounded,
                    title: 'Customer note',
                    subtitle: job.notes,
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),
          TnCard(
            child: Column(
              children: [
                Row(
                  children: [
                    const Expanded(
                      child: Text('Your payout', style: TextStyle(color: TnColors.muted)),
                    ),
                    MoneyText(job.driverPayoutFils, size: 22),
                  ],
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Icon(
                      job.paymentMethod == 'cash'
                          ? Icons.payments_rounded
                          : Icons.credit_card_rounded,
                      size: 18,
                      color: TnColors.muted,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        job.paymentMethod == 'cash'
                            ? 'Collect ${formatAed(job.fareTotalFils)} in cash from ${job.customerFirstName}'
                            : 'Card — charged by TowNow, do not collect cash',
                        style: const TextStyle(color: TnColors.muted),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          ..._actions(),
        ],
      ),
    );
  }

  List<Widget> _actions() {
    Widget primary(String label, Future<void> Function()? onPressed, {IconData? icon}) =>
        TnButton(key: const Key('step'), label: label, icon: icon, onPressed: onPressed);
    Widget inspection(String stage, String state) => TnCard(
      onTap: state == 'submitted' ? null : () => _inspect(stage),
      borderColor: state == 'submitted' ? TnColors.success : TnColors.navy,
      child: InfoRow(
        icon: state == 'submitted' ? Icons.check_circle_rounded : Icons.photo_camera_rounded,
        iconBg: state == 'submitted' ? const Color(0xFFE3F5EC) : TnColors.lime,
        iconColor: state == 'submitted' ? TnColors.success : TnColors.navy,
        title:
            '${stage == 'pickup' ? 'Pickup' : 'Return'} inspection'
            '${state == 'submitted'
                ? ' — submitted'
                : state == 'draft'
                ? ' — continue'
                : ''}',
        subtitle: state == 'submitted'
            ? 'Locked and saved'
            : 'Odometer, fuel, condition and 4 photos',
        trailing: state == 'submitted' ? null : const Icon(Icons.chevron_right_rounded),
      ),
    );

    switch (job.status) {
      case 'driver_assigned':
        return [
          primary(
            'Start driving to pickup',
            () => _step('en-route'),
            icon: Icons.play_arrow_rounded,
          ),
        ];
      case 'driver_arriving':
        return [primary('I have arrived', () => _step('arrived'), icon: Icons.place_rounded)];
      case 'driver_arrived':
        return [
          inspection('pickup', job.pickupInspection),
          const SizedBox(height: 12),
          primary(
            'Vehicle loaded — start tow',
            job.pickupInspection == 'submitted' ? () => _step('start-tow') : null,
            icon: Icons.local_shipping_rounded,
          ),
        ];
      case 'vehicle_loaded':
      case 'in_transit':
        return [
          inspection('return', job.returnInspection),
          const SizedBox(height: 12),
          primary(
            'Delivered — complete job',
            job.returnInspection == 'submitted' ? () => _step('complete') : null,
            icon: Icons.flag_rounded,
          ),
        ];
      default:
        return const [];
    }
  }
}

/// After completion: payout, and for cash jobs, confirming the cash was collected.
class CompletedJobScreen extends StatefulWidget {
  const CompletedJobScreen({super.key, required this.job});

  final DriverJob job;

  @override
  State<CompletedJobScreen> createState() => _CompletedJobScreenState();
}

class _CompletedJobScreenState extends State<CompletedJobScreen> {
  bool _cashRecorded = false;

  Future<void> _confirmCash() async {
    final api = context.api;
    final ok = await context.guard(() async {
      await api.confirmCash(widget.job.bookingId, widget.job.fareTotalFils);
      return true;
    });
    if (!mounted) return;
    setState(() => _cashRecorded = _cashRecorded || ok != null);
    if (ok != null) context.toast('Cash collection recorded', success: true);
  }

  @override
  Widget build(BuildContext context) {
    final job = widget.job;
    final cash = job.paymentMethod == 'cash';
    return Scaffold(
      appBar: AppBar(title: Text(job.bookingNumber)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 28),
        children: [
          TnCard(
            color: TnColors.navy,
            borderColor: TnColors.navy,
            padding: const EdgeInsets.all(22),
            child: Column(
              children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration: const BoxDecoration(color: TnColors.lime, shape: BoxShape.circle),
                  child: const Icon(Icons.check_rounded, color: TnColors.navy, size: 36),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Job completed',
                  style: TextStyle(
                    color: TnColors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                const Text('Your payout', style: TextStyle(color: Colors.white60)),
                MoneyText(job.driverPayoutFils, size: 32, color: TnColors.lime),
              ],
            ),
          ),
          const SectionTitle('Breakdown'),
          TnCard(
            child: Column(
              children: [
                KeyValueRow('Fare paid by customer (incl. VAT)', formatAed(job.fareTotalFils)),
                KeyValueRow(
                  'Your payout (after 20% commission)',
                  formatAed(job.driverPayoutFils),
                  bold: true,
                ),
              ],
            ),
          ),
          const SectionTitle('Payment'),
          if (cash && !_cashRecorded) ...[
            TnCard(
              borderColor: TnColors.warning,
              child: InfoRow(
                icon: Icons.payments_rounded,
                iconBg: const Color(0xFFFDF3E1),
                iconColor: TnColors.warning,
                title: 'Collect ${formatAed(job.fareTotalFils)} in cash',
                subtitle: 'Confirm once you have the full amount from ${job.customerFirstName}.',
              ),
            ),
            const SizedBox(height: 12),
            TnButton(
              key: const Key('confirm-cash'),
              label: 'Confirm ${formatAed(job.fareTotalFils)} cash collected',
              onPressed: _confirmCash,
            ),
          ],
          if (cash && _cashRecorded)
            const TnCard(
              child: InfoRow(
                icon: Icons.check_circle_rounded,
                iconBg: Color(0xFFE3F5EC),
                iconColor: TnColors.success,
                title: 'Cash collection recorded',
                subtitle: 'It\'s in your earnings ledger.',
              ),
            ),
          if (!cash)
            const TnCard(
              child: InfoRow(
                icon: Icons.credit_card_rounded,
                title: 'Card payment',
                subtitle: 'Charged automatically. Do not collect cash.',
              ),
            ),
          const SizedBox(height: 20),
          TnButton(
            label: 'Back to work',
            kind: TnButtonKind.secondary,
            onPressed: () async => Navigator.of(context).pop(),
          ),
        ],
      ),
    );
  }
}
