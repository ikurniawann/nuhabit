"use client";

import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BillingCharge } from "@/lib/pos/billing-settings";

const fieldLabel = "text-xs font-medium text-muted-foreground";

/** Satu baris fee/rounding di "Pengaturan lanjutan". */
export function AdvancedChargeRow({
  charge,
  onChange,
  onRemove,
}: {
  charge: BillingCharge;
  onChange: (patch: Partial<BillingCharge>) => void;
  onRemove: () => void;
}) {
  const fixed = charge.calc_method === "fixed";
  return (
    <div className="grid grid-cols-12 gap-3 p-4">
      <label className="col-span-12 space-y-1 sm:col-span-6 lg:col-span-2">
        <span className={fieldLabel}>Kode</span>
        <Input
          value={charge.code}
          onChange={(e) => onChange({ code: e.target.value.toUpperCase() })}
          className="h-9 border-gray-200/80 font-mono"
        />
      </label>
      <label className="col-span-12 space-y-1 sm:col-span-6 lg:col-span-2">
        <span className={fieldLabel}>Nama</span>
        <Input value={charge.name} onChange={(e) => onChange({ name: e.target.value })} className="h-9 border-gray-200/80" />
      </label>
      <label className="col-span-12 space-y-1 sm:col-span-6 lg:col-span-2">
        <span className={fieldLabel}>Jenis</span>
        <Select
          value={charge.charge_kind}
          onValueChange={(value) => onChange({ charge_kind: value as BillingCharge["charge_kind"] })}
        >
          <SelectTrigger className="h-9 border-gray-200/80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fee">Biaya (uniqcode)</SelectItem>
            <SelectItem value="rounding">Pembulatan</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className="col-span-12 space-y-1 sm:col-span-6 lg:col-span-2">
        <span className={fieldLabel}>Metode</span>
        <Select
          value={charge.calc_method}
          onValueChange={(value) => onChange({ calc_method: value as BillingCharge["calc_method"] })}
        >
          <SelectTrigger className="h-9 border-gray-200/80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="percent">Persen</SelectItem>
            <SelectItem value="fixed">Nominal tetap</SelectItem>
            <SelectItem value="round_nearest">Bulatkan terdekat</SelectItem>
            <SelectItem value="round_up">Bulatkan ke atas</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className="col-span-6 space-y-1 lg:col-span-1">
        <span className={fieldLabel}>
          {charge.calc_method === "percent" ? "Tarif %" : charge.charge_kind === "rounding" ? "Kelipatan" : "Nominal"}
        </span>
        <Input
          type="number"
          min={0}
          value={fixed ? charge.amount : charge.rate}
          onChange={(e) => {
            const value = Number(e.target.value) || 0;
            onChange(fixed ? { amount: value } : { rate: value });
          }}
          className="h-9 border-gray-200/80"
        />
      </label>
      <label className="col-span-6 space-y-1 lg:col-span-1">
        <span className={fieldLabel}>Urutan</span>
        <Input
          type="number"
          value={charge.apply_order}
          onChange={(e) => onChange({ apply_order: Number.parseInt(e.target.value, 10) || 0 })}
          className="h-9 border-gray-200/80"
        />
      </label>
      <div className="col-span-12 flex flex-wrap items-end gap-3 lg:col-span-2">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={charge.is_enabled}
            onChange={(e) => onChange({ is_enabled: e.target.checked })}
            className="accent-[hsl(var(--primary))]"
          />
          Aktif
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={charge.is_optional}
            onChange={(e) => onChange({ is_optional: e.target.checked })}
            className="accent-[hsl(var(--primary))]"
          />
          Opsional
        </label>
        {charge.charge_kind === "fee" ? (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"
            aria-label={`Hapus ${charge.code}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
