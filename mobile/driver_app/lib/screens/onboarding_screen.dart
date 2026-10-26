import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:townow_core/townow_core.dart';

import '../widgets.dart';

const documentLabels = {
  'emirates_id': 'Emirates ID',
  'driving_licence': 'UAE Driving Licence',
  'vehicle_registration': 'Vehicle Registration (Mulkiya)',
  'commercial_insurance': 'Commercial Insurance',
};

/// Verification (KYC): profile, tow truck and the four required documents.
/// TowNow operations approves the driver in the admin dashboard.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  int _version = 0; // bump to reload

  @override
  Widget build(BuildContext context) {
    final api = context.api;
    return Scaffold(
      appBar: AppBar(title: const Text('Verification')),
      body: Loader<(DriverProfile, List<DriverDocument>)>(
        key: ValueKey(_version),
        load: () async => (await api.driverProfile(), await api.documents()),
        builder: (context, data, reload) {
          final (profile, docs) = data;
          final hasProfile = (profile.fullName ?? '').trim().isNotEmpty;
          final hasTruck = profile.towTrucks.isNotEmpty;
          final uploaded = documentLabels.keys
              .where((t) => docs.any((d) => d.type == t && d.status != 'rejected'))
              .length;
          final steps = [hasProfile, hasTruck, uploaded == documentLabels.length];
          return RefreshIndicator(
            onRefresh: reload,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 28),
              children: [
                _statusBanner(profile, steps.where((s) => s).length),
                const SectionTitle('1 · Your profile'),
                _ProfileForm(profile: profile, onSaved: _bump),
                SectionTitle(
                  '2 · Tow truck',
                  trailing: hasTruck ? const StatusChip('approved', label: 'Added') : null,
                ),
                for (final t in profile.towTrucks) ...[
                  TnCard(
                    child: InfoRow(
                      icon: towIcons[t.towType] ?? Icons.local_shipping_rounded,
                      iconBg: TnColors.lime,
                      title: '${t.model} (${t.year})',
                      subtitle: '${towTypeLabels[t.towType] ?? t.towType} · ${t.plate}',
                    ),
                  ),
                  const SizedBox(height: 8),
                ],
                TnButton(
                  label: hasTruck ? 'Add another truck' : 'Add your tow truck',
                  icon: Icons.add_rounded,
                  kind: hasTruck ? TnButtonKind.secondary : TnButtonKind.primary,
                  onPressed: () async {
                    await showTnSheet<void>(
                      context,
                      builder: (_) =>
                          AppScope(api: api, realtime: context.realtime, child: const _TruckForm()),
                    );
                    _bump();
                  },
                ),
                SectionTitle(
                  '3 · Documents',
                  trailing: Text(
                    '$uploaded/${documentLabels.length}',
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
                for (final entry in documentLabels.entries) ...[
                  _DocumentTile(
                    type: entry.key,
                    label: entry.value,
                    doc: docs.where((d) => d.type == entry.key).firstOrNull,
                    onUploaded: _bump,
                  ),
                  const SizedBox(height: 8),
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _statusBanner(DriverProfile p, int stepsDone) {
    final (IconData icon, Color color, String title, String body) = switch (p.kycStatus) {
      'approved' => (
        Icons.verified_rounded,
        TnColors.success,
        'You\'re verified',
        'You can go online and accept tow requests.',
      ),
      'rejected' => (
        Icons.error_rounded,
        TnColors.error,
        'Verification rejected',
        p.kycRejectionReason ?? 'Fix the documents marked below and upload them again.',
      ),
      'suspended' => (
        Icons.block_rounded,
        TnColors.error,
        'Account suspended',
        'Contact TowNow support.',
      ),
      _ => (
        Icons.hourglass_top_rounded,
        TnColors.warning,
        stepsDone == 3 ? 'Under review' : 'Complete your verification',
        stepsDone == 3
            ? 'TowNow is reviewing your documents. You\'ll be notified of the decision.'
            : 'Finish the 3 steps below. TowNow reviews everything before you can go online.',
      ),
    };
    return TnCard(
      borderColor: color,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                ),
              ),
              Text('$stepsDone/3', style: const TextStyle(fontWeight: FontWeight.w800)),
            ],
          ),
          const SizedBox(height: 6),
          Text(body, style: const TextStyle(color: TnColors.muted)),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(value: stepsDone / 3, minHeight: 6),
          ),
        ],
      ),
    );
  }

  void _bump() => setState(() => _version++);
}

class _ProfileForm extends StatefulWidget {
  const _ProfileForm({required this.profile, required this.onSaved});

  final DriverProfile profile;
  final VoidCallback onSaved;

  @override
  State<_ProfileForm> createState() => _ProfileFormState();
}

class _ProfileFormState extends State<_ProfileForm> {
  late final _name = TextEditingController(text: widget.profile.fullName);
  late final _years = TextEditingController(text: '${widget.profile.experienceYears}');

  @override
  Widget build(BuildContext context) {
    return TnCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _name,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Full name (as on Emirates ID)'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _years,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Years of towing experience'),
          ),
          const SizedBox(height: 12),
          TnButton(
            label: 'Save profile',
            kind: TnButtonKind.secondary,
            onPressed: () async {
              final ok = await context.guard(() async {
                await context.api.updateDriverProfile(
                  fullName: _name.text.trim(),
                  experienceYears: int.tryParse(_years.text.trim()),
                );
                return true;
              });
              if (ok == true && context.mounted) {
                context.toast('Profile saved', success: true);
                widget.onSaved();
              }
            },
          ),
        ],
      ),
    );
  }
}

class _TruckForm extends StatefulWidget {
  const _TruckForm();

  @override
  State<_TruckForm> createState() => _TruckFormState();
}

class _TruckFormState extends State<_TruckForm> {
  final _model = TextEditingController();
  final _year = TextEditingController();
  final _code = TextEditingController();
  final _number = TextEditingController();
  String _towType = 'flatbed';
  String _emirate = 'Dubai';

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Your tow truck', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 16),
        DropdownButtonFormField(
          initialValue: _towType,
          decoration: const InputDecoration(labelText: 'Equipment'),
          items: [
            for (final e in towTypeLabels.entries)
              DropdownMenuItem(value: e.key, child: Text(e.value)),
          ],
          onChanged: (v) => setState(() => _towType = v!),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: _model,
          decoration: const InputDecoration(labelText: 'Truck model'),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: _year,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Year'),
        ),
        const SizedBox(height: 10),
        DropdownButtonFormField(
          initialValue: _emirate,
          decoration: const InputDecoration(labelText: 'Plate emirate'),
          items: [for (final e in emirates) DropdownMenuItem(value: e, child: Text(e))],
          onChanged: (v) => setState(() => _emirate = v!),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _code,
                textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(labelText: 'Plate code'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              flex: 2,
              child: TextField(
                controller: _number,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Plate number'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),
        TnButton(
          label: 'Save truck',
          onPressed: () async {
            final navigator = Navigator.of(context);
            final ok = await context.guard(() async {
              await context.api.addTowTruck({
                'towType': _towType,
                'model': _model.text.trim(),
                'year': int.tryParse(_year.text.trim()) ?? 0,
                'plateEmirate': _emirate,
                'plateCode': _code.text.trim().toUpperCase(),
                'plateNumber': _number.text.trim(),
              });
              return true;
            });
            if (ok == true) navigator.pop();
          },
        ),
      ],
    );
  }
}

class _DocumentTile extends StatelessWidget {
  const _DocumentTile({
    required this.type,
    required this.label,
    required this.doc,
    required this.onUploaded,
  });

  final String type, label;
  final DriverDocument? doc;
  final VoidCallback onUploaded;

  Future<void> _upload(BuildContext context) async {
    final api = context.api;
    final source = await showTnSheet<ImageSource>(
      context,
      builder: (ctx) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(label, style: Theme.of(ctx).textTheme.titleLarge),
          const SizedBox(height: 4),
          const Text(
            'Make sure all four corners and the text are clearly visible.',
            style: TextStyle(color: TnColors.muted),
          ),
          const SizedBox(height: 12),
          InfoRow(
            icon: Icons.photo_camera_rounded,
            title: 'Take a photo',
            onTap: () => Navigator.pop(ctx, ImageSource.camera),
          ),
          InfoRow(
            icon: Icons.photo_library_rounded,
            title: 'Choose from gallery',
            onTap: () => Navigator.pop(ctx, ImageSource.gallery),
          ),
        ],
      ),
    );
    if (source == null || !context.mounted) return;
    final XFile? picked;
    try {
      picked = await ImagePicker().pickImage(source: source, maxWidth: 2400, imageQuality: 85);
    } catch (_) {
      if (context.mounted) {
        context.toast('Camera or photos unavailable. Check app permissions.', error: true);
      }
      return;
    }
    if (picked == null || !context.mounted) return;
    final number = TextEditingController(text: doc?.documentNumber);
    final confirmed = await showTnSheet<bool>(
      context,
      builder: (ctx) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(label, style: Theme.of(ctx).textTheme.titleLarge),
          const SizedBox(height: 12),
          TextField(
            controller: number,
            decoration: const InputDecoration(labelText: 'Document number (optional)'),
          ),
          const SizedBox(height: 16),
          TnButton(
            label: 'Upload',
            icon: Icons.cloud_upload_rounded,
            onPressed: () async => Navigator.pop(ctx, true),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    final bytes = await picked.readAsBytes();
    if (!context.mounted) return;
    final ok = await context.guard(() async {
      await api.uploadDocument(
        type,
        UploadFile(bytes: bytes, filename: '$type.jpg', contentType: 'image/jpeg'),
        documentNumber: number.text.trim().isEmpty ? null : number.text.trim(),
      );
      return true;
    });
    if (ok == true && context.mounted) {
      context.toast('$label uploaded', success: true);
      onUploaded();
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = doc;
    final rejected = d?.status == 'rejected';
    return TnCard(
      onTap: () => _upload(context),
      borderColor: rejected ? TnColors.error : null,
      child: InfoRow(
        icon: d == null
            ? Icons.upload_file_rounded
            : rejected
            ? Icons.error_rounded
            : Icons.description_rounded,
        iconBg: d == null ? TnColors.bg : (rejected ? const Color(0xFFFBE9E9) : TnColors.lime),
        iconColor: rejected ? TnColors.error : TnColors.navy,
        title: label,
        subtitle: d == null
            ? 'Not uploaded — tap to add'
            : rejected
            ? 'Rejected: ${d.rejectionReason ?? 'please re-upload'}'
            : (d.documentNumber ?? 'Uploaded'),
        trailing: d == null
            ? const Icon(Icons.add_a_photo_rounded, color: TnColors.navy)
            : StatusChip(d.status),
      ),
    );
  }
}
