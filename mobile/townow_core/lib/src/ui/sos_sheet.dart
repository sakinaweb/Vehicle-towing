import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../api_client.dart';
import '../endpoints.dart';
import 'app_scope.dart';
import 'design.dart';
import 'map_view.dart';

/// Best-effort position for an SOS: a fresh fix within 8 s, else the last known one, else none.
/// Never blocks the SOS on GPS or permission problems.
Future<Position?> sosPosition() async {
  try {
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
      return null;
    }
    try {
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 8),
        ),
      );
    } catch (_) {
      return await Geolocator.getLastKnownPosition();
    }
  } catch (_) {
    return null; // GPS off, no plugin (tests), …
  }
}

/// Emergency sheet: call 999 first, or alert TowNow operations (with location and job).
Future<void> showSosSheet(BuildContext context, {String? bookingId}) {
  return showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    builder: (ctx) => _SosSheet(bookingId: bookingId, outer: context),
  );
}

class _SosSheet extends StatefulWidget {
  const _SosSheet({required this.bookingId, required this.outer});

  final String? bookingId;
  final BuildContext outer;

  @override
  State<_SosSheet> createState() => _SosSheetState();
}

class _SosSheetState extends State<_SosSheet> {
  bool _sending = false;

  Future<void> _sendSos() async {
    setState(() => _sending = true);
    final api = context.api;
    final navigator = Navigator.of(context);
    final outer = widget.outer;
    final pos = await sosPosition();
    try {
      await api.raiseSos(
        bookingId: widget.bookingId,
        lat: pos?.latitude,
        lng: pos?.longitude,
        accuracyMeters: pos?.accuracy,
      );
      navigator.pop();
      if (outer.mounted) {
        outer.toast(
          pos == null
              ? 'SOS sent to TowNow support (without location — GPS unavailable).'
              : 'SOS sent. TowNow support has your location and will contact you.',
          success: true,
        );
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _sending = false);
      context.toast('${e.message} Call 999 if you are in danger.', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Emergency', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            const Text(
              'If anyone is hurt or in danger, call 999 first.',
              style: TextStyle(color: TnColors.muted),
            ),
            const SizedBox(height: 16),
            TnButton(
              key: const Key('sos-call-999'),
              icon: Icons.call_rounded,
              label: 'Call 999 (Police · Ambulance)',
              onPressed: () => callNumber('999'),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              key: const Key('sos-send'),
              style: OutlinedButton.styleFrom(
                foregroundColor: TnColors.error,
                minimumSize: const Size.fromHeight(52),
                side: const BorderSide(color: TnColors.error),
              ),
              onPressed: _sending ? null : _sendSos,
              icon: _sending
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.sos_rounded),
              label: Text(_sending ? 'Sending SOS…' : 'Send SOS to TowNow support'),
            ),
            const SizedBox(height: 8),
            Text(
              widget.bookingId == null
                  ? 'Shares your current location with the TowNow operations team.'
                  : 'Shares your current location and this job with the TowNow operations team.',
              style: const TextStyle(color: TnColors.muted, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}
