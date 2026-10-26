import 'package:flutter/material.dart';
import 'package:townow_core/townow_core.dart';

import 'screens/bookings_screen.dart';
import 'screens/home_screen.dart';
import 'screens/tracking_screen.dart';
import 'screens/vehicles_screen.dart';
import 'widgets.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  MapView.userAgentPackageName = 'ae.townow.townow_customer'; // OSM tile policy: app identity
  final sessions = SecureSessionStore('townow.customer.session');
  await sessions.load();
  await Push.initialize();
  final api = ApiClient(baseUrl: TowNowConfig.apiBaseUrl, sessions: sessions, role: 'customer');
  runApp(CustomerApp(api: api));
}

class CustomerApp extends StatefulWidget {
  const CustomerApp({super.key, required this.api});

  final ApiClient api;

  @override
  State<CustomerApp> createState() => _CustomerAppState();
}

class _CustomerAppState extends State<CustomerApp> {
  late final realtime = Realtime(widget.api);
  late final push = Push(widget.api);
  final _navigator = GlobalKey<NavigatorState>();
  final _messenger = GlobalKey<ScaffoldMessengerState>();

  @override
  void initState() {
    super.initState();
    Push.listen(
      onForeground: (title, body, data) {
        final messenger = _messenger.currentState;
        if (messenger == null) return;
        showPushBanner(
          messenger,
          title,
          body,
          onView: data['bookingId'] == null ? null : () => _openBooking(data),
        );
      },
      onOpen: _openBooking,
    );
    widget.api.onSignedOut = () => setState(realtime.disconnect);
    if (widget.api.session != null) _onSignedIn();
  }

  void _onSignedIn() {
    realtime.connect();
    push.register();
    setState(() {});
  }

  /// A tapped notification opens its booking (tracking shows the end state of a finished one).
  void _openBooking(Map<String, dynamic> data) {
    final id = data['bookingId'];
    if (id is! String || id.isEmpty || widget.api.session == null) return;
    _navigator.currentState?.push(
      MaterialPageRoute<void>(builder: (_) => TrackingScreen(bookingId: id)),
    );
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
        title: 'TowNow',
        navigatorKey: _navigator,
        scaffoldMessengerKey: _messenger,
        debugShowCheckedModeBanner: false,
        theme: tnTheme(),
        home: widget.api.session == null
            ? SignInScreen(
                api: widget.api,
                title: 'Roadside towing,\nacross the UAE',
                subtitle: 'Verified tow trucks. Upfront prices. Pay the driver in cash.',
                onSignedIn: _onSignedIn,
              )
            : CustomerShell(onSignOut: _signOut),
      ),
    );
  }
}

class CustomerShell extends StatefulWidget {
  const CustomerShell({super.key, required this.onSignOut});

  final Future<void> Function() onSignOut;

  @override
  State<CustomerShell> createState() => _CustomerShellState();
}

class _CustomerShellState extends State<CustomerShell> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: switch (_tab) {
        0 => HomeScreen(onOpenAccount: () => setState(() => _tab = 2)),
        1 => const SafeArea(bottom: false, child: BookingsScreen()),
        _ => SafeArea(bottom: false, child: AccountScreen(onSignOut: widget.onSignOut)),
      },
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home_rounded),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.receipt_long_outlined),
            selectedIcon: Icon(Icons.receipt_long_rounded),
            label: 'My tows',
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

class AccountScreen extends StatefulWidget {
  const AccountScreen({super.key, required this.onSignOut});

  final Future<void> Function() onSignOut;

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
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
              InitialsAvatar(user?.fullName ?? 'TowNow', size: 56, dark: false),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      user?.fullName ?? 'Add your name',
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
              IconButton(
                tooltip: 'Edit name',
                icon: const Icon(Icons.edit_rounded, color: TnColors.lime),
                onPressed: () => _editName(user?.fullName),
              ),
            ],
          ),
        ),
        const SectionTitle('My TowNow'),
        TnCard(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
          child: Column(
            children: [
              InfoRow(
                icon: Icons.directions_car_filled_rounded,
                title: 'My vehicles',
                subtitle: 'Cars and motorbikes you tow with us',
                trailing: const Icon(Icons.chevron_right_rounded, color: TnColors.muted),
                onTap: () => open(const VehiclesScreen()),
              ),
              const Divider(),
              InfoRow(
                icon: Icons.notifications_rounded,
                title: 'Notifications',
                subtitle: 'Trip updates and messages',
                trailing: const Icon(Icons.chevron_right_rounded, color: TnColors.muted),
                onTap: () => open(const InboxScreen()),
              ),
              const Divider(),
              InfoRow(
                icon: Icons.support_agent_rounded,
                title: 'My disputes',
                subtitle: 'Problems you reported and TowNow\'s decisions',
                trailing: const Icon(Icons.chevron_right_rounded, color: TnColors.muted),
                onTap: () => open(const DisputesScreen()),
              ),
            ],
          ),
        ),
        const SectionTitle('Help'),
        TnCard(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
          child: Column(
            children: [
              if (TowNowConfig.supportPhone.isNotEmpty) ...[
                InfoRow(
                  icon: Icons.headset_mic_rounded,
                  title: 'Call TowNow support',
                  subtitle: TowNowConfig.supportPhone,
                  onTap: () => callNumber(TowNowConfig.supportPhone),
                ),
                const Divider(),
              ],
              InfoRow(
                icon: Icons.emergency_rounded,
                iconColor: TnColors.error,
                title: 'Emergency (Police) 999',
                subtitle: 'For accidents with injuries or danger on the road',
                onTap: () => callNumber('999'),
              ),
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
              message: 'You can sign in again with your mobile number.',
              confirm: 'Sign out',
            )) {
              await widget.onSignOut();
            }
          },
        ),
      ],
    );
  }

  Future<void> _editName(String? current) async {
    final name = TextEditingController(text: current);
    final api = context.api;
    final saved = await showTnSheet<bool>(
      context,
      builder: (ctx) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Your name', style: Theme.of(ctx).textTheme.titleLarge),
          const SizedBox(height: 4),
          const Text('Drivers see your first name only.', style: TextStyle(color: TnColors.muted)),
          const SizedBox(height: 16),
          TextField(
            controller: name,
            autofocus: true,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Full name'),
          ),
          const SizedBox(height: 16),
          TnButton(
            label: 'Save',
            onPressed: () async {
              final ok = await ctx.guard(() async {
                await api.updateCustomerProfile(fullName: name.text.trim());
                return true;
              });
              if (ok == true && ctx.mounted) Navigator.pop(ctx, true);
            },
          ),
        ],
      ),
    );
    if (saved == true && mounted) context.toast('Name updated', success: true);
  }
}

class DisputesScreen extends StatelessWidget {
  const DisputesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My disputes')),
      body: Loader<List<Dispute>>(
        load: context.api.myDisputes,
        builder: (context, items, reload) => RefreshIndicator(
          onRefresh: reload,
          child: items.isEmpty
              ? ListView(
                  children: const [
                    EmptyState(
                      icon: Icons.support_agent_rounded,
                      title: 'No disputes',
                      message:
                          'If something goes wrong on a tow, report it from the completed trip.',
                    ),
                  ],
                )
              : ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: items.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (_, i) {
                    final d = items[i];
                    return TnCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  d.bookingNumber,
                                  style: const TextStyle(fontWeight: FontWeight.w800),
                                ),
                              ),
                              StatusChip(d.status),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text(d.reason),
                          if (d.resolution != null) ...[
                            const SizedBox(height: 10),
                            Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: TnColors.bg,
                                borderRadius: BorderRadius.circular(TnRadius.md),
                              ),
                              child: Text('TowNow: ${d.resolution}'),
                            ),
                          ],
                        ],
                      ),
                    );
                  },
                ),
        ),
      ),
    );
  }
}
