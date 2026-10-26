import 'api_client.dart';
import 'models.dart';

/// Customer endpoints.
extension CustomerApi on ApiClient {
  Future<Json> customerProfile() async => await send('GET', '/customers/me') as Json;
  Future<void> updateCustomerProfile({String? fullName, String? email}) =>
      send('PATCH', '/customers/me', body: {'fullName': ?fullName, 'email': ?email});

  Future<List<Vehicle>> vehicles() async => ((await send('GET', '/customers/me/vehicles')) as List)
      .cast<Json>()
      .map(Vehicle.fromJson)
      .toList();
  Future<Vehicle> addVehicle(Json input) async =>
      Vehicle.fromJson(await send('POST', '/customers/me/vehicles', body: input) as Json);
  Future<Vehicle> updateVehicle(String id, Json changes) async =>
      Vehicle.fromJson(await send('PATCH', '/customers/me/vehicles/$id', body: changes) as Json);
  Future<void> removeVehicle(String id) => send('DELETE', '/customers/me/vehicles/$id');

  Future<Quote> quote({
    required String vehicleId,
    required String towType,
    required Place pickup,
    required Place dropoff,
  }) async => Quote.fromJson(
    await send(
          'POST',
          '/bookings/quotes',
          body: {
            'vehicleId': vehicleId,
            'towType': towType,
            'pickup': pickup.toJson(),
            'dropoff': dropoff.toJson(),
          },
        )
        as Json,
  );

  /// Cash: the customer pays the driver on delivery (the plan's business model).
  Future<Booking> book({required String quoteId, required String issue, String? notes}) async =>
      Booking.fromJson(
        await send(
              'POST',
              '/bookings',
              body: {
                'quoteId': quoteId,
                'issue': issue,
                'paymentMethod': 'cash',
                if (notes != null && notes.isNotEmpty) 'notes': notes,
              },
            )
            as Json,
      );

  Future<List<Booking>> bookings({String? status}) async {
    final res = await send('GET', '/bookings', query: {'limit': '50', 'status': ?status}) as Json;
    return (res['items'] as List).cast<Json>().map(Booking.fromJson).toList();
  }

  Future<NearbyAvailability> nearby(double lat, double lng) async => NearbyAvailability.fromJson(
    await send('GET', '/availability/nearby', query: {'lat': '$lat', 'lng': '$lng'}) as Json,
  );

  Future<Booking> booking(String id) async =>
      Booking.fromJson(await send('GET', '/bookings/$id') as Json);
  Future<Booking> cancelBooking(String id, String reason) async => Booking.fromJson(
    await send('POST', '/bookings/$id/cancel', body: {'reason': reason}) as Json,
  );
  Future<DriverLocationView> driverLocation(String id) async =>
      DriverLocationView.fromJson(await send('GET', '/bookings/$id/driver-location') as Json);
  Future<Booking> rate(String id, int rating, String? comment) async => Booking.fromJson(
    await send(
          'POST',
          '/bookings/$id/rating',
          body: {'rating': rating, if (comment != null && comment.isNotEmpty) 'comment': comment},
        )
        as Json,
  );
}

/// Driver endpoints.
extension DriverApi on ApiClient {
  static const _me = '/drivers/me';

  Future<DriverProfile> driverProfile() async =>
      DriverProfile.fromJson(await send('GET', _me) as Json);
  Future<void> updateDriverProfile({String? fullName, int? experienceYears}) =>
      send('PATCH', _me, body: {'fullName': ?fullName, 'experienceYears': ?experienceYears});
  Future<void> addTowTruck(Json input) => send('POST', '$_me/tow-trucks', body: input);

  Future<List<DriverDocument>> documents() async {
    final res = await send('GET', '$_me/documents') as Json;
    return (res['documents'] as List).cast<Json>().map(DriverDocument.fromJson).toList();
  }

  Future<void> uploadDocument(String type, UploadFile file, {String? documentNumber}) => upload(
    'PUT',
    '$_me/documents/$type',
    file: file,
    fields: {'documentNumber': ?documentNumber},
  );

  Future<String> setAvailability(bool online) async {
    final res = await send(
      'PUT',
      '$_me/availability',
      body: {'status': online ? 'online' : 'offline'},
    );
    return (res as Json)['availability'] as String;
  }

  /// [recordedAt] is when the GPS fix was taken; without it the server assumes "now",
  /// so always pass it for real fixes (the server rejects old and out-of-order ones).
  Future<void> postLocation(
    double lat,
    double lng, {
    double? accuracy,
    double? heading,
    DateTime? recordedAt,
  }) => send(
    'POST',
    '$_me/location',
    body: {
      'lat': lat,
      'lng': lng,
      'accuracyMeters': ?accuracy,
      'headingDegrees': ?heading,
      'recordedAt': ?recordedAt?.toUtc().toIso8601String(),
    },
  );

  Future<DriverJob?> currentOffer() async {
    final o = ((await send('GET', '$_me/offers/current')) as Json)['offer'];
    return o == null ? null : DriverJob.fromJson(o as Json);
  }

  Future<DriverJob> acceptOffer(String offerId) async =>
      DriverJob.fromJson(await send('POST', '$_me/offers/$offerId/accept') as Json);
  Future<void> declineOffer(String offerId) => send('POST', '$_me/offers/$offerId/decline');

  Future<DriverJob?> currentJob() async {
    final j = ((await send('GET', '$_me/jobs/current')) as Json)['job'];
    return j == null ? null : DriverJob.fromJson(j as Json);
  }

  /// step: en-route | arrived | start-tow | complete
  Future<DriverJob> advance(String bookingId, String step) async =>
      DriverJob.fromJson(await send('POST', '$_me/jobs/$bookingId/$step') as Json);

  Future<List<Inspection>> inspections(String bookingId) async {
    final res = await send('GET', '$_me/jobs/$bookingId/inspections') as Json;
    return (res['inspections'] as List).cast<Json>().map(Inspection.fromJson).toList();
  }

  Future<Inspection> saveInspection(String bookingId, String stage, Json details) async =>
      Inspection.fromJson(
        await send('PUT', '$_me/jobs/$bookingId/inspections/$stage', body: details) as Json,
      );
  Future<Inspection> uploadInspectionPhoto(
    String bookingId,
    String stage,
    String slot,
    UploadFile file,
  ) async => Inspection.fromJson(
    await upload(
          'POST',
          '$_me/jobs/$bookingId/inspections/$stage/photos',
          file: file,
          fields: {'slot': slot},
        )
        as Json,
  );
  Future<Inspection> submitInspection(String bookingId, String stage) async => Inspection.fromJson(
    await send('POST', '$_me/jobs/$bookingId/inspections/$stage/submit') as Json,
  );

  Future<void> confirmCash(String bookingId, int amountFils) =>
      send('POST', '$_me/jobs/$bookingId/cash-collected', body: {'amountFils': amountFils});
  Future<DriverLedger> earnings() async =>
      DriverLedger.fromJson(await send('GET', '$_me/earnings') as Json);
}

/// Both apps.
extension SharedApi on ApiClient {
  /// UAE address search via the server's geocoder. Null when no maps provider is configured.
  Future<List<Place>?> searchPlaces(String q) async {
    final res = await send('GET', '/locations/search', query: {'q': q}) as Json;
    if (res['status'] != 'available') return null;
    return (res['results'] as List).cast<Json>().map(Place.fromJson).toList();
  }

  Future<Invoice> invoice(String bookingId) async =>
      Invoice.fromJson(await send('GET', '/bookings/$bookingId/invoice') as Json);

  Future<Inbox> inbox() async => Inbox.fromJson(await send('GET', '/me/notifications') as Json);
  Future<void> markAllRead() => send('POST', '/me/notifications/read-all');

  Future<void> registerDevice(String token, String platform) =>
      send('PUT', '/me/devices', body: {'token': token, 'platform': platform});
  Future<void> removeDevice(String token) => send('DELETE', '/me/devices', body: {'token': token});

  Future<Dispute> raiseDispute(String bookingId, String reason) async => Dispute.fromJson(
    await send('POST', '/bookings/$bookingId/disputes', body: {'reason': reason}) as Json,
  );
  Future<List<Dispute>> myDisputes() async =>
      ((await send('GET', '/me/disputes')) as List).cast<Json>().map(Dispute.fromJson).toList();
}
