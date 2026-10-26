import 'package:flutter/material.dart';

import '../format.dart';

/// TowNow design tokens (brand palette).
abstract final class TnColors {
  static const navy = Color(0xFF101827); // Midnight Navy
  static const deepNavy = Color(0xFF17243A);
  static const lime = Color(0xFFC8F34A); // TowNow Lime
  static const white = Color(0xFFFFFFFF);
  static const bg = Color(0xFFF5F7FA);
  static const text = Color(0xFF182230);
  static const muted = Color(0xFF697586);
  static const border = Color(0xFFE4E7EC);
  static const success = Color(0xFF16865B);
  static const error = Color(0xFFD64545);
  static const warning = Color(0xFFB7791F);
}

abstract final class TnRadius {
  static const sm = 10.0;
  static const md = 14.0;
  static const lg = 20.0;
  static const xl = 28.0;
}

/// Tabular figures so prices and timers don't jump as digits change.
const _tabular = [FontFeature.tabularFigures()];

ThemeData tnTheme() {
  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    colorScheme: ColorScheme.fromSeed(
      seedColor: TnColors.navy,
      primary: TnColors.navy,
      onPrimary: TnColors.white,
      secondary: TnColors.lime,
      onSecondary: TnColors.navy,
      surface: TnColors.white,
      onSurface: TnColors.text,
      error: TnColors.error,
    ),
  );
  final t = base.textTheme.apply(bodyColor: TnColors.text, displayColor: TnColors.text);
  final text = t.copyWith(
    displaySmall: t.displaySmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.5),
    headlineMedium: t.headlineMedium?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.4),
    headlineSmall: t.headlineSmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.3),
    titleLarge: t.titleLarge?.copyWith(fontWeight: FontWeight.w700),
    titleMedium: t.titleMedium?.copyWith(fontWeight: FontWeight.w700),
    titleSmall: t.titleSmall?.copyWith(fontWeight: FontWeight.w600),
    bodyMedium: t.bodyMedium?.copyWith(height: 1.4),
    bodySmall: t.bodySmall?.copyWith(color: TnColors.muted, height: 1.35),
    labelLarge: t.labelLarge?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.1),
  );
  final input = OutlineInputBorder(
    borderRadius: BorderRadius.circular(TnRadius.md),
    borderSide: const BorderSide(color: TnColors.border),
  );
  return base.copyWith(
    scaffoldBackgroundColor: TnColors.bg,
    textTheme: text,
    dividerTheme: const DividerThemeData(color: TnColors.border, space: 1, thickness: 1),
    appBarTheme: AppBarTheme(
      backgroundColor: TnColors.bg,
      foregroundColor: TnColors.text,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: text.titleLarge?.copyWith(fontWeight: FontWeight.w800),
    ),
    cardTheme: CardThemeData(
      color: TnColors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(TnRadius.lg),
        side: const BorderSide(color: TnColors.border),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: TnColors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: input,
      enabledBorder: input,
      focusedBorder: input.copyWith(borderSide: const BorderSide(color: TnColors.navy, width: 1.6)),
      errorBorder: input.copyWith(borderSide: const BorderSide(color: TnColors.error)),
      labelStyle: const TextStyle(color: TnColors.muted),
      floatingLabelStyle: const TextStyle(color: TnColors.navy, fontWeight: FontWeight.w600),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: TnColors.lime,
        foregroundColor: TnColors.navy,
        disabledBackgroundColor: TnColors.border,
        disabledForegroundColor: TnColors.muted,
        minimumSize: const Size.fromHeight(56),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(TnRadius.md)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: TnColors.navy,
        minimumSize: const Size.fromHeight(52),
        side: const BorderSide(color: TnColors.border, width: 1.4),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(TnRadius.md)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: TnColors.navy,
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: TnColors.white,
      surfaceTintColor: Colors.transparent,
      indicatorColor: TnColors.lime,
      height: 70,
      labelTextStyle: WidgetStatePropertyAll(
        text.labelMedium?.copyWith(fontWeight: FontWeight.w700),
      ),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: TnColors.white,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(TnRadius.xl)),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: TnColors.white,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(TnRadius.lg)),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: TnColors.navy,
      contentTextStyle: const TextStyle(color: TnColors.white, fontWeight: FontWeight.w600),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(TnRadius.md)),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? TnColors.navy : TnColors.white,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected) ? TnColors.lime : TnColors.border,
      ),
      trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? TnColors.navy : TnColors.white,
        ),
        foregroundColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? TnColors.white : TnColors.text,
        ),
        side: const WidgetStatePropertyAll(BorderSide(color: TnColors.border)),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(TnRadius.md)),
        ),
        minimumSize: const WidgetStatePropertyAll(Size(0, 48)),
      ),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: TnColors.navy,
      linearTrackColor: TnColors.border,
    ),
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {TargetPlatform.android: FadeForwardsPageTransitionsBuilder()},
    ),
  );
}

// ---------------------------------------------------------------- brand

/// Typographic wordmark (no official logo asset exists in the project).
class TnWordmark extends StatelessWidget {
  const TnWordmark({super.key, this.size = 28, this.onDark = false});

  final double size;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: size * 1.15,
          height: size * 1.15,
          decoration: BoxDecoration(
            color: TnColors.lime,
            borderRadius: BorderRadius.circular(size * 0.32),
          ),
          child: Icon(Icons.local_shipping_rounded, color: TnColors.navy, size: size * 0.72),
        ),
        SizedBox(width: size * 0.35),
        Text(
          'TowNow',
          style: TextStyle(
            fontSize: size,
            fontWeight: FontWeight.w900,
            letterSpacing: -0.8,
            color: onDark ? TnColors.white : TnColors.navy,
          ),
        ),
      ],
    );
  }
}

/// Navy hero header with rounded bottom corners (top of home dashboards).
class TnHeroHeader extends StatelessWidget {
  const TnHeroHeader({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.fromLTRB(20, MediaQuery.paddingOf(context).top + 16, 20, 28),
      decoration: const BoxDecoration(
        color: TnColors.navy,
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(TnRadius.xl)),
      ),
      child: DefaultTextStyle.merge(
        style: const TextStyle(color: TnColors.white),
        child: child,
      ),
    );
  }
}

// ---------------------------------------------------------------- building blocks

class TnCard extends StatelessWidget {
  const TnCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.onTap,
    this.color,
    this.borderColor,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final Color? color;
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(TnRadius.lg);
    return Material(
      color: color ?? TnColors.white,
      shape: RoundedRectangleBorder(
        borderRadius: radius,
        side: BorderSide(color: borderColor ?? TnColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: padding, child: child),
      ),
    );
  }
}

enum TnButtonKind { primary, dark, secondary, danger }

/// Primary actions. Shows a spinner and ignores taps while its action runs, so a
/// double tap can never submit twice.
class TnButton extends StatefulWidget {
  const TnButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.kind = TnButtonKind.primary,
  });

  final String label;
  final IconData? icon;
  final TnButtonKind kind;

  /// Null = disabled. Async actions keep the button busy until they finish.
  final Future<void> Function()? onPressed;

  @override
  State<TnButton> createState() => _TnButtonState();
}

class _TnButtonState extends State<TnButton> {
  bool _busy = false;

  Future<void> _run() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await widget.onPressed!();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (widget.kind) {
      TnButtonKind.primary => (TnColors.lime, TnColors.navy),
      TnButtonKind.dark => (TnColors.navy, TnColors.white),
      TnButtonKind.danger => (TnColors.error, TnColors.white),
      TnButtonKind.secondary => (TnColors.white, TnColors.navy),
    };
    final child = _busy
        ? SizedBox(
            width: 22,
            height: 22,
            child: CircularProgressIndicator(strokeWidth: 2.6, color: fg),
          )
        : Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (widget.icon != null) ...[Icon(widget.icon, size: 20), const SizedBox(width: 10)],
              Flexible(child: Text(widget.label, overflow: TextOverflow.ellipsis)),
            ],
          );
    final onPressed = widget.onPressed == null || _busy ? null : _run;
    if (widget.kind == TnButtonKind.secondary) {
      return OutlinedButton(onPressed: onPressed, child: child);
    }
    return FilledButton(
      onPressed: onPressed,
      style: FilledButton.styleFrom(backgroundColor: bg, foregroundColor: fg),
      child: child,
    );
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.trailing});

  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 20, 4, 10),
      child: Row(
        children: [
          Expanded(
            child: Text(
              text.toUpperCase(),
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w800,
                letterSpacing: 1.1,
                color: TnColors.muted,
              ),
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// Icon tile + title/subtitle + optional trailing — the standard list row.
class InfoRow extends StatelessWidget {
  const InfoRow({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.iconColor,
    this.iconBg,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final Color? iconColor, iconBg;

  @override
  Widget build(BuildContext context) {
    final row = Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: iconBg ?? TnColors.bg,
              borderRadius: BorderRadius.circular(TnRadius.sm),
            ),
            child: Icon(icon, size: 22, color: iconColor ?? TnColors.navy),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(subtitle!, style: const TextStyle(color: TnColors.muted, fontSize: 13)),
                ],
              ],
            ),
          ),
          ?trailing,
        ],
      ),
    );
    return onTap == null
        ? row
        : InkWell(borderRadius: BorderRadius.circular(TnRadius.md), onTap: onTap, child: row);
  }
}

class MoneyText extends StatelessWidget {
  const MoneyText(this.fils, {super.key, this.size = 28, this.color, this.signed = false});

  final int fils;
  final double size;
  final Color? color;
  final bool signed;

  @override
  Widget build(BuildContext context) {
    final sign = signed ? (fils < 0 ? '−' : '+') : '';
    return Text(
      '$sign${formatAed(signed ? fils.abs() : fils)}',
      style: TextStyle(
        fontSize: size,
        fontWeight: FontWeight.w900,
        letterSpacing: -0.5,
        color: color ?? TnColors.text,
        fontFeatures: _tabular,
      ),
    );
  }
}

class KeyValueRow extends StatelessWidget {
  const KeyValueRow(this.label, this.value, {super.key, this.bold = false});

  final String label, value;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final style = TextStyle(
      fontSize: bold ? 16 : 14,
      fontWeight: bold ? FontWeight.w800 : FontWeight.w500,
      color: bold ? TnColors.text : TnColors.muted,
      fontFeatures: _tabular,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          Text(value, style: style.copyWith(color: TnColors.text)),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- status

enum ChipTone { neutral, info, success, warning, danger, lime }

/// Colour + label for a status value (booking, KYC, dispute, document, payment).
(String, ChipTone) statusStyle(String status) => switch (status) {
  'requested' || 'searching' => (statusLabel(status), ChipTone.info),
  'driver_assigned' ||
  'driver_arriving' ||
  'driver_arrived' => (statusLabel(status), ChipTone.lime),
  'vehicle_loaded' || 'in_transit' => (statusLabel(status), ChipTone.lime),
  'completed' || 'approved' || 'resolved' || 'captured' => (_title(status), ChipTone.success),
  'cancelled' || 'rejected' || 'expired' || 'failed' => (_title(status), ChipTone.danger),
  'pending' || 'open' || 'draft' => (_title(status), ChipTone.warning),
  'online' => ('Online', ChipTone.success),
  'offline' => ('Offline', ChipTone.neutral),
  _ => (_title(status), ChipTone.neutral),
};

String _title(String s) {
  final label = bookingStatusLabels[s] ?? s.replaceAll('_', ' ');
  return label.isEmpty ? label : label[0].toUpperCase() + label.substring(1);
}

class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key, this.label});

  final String status;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final (text, tone) = statusStyle(status);
    final (bg, fg) = switch (tone) {
      ChipTone.info => (const Color(0xFFE8F0FE), const Color(0xFF1D4ED8)),
      ChipTone.success => (const Color(0xFFE3F5EC), TnColors.success),
      ChipTone.warning => (const Color(0xFFFDF3E1), TnColors.warning),
      ChipTone.danger => (const Color(0xFFFBE9E9), TnColors.error),
      ChipTone.lime => (TnColors.lime, TnColors.navy),
      ChipTone.neutral => (TnColors.bg, TnColors.muted),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(99)),
      child: Text(
        label ?? text,
        style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w800),
      ),
    );
  }
}

/// The real booking lifecycle as a vertical timeline. Only states the server
/// reported are marked done; times come from the booking history.
class BookingTimeline extends StatelessWidget {
  const BookingTimeline({super.key, required this.status, this.times = const {}});

  final String status;

  /// status → when it happened (from booking history).
  final Map<String, DateTime> times;

  static const _steps = [
    ('requested', 'Requested'),
    ('driver_assigned', 'Driver assigned'),
    ('driver_arriving', 'On the way'),
    ('driver_arrived', 'Arrived'),
    ('in_transit', 'Towing'),
    ('completed', 'Completed'),
  ];
  static const _order = [
    'requested',
    'searching',
    'driver_assigned',
    'driver_arriving',
    'driver_arrived',
    'vehicle_loaded',
    'in_transit',
    'completed',
  ];

  @override
  Widget build(BuildContext context) {
    final current = _order.indexOf(status);
    return Column(
      children: [
        for (var i = 0; i < _steps.length; i++)
          _row(context, i, current >= _order.indexOf(_steps[i].$1) && current >= 0),
      ],
    );
  }

  Widget _row(BuildContext context, int i, bool done) {
    final (key, label) = _steps[i];
    final at = times[key];
    final isLast = i == _steps.length - 1;
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 28,
            child: Column(
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 300),
                  width: 18,
                  height: 18,
                  decoration: BoxDecoration(
                    color: done ? TnColors.navy : TnColors.white,
                    shape: BoxShape.circle,
                    border: Border.all(color: done ? TnColors.navy : TnColors.border, width: 2),
                  ),
                  child: done ? const Icon(Icons.check, size: 12, color: TnColors.lime) : null,
                ),
                if (!isLast)
                  Expanded(
                    child: Container(width: 2, color: done ? TnColors.navy : TnColors.border),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Text(
                label,
                style: TextStyle(
                  fontWeight: done ? FontWeight.w700 : FontWeight.w500,
                  color: done ? TnColors.text : TnColors.muted,
                ),
              ),
            ),
          ),
          if (at != null)
            Text(
              TimeOfDay.fromDateTime(at).format(context),
              style: const TextStyle(color: TnColors.muted, fontSize: 12),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- motion

/// Expanding rings — "searching" / "online" indicator. Restrained and cheap.
class PulseRings extends StatefulWidget {
  const PulseRings({super.key, this.size = 120, this.color = TnColors.lime, this.child});

  final double size;
  final Color color;
  final Widget? child;

  @override
  State<PulseRings> createState() => _PulseRingsState();
}

class _PulseRingsState extends State<PulseRings> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1800))
    ..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.size,
      height: widget.size,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, child) => Stack(
          alignment: Alignment.center,
          children: [
            for (final offset in [0.0, 0.5])
              Builder(
                builder: (_) {
                  final t = (_c.value + offset) % 1;
                  return Container(
                    width: widget.size * (0.35 + 0.65 * t),
                    height: widget.size * (0.35 + 0.65 * t),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: widget.color.withValues(alpha: 0.45 * (1 - t)),
                    ),
                  );
                },
              ),
            ?child,
          ],
        ),
        child: widget.child,
      ),
    );
  }
}

// ---------------------------------------------------------------- states

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.message, this.action});

  final IconData icon;
  final String title;
  final String? message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 40),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 72,
            height: 72,
            decoration: const BoxDecoration(color: TnColors.white, shape: BoxShape.circle),
            child: Icon(icon, size: 34, color: TnColors.navy),
          ),
          const SizedBox(height: 16),
          Text(title, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
          if (message != null) ...[
            const SizedBox(height: 6),
            Text(
              message!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: TnColors.muted),
            ),
          ],
          if (action != null) ...[const SizedBox(height: 20), action!],
        ],
      ),
    );
  }
}

class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.message, this.onRetry});

  final String message;
  final Future<void> Function()? onRetry;

  @override
  Widget build(BuildContext context) {
    return EmptyState(
      icon: Icons.wifi_off_rounded,
      title: 'Something went wrong',
      message: message,
      action: onRetry == null
          ? null
          : SizedBox(
              width: 180,
              child: TnButton(label: 'Try again', kind: TnButtonKind.secondary, onPressed: onRetry),
            ),
    );
  }
}

/// Soft pulsing placeholder block.
class Skeleton extends StatefulWidget {
  const Skeleton({super.key, this.height = 16, this.width = double.infinity, this.radius = 8});

  final double height, width, radius;

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))
    ..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: Tween(begin: 0.45, end: 1.0).animate(_c),
      child: Container(
        height: widget.height,
        width: widget.width,
        decoration: BoxDecoration(
          color: const Color(0xFFE6EAF0),
          borderRadius: BorderRadius.circular(widget.radius),
        ),
      ),
    );
  }
}

class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.count = 4});

  final int count;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.all(20),
      physics: const NeverScrollableScrollPhysics(),
      itemCount: count,
      separatorBuilder: (_, _) => const SizedBox(height: 12),
      itemBuilder: (_, _) => const TnCard(
        child: Row(
          children: [
            Skeleton(width: 42, height: 42, radius: 10),
            SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Skeleton(width: 160),
                  SizedBox(height: 8),
                  Skeleton(width: 100, height: 12),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Modal sheet with consistent padding and keyboard handling.
Future<T?> showTnSheet<T>(BuildContext context, {required WidgetBuilder builder}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (ctx) => Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(ctx).bottom),
      child: SingleChildScrollView(child: builder(ctx)),
    ),
  );
}

/// Confirmation dialog for destructive or irreversible actions.
Future<bool> confirmAction(
  BuildContext context, {
  required String title,
  required String message,
  required String confirm,
  bool danger = false,
}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Not now')),
        FilledButton(
          style: danger
              ? FilledButton.styleFrom(
                  backgroundColor: TnColors.error,
                  foregroundColor: TnColors.white,
                  minimumSize: const Size(0, 44),
                )
              : FilledButton.styleFrom(minimumSize: const Size(0, 44)),
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(confirm),
        ),
      ],
    ),
  );
  return ok == true;
}
