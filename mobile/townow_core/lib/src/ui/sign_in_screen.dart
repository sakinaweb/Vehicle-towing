import 'dart:async';

import 'package:flutter/material.dart';

import '../api_client.dart';
import '../config.dart';
import '../format.dart';
import 'design.dart';

/// Phone → SMS code sign-in (the API's OTP flow). Same for customers and drivers.
class SignInScreen extends StatefulWidget {
  const SignInScreen({
    super.key,
    required this.api,
    required this.title,
    required this.onSignedIn,
    this.subtitle,
    this.icon = Icons.local_shipping_rounded,
    this.countries,
  });

  final ApiClient api;
  final String title;
  final String? subtitle;
  final IconData icon;
  final VoidCallback onSignedIn;

  /// ISO codes offered, first = default. Defaults to --dart-define=PHONE_COUNTRIES.
  final List<String>? countries;

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  late final List<PhoneCountry> _countries =
      (widget.countries ?? TowNowConfig.phoneCountries.split(','))
          .map((c) => phoneCountries[c.trim().toUpperCase()])
          .whereType<PhoneCountry>()
          .toList();
  late PhoneCountry _country = _countries.isEmpty ? phoneCountries['AE']! : _countries.first;
  String? _sentTo;
  String? _error;
  int _resendIn = 0;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _error = null);
    try {
      await action();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Something went wrong. Please try again.');
    }
  }

  void _startResendTimer() {
    _timer?.cancel();
    setState(() => _resendIn = 30);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted || _resendIn <= 1) {
        t.cancel();
        if (mounted) setState(() => _resendIn = 0);
        return;
      }
      setState(() => _resendIn--);
    });
  }

  Future<void> _sendCode() => _run(() async {
    final phone = _country.normalize(_phone.text);
    if (phone == null) {
      setState(
        () => _error = _country.iso == 'AE'
            ? 'Enter a UAE mobile number, e.g. 050 123 4567.'
            : 'Enter a valid ${_country.name} mobile number, e.g. ${_country.example}.',
      );
      return;
    }
    await widget.api.requestOtp(phone);
    setState(() => _sentTo = phone);
    _startResendTimer();
  });

  Future<void> _verify() => _run(() async {
    if (_code.text.trim().length != 6) {
      setState(() => _error = 'Enter the 6-digit code from the SMS.');
      return;
    }
    try {
      await widget.api.verifyOtp(_sentTo!, _code.text.trim());
    } on ApiException catch (e) {
      // 403/409 come after the code was accepted and spent: retrying it can only say
      // "expired", so go back to the number step with the real reason.
      if (e.status != 403 && !e.isConflict) rethrow;
      setState(() {
        _sentTo = null;
        _code.clear();
        _error = e.message;
      });
      return;
    }
    widget.onSignedIn();
  });

  Future<void> _sendAgain() => _run(() async {
    await widget.api.requestOtp(_sentTo!);
    _startResendTimer();
  });

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      backgroundColor: TnColors.white,
      body: ListView(
        padding: EdgeInsets.zero,
        children: [
          TnHeroHeader(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const TnWordmark(onDark: true, size: 26),
                const SizedBox(height: 36),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: TnColors.deepNavy,
                    borderRadius: BorderRadius.circular(TnRadius.lg),
                  ),
                  child: Icon(widget.icon, color: TnColors.lime, size: 34),
                ),
                const SizedBox(height: 18),
                Text(widget.title, style: text.headlineMedium?.copyWith(color: TnColors.white)),
                if (widget.subtitle != null) ...[
                  const SizedBox(height: 6),
                  Text(widget.subtitle!, style: text.bodyLarge?.copyWith(color: Colors.white70)),
                ],
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 250),
              child: _sentTo == null ? _phoneStep(text) : _codeStep(text),
            ),
          ),
        ],
      ),
    );
  }

  Widget _phoneStep(TextTheme text) {
    return Column(
      key: const ValueKey('phone-step'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Sign in with your mobile', style: text.titleLarge),
        const SizedBox(height: 4),
        const Text('We\'ll send a 6-digit code by SMS.', style: TextStyle(color: TnColors.muted)),
        const SizedBox(height: 20),
        TextField(
          key: const Key('phone'),
          controller: _phone,
          keyboardType: TextInputType.phone,
          autofillHints: const [AutofillHints.telephoneNumber],
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600, letterSpacing: 0.5),
          decoration: InputDecoration(
            labelText: _country.iso == 'AE' ? 'UAE mobile number' : 'Mobile number',
            hintText: _country.example,
            prefixIcon: Padding(
              padding: const EdgeInsets.only(left: 16, right: 8),
              child: _countries.length < 2 ? _dialCode(_country) : _countryPicker(),
            ),
            prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
          ),
          onSubmitted: (_) => _sendCode(),
        ),
        _errorText(),
        const SizedBox(height: 20),
        TnButton(label: 'Send code', icon: Icons.sms_rounded, onPressed: _sendCode),
      ],
    );
  }

  Widget _dialCode(PhoneCountry c) =>
      Text(c.dialCode, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700));

  Widget _countryPicker() => DropdownButtonHideUnderline(
    child: DropdownButton<PhoneCountry>(
      key: const Key('country'),
      value: _country,
      items: [
        for (final c in _countries)
          DropdownMenuItem(
            value: c,
            child: Semantics(label: c.name, child: _dialCode(c)),
          ),
      ],
      onChanged: (c) => setState(() {
        _country = c!;
        _error = null;
      }),
    ),
  );

  Widget _codeStep(TextTheme text) {
    return Column(
      key: const ValueKey('code-step'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Enter your code', style: text.titleLarge),
        const SizedBox(height: 4),
        Text('Sent to $_sentTo', style: const TextStyle(color: TnColors.muted)),
        const SizedBox(height: 20),
        TextField(
          key: const Key('code'),
          controller: _code,
          keyboardType: TextInputType.number,
          maxLength: 6,
          textAlign: TextAlign.center,
          autofillHints: const [AutofillHints.oneTimeCode],
          style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: 12),
          decoration: const InputDecoration(counterText: '', hintText: '000000'),
          onSubmitted: (_) => _verify(),
        ),
        _errorText(),
        const SizedBox(height: 20),
        TnButton(label: 'Verify and continue', onPressed: _verify),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            TextButton(
              onPressed: () => setState(() {
                _sentTo = null;
                _code.clear();
                _error = null;
              }),
              child: const Text('Change number'),
            ),
            TextButton(
              onPressed: _resendIn > 0 ? null : _sendAgain,
              child: Text(_resendIn > 0 ? 'Resend in ${_resendIn}s' : 'Resend code'),
            ),
          ],
        ),
      ],
    );
  }

  Widget _errorText() => AnimatedSize(
    duration: const Duration(milliseconds: 200),
    child: _error == null
        ? const SizedBox(width: double.infinity)
        : Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Row(
              children: [
                const Icon(Icons.error_outline_rounded, color: TnColors.error, size: 18),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(_error!, style: const TextStyle(color: TnColors.error)),
                ),
              ],
            ),
          ),
  );
}
