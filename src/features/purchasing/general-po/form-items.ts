/** Logika murni form PO barang operasional: baris item dari PR/master barang dan payload. */
import type {
  ApprovedGeneralPRForPO,
  GeneralPOFormInput,
  GeneralPOFormSupply,
} from "./types";

export type GeneralPOItemRow = GeneralPOFormInput["items"][number] & {
  supply_name?: string;
  unit_name?: string;
  stockable?: boolean;
};

type UnitRef = { id: string; nama: string };

export const emptyGeneralItem = (): GeneralPOItemRow => ({
  supply_item_id: "",
  qty_ordered: 1,
  harga_satuan: 0,
  notes: "",
});

const unitNameOf = (units: UnitRef[], unitId?: string | null) => units.find((u) => u.id === unitId)?.nama;

/** Baris item dari PR disetujui; harga estimasi PR, fallback harga beli master. */
export function generalItemsFromPR(
  pr: ApprovedGeneralPRForPO,
  supplies: GeneralPOFormSupply[],
  units: UnitRef[]
): GeneralPOItemRow[] {
  return (pr.items ?? []).map((item) => {
    const supply = supplies.find((s) => s.id === item.supply_item_id);
    const satuanId = item.satuan_id || supply?.satuan_id || undefined;
    return {
      supply_item_id: item.supply_item_id || "",
      pr_item_id: item.id,
      satuan_id: satuanId,
      qty_ordered: Number(item.qty || 1),
      harga_satuan: Number(item.estimated_price || supply?.harga_beli || 0),
      notes: item.description || supply?.nama || "",
      supply_name: supply?.nama || item.description,
      unit_name: unitNameOf(units, satuanId) || item.unit,
      stockable: supply?.stockable,
    };
  });
}

/** Ganti barang pada baris: harga default langsung dari master (tanpa price list vendor). */
export function withSupply(row: GeneralPOItemRow, supply: GeneralPOFormSupply, units: UnitRef[]): GeneralPOItemRow {
  return {
    ...row,
    supply_item_id: supply.id,
    satuan_id: supply.satuan_id || undefined,
    supply_name: supply.nama,
    unit_name: unitNameOf(units, supply.satuan_id),
    stockable: supply.stockable,
    harga_satuan: Math.round(Number(supply.harga_beli || 0)),
    notes: supply.nama,
  };
}

export function validateGeneralPO(vendorId: string, items: GeneralPOItemRow[]): string | null {
  if (!vendorId) return "Vendor wajib dipilih.";
  if (items.some((item) => !item.supply_item_id)) return "Semua item harus memilih barang.";
  return null;
}

export function toGeneralPayloadItems(items: GeneralPOItemRow[]): GeneralPOFormInput["items"] {
  return items.map((item) => ({
    supply_item_id: item.supply_item_id,
    pr_item_id: item.pr_item_id,
    satuan_id: item.satuan_id,
    qty_ordered: Number(item.qty_ordered),
    harga_satuan: Number(item.harga_satuan),
    notes: item.notes,
  }));
}
