// Typed views of the API responses the apps use. Money is integer fils (AED × 100).

typedef Json = Map<String, dynamic>;

DateTime? _date(Object? v) => v == null ? null : DateTime.parse(v as String).toLocal();
int _int(Object? v) => (v as num?)?.toInt() ?? 0;
double? _dbl(Object? v) => (v as num?)?.toDouble();
List<Json> _list(Object? v) => (v as List? ?? const []).cast<Map<String, dynamic>>();

class Place {
  const Place({required this.lat, required this.lng, required this.address});

  factory Place.fromJson(Json j) =>
      Place(lat: _dbl(j['lat'])!, lng: _dbl(j['lng'])!, address: j['address'] as String? ?? '');

  final double lat;
  final double lng;
  final String address;

  Json toJson() => {'lat': lat, 'lng': lng, 'address': address};
}

class Vehicle {
  Vehicle.fromJson(Json j)
    : id = j['id'] as String,
      category = j['category'] as String,
      brand = j['brand'] as String,
      model = j['model'] as String,
      year = _int(j['year']),
      color = j['color'] as String?,
      plateEmirate = j['plateEmirate'] as String,
      plateCode = j['plateCode'] as String,
      plateNumber = j['plateNumber'] as String,
      isDefault = j['isDefault'] as bool? ?? false;

  final String id, category, brand, model, plateEmirate, plateCode, plateNumber;
  final int year;
  final String? color;
  final bool isDefault;

  String get title => '$brand $model ($year)';
  String get plate => '$plateEmirate $plateCode $plateNumber';
}

class Fare {
  Fare.fromJson(Json j)
    : subtotalFils = _int(j['subtotalFils']),
      vatFils = _int(j['vatFils']),
      vatRateBps = _int(j['vatRateBps']),
      totalFils = _int(j['totalFils']),
      baseFareFils = _int(j['baseFareFils']),
      distanceChargeFils = _int(j['distanceChargeFils']),
      otherChargesFils =
          _int(j['towTypeSurchargeFils'] ?? j['towTypeChargeFils']) +
          _int(j['nightSurchargeFils']) +
          _int(j['minimumFareAdjustmentFils']) +
          _int(j['additionalChargesFils']),
      currency = j['currency'] as String? ?? 'AED';

  final int subtotalFils, vatFils, vatRateBps, totalFils, baseFareFils, distanceChargeFils;

  /// Equipment surcharge, night surcharge and minimum-fare top-up, as priced by the server.
  final int otherChargesFils;
  final String currency;
}

class Quote {
  Quote.fromJson(Json j)
    : quoteId = j['quoteId'] as String,
      expiresAt = _date(j['expiresAt'])!,
      towType = j['towType'] as String,
      pickup = Place.fromJson(j['pickup'] as Json),
      dropoff = Place.fromJson(j['dropoff'] as Json),
      distanceMeters = _int(j['distanceMeters']),
      estimatedDurationSeconds = _int(j['estimatedDurationSeconds']),
      fare = Fare.fromJson(j['fare'] as Json);

  final String quoteId, towType;
  final DateTime expiresAt;
  final Place pickup, dropoff;
  final int distanceMeters, estimatedDurationSeconds;
  final Fare fare;
}

class AssignedDriver {
  AssignedDriver.fromJson(Json j)
    : firstName = j['firstName'] as String,
      rating = _dbl(j['rating']),
      totalTrips = _int(j['totalTrips']),
      truckModel = (j['truck'] as Json)['model'] as String,
      truckPlate = [
        (j['truck'] as Json)['plateEmirate'],
        (j['truck'] as Json)['plateCode'],
        (j['truck'] as Json)['plateNumber'],
      ].join(' ');

  final String firstName, truckModel, truckPlate;
  final double? rating;
  final int totalTrips;
}

class PaymentSummary {
  PaymentSummary.fromJson(Json j)
    : method = j['method'] as String,
      status = j['status'] as String,
      amountFils = _int(j['amountFils']);

  final String method, status;
  final int amountFils;
}

class StatusChange {
  StatusChange.fromJson(Json j)
    : toStatus = j['toStatus'] as String,
      note = j['note'] as String?,
      at = _date(j['at'])!;

  final String toStatus;
  final String? note;
  final DateTime at;
}

class Booking {
  Booking.fromJson(Json j)
    : id = j['id'] as String,
      bookingNumber = j['bookingNumber'] as String,
      status = j['status'] as String,
      createdAt = _date(j['createdAt'])!,
      vehicle = Vehicle.fromJson(j['vehicle'] as Json),
      towType = j['towType'] as String,
      issue = j['issue'] as String,
      pickup = Place.fromJson(j['pickup'] as Json),
      dropoff = Place.fromJson(j['dropoff'] as Json),
      distanceMeters = _int(j['distanceMeters']),
      fare = Fare.fromJson(j['fare'] as Json),
      paymentMethod = j['paymentMethod'] as String,
      canCancel = j['canCancel'] as bool? ?? false,
      cancellationReason = j['cancellationReason'] as String?,
      driver = j['driver'] == null ? null : AssignedDriver.fromJson(j['driver'] as Json),
      payment = j['payment'] == null ? null : PaymentSummary.fromJson(j['payment'] as Json),
      myRating = (j['myRating'] as Json?)?['rating'] as int?,
      history = _list(j['history']).map(StatusChange.fromJson).toList();

  final String id, bookingNumber, status, towType, issue, paymentMethod;
  final DateTime createdAt;
  final Vehicle vehicle;
  final Place pickup, dropoff;
  final int distanceMeters;
  final Fare fare;
  final bool canCancel;
  final String? cancellationReason;
  final AssignedDriver? driver;
  final PaymentSummary? payment;
  final int? myRating;
  final List<StatusChange> history;

  bool get isFinal => status == 'completed' || status == 'cancelled';
}

class LiveLocation {
  LiveLocation.fromJson(Json j)
    : lat = _dbl(j['lat'])!,
      lng = _dbl(j['lng'])!,
      ageSeconds = _int(j['ageSeconds']),
      stale = j['stale'] as bool? ?? false;

  final double lat, lng;
  final int ageSeconds;
  final bool stale;
}

class DriverLocationView {
  DriverLocationView.fromJson(Json j)
    : status = j['status'] as String,
      location = j['location'] == null ? null : LiveLocation.fromJson(j['location'] as Json),
      etaSeconds = (j['eta'] as Json?)?['status'] == 'available'
          ? _int((j['eta'] as Json)['durationSeconds'])
          : null,
      etaReason = (j['eta'] as Json?)?['reason'] as String?;

  final String status;
  final LiveLocation? location;
  final int? etaSeconds;
  final String? etaReason;

  /// Never an invented number: a routed estimate, or why there is none.
  String get etaLabel {
    if (etaSeconds != null) return 'ETA ${(etaSeconds! / 60).round().clamp(1, 999)} min';
    return etaReason == 'location_unavailable' ? 'Waiting for driver GPS' : 'ETA unavailable';
  }
}

class Invoice {
  Invoice.fromJson(Json j)
    : invoiceNumber = j['invoiceNumber'] as String,
      title = j['title'] as String,
      notice = j['notice'] as String?,
      isTaxInvoice = j['isTaxInvoice'] as bool? ?? false,
      sellerName = (j['seller'] as Json)['name'] as String,
      sellerTrn = (j['seller'] as Json)['trn'] as String?,
      subtotalFils = _int(j['subtotalFils']),
      vatFils = _int(j['vatFils']),
      vatRateBps = _int(j['vatRateBps']),
      totalFils = _int(j['totalFils']),
      paymentMethod = j['paymentMethod'] as String,
      paymentStatus = j['paymentStatus'] as String?,
      issuedAt = _date(j['issuedAt'])!;

  final String invoiceNumber, title, sellerName, paymentMethod;
  final String? notice, sellerTrn, paymentStatus;
  final bool isTaxInvoice;
  final int subtotalFils, vatFils, vatRateBps, totalFils;
  final DateTime issuedAt;
}

// ---------------------------------------------------------------- driver side

class TowTruck {
  TowTruck.fromJson(Json j)
    : id = j['id'] as String,
      towType = j['towType'] as String,
      model = j['model'] as String,
      year = _int(j['year']),
      plate = '${j['plateEmirate']} ${j['plateCode']} ${j['plateNumber']}',
      isActive = j['isActive'] as bool? ?? true;

  final String id, towType, model, plate;
  final int year;
  final bool isActive;
}

class DriverProfile {
  DriverProfile.fromJson(Json j)
    : fullName = (j['user'] as Json)['fullName'] as String?,
      phone = (j['user'] as Json)['phone'] as String,
      kycStatus = j['kycStatus'] as String,
      kycRejectionReason = j['kycRejectionReason'] as String?,
      availability = j['availability'] as String,
      rating = _dbl(j['rating']),
      totalTrips = _int(j['totalTrips']),
      experienceYears = _int(j['experienceYears']),
      towTrucks = _list(j['towTrucks']).map(TowTruck.fromJson).toList();

  final String? fullName, kycRejectionReason;
  final String phone, kycStatus, availability;
  final double? rating;
  final int totalTrips, experienceYears;
  final List<TowTruck> towTrucks;

  bool get approved => kycStatus == 'approved';
}

class DriverDocument {
  DriverDocument.fromJson(Json j)
    : type = j['type'] as String,
      status = j['status'] as String,
      documentNumber = j['documentNumber'] as String?,
      rejectionReason = j['rejectionReason'] as String?;

  final String type, status;
  final String? documentNumber, rejectionReason;
}

class DriverJob {
  DriverJob.fromJson(Json j)
    : bookingId = j['bookingId'] as String,
      bookingNumber = j['bookingNumber'] as String,
      status = j['status'] as String,
      towType = j['towType'] as String,
      issue = j['issue'] as String,
      notes = j['notes'] as String?,
      vehicleTitle = '${(j['vehicle'] as Json)['brand']} ${(j['vehicle'] as Json)['model']}',
      vehiclePlate = (j['vehicle'] as Json)['plate'] as String,
      pickup = Place.fromJson(j['pickup'] as Json),
      dropoff = Place.fromJson(j['dropoff'] as Json),
      tripDistanceMeters = _int(j['tripDistanceMeters']),
      fareTotalFils = _int(j['fareTotalFils']),
      driverPayoutFils = _int(j['driverPayoutFils']),
      customerFirstName = j['customerFirstName'] as String? ?? 'Customer',
      paymentMethod = j['paymentMethod'] as String? ?? 'cash',
      pickupInspection = ((j['inspections'] as Json?)?['pickup'] as String?) ?? 'none',
      returnInspection = ((j['inspections'] as Json?)?['return'] as String?) ?? 'none',
      offerId = j['offerId'] as String?,
      expiresAt = _date(j['expiresAt']),
      distanceToPickupMeters = (j['distanceToPickupMeters'] as num?)?.toInt();

  final String bookingId, bookingNumber, status, towType, issue, vehicleTitle, vehiclePlate;
  final String customerFirstName, paymentMethod, pickupInspection, returnInspection;
  final String? notes;
  final Place pickup, dropoff;
  final int tripDistanceMeters, fareTotalFils, driverPayoutFils;

  /// Only on offers.
  final String? offerId;
  final DateTime? expiresAt;
  final int? distanceToPickupMeters;
}

class InspectionPhoto {
  InspectionPhoto.fromJson(Json j) : id = j['id'] as String, slot = j['slot'] as String;

  final String id, slot;
}

class Inspection {
  Inspection.fromJson(Json j)
    : stage = j['stage'] as String,
      odometerKm = _int(j['odometerKm']),
      fuelLevel = j['fuelLevel'] as String,
      checklist = Map<String, String>.from(j['checklist'] as Map),
      notes = j['notes'] as String?,
      submittedAt = _date(j['submittedAt']),
      photos = _list(j['photos']).map(InspectionPhoto.fromJson).toList();

  final String stage, fuelLevel;
  final int odometerKm;
  final Map<String, String> checklist;
  final String? notes;
  final DateTime? submittedAt;
  final List<InspectionPhoto> photos;
}

class LedgerEntry {
  LedgerEntry.fromJson(Json j)
    : type = j['type'] as String,
      amountFils = _int(j['amountFils']),
      reference = j['reference'] as String?,
      createdAt = _date(j['createdAt'])!;

  final String type;
  final int amountFils;
  final String? reference;
  final DateTime createdAt;
}

class DriverLedger {
  DriverLedger.fromJson(Json j)
    : balanceFils = _int(j['balanceFils']),
      entries = _list(j['entries']).map(LedgerEntry.fromJson).toList();

  /// + TowNow owes the driver, − the driver owes TowNow.
  final int balanceFils;
  final List<LedgerEntry> entries;
}

// ---------------------------------------------------------------- shared

class AppNotification {
  AppNotification.fromJson(Json j)
    : id = j['id'] as String,
      type = j['type'] as String,
      title = j['title'] as String,
      body = j['body'] as String,
      data = Map<String, dynamic>.from(j['data'] as Map? ?? const {}),
      createdAt = _date(j['createdAt'])!,
      readAt = _date(j['readAt']);

  final String id, type, title, body;
  final Map<String, dynamic> data;
  final DateTime createdAt;
  final DateTime? readAt;
}

class Inbox {
  Inbox.fromJson(Json j)
    : items = _list(j['items']).map(AppNotification.fromJson).toList(),
      unread = _int(j['unread']);

  final List<AppNotification> items;
  final int unread;
}

class Dispute {
  Dispute.fromJson(Json j)
    : id = j['id'] as String,
      bookingNumber = j['bookingNumber'] as String,
      reason = j['reason'] as String,
      status = j['status'] as String,
      resolution = j['resolution'] as String?,
      createdAt = _date(j['createdAt'])!;

  final String id, bookingNumber, reason, status;
  final String? resolution;
  final DateTime createdAt;
}

/// Available tow trucks near a point — counts and coarse distance only.
class NearbyAvailability {
  NearbyAvailability.fromJson(Json j)
    : radiusMeters = _int(j['radiusMeters']),
      byTowType = {
        for (final t in _list(j['byTowType']))
          t['towType'] as String: (
            available: _int(t['available']),
            nearestMeters: (t['nearestMeters'] as num?)?.toInt(),
          ),
      };

  final int radiusMeters;
  final Map<String, ({int available, int? nearestMeters})> byTowType;

  int get total => byTowType.values.fold(0, (a, b) => a + b.available);
}
