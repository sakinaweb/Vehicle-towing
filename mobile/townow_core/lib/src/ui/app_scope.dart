import 'package:flutter/material.dart';

import '../api_client.dart';
import '../realtime.dart';
import 'design.dart';

/// Gives every screen the API client and the realtime connection.
class AppScope extends InheritedWidget {
  const AppScope({super.key, required this.api, required this.realtime, required super.child});

  final ApiClient api;
  final Realtime realtime;

  /// The client and socket never change for the app's lifetime, so no dependency is
  /// registered — safe to call from initState.
  static AppScope of(BuildContext context) => context.getInheritedWidgetOfExactType<AppScope>()!;

  @override
  bool updateShouldNotify(AppScope oldWidget) =>
      api != oldWidget.api || realtime != oldWidget.realtime;
}

/// In-app banner for a push that arrives while the app is open.
void showPushBanner(
  ScaffoldMessengerState messenger,
  String title,
  String body, {
  VoidCallback? onView,
}) {
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        duration: const Duration(seconds: 6),
        backgroundColor: TnColors.navy,
        content: Row(
          children: [
            const Icon(Icons.notifications_active_rounded, color: TnColors.lime),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
                  if (body.isNotEmpty) Text(body),
                ],
              ),
            ),
          ],
        ),
        action: onView == null
            ? null
            : SnackBarAction(label: 'View', textColor: TnColors.lime, onPressed: onView),
      ),
    );
}

extension AppScopeX on BuildContext {
  ApiClient get api => AppScope.of(this).api;
  Realtime get realtime => AppScope.of(this).realtime;

  void toast(String message, {bool error = false, bool success = false}) {
    ScaffoldMessenger.of(this)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Row(
            children: [
              Icon(
                error
                    ? Icons.error_outline_rounded
                    : success
                    ? Icons.check_circle_rounded
                    : Icons.info_outline_rounded,
                color: error ? TnColors.white : TnColors.lime,
              ),
              const SizedBox(width: 12),
              Expanded(child: Text(message)),
            ],
          ),
          backgroundColor: error ? TnColors.error : TnColors.navy,
        ),
      );
  }

  /// Runs an API action, showing its error message instead of throwing.
  Future<T?> guard<T>(Future<T> Function() action) async {
    try {
      return await action();
    } on ApiException catch (e) {
      if (mounted) toast(e.message, error: true);
      return null;
    }
  }
}

/// The app theme (kept under its original name for existing callers).
ThemeData townowTheme() => tnTheme();

/// Loading (skeleton) / error / content for a future-backed screen.
class Loader<T> extends StatefulWidget {
  const Loader({super.key, required this.load, required this.builder, this.skeleton});

  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data, Future<void> Function() reload) builder;

  /// Custom placeholder; a list skeleton by default.
  final Widget? skeleton;

  @override
  State<Loader<T>> createState() => _LoaderState<T>();
}

class _LoaderState<T> extends State<Loader<T>> {
  T? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    try {
      final data = await widget.load();
      if (mounted) {
        setState(() {
          _data = data;
          _error = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    if (data != null) return widget.builder(context, data, _reload);
    if (_error != null) {
      return Center(
        child: ErrorState(message: _error!, onRetry: _reload),
      );
    }
    return widget.skeleton ?? const SkeletonList();
  }
}
