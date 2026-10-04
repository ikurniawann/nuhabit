"use client";

import { Combobox } from "@/components/ui/combobox";
import { Switch } from "@/components/ui/switch";
import { FormFieldLabel, formComboboxClassName } from "@/components/layout/form-field";

export type StallOption = {
  id: string;
  name: string;
  code: string;
};

interface StallAssignmentPickerProps {
  stalls: StallOption[];
  defaultWarehouseId: string;
  canSwitchStall: boolean;
  canCentralCheckout?: boolean;
  showCentralCheckout?: boolean;
  required?: boolean;
  onChange: (patch: {
    default_warehouse_id?: string;
    warehouse_ids?: string[];
    can_switch_stall?: boolean;
    can_central_checkout?: boolean;
  }) => void;
}

export function StallAssignmentPicker({
  stalls,
  defaultWarehouseId,
  canSwitchStall,
  canCentralCheckout = false,
  showCentralCheckout = false,
  required = false,
  onChange,
}: StallAssignmentPickerProps) {
  const stallOptions = stalls.map((stall) => ({
    value: stall.id,
    label: stall.name,
    description: stall.code,
  }));

  function setDefaultStall(warehouseId: string) {
    onChange({
      default_warehouse_id: warehouseId,
      warehouse_ids: warehouseId ? [warehouseId] : [],
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <FormFieldLabel required={required}>Stall default</FormFieldLabel>
        <p className="mt-1 text-xs text-muted-foreground">
          Stall ini dipakai otomatis saat login. Transaksi kasir mengikuti stall aktif.
        </p>
        <div className="mt-2">
          <Combobox
            options={stallOptions}
            value={defaultWarehouseId}
            onChange={setDefaultStall}
            placeholder="Pilih stall default"
            searchPlaceholder="Cari stall..."
            emptyMessage="Tidak ada stall di branch ini"
            className={formComboboxClassName}
          />
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-200/70 bg-card px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Boleh pindah stall</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Jika aktif, karyawan bisa ganti stall di sidebar dan jualan di stall lain dalam
            branch yang sama.
          </p>
        </div>
        <Switch
          checked={canSwitchStall}
          onCheckedChange={(checked) => onChange({ can_switch_stall: checked })}
          className="mt-0.5 border-transparent focus-visible:ring-primary/30"
        />
      </div>

      {showCentralCheckout ? (
        <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-200/70 bg-card px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Kasir pusat</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Boleh transaksi Semua Stall (katalog semua menu). Tetap butuh permission
              POS Kasir Pusat di role.
            </p>
          </div>
          <Switch
            checked={canCentralCheckout}
            onCheckedChange={(checked) =>
              onChange({
                can_central_checkout: checked,
                can_switch_stall: checked ? true : canSwitchStall,
              })
            }
            className="mt-0.5 border-transparent focus-visible:ring-primary/30"
          />
        </div>
      ) : null}
    </div>
  );
}
