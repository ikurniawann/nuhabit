"use client";

// Bagian form campaign: batasi kode ke produk/kategori tertentu dan atur
// siapa yang boleh memakai (semua, member, member baru).

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePromoCatalog } from "../catalog";
import { PROMO_ELIGIBILITY_LABELS, type PromoEligibility } from "../types";
import { TargetPicker } from "./target-picker";

export interface CampaignTargetValue {
  target_product_ids: string[];
  target_category_ids: string[];
  eligibility: PromoEligibility;
  new_member_days: string;
}

/** Kosong = tanpa batas hari; selain itu bilangan bulat 1–3650. */
export function isValidNewMemberDays(value: CampaignTargetValue): boolean {
  if (value.eligibility !== "member_baru" || value.new_member_days.trim() === "") return true;
  const days = Number(value.new_member_days);
  return Number.isInteger(days) && days >= 1 && days <= 3650;
}

export function CampaignTargetFields({
  value,
  onChange,
  disabled,
}: {
  value: CampaignTargetValue;
  onChange: (patch: Partial<CampaignTargetValue>) => void;
  disabled?: boolean;
}) {
  const catalog = usePromoCatalog();
  const productOptions = useMemo(
    () => (catalog.data?.products ?? []).map((p) => ({ id: p.id, label: p.name })),
    [catalog.data]
  );
  const categoryOptions = useMemo(
    () => (catalog.data?.categories ?? []).map((c) => ({ id: c.id, label: c.name })),
    [catalog.data]
  );

  return (
    <div className="space-y-3 rounded-xl bg-surface-2 p-3">
      <div>
        <p className="text-sm font-semibold text-foreground">Batas produk &amp; pembeli</p>
        <p className="text-xs text-muted-foreground">
          Kosongkan produk dan kategori agar diskon berlaku untuk seluruh belanja. Bila diisi,
          diskon hanya dihitung dari item yang cocok (khusus kasir POS).
        </p>
      </div>
      <TargetPicker
        label="Produk"
        options={productOptions}
        value={value.target_product_ids}
        onChange={(next) => onChange({ target_product_ids: next })}
        placeholder={catalog.isLoading ? "Memuat produk…" : "Cari produk…"}
        disabled={disabled}
      />
      <TargetPicker
        label="Kategori"
        options={categoryOptions}
        value={value.target_category_ids}
        onChange={(next) => onChange({ target_category_ids: next })}
        placeholder={catalog.isLoading ? "Memuat kategori…" : "Cari kategori…"}
        disabled={disabled}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Siapa yang boleh pakai</Label>
          <Select
            value={value.eligibility}
            onValueChange={(v) => onChange({ eligibility: v as PromoEligibility })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(PROMO_ELIGIBILITY_LABELS) as [PromoEligibility, string][]).map(
                ([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
        {value.eligibility === "member_baru" ? (
          <div className="space-y-1.5">
            <Label htmlFor="promo_new_member_days">Terdaftar maks. (hari, opsional)</Label>
            <Input
              id="promo_new_member_days"
              inputMode="numeric"
              placeholder="tanpa batas hari"
              value={value.new_member_days}
              disabled={disabled}
              onChange={(e) => onChange({ new_member_days: e.target.value.replace(/\D/g, "") })}
            />
          </div>
        ) : null}
      </div>
      {value.eligibility === "member_baru" ? (
        <p className="text-xs text-muted-foreground">
          Member baru = belum pernah punya transaksi lunas. Isi jumlah hari untuk sekaligus
          membatasi umur keanggotaan.
        </p>
      ) : null}
    </div>
  );
}
