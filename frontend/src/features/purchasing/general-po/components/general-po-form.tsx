"use client";

import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { VendorPOForm, type VendorPOHeaderInput } from "@/features/purchasing/po/components/vendor-po/vendor-po-form";
import {
  emptyGeneralItem,
  generalItemsFromPR,
  toGeneralPayloadItems,
  validateGeneralPO,
  withSupply,
  type GeneralPOItemRow,
} from "../form-items";
import type { ApprovedGeneralPRForPO, GeneralPOFormData, GeneralPOFormInput } from "../types";

interface GeneralPOFormProps {
  lookups: GeneralPOFormData;
  approvedPRs: ApprovedGeneralPRForPO[];
  initialPRId?: string;
  onSubmit: (data: GeneralPOFormInput) => Promise<void>;
  isLoading: boolean;
  cancelHref: string;
}

/** Form PO barang operasional; harga default dari master barang (tanpa price list vendor). */
export function GeneralPOForm({ lookups, approvedPRs, initialPRId, onSubmit, isLoading, cancelHref }: GeneralPOFormProps) {
  const { vendors, supplies, units } = lookups;
  const itemsFromPR = (prId: string) => {
    const pr = approvedPRs.find((entry) => entry.id === prId);
    const rows = pr ? generalItemsFromPR(pr, supplies, units) : [];
    return rows.length ? rows : null;
  };

  return (
    <VendorPOForm<GeneralPOItemRow>
      vendors={vendors}
      approvedPRs={approvedPRs}
      initialPRId={initialPRId}
      initialItems={(initialPRId && itemsFromPR(initialPRId)) || [emptyGeneralItem()]}
      emptyItem={emptyGeneralItem}
      itemsFromPR={itemsFromPR}
      validate={validateGeneralPO}
      isLoading={isLoading}
      cancelHref={cancelHref}
      onSubmit={(header: VendorPOHeaderInput, items) => onSubmit({ ...header, items: toGeneralPayloadItems(items) })}
      renderPicker={(row, setRow) => (
        <>
          <Label className="text-xs">Barang</Label>
          <Combobox
            options={supplies.map((s) => ({ value: s.id, label: s.nama, description: s.kode }))}
            value={row.supply_item_id}
            onChange={(value) => {
              const supply = supplies.find((s) => s.id === value);
              if (supply) setRow(withSupply(row, supply, units));
            }}
            placeholder="Pilih barang..."
            searchPlaceholder="Cari..."
            emptyMessage="Barang tidak ditemukan"
            className="h-9 text-sm"
          />
          {row.stockable !== undefined && (
            <Badge
              className={row.stockable ? "border-0 bg-blue-100 text-blue-700" : "border-0 bg-gray-100 text-gray-600"}
            >
              {row.stockable ? "Stok" : "Expense"}
            </Badge>
          )}
        </>
      )}
    />
  );
}
