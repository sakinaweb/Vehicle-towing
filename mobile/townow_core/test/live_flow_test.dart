// Live end-to-end tow against a running API, using the apps' own client code
// (ApiClient + Realtime). Skipped unless LIVE_API is set:
//
//   LIVE_API=http://localhost:4000/api/v1 LIVE_API_LOG=<API stdout file> flutter test test/live_flow_test.dart
//
// OTP codes come from the API log (SMS_PROVIDER=log in development).
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:townow_core/townow_core.dart';

final base = Platform.environment['LIVE_API'];
final log = Platform.environment['LIVE_API_LOG'];

// Distinct last two digits: the log masks numbers as +97158*****NN.
const customerPhone = '+971589990411';
const driverPhone = '+971589990422';
const adminPhone = '+971589990303'; // provisioned with npm run admin:create

Future<String> otpFor(String phone, DateTime after) async {
  final tail = phone.substring(phone.length - 2);
  final re = RegExp(r'SMS to \+97158\*{5}' + tail + r'.*?code is (\d{6})');
  for (var i = 0; i < 40; i++) {
    final text = _readLog().replaceAll(RegExp(r'\x1b\[[0-9;]*m'), '');
    final matches = re.allMatches(text).toList();
    if (matches.isNotEmpty && File(log!).lastModifiedSync().isAfter(after)) {
      return matches.last.group(1)!;
    }
    await Future<void>.delayed(const Duration(milliseconds: 300));
  }
  throw StateError('No OTP for $phone in the API log');
}

/// The API log as text; Windows PowerShell's Tee-Object writes UTF-16 LE (with a BOM).
String _readLog() {
  final bytes = File(log!).readAsBytesSync();
  if (bytes.length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE) {
    final units = <int>[
      for (var i = 2; i + 1 < bytes.length; i += 2) bytes[i] | (bytes[i + 1] << 8),
    ];
    return String.fromCharCodes(units);
  }
  return utf8.decode(bytes, allowMalformed: true);
}

/// With the API's demo login on (DEMO_LOGIN_PHONES), the customer and driver codes are not
/// logged; pass the same code as LIVE_DEMO_CODE. Every other number still reads the log.
final _demoCode = Platform.environment['LIVE_DEMO_CODE'];

Future<ApiClient> signIn(String phone, String role) async {
  final api = ApiClient(baseUrl: base!, sessions: MemorySessionStore(), role: role);
  final before = DateTime.now().subtract(const Duration(seconds: 1));
  await api.requestOtp(phone);
  final demo = _demoCode != null && (phone == customerPhone || phone == driverPhone);
  await api.verifyOtp(phone, demo ? _demoCode! : await otpFor(phone, before));
  return api;
}

/// LIVE_PAUSE_SECONDS=N pauses after each phase, so the apps on a phone signed in with the same
/// test accounts can be watched (or screenshotted) while the flow runs.
final _pause = int.tryParse(Platform.environment['LIVE_PAUSE_SECONDS'] ?? '') ?? 0;
Future<void> hold(String step) async {
  if (_pause == 0) return;
  // ignore: avoid_print
  print('LIVE STEP ${DateTime.now().toIso8601String().substring(11, 19)} $step');
  await Future<void>.delayed(Duration(seconds: _pause));
}

Future<T> waitFor<T>(Future<T?> Function() fn, {int seconds = 30}) async {
  final end = DateTime.now().add(Duration(seconds: seconds));
  while (true) {
    final v = await fn();
    if (v != null) return v;
    if (DateTime.now().isAfter(end)) throw TimeoutException('waitFor');
    await Future<void>.delayed(const Duration(milliseconds: 500));
  }
}

final pdf = UploadFile(
  bytes: utf8.encode('%PDF-1.4\n% TowNow live test document\n'),
  filename: 'doc.pdf',
  contentType: 'application/pdf',
);
final jpeg = UploadFile(
  bytes: [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, ...utf8.encode('JFIF live test photo')],
  filename: 'p.jpg',
  contentType: 'image/jpeg',
);

void main() {
  test(
    'customer books → KYC-approved driver tows → cash, receipt, rating, dispute, ledger',
    () async {
      // Remote spot (Hatta) so no other dev driver is matched.
      const pickup = Place(lat: 24.80, lng: 56.12, address: 'Hatta Dam car park (live test)');
      const dropoff = Place(lat: 24.83, lng: 56.10, address: 'Hatta garage (live test)');

      // ---- driver onboarding + admin KYC approval
      final driver = await signIn(driverPhone, 'driver');
      await driver.updateDriverProfile(fullName: 'Saeed Live-Test', experienceYears: 4);
      var profile = await driver.driverProfile();
      if (profile.towTrucks.isEmpty) {
        await driver.addTowTruck({
          'towType': 'flatbed',
          'model': 'Hino 300 Flatbed',
          'year': 2024,
          'plateEmirate': 'Dubai',
          'plateCode': 'Q',
          'plateNumber': '40422',
        });
      }
      // Re-runs: an approved driver's documents are locked (and already on file).
      for (final t in [
        if (profile.kycStatus != 'approved') ...[
          'emirates_id',
          'driving_licence',
          'vehicle_registration',
          'commercial_insurance',
        ],
      ]) {
        await driver.uploadDocument(
          t,
          pdf,
          documentNumber: 'LIVE-${t.substring(0, 3).toUpperCase()}',
        );
      }
      final admin = await signIn(adminPhone, 'admin');
      final driverRow =
          (await admin.send('GET', '/admin/drivers', query: {'kycStatus': 'pending'})
                  as Json)['items']
              as List;
      final pending = driverRow.cast<Json>().where((d) => d['phone'] == driverPhone).firstOrNull;
      final driverId =
          pending?['driverId'] as String? ??
          ((await admin.send('GET', '/admin/drivers', query: {'kycStatus': 'approved'})
                          as Json)['items']
                      as List)
                  .cast<Json>()
                  .firstWhere((d) => d['phone'] == driverPhone)['driverId']
              as String;
      await admin.send('POST', '/admin/drivers/$driverId/kyc/approve');
      profile = await driver.driverProfile();
      expect(profile.kycStatus, 'approved');

      // ---- driver online at the pickup area, listening on the socket
      final driverRt = Realtime(driver)..connect();
      final offers = <Json>[];
      driverRt.on(RealtimeEvents.offerNew, offers.add);
      expect(await driver.setAvailability(true), 'online');
      await driver.postLocation(24.79, 56.11);

      // ---- customer books (cash), listening on the socket
      final customer = await signIn(customerPhone, 'customer');
      await customer.updateCustomerProfile(fullName: 'Aisha Live-Test');
      final customerRt = Realtime(customer)..connect();
      final statuses = <String>[];
      customerRt.on(RealtimeEvents.bookingUpdated, (d) => statuses.add(d['status'] as String));
      final vehicles = await customer.vehicles();
      final vehicle = vehicles.isNotEmpty
          ? vehicles.first
          : await customer.addVehicle({
              'category': 'car',
              'brand': 'Nissan',
              'model': 'Patrol',
              'year': 2021,
              'plateEmirate': 'Dubai',
              'plateCode': 'W',
              'plateNumber': '41141',
            });
      final quote = await customer.quote(
        vehicleId: vehicle.id,
        towType: 'flatbed',
        pickup: pickup,
        dropoff: dropoff,
      );
      expect(quote.fare.vatFils, (quote.fare.subtotalFils * 0.05).round()); // 5% VAT
      expect(quote.fare.totalFils, quote.fare.subtotalFils + quote.fare.vatFils);
      final booking = await customer.book(
        quoteId: quote.quoteId,
        issue: 'Breakdown',
        notes: 'Live E2E',
      );
      expect(booking.fare.totalFils, quote.fare.totalFils); // server price is kept

      // ---- dispatch: offer reaches the driver (REST + socket via the worker).
      // The test position is re-sent while waiting: if this driver is also signed in on a phone
      // elsewhere, that phone's real GPS would otherwise move them out of the pickup area.
      final offer = await waitFor(() async {
        await driver.postLocation(24.79, 56.11);
        final o = await driver.currentOffer();
        return o?.bookingId == booking.id ? o : null;
      }, seconds: 60);
      expect(
        offer.driverPayoutFils,
        quote.fare.subtotalFils - (quote.fare.subtotalFils * 0.2).round(),
      ); // 20%
      final job = await driver.acceptOffer(offer.offerId!);
      expect(job.status, 'driver_assigned');
      await hold('driver assigned ${booking.bookingNumber}');

      // ---- chat: customer → driver live, reply, read receipt, history
      final driverChat = <Json>[];
      final customerReads = <Json>[];
      driverRt.on(RealtimeEvents.chatMessage, driverChat.add);
      customerRt.on(RealtimeEvents.chatRead, customerReads.add);
      final hello = await customer.sendChat(
        booking.id,
        'Hi, I am at the Hatta Dam car park gate (live test)',
        newClientId(),
      );
      expect(hello.mine, isTrue);
      final got = await waitFor(
        () async => driverChat.where((m) => m['id'] == hello.id).firstOrNull,
        seconds: 10,
      );
      expect(got['mine'], isFalse);
      await driver.sendChat(booking.id, 'On my way, about 10 minutes (live test)', newClientId());
      await driver.markChatRead(booking.id);
      await waitFor(() async => customerReads.isNotEmpty ? true : null, seconds: 10);
      final history = await customer.chatMessages(booking.id);
      expect(history.map((m) => m.mine), [true, false]);
      expect(history.first.readAt, isNotNull);
      await hold('chat exchanged');

      // ---- SOS from the driver on the job → operations acknowledge and resolve it
      final sos = await driver.raiseSos(
        bookingId: booking.id,
        lat: 24.79,
        lng: 56.11,
        note: 'Live test SOS',
      );
      expect(sos['status'], 'open');
      expect(sos['bookingNumber'], booking.bookingNumber);
      await admin.send('POST', '/admin/sos/${sos['id']}/acknowledge');
      final closed =
          await admin.send(
                'POST',
                '/admin/sos/${sos['id']}/resolve',
                body: {'resolution': 'Live test'},
              )
              as Json;
      expect(closed['status'], 'resolved');

      // ---- trip with inspections
      await driver.advance(booking.id, 'en-route');
      await driver.postLocation(24.795, 56.115);
      final live = await customer.driverLocation(booking.id);
      expect(live.location, isNotNull); // real driver position, not invented
      await driver.advance(booking.id, 'arrived');
      await hold('driver arrived');
      for (final stage in ['pickup', 'return']) {
        if (stage == 'return') await driver.advance(booking.id, 'start-tow');
        await driver.saveInspection(booking.id, stage, {
          'odometerKm': stage == 'pickup' ? 52000 : 52004,
          'fuelLevel': 'half',
          'checklist': {
            for (final i in ['body', 'glass', 'lights', 'tyres', 'mirrors', 'interior']) i: 'ok',
          },
        });
        for (final slot in ['front', 'back', 'left', 'right']) {
          await driver.uploadInspectionPhoto(booking.id, stage, slot, jpeg);
        }
        await driver.submitInspection(booking.id, stage);
      }
      final done = await driver.advance(booking.id, 'complete');
      expect(done.status, 'completed');
      await driver.confirmCash(booking.id, done.fareTotalFils);
      await hold('completed, cash collected');

      // ---- customer side
      final completed = await customer.booking(booking.id);
      expect(completed.status, 'completed');
      expect(completed.payment?.status, 'captured');
      final invoice = await customer.invoice(booking.id);
      expect(invoice.totalFils, quote.fare.totalFils);
      expect(invoice.vatRateBps, 500);
      expect(invoice.isTaxInvoice, isFalse); // no TRN configured
      final rated = await customer.rate(booking.id, 5, 'Live test: quick and careful');
      expect(rated.myRating, 5);
      final dispute = await customer.raiseDispute(
        booking.id,
        'Live test: small scratch on the rear bumper.',
      );
      expect(dispute.status, 'open');

      // ---- ledger: earning (80% of subtotal) − cash collected (total)
      final ledger = await driver.earnings();
      final trip = ledger.entries.where((e) => e.type == 'trip_earning').first;
      expect(trip.amountFils, offer.driverPayoutFils);

      // ---- realtime from the worker process reached both apps; inbox filled
      await waitFor(() async => statuses.contains('completed') ? true : null, seconds: 10);
      expect(
        statuses,
        containsAll([
          'driver_assigned',
          'driver_arriving',
          'driver_arrived',
          'in_transit',
          'completed',
        ]),
      );
      expect(offers.map((o) => o['bookingId']), contains(booking.id));
      final inbox = await customer.inbox();
      expect(inbox.items.map((n) => n.type), contains('booking.completed'));

      await driver.setAvailability(false);
      driverRt.disconnect();
      customerRt.disconnect();
      // ignore: avoid_print
      print(
        'LIVE OK ${booking.bookingNumber} total=${formatAed(invoice.totalFils)} '
        'payout=${formatAed(offer.driverPayoutFils)} balance=${formatAed(ledger.balanceFils)} '
        'statuses=$statuses dispute=${dispute.id}',
      );
    },
    timeout: const Timeout(Duration(minutes: 6)),
    skip: base == null ? 'set LIVE_API to run' : false,
  );
}
