/** Logika murni form PO bahan baku: baris item, satuan, total, validasi, dan payload API. */
import { computePoTotals, type PoTotals } from "@/lib/purchasing/po-totals";
import type {
  PurchaseOrderFormData,
  PurchaseOrderItem,
  PurchaseOrderWithStats,
  RawMaterialWithStock,
  Unit,
} from "@/types/purchasing";

export interface POItemForm {
  id: string;
  raw_material_id: string;
  pr_item_id?: string;
  satuan_id?: string;
  qty_ordered: number;
  harga_satuan: number;
  notes: string;
  subtotal: number;
  raw_material_name?: string;
  raw_material_unit?: string;
  requested_qty?: number;
  requested_satuan_id?: string;
}

/** Baris item PR yang dibutuhkan form PO (bentuk dari GET /api/purchasing/pr/[id]). */
export interface POFormPRItem {
  id: string;
  raw_material_id?: string | null;
  satuan_id?: string | null;
  satuan?: { id?: string; nama?: string } | null;
  unit?: string | null;
  qty?: number | null;
  estimated_price?: number | null;
  description?: string | null;
  raw_material?: { nama?: string } | null;
}

type POItemRow = PurchaseOrderItem & {
  pr_item_id?: string | null;
  satuan_id?: string | null;
  catatan?: string | null;
};

export function mapPOItemToForm(item: PurchaseOrderItem): POItemForm {
  const row = item as POItemRow;
  const qty = Number(item.qty_ordered || 0);
  const price = Number(item.harga_satuan || 0);
  const note = row.catatan ?? item.notes ?? "";
  return {
    id: item.id,
    pr_item_id: row.pr_item_id || undefined,
    raw_material_id: item.raw_material_id || "",
    satuan_id: row.satuan_id || undefined,
    qty_ordered: qty,
    harga_satuan: price,
    notes: note,
    subtotal: qty * price,
    raw_material_name: item.raw_material?.nama || note,
    raw_material_unit: item.satuan?.nama || item.raw_material?.satuan || "",
    requested_qty: qty,
    requested_satuan_id: row.satuan_id || undefined,
  };
}

/** Satuan item PR: id eksplisit, lalu cocokkan nama/kode satuan, lalu satuan besar bahan baku. */
export function resolveSatuanIdFromPrItem(
  item: Pick<POFormPRItem, "satuan_id" | "satuan" | "unit" | "raw_material_id">,
  materials: RawMaterialWithStock[],
  units: Unit[]
): string | undefined {
  if (item.satuan_id) return item.satuan_id;
  if (item.satuan?.id) return item.satuan.id;

  const label = (item.satuan?.nama || item.unit || "").trim().toLowerCase();
  if (label) {
    const match = units.find((unit) => unit.nama.toLowerCase() === label || unit.kode?.toLowerCase() === label);
    if (match) return match.id;
  }

  if (item.raw_material_id) {
    return materials.find((entry) => entry.id === item.raw_material_id)?.satuan_besar_id || undefined;
  }
  return undefined;
}

export function mapPRItemToForm(item: POFormPRItem, materials: RawMaterialWithStock[], units: Unit[]): POItemForm {
  const qty = Number(item.qty || 0);
  const price = Number(item.estimated_price || 0);
  const satuanId = resolveSatuanIdFromPrItem(item, materials, units);
  const unitName = item.satuan?.nama || item.unit || units.find((unit) => unit.id === satuanId)?.nama || "";
  return {
    id: item.id,
    pr_item_id: item.id,
    raw_material_id: item.raw_material_id || "",
    satuan_id: satuanId,
    qty_ordered: qty,
    harga_satuan: price,
    notes: item.description || "",
    subtotal: qty * price,
    raw_material_name: item.raw_material?.nama || item.description || "",
    raw_material_unit: unitName,
    requested_qty: qty,
    requested_satuan_id: satuanId,
  };
}

/** Ubah qty atau harga satu baris dan hitung ulang subtotalnya. */
export function withQtyOrPrice(item: POItemForm, field: "qty_ordered" | "harga_satuan", value: number): POItemForm {
  const next = { ...item, [field]: value };
  next.subtotal = next.qty_ordered * next.harga_satuan;
  if (field === "qty_ordered") next.requested_qty = value;
  return next;
}

/** Isi harga beli saran (dibulatkan) dan satuannya; qty minimal 1. */
export function withPurchasePrice(item: POItemForm, unitPrice: number, unitId: string, unitLabel: string): POItemForm {
  const price = Math.round(unitPrice);
  const qty = Math.max(1, Number(item.qty_ordered || item.requested_qty || 1));
  return {
    ...item,
    satuan_id: unitId,
    raw_material_unit: unitLabel || item.raw_material_unit,
    qty_ordered: qty,
    harga_satuan: price,
    subtotal: qty * price,
  };
}

/** Satuan untuk mencari harga beli: satuan baris, satuan PR, lalu satuan besar bahan baku. */
export function priceLookupUnitId(item: POItemForm, materials: RawMaterialWithStock[]): string | undefined {
  const material = materials.find((entry) => entry.id === item.raw_material_id);
  return item.satuan_id || item.requested_satuan_id || material?.satuan_besar_id || undefined;
}

export function emptyPOForm(prId: string | undefined, today: string): PurchaseOrderFormData {
  return {
    supplier_id: "",
    pr_id: prId,
    tanggal_po: today,
    tanggal_kirim_estimasi: "",
    catatan: "",
    alamat_pengiriman: "",
    diskon_persen: 0,
    diskon_nominal: 0,
    ppn_persen: 11,
    source_type: "manual",
    production_order_id: null,
    source_reference: null,
    items: [],
  };
}

export function poFormFromExisting(po: PurchaseOrderWithStats, today: string): PurchaseOrderFormData {
  return {
    supplier_id: po.supplier_id || "",
    pr_id: po.pr_id || undefined,
    tanggal_po: po.tanggal_po?.split("T")[0] || today,
    tanggal_kirim_estimasi: po.tanggal_kirim_estimasi?.split("T")[0] || "",
    catatan: po.catatan || "",
    alamat_pengiriman: po.alamat_pengiriman || "",
    diskon_persen: Number(po.diskon_persen || 0),
    diskon_nominal: Number(po.diskon_nominal || 0),
    ppn_persen: Number(po.ppn_persen ?? 11),
    source_type: po.source_type || "manual",
    production_order_id: po.production_order_id || null,
    source_reference: po.source_reference || null,
    items: [],
  };
}

/** Total form memakai rumus server (computePoTotals) supaya angka di layar sama dengan yang tersimpan. */
export function poFormTotals(items: POItemForm[], form: Pick<PurchaseOrderFormData, "diskon_persen" | "diskon_nominal" | "ppn_persen">): PoTotals {
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  return computePoTotals(subtotal, form);
}

/** Pesan galat validasi sebelum simpan, atau null bila valid. */
export function validatePOForm(form: PurchaseOrderFormData, items: POItemForm[], isEditMode: boolean): string | null {
  if (!isEditMode && !form.pr_id) return "Purchase order harus dibuat dari purchase request yang disetujui";
  if (!form.supplier_id) return "Pilih supplier terlebih dahulu";
  if (items.length === 0) return "Tambahkan minimal 1 item";
  if (items.some((item) => !item.raw_material_id || item.qty_ordered <= 0 || item.harga_satuan < 0)) {
    return "Lengkapi bahan baku, jumlah, dan harga untuk semua item";
  }
  return null;
}

export function buildCreatePOPayload(form: PurchaseOrderFormData, items: POItemForm[]): PurchaseOrderFormData {
  return {
    ...form,
    pr_id: form.pr_id || undefined,
    tanggal_kirim_estimasi: form.tanggal_kirim_estimasi || "",
    items: items.map((item) => ({
      raw_material_id: item.raw_material_id,
      pr_item_id: item.pr_item_id,
      satuan_id: item.satuan_id,
      qty_ordered: Number(item.qty_ordered || 0),
      harga_satuan: Number(item.harga_satuan || 0),
      notes: item.notes || "",
    })),
  };
}

/** Ubah PO draf hanya mengirim header; item terkunci di mode ubah. */
export function buildUpdatePOPayload(form: PurchaseOrderFormData): Partial<PurchaseOrderFormData> {
  return {
    supplier_id: form.supplier_id,
    tanggal_po: form.tanggal_po,
    tanggal_kirim_estimasi: form.tanggal_kirim_estimasi || undefined,
    catatan: form.catatan || undefined,
    alamat_pengiriman: form.alamat_pengiriman || undefined,
    diskon_persen: form.diskon_persen,
    diskon_nominal: form.diskon_nominal,
    ppn_persen: form.ppn_persen,
  };
}
