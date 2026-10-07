"use client";

import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { useCoaList } from "@/features/accounting/chart-of-accounts/queries";
import { resolveDefaultCoaForCategory } from "@/lib/purchasing/raw-material-coa";

export type RawMaterialCoaFormValue = {
  coa_production: string;
  coa_rnd: string;
  coa_asset: string;
};

type Props = {
  value: RawMaterialCoaFormValue;
  onChange: (next: RawMaterialCoaFormValue) => void;
  kategori?: string | null;
  disabled?: boolean;
};

function formatCoaOption(code: string, name: string, codeDisplay?: string | null) {
  return `${codeDisplay || code} — ${name}`;
}

export function RawMaterialCoaFields({
  value,
  onChange,
  kategori,
  disabled,
}: Props) {
  const { data: coaData, isLoading } = useCoaList({
    is_postable: "true",
    is_active: "true",
  });

  const options = useMemo(() => {
    return (coaData ?? []).map((a) => ({
      value: a.code,
      label: formatCoaOption(a.code, a.name, a.code_display),
      description: a.account_type_name || undefined,
    }));
  }, [coaData]);

  const defaults = useMemo(
    () => resolveDefaultCoaForCategory(kategori),
    [kategori]
  );

  const hintAsset = defaults.coa_asset
    ? `Default kategori: ${defaults.coa_asset}${
        defaults.coa_asset_label ? ` (${defaults.coa_asset_label})` : ""
      }`
    : "Pilih akun inventori sesuai kategori bahan baku";

  const hintProduction = defaults.coa_production
    ? `Saran: ${defaults.coa_production}${
        defaults.coa_production_label
          ? ` (${defaults.coa_production_label})`
          : ""
      }`
    : "Kode akun untuk pemakaian produksi";

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Produksi</Label>
        <Combobox
          options={options}
          value={value.coa_production}
          onChange={(v) => onChange({ ...value, coa_production: v })}
          placeholder={isLoading ? "Memuat COA..." : "Pilih akun produksi..."}
          searchPlaceholder="Cari kode atau nama akun..."
          disabled={disabled || isLoading}
          className="h-9 text-sm"
          contentClassName="min-w-80"
          allowClear
        />
        <p className="text-xs text-muted-foreground">{hintProduction}</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Riset &amp; Pengembangan</Label>
        <Combobox
          options={options}
          value={value.coa_rnd}
          onChange={(v) => onChange({ ...value, coa_rnd: v })}
          placeholder={isLoading ? "Memuat COA..." : "Pilih akun R&D..."}
          searchPlaceholder="Cari kode atau nama akun..."
          disabled={disabled || isLoading}
          className="h-9 text-sm"
          contentClassName="min-w-80"
          allowClear
        />
        <p className="text-xs text-muted-foreground">
          Opsional — pemakaian riset &amp; pengembangan
        </p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Aset</Label>
        <Combobox
          options={options}
          value={value.coa_asset}
          onChange={(v) => onChange({ ...value, coa_asset: v })}
          placeholder={isLoading ? "Memuat COA..." : "Pilih akun aset..."}
          searchPlaceholder="Cari kode atau nama akun..."
          disabled={disabled || isLoading}
          className="h-9 text-sm"
          contentClassName="min-w-80"
          allowClear
        />
        <p className="text-xs text-muted-foreground">{hintAsset}</p>
      </div>
    </div>
  );
}

/**
 * Saat kategori berubah: isi Aset (dan Produksi jika masih kosong) dari mapping.
 * Tidak menimpa nilai yang sudah diubah manual kecuali masih kosong / masih default lama.
 */
export function applyCategoryCoaDefaults(
  kategori: string,
  current: RawMaterialCoaFormValue,
  previousKategori?: string | null
): RawMaterialCoaFormValue {
  const next = resolveDefaultCoaForCategory(kategori);
  const prev = resolveDefaultCoaForCategory(previousKategori);

  const keepOrFill = (
    currentCode: string,
    previousDefault: string | null,
    nextDefault: string | null
  ) => {
    if (!nextDefault) return currentCode;
    if (!currentCode) return nextDefault;
    if (previousDefault && currentCode === previousDefault) return nextDefault;
    return currentCode;
  };

  return {
    coa_asset: keepOrFill(
      current.coa_asset,
      prev.coa_asset,
      next.coa_asset
    ),
    coa_production: keepOrFill(
      current.coa_production,
      prev.coa_production,
      next.coa_production
    ),
    coa_rnd: current.coa_rnd,
  };
}
