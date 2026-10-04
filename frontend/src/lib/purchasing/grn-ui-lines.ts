/**
 * Logika baris GRN di sisi klien: halaman Buat GRN dan Lanjutkan GRN.
 * Murni (tanpa React/fetch) supaya aturan qty bisa diuji.
 */

export type ReceivingModuleType = "raw_material" | "product";

export type ApiUnit =
  | string
  | { nama?: string | null; nama_satuan?: string | null; kode?: string | null }
  | null
  | undefined;

/** EPIC-047 Fase 2: label read-only varian (SKU) untuk produk ber-varian. */
export type PosSkuRef = { id?: string; sku?: string | null; name?: string | null };

/** Baris item PO dari /api/purchasing/po/[id]/items atau embed GRN. */
export type PoLineApiRow = {
  id: string;
  raw_material_id?: string | null;
  product_id?: string | null;
  nama_bahan?: string | null;
  qty_ordered?: number | string | null;
  qty_received?: number | string | null;
  raw_material?: {
    nama?: string | null;
    nama_bahan?: string | null;
    kode?: string | null;
    satuan_besar?: ApiUnit;
  } | null;
  product?: { nama?: string | null } | null;
  satuan?: ApiUnit;
  unit?: ApiUnit;
  pos_sku_id?: string | null;
  pos_sku?: PosSkuRef | null;
};

export type PoLine = {
  id: string;
  raw_material_id: string;
  product_id?: string;
  nama_bahan: string;
  qty_ordered: number;
  qty_received: number;
  satuan: string;
  pos_sku_id: string | null;
  pos_sku: PosSkuRef | null;
};

const UNKNOWN_ITEM = "Tidak diketahui";

export function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function unitName(unit: ApiUnit, fallback = "pcs"): string {
  if (!unit) return fallback;
  if (typeof unit === "string") return unit || fallback;
  return unit.nama || unit.nama_satuan || unit.kode || fallback;
}

export function mapPoLine(row: PoLineApiRow, moduleType: ReceivingModuleType): PoLine {
  const isProduct = moduleType === "product";
  const itemName = isProduct
    ? row.product?.nama
    : row.raw_material?.nama || row.raw_material?.nama_bahan;
  return {
    id: row.id,
    raw_material_id: isProduct ? "" : row.raw_material_id || "",
    product_id: isProduct ? row.product_id || undefined : undefined,
    nama_bahan: row.nama_bahan || itemName || UNKNOWN_ITEM,
    qty_ordered: toNumber(row.qty_ordered),
    qty_received: toNumber(row.qty_received),
    satuan: unitName(row.satuan || row.unit || row.raw_material?.satuan_besar),
    pos_sku_id: row.pos_sku_id ?? null,
    pos_sku: row.pos_sku ?? null,
  };
}

export function poRemainingQty(line?: Pick<PoLine, "qty_ordered" | "qty_received">): number {
  if (!line) return 0;
  return Math.max(0, line.qty_ordered - line.qty_received);
}

// ---------------------------------------------------------------------------
// Buat GRN
// ---------------------------------------------------------------------------

export type GrnDeliveryApiRow = {
  id: string;
  no_resi?: string | null;
  nomor_resi?: string | null;
  delivery_number?: string | null;
  no_surat_jalan?: string | null;
  kurir?: string | null;
  ekspedisi?: string | null;
  vendor_name?: string | null;
  status?: string | null;
  purchase_order_id?: string | null;
  po_id?: string | null;
  branch_id?: string | null;
  supplier_name?: string | null;
  po_number?: string | null;
};

export type GrnDeliveryOption = {
  id: string;
  no_resi: string;
  no_surat_jalan: string;
  kurir: string;
  status: string;
  purchase_order_id: string;
  branch_id: string | null;
  supplier_name: string;
  po_number: string;
};

export function mapGrnDelivery(row: GrnDeliveryApiRow): GrnDeliveryOption {
  const resi = row.no_resi || row.nomor_resi || row.delivery_number || "";
  const kurir = row.kurir || row.ekspedisi || row.vendor_name || "";
  return {
    id: row.id,
    no_resi: resi,
    no_surat_jalan: row.no_surat_jalan || "",
    kurir,
    status: row.status || "pending",
    purchase_order_id: row.purchase_order_id || row.po_id || "",
    branch_id: row.branch_id || null,
    supplier_name: row.supplier_name || kurir || row.no_surat_jalan || resi || "Unknown",
    po_number: row.po_number || resi,
  };
}

export type ReceivingUserScope = {
  role: string | null;
  business_scope: "holding" | "company" | "branch" | null;
  branch_id: string | null;
  is_unscoped: boolean;
};

/**
 * Cabang untuk daftar gudang tujuan. Pengguna cabang selalu memakai cabangnya;
 * selain itu cabang pengiriman, lalu cabang PO (perlu dicari dulu).
 */
export type WarehouseBranchPlan =
  | { kind: "wait" }
  | { kind: "lookup-po"; poId: string }
  | { kind: "ready"; branchId: string | null };

export function planWarehouseBranch(
  scope: ReceivingUserScope | null | undefined,
  delivery: Pick<GrnDeliveryOption, "branch_id" | "purchase_order_id"> | null
): WarehouseBranchPlan {
  if (!scope || !delivery) return { kind: "wait" };
  if (!scope.is_unscoped && scope.business_scope === "branch" && scope.branch_id) {
    return { kind: "ready", branchId: scope.branch_id };
  }
  if (delivery.branch_id) return { kind: "ready", branchId: delivery.branch_id };
  if (!delivery.purchase_order_id) return { kind: "ready", branchId: null };
  return { kind: "lookup-po", poId: delivery.purchase_order_id };
}

export type CreateGrnLineEdit = {
  acceptQty?: number;
  batch_number?: string;
  expiry_date?: string;
};

export type CreateGrnLine = {
  purchase_order_item_id: string;
  raw_material_id: string;
  product_id?: string;
  nama_bahan: string;
  satuan: string;
  qty_ordered: number;
  qty_received: number;
  remaining: number;
  /** Diterima / QC (masuk stok). */
  qty_diterima: number;
  /** Kekurangan vs sisa PO (tolak / QC gagal). */
  qty_ditolak: number;
  batch_number: string;
  expiry_date: string;
};

/**
 * Baris GRN baru hanya untuk item PO yang masih punya sisa. Default diterima = sisa;
 * qty yang diisi pengguna dibatasi 0..sisa dan kekurangannya jadi tolak.
 */
export function buildCreateGrnLines(
  poLines: PoLine[],
  edits: Record<string, CreateGrnLineEdit> = {}
): CreateGrnLine[] {
  return poLines.flatMap((po) => {
    const remaining = poRemainingQty(po);
    if (remaining <= 0) return [];
    const edit = edits[po.id] ?? {};
    const accept = Math.max(0, Math.min(toNumber(edit.acceptQty ?? remaining), remaining));
    return [
      {
        purchase_order_item_id: po.id,
        raw_material_id: po.raw_material_id,
        product_id: po.product_id,
        nama_bahan: po.nama_bahan,
        satuan: po.satuan,
        qty_ordered: po.qty_ordered,
        qty_received: po.qty_received,
        remaining,
        qty_diterima: accept,
        qty_ditolak: remaining - accept,
        batch_number: edit.batch_number ?? "",
        expiry_date: edit.expiry_date ?? "",
      },
    ];
  });
}

export function createGrnTotals(lines: CreateGrnLine[]) {
  return lines.reduce(
    (acc, line) => ({
      accepted: acc.accepted + line.qty_diterima,
      rejected: acc.rejected + line.qty_ditolak,
    }),
    { accepted: 0, rejected: 0 }
  );
}

export type CreateGrnForm = {
  deliveryId: string;
  warehouseId: string;
  tanggal_penerimaan: string;
  catatan: string;
};

/** Pesan galat pertama, atau null bila form siap disimpan. */
export function validateCreateGrn(form: CreateGrnForm, lines: CreateGrnLine[]): string | null {
  if (!form.deliveryId) return "Pilih pengiriman terlebih dahulu.";
  if (!form.warehouseId) return "Pilih gudang tujuan.";
  if (!form.tanggal_penerimaan) return "Tanggal penerimaan wajib diisi.";
  if (lines.length === 0) return "Minimal satu item wajib diisi.";
  if (!lines.some((line) => line.qty_diterima > 0)) {
    return "Isi qty Diterima / QC untuk minimal satu item.";
  }
  return null;
}

export function buildCreateGrnPayload(
  form: CreateGrnForm,
  lines: CreateGrnLine[],
  moduleType: ReceivingModuleType
) {
  const isProduct = moduleType === "product";
  return {
    delivery_id: form.deliveryId,
    warehouse_id: form.warehouseId,
    tanggal_penerimaan: form.tanggal_penerimaan,
    catatan: form.catatan || undefined,
    ...(isProduct ? { module_type: "product" as const } : {}),
    items: lines.map((line) => ({
      purchase_order_item_id: line.purchase_order_item_id,
      ...(isProduct ? { product_id: line.product_id } : { raw_material_id: line.raw_material_id }),
      qty_diterima: line.qty_diterima,
      qty_ditolak: line.qty_ditolak,
      qty_accepted: line.qty_diterima,
      qty_rejected: 0,
      kondisi: "baik" as const,
      ...(isProduct
        ? {}
        : {
            batch_number: line.batch_number.trim() || undefined,
            expiry_date: line.expiry_date || undefined,
          }),
    })),
  };
}

// ---------------------------------------------------------------------------
// Lanjutkan GRN
// ---------------------------------------------------------------------------

/** Item GRN dari GET /api/purchasing/grn/[id]. */
export type ContinueGrnApiItem = {
  id: string;
  grn_id?: string;
  purchase_order_item_id?: string;
  raw_material_id?: string | null;
  nama_bahan?: string | null;
  qty_diterima?: number | string | null;
  qty_ditolak?: number | string | null;
  raw_material?: PoLineApiRow["raw_material"];
  satuan?: ApiUnit;
  purchase_order_item?: {
    id: string;
    raw_material_id?: string | null;
    qty_ordered?: number | string | null;
    qty_received?: number | string | null;
    raw_material?: PoLineApiRow["raw_material"];
    satuan?: ApiUnit;
    pos_sku_id?: string | null;
    pos_sku?: PosSkuRef | null;
  } | null;
  pos_sku_id?: string | null;
  pos_sku?: PosSkuRef | null;
};

export type ContinueGrnLine = {
  id: string;
  purchase_order_item_id?: string;
  raw_material_id: string;
  nama_bahan: string;
  satuan: string;
  pos_sku: PosSkuRef | null;
  previous_qty_diterima: number;
  previous_qty_ditolak: number;
  /** Total baik pada baris ini setelah disimpan (sebelumnya + tambahan). */
  qty_diterima: number;
  /** Total tolak pada baris ini setelah disimpan. */
  qty_ditolak: number;
};

/** Item PO dari embed purchase_order_item bila endpoint item PO kosong. */
export function poLinesFromGrnItems(items: ContinueGrnApiItem[]): PoLine[] {
  return items.flatMap((item) => {
    const po = item.purchase_order_item;
    if (!po) return [];
    const rawMaterial = item.raw_material || po.raw_material;
    return [
      {
        id: po.id,
        raw_material_id: po.raw_material_id || item.raw_material_id || "",
        nama_bahan: rawMaterial?.nama || rawMaterial?.nama_bahan || UNKNOWN_ITEM,
        qty_ordered: toNumber(po.qty_ordered),
        qty_received: toNumber(po.qty_received),
        satuan: unitName(po.satuan || item.satuan || item.raw_material?.satuan_besar),
        pos_sku_id: po.pos_sku_id ?? item.pos_sku_id ?? null,
        pos_sku: po.pos_sku ?? item.pos_sku ?? null,
      },
    ];
  });
}

export function findPoLine(
  line: Pick<ContinueGrnLine, "purchase_order_item_id" | "raw_material_id">,
  poLines: PoLine[]
): PoLine | undefined {
  return (
    poLines.find((po) => po.id === line.purchase_order_item_id) ||
    (line.raw_material_id
      ? poLines.find((po) => po.raw_material_id === line.raw_material_id)
      : undefined)
  );
}

/** Batas total baik pada baris ini: sebelumnya + sisa PO, tidak melebihi qty pesan. */
export function maxTotalGoodQty(line: ContinueGrnLine, po?: PoLine): number {
  const ceiling = line.previous_qty_diterima + poRemainingQty(po);
  const ordered = po?.qty_ordered ?? 0;
  return ordered > 0 ? Math.min(ordered, ceiling) : ceiling;
}

/** Set total baik; kekurangan terhadap sisa PO pindah ke kolom tolak. */
export function applyContinueGoodQty(
  line: ContinueGrnLine,
  po: PoLine | undefined,
  goodQty: number
): ContinueGrnLine {
  const totalGood = Math.max(
    line.previous_qty_diterima,
    Math.min(toNumber(goodQty), maxTotalGoodQty(line, po))
  );
  const incrementalGood = Math.max(0, totalGood - line.previous_qty_diterima);
  const incrementalReject = Math.max(0, poRemainingQty(po) - incrementalGood);
  return {
    ...line,
    qty_diterima: totalGood,
    qty_ditolak: line.previous_qty_ditolak + incrementalReject,
  };
}

/** Baris form Lanjutkan GRN, default menerima seluruh sisa PO. */
export function buildContinueGrnLines(
  items: ContinueGrnApiItem[],
  poLines: PoLine[]
): ContinueGrnLine[] {
  return items.map((item) => {
    const embeddedPo = item.purchase_order_item;
    const rawMaterial = item.raw_material || embeddedPo?.raw_material;
    const line: ContinueGrnLine = {
      id: item.id,
      purchase_order_item_id: item.purchase_order_item_id,
      raw_material_id: item.raw_material_id || embeddedPo?.raw_material_id || "",
      nama_bahan: item.nama_bahan || rawMaterial?.nama || rawMaterial?.nama_bahan || UNKNOWN_ITEM,
      satuan: unitName(item.satuan || embeddedPo?.satuan || rawMaterial?.satuan_besar),
      pos_sku: item.pos_sku ?? embeddedPo?.pos_sku ?? null,
      previous_qty_diterima: toNumber(item.qty_diterima),
      previous_qty_ditolak: toNumber(item.qty_ditolak),
      qty_diterima: 0,
      qty_ditolak: 0,
    };
    const po = findPoLine(line, poLines);
    return applyContinueGoodQty(line, po, maxTotalGoodQty(line, po));
  });
}

export type ContinueGrnStatus = "pending" | "received" | "rejected";

/** Status GRN setelah disimpan, dari baris yang berisi qty. */
export function continueGrnStatus(lines: ContinueGrnLine[], poLines: PoLine[]): ContinueGrnStatus {
  const totalGood = lines.reduce((sum, line) => sum + line.qty_diterima, 0);
  const totalReject = lines.reduce((sum, line) => sum + line.qty_ditolak, 0);
  if (totalGood === 0 && totalReject > 0) return "rejected";

  const totalOrdered = poLines.reduce((sum, po) => sum + po.qty_ordered, 0);
  const projectedReceived = poLines.reduce((sum, po) => {
    const line = lines.find(
      (l) =>
        l.purchase_order_item_id === po.id ||
        (Boolean(l.raw_material_id) && l.raw_material_id === po.raw_material_id)
    );
    return sum + (line ? line.qty_diterima : po.qty_received);
  }, 0);
  if (projectedReceived >= totalOrdered && totalReject === 0) return "received";
  return "pending";
}

export type ContinueGrnForm = { tanggal_penerimaan: string; catatan: string };

/** Payload PATCH, atau null bila tidak ada baris dengan qty. */
export function buildContinueGrnPayload(
  grnId: string,
  form: ContinueGrnForm,
  lines: ContinueGrnLine[],
  poLines: PoLine[]
) {
  const filled = lines.filter((line) => line.qty_diterima > 0 || line.qty_ditolak > 0);
  if (filled.length === 0) return null;
  return {
    status: continueGrnStatus(filled, poLines),
    catatan: form.catatan,
    tanggal_penerimaan: form.tanggal_penerimaan,
    items: filled.map((line) => ({
      id: line.id,
      grn_id: grnId,
      purchase_order_item_id: line.purchase_order_item_id,
      raw_material_id: line.raw_material_id,
      qty_diterima: line.qty_diterima,
      qty_ditolak: line.qty_ditolak,
      kondisi: "baik" as const,
      catatan: null,
    })),
  };
}
