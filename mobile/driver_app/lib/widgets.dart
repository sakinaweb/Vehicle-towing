import 'package:flutter/material.dart';
import 'package:townow_core/townow_core.dart';

const towIcons = {
  'flatbed': Icons.local_shipping_rounded,
  'wheel-lift': Icons.directions_car_filled_rounded,
  'bike-carrier': Icons.two_wheeler_rounded,
};

/// Countdown ring for offer expiry (driven by the parent's 1 s tick).
class CountdownRing extends StatelessWidget {
  const CountdownRing({super.key, required this.secondsLeft, required this.totalSeconds});

  final int secondsLeft, totalSeconds;

  @override
  Widget build(BuildContext context) {
    final v = totalSeconds <= 0 ? 0.0 : (secondsLeft / totalSeconds).clamp(0.0, 1.0);
    return SizedBox(
      width: 64,
      height: 64,
      child: Stack(
        alignment: Alignment.center,
        children: [
          SizedBox.expand(
            child: CircularProgressIndicator(
              value: v,
              strokeWidth: 5,
              color: secondsLeft <= 5 ? TnColors.error : TnColors.lime,
              backgroundColor: TnColors.deepNavy,
            ),
          ),
          Text(
            '${secondsLeft.clamp(0, 999)}s',
            style: const TextStyle(
              color: TnColors.white,
              fontWeight: FontWeight.w900,
              fontSize: 16,
            ),
          ),
        ],
      ),
    );
  }
}

/// Pickup → drop-off route block.
class RouteBlock extends StatelessWidget {
  const RouteBlock({super.key, required this.pickup, required this.dropoff, this.onDark = false});

  final String pickup, dropoff;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    final text = onDark ? TnColors.white : TnColors.text;
    final sub = onDark ? Colors.white60 : TnColors.muted;
    Widget line(IconData icon, String label, String value) => Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 20, color: onDark ? TnColors.lime : TnColors.navy),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: TextStyle(color: sub, fontSize: 12)),
              Text(
                value,
                style: TextStyle(color: text, fontWeight: FontWeight.w700),
              ),
            ],
          ),
        ),
      ],
    );
    return Column(
      children: [
        line(Icons.trip_origin, 'Pickup', pickup),
        Padding(
          padding: const EdgeInsets.only(left: 9, top: 2, bottom: 2),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Container(
              width: 2,
              height: 14,
              color: onDark ? TnColors.deepNavy : TnColors.border,
            ),
          ),
        ),
        line(Icons.flag_rounded, 'Drop-off', dropoff),
      ],
    );
  }
}

/// Horizontal progress through the trip stages (real job status).
class TripProgress extends StatelessWidget {
  const TripProgress({super.key, required this.status});

  final String status;

  static const _stages = [
    ('driver_assigned', 'Accepted'),
    ('driver_arriving', 'On the way'),
    ('driver_arrived', 'Arrived'),
    ('in_transit', 'Towing'),
    ('completed', 'Done'),
  ];

  @override
  Widget build(BuildContext context) {
    final normalized = status == 'vehicle_loaded' ? 'in_transit' : status;
    final current = _stages.indexWhere((s) => s.$1 == normalized);
    return Row(
      children: [
        for (var i = 0; i < _stages.length; i++)
          Expanded(
            child: Column(
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 300),
                  height: 6,
                  margin: const EdgeInsets.symmetric(horizontal: 2),
                  decoration: BoxDecoration(
                    color: i <= current ? TnColors.navy : TnColors.border,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  _stages[i].$2,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: i == current ? FontWeight.w800 : FontWeight.w500,
                    color: i <= current ? TnColors.text : TnColors.muted,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
