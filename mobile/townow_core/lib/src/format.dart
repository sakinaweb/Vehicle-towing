/// AED from integer fils, e.g. 25328 → "AED 253.28".
String formatAed(int fils) => 'AED ${(fils / 100).toStringAsFixed(2)}';

String formatKm(int meters) => '${(meters / 1000).toStringAsFixed(1)} km';

const bookingStatusLabels = {
  'requested': 'Requested',
  'searching': 'Finding a tow truck',
  'driver_assigned': 'Driver assigned',
  'driver_arriving': 'Driver on the way',
  'driver_arrived': 'Driver has arrived',
  'vehicle_loaded': 'Vehicle loaded',
  'in_transit': 'Towing to destination',
  'completed': 'Completed',
  'cancelled': 'Cancelled',
};

String statusLabel(String status) => bookingStatusLabels[status] ?? status;

const towTypeLabels = {
  'flatbed': 'Flatbed',
  'wheel-lift': 'Wheel-lift',
  'bike-carrier': 'Bike carrier',
};

/// Mirrors the API rule (the server is the authority): which equipment fits which vehicle.
bool towTypeFits(String category, String towType) =>
    category == 'car' ? towType != 'bike-carrier' : towType != 'wheel-lift';

const vehicleIssues = [
  'Breakdown',
  'Flat Tyre',
  'Accident',
  'Battery Issue',
  'Engine Issue',
  'Overheating',
  'Locked Out',
  'Other',
];

const emirates = [
  'Dubai',
  'Abu Dhabi',
  'Sharjah',
  'Ajman',
  'Umm Al Quwain',
  'Ras Al Khaimah',
  'Fujairah',
];

/// A country whose mobiles can sign in. Keep in step with the API's OTP_COUNTRIES rules.
class PhoneCountry {
  const PhoneCountry(this.iso, this.name, this.dialCode, this.example, this._national);

  final String iso;
  final String name;

  /// e.g. "+971".
  final String dialCode;

  /// National number as people write it, for the hint.
  final String example;
  final String _national;

  /// E.164 from what people type: 050 123 4567, 501234567, +971 50 …, 00971 ….
  String? normalize(String input) {
    var digits = input.replaceAll(RegExp(r'\D'), '');
    final cc = dialCode.substring(1);
    if (digits.startsWith('00$cc')) digits = digits.substring(2);
    final national = RegExp(_national);
    // Strip the country code only when what's left is a whole number (+91 91… is valid in India).
    if (digits.startsWith(cc) && national.hasMatch(digits.substring(cc.length))) {
      digits = digits.substring(cc.length);
    }
    if (digits.startsWith('0')) digits = digits.substring(1); // trunk prefix
    return national.hasMatch(digits) ? '$dialCode$digits' : null;
  }
}

/// Every country the apps know; --dart-define=PHONE_COUNTRIES picks which ones are offered.
const phoneCountries = {
  'AE': PhoneCountry('AE', 'United Arab Emirates', '+971', '50 123 4567', r'^5[024568]\d{7}$'),
  'IN': PhoneCountry('IN', 'India', '+91', '98765 43210', r'^[6-9]\d{9}$'),
};

/// UAE mobile in E.164 from what people type: 050 123 4567, 501234567, +971 50 ….
String? normalizeUaeMobile(String input) => phoneCountries['AE']!.normalize(input);
