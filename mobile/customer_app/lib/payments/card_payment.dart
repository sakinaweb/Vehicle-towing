import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import 'package:townow_core/townow_core.dart';

/// Test mode only unless the build opts in with --dart-define=STRIPE_ALLOW_LIVE=true.
const _allowLive = bool.fromEnvironment('STRIPE_ALLOW_LIVE');

enum SheetResult { completed, closed, failed }

class SheetOutcome {
  const SheetOutcome(this.result, [this.message]);
  final SheetResult result;
  final String? message;
}

typedef CardSheet = Future<SheetOutcome> Function(PaymentSession session);

/// The native Stripe PaymentSheet; widget tests swap in a fake.
@visibleForTesting
CardSheet cardSheet = _stripeSheet;

Future<SheetOutcome> _stripeSheet(PaymentSession s) async {
  try {
    Stripe.publishableKey = s.publishableKey;
    await Stripe.instance.applySettings();
    await Stripe.instance.initPaymentSheet(
      paymentSheetParameters: SetupPaymentSheetParameters(
        paymentIntentClientSecret: s.clientSecret,
        merchantDisplayName: 'TowNow',
        style: ThemeMode.system,
      ),
    );
    await Stripe.instance.presentPaymentSheet();
    return const SheetOutcome(SheetResult.completed);
  } on StripeException catch (e) {
    if (e.error.code == FailureCode.Canceled) return const SheetOutcome(SheetResult.closed);
    return SheetOutcome(SheetResult.failed, e.error.localizedMessage ?? e.error.message);
  }
}

/// Opens the card form for an unpaid card booking, then asks the server for the result
/// (the webhook usually got there first; sync covers a late one). Returns the payment
/// status the server now has, or null when nothing could be read.
/// The client secret only lives in memory for the duration of this call.
Future<String?> payByCard(BuildContext context, String bookingId) async {
  final api = context.api;
  final session = await context.guard(() => api.paymentSession(bookingId));
  if (session == null || !context.mounted) return null;
  if (session.clientSecret == null) return session.status; // already authorised / paid
  if (!_allowLive && !session.publishableKey.startsWith('pk_test_')) {
    context.toast('Card payments are in test mode only.', error: true);
    return null;
  }

  final outcome = await cardSheet(session);
  if (!context.mounted) return null;
  final summary = await context.guard(() => api.syncPayment(bookingId));
  if (summary == null || !context.mounted) return null;

  switch (summary.status) {
    case 'authorized' || 'captured':
      context.toast('Card authorised — you are charged after delivery.', success: true);
    case 'failed':
      context.toast(
        summary.failureReason ?? outcome.message ?? 'The card payment failed. Please try again.',
        error: true,
      );
    default:
      context.toast(switch (outcome.result) {
        SheetResult.closed => 'Payment not completed. Tap Pay now when you are ready.',
        SheetResult.failed => outcome.message ?? 'The card payment failed. Please try again.',
        SheetResult.completed => 'Payment is processing…',
      }, error: outcome.result == SheetResult.failed);
  }
  return summary.status;
}
