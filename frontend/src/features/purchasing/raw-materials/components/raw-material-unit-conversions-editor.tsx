"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { RawMaterialUnitConversion, Unit } from "@/types/purchasing";
import { formatNumber } from "@/lib/format";

type ConversionDraft = RawMaterialUnitConversion & { key?: string };

interface RawMaterialUnitConversionsEditorProps {
  units: Unit[];
  baseUnitId?: string | null;
  bigUnitId?: string | null;
  bigUnitFactor?: number;
  conversions: ConversionDraft[];
  onChange: (conversions: ConversionDraft[]) => void;
}

function getUnitLabel(unit?: Unit) {
  if (!unit) return "-";
  return unit.simbol || unit.kode || unit.nama;
}

export function RawMaterialUnitConversionsEditor({
  units,
  baseUnitId,
  bigUnitId,
  bigUnitFactor = 1,
  conversions,
  onChange,
}: RawMaterialUnitConversionsEditorProps) {
  const baseUnit = units.find((unit) => unit.id === baseUnitId);
  const bigUnit = units.find((unit) => unit.id === bigUnitId);
  const selectableUnits = units.filter((unit) => unit.tipe === "BESAR" || unit.tipe === "KECIL" || unit.tipe === "KONVERSI");
  const lockedUnitIds = [baseUnitId, bigUnitId].filter(Boolean);
  const baseLabel = getUnitLabel(baseUnit);
  const bigLabel = getUnitLabel(bigUnit);

  const updateConversion = (index: number, patch: Partial<ConversionDraft>) => {
    onChange(conversions.map((conversion, currentIndex) => (
      currentIndex === index ? { ...conversion, ...patch } : conversion
    )));
  };

  return (
    <div className="space-y-3 rounded-xl border border-gray-200/70 bg-gray-50/50 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Konversi Satuan Lain</h3>
          <p className="mt-1 text-xs text-gray-500">
            Tambahkan satuan beli alternatif, misalnya sak, dus, pak, atau botol.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="purchasing-secondary-button h-9"
          onClick={() => onChange([...conversions, { key: crypto.randomUUID(), satuan_id: "", qty_in_base_unit: 1 }])}
        >
          <Plus className="mr-2 h-4 w-4" />
          Tambah
        </Button>
      </div>

      <div className="space-y-2 rounded-lg border border-gray-200/70 bg-white p-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <p className="text-xs font-medium text-gray-600">Satuan dasar stok</p>
            <p className="mt-1 text-sm font-semibold text-gray-900">{baseUnit?.nama || "Belum dipilih"}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-600">Konversi utama</p>
            <p className="mt-1 text-sm font-semibold text-gray-900">
              {bigUnit ? `1 ${bigLabel} = ${formatNumber(bigUnitFactor || 1, 4)} ${baseLabel}` : "Belum dipilih"}
            </p>
          </div>
        </div>
      </div>

      {conversions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-white px-4 py-5 text-center text-sm text-gray-500">
          Belum ada satuan alternatif. Tambahkan jika supplier menjual bahan ini dalam satuan berbeda.
        </div>
      ) : (
        <div className="space-y-3">
          {conversions.map((conversion, index) => {
            const selectedUnit = units.find((unit) => unit.id === conversion.satuan_id);
            const disabledUnits = new Set([
              ...lockedUnitIds,
              ...conversions
                .filter((_, currentIndex) => currentIndex !== index)
                .map((item) => item.satuan_id)
                .filter(Boolean),
            ]);
            const options = selectableUnits
              .filter((unit) => unit.id === conversion.satuan_id || !disabledUnits.has(unit.id))
              .map((unit) => ({ value: unit.id, label: unit.nama, description: unit.simbol || unit.kode }));

            return (
              <div key={conversion.id || conversion.key || index} className="rounded-lg border border-gray-200/70 bg-white p-3">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Satuan Alternatif</Label>
                    <Combobox
                      options={options}
                      value={conversion.satuan_id}
                      onChange={(value) => updateConversion(index, { satuan_id: value })}
                      placeholder="Pilih satuan..."
                      searchPlaceholder="Cari satuan..."
                      emptyMessage="Satuan tidak ditemukan"
                      allowClear
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Jumlah dalam Satuan Dasar</Label>
                    <div className="flex rounded-lg border border-gray-300 bg-white focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-100">
                      <NumericInput
                        value={conversion.qty_in_base_unit}
                        onValueChange={(value) => updateConversion(index, { qty_in_base_unit: value || 1 })}
                        decimalScale={4}
                        className="h-9 rounded-r-none border-0 text-sm shadow-none focus-visible:ring-0"
                      />
                      <div className="flex min-w-14 items-center justify-center rounded-r-lg border-l border-gray-200 bg-gray-50 px-3 text-xs font-semibold uppercase text-gray-500">
                        {baseLabel}
                      </div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 w-full border-red-200 px-3 text-red-600 hover:bg-red-50 md:w-9"
                    onClick={() => onChange(conversions.filter((_, currentIndex) => currentIndex !== index))}
                    aria-label="Hapus konversi"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {selectedUnit && (
                  <p className="mt-2 text-xs text-gray-500">
                    1 {getUnitLabel(selectedUnit)} = {formatNumber(conversion.qty_in_base_unit || 1, 4)} {baseLabel}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
