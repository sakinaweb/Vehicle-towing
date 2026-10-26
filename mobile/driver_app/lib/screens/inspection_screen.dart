import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:townow_core/townow_core.dart';

const _slots = ['front', 'back', 'left', 'right'];
const _slotIcons = {
  'front': Icons.arrow_upward_rounded,
  'back': Icons.arrow_downward_rounded,
  'left': Icons.arrow_back_rounded,
  'right': Icons.arrow_forward_rounded,
};
const _checklistItems = ['body', 'glass', 'lights', 'tyres', 'mirrors', 'interior'];
const _fuelLevels = {
  'empty': 'Empty',
  'quarter': '¼',
  'half': '½',
  'three_quarters': '¾',
  'full': 'Full',
};

/// Pickup or return inspection: odometer, fuel, checklist, four camera photos, submit.
/// Saved as a draft on the server as you go; submitting locks it. Photos are taken with
/// the camera (evidence), never picked from the gallery.
class InspectionScreen extends StatefulWidget {
  const InspectionScreen({super.key, required this.job, required this.stage});

  final DriverJob job;
  final String stage;

  @override
  State<InspectionScreen> createState() => _InspectionScreenState();
}

class _InspectionScreenState extends State<InspectionScreen> {
  final _odometer = TextEditingController();
  final _notes = TextEditingController();
  String _fuel = 'half';
  final Map<String, String> _checklist = {for (final i in _checklistItems) i: 'ok'};
  Inspection? _saved;
  final _previews = <String, Uint8List>{}; // slot → image shown in the tile
  final _uploading = <String>{};
  bool _submitting = false;

  String get _base => '/drivers/me/jobs/${widget.job.bookingId}/inspections';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = context.api;
    final all = await context.guard(() => api.inspections(widget.job.bookingId));
    final mine = all?.where((i) => i.stage == widget.stage).firstOrNull;
    if (mine == null || !mounted) return;
    setState(() {
      _saved = mine;
      _odometer.text = '${mine.odometerKm}';
      _notes.text = mine.notes ?? '';
      _fuel = mine.fuelLevel;
      _checklist.addAll(mine.checklist);
    });
    // Thumbnails of photos already on the server (private endpoint, driver token).
    for (final p in mine.photos) {
      api.bytes('$_base/photos/${p.id}').then((b) {
        if (mounted) setState(() => _previews[p.slot] = Uint8List.fromList(b));
      }, onError: (Object _) {});
    }
  }

  Map<String, dynamic>? _details() {
    final km = int.tryParse(_odometer.text.trim());
    if (km == null || km < 0) {
      context.toast('Enter the odometer reading in km.', error: true);
      return null;
    }
    return {
      'odometerKm': km,
      'fuelLevel': _fuel,
      'checklist': _checklist,
      if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
    };
  }

  Future<bool> _save() async {
    final details = _details();
    if (details == null) return false;
    final api = context.api;
    final saved = await context.guard(
      () => api.saveInspection(widget.job.bookingId, widget.stage, details),
    );
    if (saved != null && mounted) setState(() => _saved = saved);
    return saved != null;
  }

  Future<void> _photo(String slot) async {
    if (_saved == null && !await _save()) return;
    final XFile? shot;
    try {
      shot = await ImagePicker().pickImage(
        source: ImageSource.camera,
        maxWidth: 1920,
        imageQuality: 80,
      );
    } catch (_) {
      if (mounted) {
        context.toast('Camera unavailable. Allow camera access in Settings.', error: true);
      }
      return;
    }
    if (shot == null || !mounted) return;
    final bytes = await shot.readAsBytes();
    if (!mounted) return;
    setState(() {
      _uploading.add(slot);
      _previews[slot] = bytes;
    });
    final api = context.api;
    final saved = await context.guard(
      () => api.uploadInspectionPhoto(
        widget.job.bookingId,
        widget.stage,
        slot,
        UploadFile(bytes: bytes, filename: '$slot.jpg', contentType: 'image/jpeg'),
      ),
    );
    if (!mounted) return;
    setState(() {
      _uploading.remove(slot);
      if (saved != null) {
        _saved = saved;
      } else if (!(_saved?.photos.any((p) => p.slot == slot) ?? false)) {
        _previews.remove(slot); // upload failed and nothing on the server
      }
    });
  }

  Future<void> _submit() async {
    setState(() => _submitting = true);
    final navigator = Navigator.of(context);
    final api = context.api;
    if (await _save() && mounted) {
      final done = await context.guard(
        () => api.submitInspection(widget.job.bookingId, widget.stage),
      );
      if (done != null) {
        if (mounted) context.toast('Inspection submitted', success: true);
        navigator.pop();
        return;
      }
    }
    if (mounted) setState(() => _submitting = false);
  }

  @override
  Widget build(BuildContext context) {
    final uploaded = {for (final p in _saved?.photos ?? <InspectionPhoto>[]) p.slot};
    final photosDone = _slots.where(uploaded.contains).length;
    final ready = photosDone == _slots.length && _uploading.isEmpty;
    return Scaffold(
      appBar: AppBar(title: Text('${widget.stage == 'pickup' ? 'Pickup' : 'Return'} inspection')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 28),
        children: [
          TnCard(
            color: TnColors.navy,
            borderColor: TnColors.navy,
            child: Row(
              children: [
                SizedBox(
                  width: 52,
                  height: 52,
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      SizedBox.expand(
                        child: CircularProgressIndicator(
                          value: photosDone / _slots.length,
                          strokeWidth: 5,
                          color: TnColors.lime,
                          backgroundColor: TnColors.deepNavy,
                        ),
                      ),
                      Text(
                        '$photosDone/4',
                        style: const TextStyle(color: TnColors.white, fontWeight: FontWeight.w900),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Text(
                    ready
                        ? 'All photos uploaded — check the details and submit.'
                        : 'Record the vehicle\'s condition before ${widget.stage == 'pickup' ? 'loading' : 'handing it over'}.',
                    style: const TextStyle(color: TnColors.white),
                  ),
                ),
              ],
            ),
          ),
          const SectionTitle('Photos (required)'),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 1.25,
            children: [for (final slot in _slots) _photoTile(slot, uploaded.contains(slot))],
          ),
          const SectionTitle('Details'),
          TnCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  key: const Key('odometer'),
                  controller: _odometer,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Odometer (km)', suffixText: 'km'),
                ),
                const SizedBox(height: 14),
                const Text('Fuel level', style: TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                SegmentedButton<String>(
                  showSelectedIcon: false,
                  segments: [
                    for (final e in _fuelLevels.entries)
                      ButtonSegment(value: e.key, label: Text(e.value)),
                  ],
                  selected: {_fuel},
                  onSelectionChanged: (s) => setState(() => _fuel = s.first),
                ),
              ],
            ),
          ),
          const SectionTitle('Condition'),
          TnCard(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
            child: Column(
              children: [
                for (final item in _checklistItems) ...[
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            item[0].toUpperCase() + item.substring(1),
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                        ),
                        _conditionChoice(item, 'ok', 'OK'),
                        const SizedBox(width: 8),
                        _conditionChoice(item, 'damaged', 'Damaged'),
                      ],
                    ),
                  ),
                  if (item != _checklistItems.last) const Divider(),
                ],
              ],
            ),
          ),
          const SectionTitle('Notes'),
          TextField(
            controller: _notes,
            maxLines: 3,
            decoration: const InputDecoration(
              hintText: 'Existing damage, e.g. scratch on rear bumper',
            ),
          ),
          const SizedBox(height: 20),
          if (!ready)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(
                'Take all 4 photos to submit (${4 - photosDone} left).',
                textAlign: TextAlign.center,
                style: const TextStyle(color: TnColors.muted),
              ),
            ),
          TnButton(
            label: 'Submit inspection',
            icon: Icons.lock_rounded,
            onPressed: !ready || _submitting ? null : _submit,
          ),
        ],
      ),
    );
  }

  Widget _conditionChoice(String item, String value, String label) {
    final selected = _checklist[item] == value;
    final damaged = value == 'damaged';
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      showCheckmark: false,
      selectedColor: damaged ? TnColors.error : TnColors.navy,
      backgroundColor: TnColors.white,
      side: BorderSide(color: selected ? Colors.transparent : TnColors.border),
      labelStyle: TextStyle(
        color: selected ? TnColors.white : TnColors.text,
        fontWeight: FontWeight.w700,
      ),
      onSelected: (_) => setState(() => _checklist[item] = value),
    );
  }

  Widget _photoTile(String slot, bool done) {
    final preview = _previews[slot];
    final busy = _uploading.contains(slot);
    return Material(
      color: done ? TnColors.navy : TnColors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(TnRadius.lg),
        side: BorderSide(color: done ? TnColors.navy : TnColors.border, width: 1.4),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: busy ? null : () => _photo(slot),
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (preview != null)
              Image.memory(preview, fit: BoxFit.cover, gaplessPlayback: true)
            else
              Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(_slotIcons[slot], color: TnColors.navy),
                  const SizedBox(height: 6),
                  const Icon(Icons.photo_camera_rounded, color: TnColors.muted, size: 20),
                ],
              ),
            Positioned(
              left: 8,
              bottom: 8,
              right: 8,
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: done ? TnColors.lime : TnColors.bg,
                      borderRadius: BorderRadius.circular(99),
                    ),
                    child: Text(
                      slot[0].toUpperCase() + slot.substring(1),
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 12,
                        color: TnColors.navy,
                      ),
                    ),
                  ),
                  const Spacer(),
                  if (done && !busy)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.black54,
                        borderRadius: BorderRadius.circular(99),
                      ),
                      child: const Text(
                        'Retake',
                        style: TextStyle(color: TnColors.white, fontSize: 11),
                      ),
                    ),
                ],
              ),
            ),
            if (busy)
              Container(
                color: Colors.black38,
                alignment: Alignment.center,
                child: const CircularProgressIndicator(color: TnColors.lime),
              ),
            if (done && !busy)
              const Positioned(
                top: 8,
                right: 8,
                child: Icon(Icons.check_circle_rounded, color: TnColors.lime),
              ),
          ],
        ),
      ),
    );
  }
}
