import 'package:flutter/material.dart';
import 'package:townow_core/townow_core.dart';

/// Services offered (all backed by the API's tow types; no invented services).
class TowService {
  const TowService(this.towType, this.title, this.subtitle, this.icon, this.category);

  final String towType, title, subtitle, category;
  final IconData icon;
}

const towServices = [
  TowService(
    'flatbed',
    'Flatbed towing',
    'Safest for cars, SUVs and luxury vehicles',
    Icons.local_shipping_rounded,
    'car',
  ),
  TowService(
    'wheel-lift',
    'Car towing',
    'Wheel-lift for short distances',
    Icons.directions_car_filled_rounded,
    'car',
  ),
  TowService(
    'bike-carrier',
    'Motorbike towing',
    'Dedicated bike carrier',
    Icons.two_wheeler_rounded,
    'motorbike',
  ),
];

TowService serviceFor(String towType) =>
    towServices.firstWhere((s) => s.towType == towType, orElse: () => towServices.first);

/// Selectable vehicle card.
class VehicleCard extends StatelessWidget {
  const VehicleCard({
    super.key,
    required this.vehicle,
    this.selected = false,
    this.onTap,
    this.trailing,
  });

  final Vehicle vehicle;
  final bool selected;
  final VoidCallback? onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(TnRadius.lg),
        boxShadow: selected
            ? [
                BoxShadow(
                  color: TnColors.navy.withValues(alpha: 0.12),
                  blurRadius: 14,
                  offset: const Offset(0, 6),
                ),
              ]
            : null,
      ),
      child: TnCard(
        onTap: onTap,
        borderColor: selected ? TnColors.navy : null,
        child: Row(
          children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: selected ? TnColors.lime : TnColors.bg,
                borderRadius: BorderRadius.circular(TnRadius.md),
              ),
              child: Icon(
                vehicle.category == 'car'
                    ? Icons.directions_car_filled_rounded
                    : Icons.two_wheeler_rounded,
                color: TnColors.navy,
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${_cap(vehicle.brand)} ${_cap(vehicle.model)}',
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      PlateBadge(vehicle.plateEmirate, vehicle.plateCode, vehicle.plateNumber),
                      const SizedBox(width: 8),
                      Text('${vehicle.year}', style: const TextStyle(color: TnColors.muted)),
                    ],
                  ),
                ],
              ),
            ),
            if (trailing != null)
              trailing!
            else if (selected)
              const Icon(Icons.check_circle_rounded, color: TnColors.navy),
          ],
        ),
      ),
    );
  }
}

String _cap(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

/// UAE-style number plate chip.
class PlateBadge extends StatelessWidget {
  const PlateBadge(this.emirate, this.code, this.number, {super.key});

  final String emirate, code, number;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: TnColors.white,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: TnColors.navy, width: 1.2),
      ),
      child: Text(
        '$emirate  $code $number',
        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, letterSpacing: 0.4),
      ),
    );
  }
}

/// Avatar from initials (no stock photos of people).
class InitialsAvatar extends StatelessWidget {
  const InitialsAvatar(this.name, {super.key, this.size = 48, this.dark = true});

  final String name;
  final double size;
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    final initials = parts.isEmpty ? '?' : parts.take(2).map((p) => p[0].toUpperCase()).join();
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: dark ? TnColors.navy : TnColors.lime,
        shape: BoxShape.circle,
      ),
      child: Text(
        initials,
        style: TextStyle(
          color: dark ? TnColors.lime : TnColors.navy,
          fontWeight: FontWeight.w900,
          fontSize: size * 0.36,
        ),
      ),
    );
  }
}
