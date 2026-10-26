'use client';

import { useState } from 'react';
import { ErrorBox, Shell, useLoad } from '../../components/Shell';
import { Badge, SkeletonRows, useFeedback } from '../../components/ui';
import { aed, errorText, listTariffs, publishTariff, TariffInput, TariffVersion, when } from '../../lib/admin';

const MONEY_FIELDS = [
  ['baseFareFils', 'Base fare'],
  ['perKmFils', 'Per km'],
  ['minimumFareFils', 'Minimum fare'],
  ['towTypeSurchargeFils', 'Equipment surcharge'],
  ['nightSurchargeFils', 'Night surcharge (00:00–05:59)'],
] as const;

const TYPE_LABELS: Record<string, string> = {
  flatbed: 'Flatbed',
  'wheel-lift': 'Wheel-lift',
  'bike-carrier': 'Bike carrier',
};

/** Tariffs are versioned: publishing creates a new version; past bookings keep theirs. */
export default function PricingPage() {
  const { data, error, reload } = useLoad(listTariffs);
  const current = (data ?? []).filter((t) => !t.effectiveTo);
  return (
    <Shell title="Fares" subtitle="VAT (5%) is fixed by law. Changes apply to new quotes only.">
      <ErrorBox error={error} />
      {!data && !error && <SkeletonRows rows={3} cols={6} />}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {current.map((t) => (
          <TariffEditor key={t.id} tariff={t} onPublished={reload} />
        ))}
      </div>
      {data && (
        <>
          <h2>Version history</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Base</th>
                  <th>Per km</th>
                  <th>Minimum</th>
                  <th>Commission</th>
                  <th>From</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <strong>{TYPE_LABELS[t.towType] ?? t.towType}</strong>
                    </td>
                    <td className="num">{aed(t.baseFareFils)}</td>
                    <td className="num">{aed(t.perKmFils)}</td>
                    <td className="num">{aed(t.minimumFareFils)}</td>
                    <td>{t.platformCommissionBps / 100}%</td>
                    <td className="muted">{when(t.effectiveFrom)}</td>
                    <td>{t.effectiveTo ? <span className="muted">until {when(t.effectiveTo)}</span> : <Badge status="approved" label="Current" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Shell>
  );
}

function TariffEditor({ tariff, onPublished }: { tariff: TariffVersion; onPublished: () => void }) {
  const { confirm, toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(MONEY_FIELDS.map(([k]) => [k, (tariff[k] / 100).toFixed(2)])),
    commission: String(tariff.platformCommissionBps / 100),
  }));

  const publish = async () => {
    const body: TariffInput = {
      towType: tariff.towType,
      baseFareFils: 0,
      perKmFils: 0,
      minimumFareFils: 0,
      towTypeSurchargeFils: 0,
      nightSurchargeFils: 0,
      platformCommissionBps: Math.round(Number(form.commission) * 100),
    };
    for (const [k] of MONEY_FIELDS) body[k] = Math.round(Number(form[k]) * 100);
    if (
      !(await confirm({
        title: `Publish new ${TYPE_LABELS[tariff.towType] ?? tariff.towType} fares?`,
        message: 'Effective immediately for new quotes. Existing bookings keep their price.',
        confirm: 'Publish',
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await publishTariff(body);
      toast('New fare version published');
      onPublished();
    } catch (e) {
      toast(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 17 }}>{TYPE_LABELS[tariff.towType] ?? tariff.towType}</strong>
        <span className="muted">since {when(tariff.effectiveFrom)}</span>
      </div>
      {MONEY_FIELDS.map(([k, label]) => (
        <label key={k} className="field">
          {label} (AED)
          <input inputMode="decimal" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
        </label>
      ))}
      <label className="field">
        TowNow commission (%)
        <input inputMode="decimal" value={form.commission} onChange={(e) => setForm({ ...form, commission: e.target.value })} />
      </label>
      <button className="dark" disabled={busy} onClick={() => void publish()}>
        Publish new version
      </button>
    </div>
  );
}
