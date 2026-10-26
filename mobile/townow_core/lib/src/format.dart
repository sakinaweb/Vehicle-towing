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

/// UAE mobile in E.164 from what people type: 050 123 4567, 501234567, +971 50 ….
String? normalizeUaeMobile(String input) {
  var digits = input.replaceAll(RegExp(r'\D'), '');
  if (digits.startsWith('00971')) digits = digits.substring(5);
  if (digits.startsWith('971')) digits = digits.substring(3);
  if (digits.startsWith('0')) digits = digits.substring(1);
  return RegExp(r'^5[024568]\d{7}$').hasMatch(digits) ? '+971$digits' : null;
}
