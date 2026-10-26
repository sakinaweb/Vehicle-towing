import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:townow_core/townow_core.dart';

void main() {
  // flutter_map's tile cache asks path_provider for a folder; tests have no plugins.
  setUp(() {
    final dir = Directory.systemTemp.createTempSync('tile-cache');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      (_) async => dir.path,
    );
  });

  testWidgets('map shows loading, then a retry card when tiles fail; attribution stays', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: MapView(markers: [MapMarker('pickup', 25.2, 55.27, 'Pickup')]),
        ),
      ),
    );
    expect(find.text('Loading map…'), findsOneWidget);
    expect(find.text('© OpenStreetMap contributors'), findsOneWidget);

    // flutter_test answers every HTTP request with 400, so every tile fails.
    for (var i = 0; i < 20 && find.text('Retry').evaluate().isEmpty; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200)));
      await tester.pump();
    }
    expect(find.text('Map couldn\'t load. Check your connection.'), findsOneWidget);
    expect(find.text('Loading map…'), findsNothing);
    expect(find.text('© OpenStreetMap contributors'), findsOneWidget);
    expect(find.byTooltip('Pickup'), findsOneWidget); // real points stay on screen

    await tester.tap(find.text('Retry'));
    await tester.pump();
    expect(find.text('Loading map…'), findsOneWidget);

    await tester.pumpWidget(const SizedBox()); // disposes the load-timeout timer
  });
}
