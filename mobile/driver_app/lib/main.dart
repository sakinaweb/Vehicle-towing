import 'package:flutter/material.dart';
import 'package:townow_core/townow_core.dart';

import 'screens/earnings_screen.dart';
import 'screens/onboarding_screen.dart';
import 'screens/work_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  MapView.userAgentPackageName = 'ae.townow.townow_driver'; // OSM tile policy: app identity
  final sessions = SecureSessionStore('townow.driver.session');
  await sessions.load();
  await Push.initialize();
  final api = ApiClient(baseUrl: TowNowConfig.apiBaseUrl, sessions: sessions, role: 'driver');
  runApp(DriverApp(api: api));
}

class DriverApp extends StatefulWidget {
  const DriverApp({super.key, required this.api});

  final ApiClient api;

  @override
  State<DriverApp> createState() => _DriverAppState();
}

class _DriverAppState extends State<DriverApp> {
  late final realtime = Realtime(widget.api);
  late final push = Push(widget.api);
  final _navigator = GlobalKey<NavigatorState>();
  final _messenger = GlobalKey<ScaffoldMessengerState>();
  final _shell = GlobalKey<_DriverShellState>();

  @override
  void initState() {
    super.initState();
    Push.listen(
      onForeground: (title, body, data) {
        final messenger = _messenger.currentState;
        if (messenger != null) showPushBanner(messenger, title, body, onView: _openWork);
      },
      onOpen: (_) => _openWork(),
    );
    widget.api.onSignedOut = () => setState(realtime.disconnect);
    if (widget.api.session != null) _onSignedIn();
  }

  void _onSignedIn() {
    realtime.connect();
    push.register();
    setState(() {});
  }

  /// A tapped notification (offer, cancelled job, KYC result) lands on the Work tab,
  /// which shows the current offer, job and verification state.
  void _openWork() {
    _navigator.currentState?.popUntil((r) => r.isFirst);
    _shell.currentState?.showTab(0);
  }

  Future<void> _signOut() async {
    await push.unregister();
    realtime.disconnect();
    await widget.api.signOut();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return AppScope(
      api: widget.api,
      realtime: realtime,
      child: MaterialApp(
        title: 'TowNow Driver',
        navigatorKey: _navigator,
        scaffoldMessengerKey: _messenger,
        debugShowCheckedModeBanner: false,
        theme: tnTheme(),
        home: widget.api.session == null
            ? SignInScreen(
                api: widget.api,
                title: 'Drive with\nTowNow',
                subtitle: 'Get tow requests near you. Get paid for every job.',
                icon: Icons.badge_rounded,
                onSignedIn: _onSignedIn,
              )
            : DriverShell(key: _shell, onSignOut: _signOut),
      ),
    );
  }
}

/// Bottom navigation: Work · Earnings · Account.
class DriverShell extends StatefulWidget {
  const DriverShell({super.key, required this.onSignOut});

  final Future<void> Function() onSignOut;

  @override
  State<DriverShell> createState() => _DriverShellState();
}

class _DriverShellState extends State<DriverShell> {
  int _tab = 0;

  void showTab(int tab) => setState(() => _tab = tab);

  @override
  Widget build(BuildContext context) {
    final pages = [
      const WorkScreen(),
      const SafeArea(bottom: false, child: EarningsScreen()),
      SafeArea(bottom: false, child: AccountScreen(onSignOut: widget.onSignOut)),
    ];
    return Scaffold(
      body: IndexedStack(index: _tab, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.local_shipping_outlined),
            selectedIcon: Icon(Icons.local_shipping_rounded),
            label: 'Work',
          ),
          NavigationDestination(
            icon: Icon(Icons.account_balance_wallet_outlined),
            selectedIcon: Icon(Icons.account_balance_wallet_rounded),
            label: 'Earnings',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline_rounded),
            selectedIcon: Icon(Icons.person_rounded),
            label: 'Account',
          ),
        ],
      ),
    );
  }
}

class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key, required this.onSignOut});

  final Future<void> Function() onSignOut;

  @override
  Widget build(BuildContext context) {
    final user = context.api.session?.user;
    void open(Widget screen) =>
        Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text('Account', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 16),
        TnCard(
          color: TnColors.navy,
          borderColor: TnColors.navy,
          child: Row(
            children: [
              Container(
                width: 56,
                height: 56,
                decoration: const BoxDecoration(color: TnColors.lime, shape: BoxShape.circle),
                child: const Icon(Icons.badge_rounded, color: TnColors.navy, size: 28),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      user?.fullName ?? 'Driver partner',
                      style: const TextStyle(
                        color: TnColors.white,
                        fontWeight: FontWeight.w800,
                        fontSize: 18,
                      ),
                    ),
                    Text(user?.phone ?? '', style: const TextStyle(color: Colors.white70)),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SectionTitle('Profile'),
        TnCard(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
          child: Column(
            children: [
              InfoRow(
                icon: Icons.verified_user_rounded,
                title: 'Profile, truck & documents',
                subtitle: 'Verification (KYC)',
                trailing: const Icon(Icons.chevron_right_rounded, color: TnColors.muted),
                onTap: () => open(const OnboardingScreen()),
              ),
              const Divider(),
              InfoRow(
                icon: Icons.notifications_rounded,
                title: 'Notifications',
                subtitle: 'Offers, KYC decisions and messages',
                trailing: const Icon(Icons.chevron_right_rounded, color: TnColors.muted),
                onTap: () => open(const InboxScreen()),
              ),
              if (TowNowConfig.supportPhone.isNotEmpty) ...[
                const Divider(),
                InfoRow(
                  icon: Icons.headset_mic_rounded,
                  title: 'Driver support',
                  subtitle: TowNowConfig.supportPhone,
                  onTap: () => callNumber(TowNowConfig.supportPhone),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 20),
        TnButton(
          label: 'Sign out',
          kind: TnButtonKind.secondary,
          icon: Icons.logout_rounded,
          onPressed: () async {
            if (await confirmAction(
              context,
              title: 'Sign out?',
              message: 'You will stop receiving tow requests on this phone.',
              confirm: 'Sign out',
            )) {
              await onSignOut();
            }
          },
        ),
      ],
    );
  }
}
