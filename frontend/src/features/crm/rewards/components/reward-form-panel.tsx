"use client";

import { Plus, Save, X } from "lucide-react";
import { QUOTA_PERIOD_LABELS, QUOTA_PERIODS } from "@/lib/crm/rewards";
import type { QuotaPeriod, Reward, RewardForm, Tier } from "../types";
import { REWARD_TYPE_LABELS, SELECTABLE_REWARD_TYPES } from "../reward-form";
import { SelectField, TextField } from "./rewards-ui";

/** Form reward baru / edit. State form dipegang halaman (dipakai juga oleh Edit & Salin). */
export function RewardFormPanel({
  form,
  tiers,
  saving,
  onChange,
  onReset,
  onSave,
}: {
  form: RewardForm;
  tiers: Tier[];
  saving: boolean;
  onChange: (patch: Partial<RewardForm>) => void;
  onReset: () => void;
  onSave: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
          <Plus className="size-4" />
          {form.id ? "Edit Reward" : "Reward Baru"}
        </h2>
        {form.id && <div className="mt-1 text-xs text-slate-500">Sedang mengubah {form.code}</div>}
      </div>
      <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <TextField label="Kode" value={form.code} onChange={(code) => onChange({ code })} placeholder="voucher-kopi" />
          <TextField label="Nama" value={form.name} onChange={(name) => onChange({ name })} placeholder="Voucher Kopi Gratis" />
        </div>

        <SelectField
          label="Jenis"
          value={form.reward_type}
          onChange={(value) => onChange({ reward_type: value as Reward["reward_type"] })}
        >
          {SELECTABLE_REWARD_TYPES.map((type) => (
            <option key={type} value={type}>
              {REWARD_TYPE_LABELS[type]}
            </option>
          ))}
        </SelectField>

        <fieldset className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Syarat kelayakan</legend>
          <TextField
            label="Min XP (tidak dipotong)"
            type="number"
            value={String(form.min_xp)}
            onChange={(value) => onChange({ min_xp: Number(value) || 0 })}
            hint="Member harus punya XP seumur hidup minimal segini."
          />
          <SelectField
            label="Tier minimum"
            value={form.required_tier_id}
            onChange={(required_tier_id) => onChange({ required_tier_id })}
          >
            <option value="">Semua tier</option>
            {tiers.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.name}
              </option>
            ))}
          </SelectField>
        </fieldset>

        <fieldset className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Batas pengambilan</legend>
          <TextField
            label="Stok total"
            type="number"
            value={form.stock_total}
            onChange={(stock_total) => onChange({ stock_total })}
            placeholder="Kosongkan = tanpa batas"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Maks. per member"
              type="number"
              value={form.max_redemptions_per_member}
              onChange={(max_redemptions_per_member) => onChange({ max_redemptions_per_member })}
              placeholder="Kosong = bebas"
            />
            <SelectField
              label="Periode kuota"
              value={form.quota_period}
              onChange={(value) => onChange({ quota_period: value as QuotaPeriod })}
            >
              {QUOTA_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {QUOTA_PERIOD_LABELS[period]}
                </option>
              ))}
            </SelectField>
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(event) => onChange({ is_active: event.target.checked })}
            className="size-4 rounded border-slate-300"
          />
          Tampilkan &amp; bisa di-redeem member
        </label>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onReset}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            {form.id ? (
              <>
                <X className="size-4" />
                Batal
              </>
            ) : (
              "Reset"
            )}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !form.code || !form.name}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            <Save className="size-4" />
            {form.id ? "Update" : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}
