"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import type { CrmTier } from "../types";
import type { MemberEditForm } from "../member-detail";
import { FeedbackNote, fieldClass, type Feedback } from "./member-detail-ui";

/**
 * Form data customer + member. Pemanggil me-mount ulang lewat `key` saat data
 * server berubah, jadi state awal cukup diambil dari `initial`.
 */
export function MemberProfileForm({
  initial,
  activeTiers,
  crmProfileReady,
  saving,
  feedback,
  onSave,
}: {
  initial: MemberEditForm;
  activeTiers: CrmTier[];
  crmProfileReady: boolean;
  saving: boolean;
  feedback: Feedback;
  onSave: (form: MemberEditForm) => void;
}) {
  const [form, setForm] = useState(initial);
  const patch = (value: Partial<MemberEditForm>) => setForm((current) => ({ ...current, ...value }));

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 border-b border-slate-200 pb-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-950">Customer & Member Settings</h3>
          <p className="mt-1 text-sm text-slate-500">Update data customer, status member, dan tier manual.</p>
        </div>
        <button
          type="button"
          onClick={() => onSave(form)}
          disabled={saving || !form.name.trim()}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Save className="size-4" />
          {saving ? "Menyimpan..." : "Simpan"}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <TextInput label="Nama" value={form.name} onChange={(name) => patch({ name })} />
        <TextInput label="Phone" value={form.phone} onChange={(phone) => patch({ phone })} />
        <TextInput label="Email" value={form.email} onChange={(email) => patch({ email })} />
        <label className="block text-sm">
          <span className="text-xs font-medium text-slate-500">Tier Manual</span>
          <select
            value={form.tierId}
            onChange={(event) => patch({ tierId: event.target.value })}
            disabled={!crmProfileReady}
            className={fieldClass}
          >
            <option value="">Pilih tier</option>
            {activeTiers.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-xs font-medium text-slate-500">Status Member</span>
          <select
            value={form.status}
            onChange={(event) => patch({ status: event.target.value })}
            disabled={!crmProfileReady}
            className={fieldClass}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
            <option value="merged">Merged</option>
          </select>
        </label>
        <Checkbox
          label="Customer aktif"
          checked={form.customerActive}
          onChange={(customerActive) => patch({ customerActive })}
        />
        <Checkbox label="KOL (komplimen gratis)" checked={form.isKol} onChange={(isKol) => patch({ isKol })} />
        {form.isKol && (
          <label className="text-sm text-slate-700">
            Kuota komplimen / bulan (Rp)
            <input
              type="text"
              inputMode="numeric"
              value={form.kolLimit}
              onChange={(event) => patch({ kolLimit: event.target.value.replace(/\D/g, "") })}
              placeholder="Kosong = tanpa batas"
              className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3"
            />
          </label>
        )}
      </div>

      <FeedbackNote feedback={feedback} className="mt-3" />
    </section>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className={fieldClass} />
    </label>
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex h-10 items-center gap-3 self-end rounded-md border border-slate-300 px-3 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 rounded border-slate-300"
      />
      {label}
    </label>
  );
}
