import 'package:flutter/material.dart';
import 'package:townow_core/townow_core.dart';

import '../widgets.dart';

class VehiclesScreen extends StatefulWidget {
  const VehiclesScreen({super.key});

  @override
  State<VehiclesScreen> createState() => _VehiclesScreenState();
}

class _VehiclesScreenState extends State<VehiclesScreen> {
  int _version = 0;

  void _reload() => setState(() => _version++);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My vehicles')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: TnColors.lime,
        foregroundColor: TnColors.navy,
        icon: const Icon(Icons.add_rounded),
        label: const Text('Add vehicle', style: TextStyle(fontWeight: FontWeight.w800)),
        onPressed: () async {
          if (await addVehicle(context) != null) _reload();
        },
      ),
      body: Loader<List<Vehicle>>(
        key: ValueKey(_version),
        load: context.api.vehicles,
        builder: (context, vehicles, reload) => vehicles.isEmpty
            ? const Center(
                child: EmptyState(
                  icon: Icons.directions_car_filled_rounded,
                  title: 'No vehicles yet',
                  message: 'Add your car or motorbike so drivers know what to tow.',
                ),
              )
            : ListView.separated(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 96),
                itemCount: vehicles.length,
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (context, i) {
                  final v = vehicles[i];
                  return VehicleCard(
                    vehicle: v,
                    trailing: PopupMenuButton<String>(
                      icon: const Icon(Icons.more_vert_rounded),
                      onSelected: (action) async {
                        if (action == 'edit') {
                          if (await addVehicle(context, existing: v) != null) _reload();
                        } else if (await confirmAction(
                          context,
                          title: 'Remove ${v.title}?',
                          message: 'Past bookings keep their details.',
                          confirm: 'Remove',
                          danger: true,
                        )) {
                          if (!context.mounted) return;
                          await context.guard(() => context.api.removeVehicle(v.id));
                          _reload();
                        }
                      },
                      itemBuilder: (_) => const [
                        PopupMenuItem(value: 'edit', child: Text('Edit')),
                        PopupMenuItem(value: 'remove', child: Text('Remove')),
                      ],
                    ),
                  );
                },
              ),
      ),
    );
  }
}

/// Add (or edit) sheet; returns the saved vehicle.
Future<Vehicle?> addVehicle(BuildContext context, {Vehicle? existing}) {
  final scope = AppScope.of(context);
  return showTnSheet<Vehicle>(
    context,
    builder: (_) => AppScope(
      api: scope.api,
      realtime: scope.realtime,
      child: _VehicleForm(existing: existing),
    ),
  );
}

class _VehicleForm extends StatefulWidget {
  const _VehicleForm({this.existing});

  final Vehicle? existing;

  @override
  State<_VehicleForm> createState() => _VehicleFormState();
}

class _VehicleFormState extends State<_VehicleForm> {
  late final _brand = TextEditingController(text: widget.existing?.brand);
  late final _model = TextEditingController(text: widget.existing?.model);
  late final _year = TextEditingController(text: widget.existing?.year.toString());
  late final _code = TextEditingController(text: widget.existing?.plateCode);
  late final _number = TextEditingController(text: widget.existing?.plateNumber);
  late String _category = widget.existing?.category ?? 'car';
  late String _emirate = widget.existing?.plateEmirate ?? 'Dubai';

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          editing ? 'Edit vehicle' : 'Add a vehicle',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 16),
        if (!editing) ...[
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(
                value: 'car',
                label: Text('Car'),
                icon: Icon(Icons.directions_car_filled_rounded),
              ),
              ButtonSegment(
                value: 'motorbike',
                label: Text('Motorbike'),
                icon: Icon(Icons.two_wheeler_rounded),
              ),
            ],
            selected: {_category},
            onSelectionChanged: (s) => setState(() => _category = s.first),
          ),
          const SizedBox(height: 12),
        ],
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _brand,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(labelText: 'Make', hintText: 'Toyota'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: TextField(
                controller: _model,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(labelText: 'Model', hintText: 'Camry'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _year,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Year', hintText: '2022'),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField(
          initialValue: _emirate,
          decoration: const InputDecoration(labelText: 'Plate emirate'),
          items: [for (final e in emirates) DropdownMenuItem(value: e, child: Text(e))],
          onChanged: (v) => setState(() => _emirate = v!),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _code,
                textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(labelText: 'Plate code', hintText: 'A'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              flex: 2,
              child: TextField(
                controller: _number,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Plate number', hintText: '12345'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),
        TnButton(
          label: editing ? 'Save changes' : 'Save vehicle',
          onPressed: () async {
            final navigator = Navigator.of(context);
            final api = context.api;
            final body = {
              'brand': _brand.text.trim(),
              'model': _model.text.trim(),
              'year': int.tryParse(_year.text.trim()) ?? 0,
              'plateEmirate': _emirate,
              'plateCode': _code.text.trim().toUpperCase(),
              'plateNumber': _number.text.trim(),
            };
            final v = await context.guard(
              () => editing
                  ? api.updateVehicle(widget.existing!.id, body)
                  : api.addVehicle({...body, 'category': _category}),
            );
            if (v != null) navigator.pop(v);
          },
        ),
      ],
    );
  }
}
