/**
 * Langkah produksi bertahap (modul Go `production`, /api/production):
 * keluarkan bahan ke WIP, terima hasil per batch (baik + scrap), lihat HPP
 * per batch. Tipe di sini mengikuti respons Go; angka sudah berupa number.
 */

export type ProductionContext = "product" | "raw_material";

export type ProductionFlowOrder = {
  id: string;
  nomor_produksi: string;
  status: string;
  production_context: ProductionContext;
  output_type: "FINISHED_GOOD" | "WIP";
  item_kode: string;
  item_nama: string;
  planned_qty: number;
  actual_qty: number;
  planned_material_cost: number;
  overhead_cost: number;
  labor_cost: number;
  packaging_cost: number;
  waste_cost: number;
  conversion_cost: number;
  hpp_per_unit: number;
  started_at: string | null;
  completed_at: string | null;
  /** Order induk bila order ini sub-order. */
  parent_order_id: string | null;
  parent_nomor_produksi: string | null;
};

/** Bahan setengah jadi (dibuat sendiri) di order dan kekurangannya, dalam satuan stok. */
export type ProductionIntermediate = {
  material_id: string;
  raw_material_id: string;
  kode: string;
  nama: string;
  satuan: string;
  qty_needed: number;
  qty_onhand: number;
  qty_on_sub_orders: number;
  shortage_qty: number;
};

export type ProductionSubOrder = {
  id: string;
  nomor_produksi: string;
  status: string;
  production_context: ProductionContext;
  output_type: string;
  item_kode: string;
  item_nama: string;
  planned_qty: number;
  created_at: string;
};

export type ProductionFlowMaterial = {
  id: string;
  raw_material_id: string;
  kode: string;
  nama: string;
  satuan: string;
  qty_planned: number;
  qty_issued: number;
  qty_returned: number;
  /** Sudah dikeluarkan dan belum dikembalikan. */
  qty_returnable: number;
  qty_remaining: number;
  unit_cost: number;
  issued_cost: number;
  returned_cost: number;
  qty_onhand: number;
  /** Baris resep dalam satuannya sendiri; null untuk order sebelum konversi satuan. */
  recipe_qty: number | null;
  recipe_satuan: string | null;
  unit_factor: number | null;
};

export type ProductionIssue = {
  id: string;
  nomor_issue: string;
  total_cost: number;
  catatan: string | null;
  created_at: string;
  lines: { raw_material_id: string; kode: string; nama: string; qty: number; unit_cost: number; total_cost: number }[];
};

/** Pengembalian bahan sisa ke stok (<order>-R01, ...). */
export type ProductionReturn = {
  id: string;
  nomor_return: string;
  total_cost: number;
  catatan: string | null;
  created_at: string;
  lines: ProductionIssue["lines"];
};

export type ProductionBatch = {
  id: string;
  batch_number: string;
  output_type: string;
  wip_raw_material_id: string | null;
  qty_good: number;
  qty_scrap: number;
  material_cost: number;
  conversion_cost: number;
  scrap_cost: number;
  total_cost: number;
  hpp_per_unit: number;
  /** Scrap dalam toleransi menaikkan HPP; sisanya dibebankan sebagai kerugian. */
  qty_scrap_normal: number;
  qty_scrap_abnormal: number;
  abnormal_material_cost: number;
  abnormal_conversion_cost: number;
  abnormal_scrap_cost: number;
  scrap_tolerance_pct: number | null;
  yield_pct: number | null;
  planned_yield_pct: number | null;
  is_final: boolean;
  catatan: string | null;
  created_at: string;
};

export type ProductionWipBalance = {
  issued_cost: number;
  returned_cost: number;
  received_material_cost: number;
  scrap_cost: number;
  abnormal_scrap_cost: number;
  /** Persen toleransi scrap resep dan jatah scrap normal order (qty). */
  scrap_tolerance_pct: number;
  scrap_allowance: number;
  qty_scrap_abnormal: number;
  wip_value: number;
  conversion_cost: number;
  conversion_applied: number;
  std_material_per_unit: number;
  qty_good: number;
  qty_scrap: number;
  qty_remaining: number;
  yield_pct: number | null;
  planned_yield_pct: number | null;
};

export type ProductionSku = { id: string; sku: string; name: string };

export type ProductionFlow = {
  order: ProductionFlowOrder;
  materials: ProductionFlowMaterial[];
  issues: ProductionIssue[];
  returns: ProductionReturn[];
  batches: ProductionBatch[];
  wip: ProductionWipBalance;
  can_issue: boolean;
  can_receive: boolean;
  /** Order berjalan dan masih ada bahan keluar yang bisa dikembalikan. */
  can_return: boolean;
  /** true setelah bahan dikeluarkan bertahap: order selesai lewat Terima Hasil. */
  stepped: boolean;
  variant_skus: ProductionSku[];
  intermediates: ProductionIntermediate[];
  sub_orders: ProductionSubOrder[];
  /** Ada kekurangan bahan setengah jadi yang belum tercakup sub-order. */
  can_create_sub_orders: boolean;
};

export type ProductionWipOrder = {
  id: string;
  nomor_produksi: string;
  status: string;
  production_context: ProductionContext;
  output_type: string;
  item_kode: string;
  item_nama: string;
  planned_qty: number;
  started_at: string | null;
  issued_cost: number;
  received_material_cost: number;
  scrap_cost: number;
  wip_value: number;
  conversion_cost: number;
  conversion_applied: number;
  qty_good: number;
  qty_scrap: number;
  batches: number;
  yield_pct: number | null;
  last_issue_at: string;
  last_receipt_at: string | null;
};

export type ProductionWipList = {
  orders: ProductionWipOrder[];
  summary: { orders: number; wip_value: number; issued_cost: number };
};

export type ProductionBatchRow = ProductionBatch & {
  production_order_id: string;
  nomor_produksi: string;
  production_context: ProductionContext;
  order_status: string;
  item_kode: string;
  item_nama: string;
  /** false untuk batch dari "Terima Output" sekali jalan: biayanya tidak dipecah. */
  stepped: boolean;
};

export type ProductionBatchDetail = ProductionBatchRow & {
  planned_qty: number;
  materials: {
    raw_material_id: string;
    kode: string;
    nama: string;
    satuan: string;
    issued_qty: number;
    issued_cost: number;
    share_cost: number;
    share_pct: number;
  }[];
  variants: { pos_sku_id: string; sku: string; name: string; qty: number }[];
};

/* ── Keluarkan bahan ─────────────────────────────────────────────────── */

export type IssueRow = { materialId: string; qty: string };

/** Isian awal: sisa rencana, dibatasi stok yang ada. */
export function initIssueRows(materials: ProductionFlowMaterial[]): IssueRow[] {
  return materials.map((m) => ({
    materialId: m.id,
    qty: String(roundQty(Math.max(0, Math.min(m.qty_remaining, m.qty_onhand)))),
  }));
}

/** Payload POST .../issues: hanya baris dengan qty > 0. */
export function buildIssuePayload(rows: IssueRow[], catatan: string) {
  const lines = rows
    .map((row) => ({ material_id: row.materialId, qty: roundQty(Number(row.qty)) }))
    .filter((line) => Number.isFinite(line.qty) && line.qty > 0);
  const note = catatan.trim();
  return note ? { lines, catatan: note } : { lines };
}

/** Baris yang melebihi stok gudang (dicegah sebelum dikirim). */
export function issueShortages(rows: IssueRow[], materials: ProductionFlowMaterial[]): string[] {
  const byId = new Map(materials.map((m) => [m.id, m]));
  return rows
    .filter((row) => Number(row.qty) > (byId.get(row.materialId)?.qty_onhand ?? 0))
    .map((row) => row.materialId);
}

/* ── Kembalikan bahan ────────────────────────────────────────────────── */

/** Jumlah kembali per baris order (id baris → isian). */
export type ReturnRows = Record<string, string>;

/** Baris yang masih bisa dikembalikan. */
export function returnableMaterials(materials: ProductionFlowMaterial[]): ProductionFlowMaterial[] {
  return materials.filter((m) => m.qty_returnable > 0);
}

/** Baris yang melebihi jumlah yang bisa dikembalikan. */
export function returnErrors(rows: ReturnRows, materials: ProductionFlowMaterial[]): string[] {
  return materials.filter((m) => num(rows[m.id] ?? "") > m.qty_returnable + 1e-9).map((m) => m.id);
}

/** Baris payload: hanya qty > 0. */
export function returnLines(rows: ReturnRows) {
  return Object.entries(rows)
    .map(([material_id, qty]) => ({ material_id, qty: roundQty(num(qty)) }))
    .filter((line) => line.qty > 0);
}

/**
 * Perkiraan nilai kembali: harga rata-rata saat bahan dikeluarkan.
 * Mengembalikan seluruh sisa mengambil sisa nilai baris itu.
 */
export function returnValue(rows: ReturnRows, materials: ProductionFlowMaterial[]): number {
  return round2(
    materials.reduce((sum, m) => {
      const qty = num(rows[m.id] ?? "");
      if (qty <= 0 || m.qty_issued <= 0) return sum;
      if (qty >= m.qty_returnable) return sum + Math.max(0, m.issued_cost - m.returned_cost);
      return sum + round2((qty * m.issued_cost) / m.qty_issued);
    }, 0)
  );
}

/** Payload POST .../returns. */
export function buildReturnPayload(rows: ReturnRows, catatan: string) {
  const note = catatan.trim();
  const lines = returnLines(rows);
  return note ? { lines, catatan: note } : { lines };
}

/* ── Terima hasil ────────────────────────────────────────────────────── */

export type ReceiptForm = {
  qtyGood: string;
  qtyScrap: string;
  final: boolean;
  catatan: string;
  overhead: string;
  labor: string;
  packaging: string;
  waste: string;
  variants: Record<string, string>;
  /** Bahan sisa yang dikembalikan bersama batch terakhir. */
  returns: ReturnRows;
};

export function initReceiptForm(flow: ProductionFlow): ReceiptForm {
  const { order, wip } = flow;
  return {
    qtyGood: String(roundQty(wip.qty_remaining)),
    qtyScrap: "0",
    final: true,
    catatan: "",
    overhead: String(order.overhead_cost),
    labor: String(order.labor_cost),
    packaging: String(order.packaging_cost),
    waste: String(order.waste_cost),
    variants: Object.fromEntries(flow.variant_skus.map((sku) => [sku.id, ""])),
    returns: {},
  };
}

function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Jumlah varian yang belum dibagi dari hasil baik. */
export function variantRemainder(form: ReceiptForm): number {
  const split = Object.values(form.variants).reduce((sum, qty) => sum + num(qty), 0);
  return Math.round((num(form.qtyGood) - split) * 100) / 100;
}

export function canSubmitReceipt(form: ReceiptForm, variantRequired: boolean, materials: ProductionFlowMaterial[] = []): boolean {
  const good = num(form.qtyGood);
  const scrap = num(form.qtyScrap);
  if (good < 0 || scrap < 0 || good + scrap <= 0) return false;
  if (form.final && returnErrors(form.returns, materials).length > 0) return false;
  if (variantRequired && good > 0 && Math.abs(variantRemainder(form)) > 0.01) return false;
  return true;
}

/** Payload POST .../receipts; biaya konversi hanya ikut di batch terakhir. */
export function buildReceiptPayload(form: ReceiptForm, variantRequired: boolean) {
  const payload: Record<string, unknown> = {
    qty_good: num(form.qtyGood),
    qty_scrap: num(form.qtyScrap),
    final: form.final,
  };
  if (form.catatan.trim()) payload.catatan = form.catatan.trim();
  if (form.final) {
    payload.overhead_cost = num(form.overhead);
    payload.labor_cost = num(form.labor);
    payload.packaging_cost = num(form.packaging);
    payload.waste_cost = num(form.waste);
  }
  const returns = form.final ? returnLines(form.returns) : [];
  if (returns.length > 0) payload.returns = returns;
  if (variantRequired && num(form.qtyGood) > 0) {
    payload.variant_output = Object.entries(form.variants)
      .map(([pos_sku_id, qty]) => ({ pos_sku_id, qty: num(qty) }))
      .filter((row) => row.qty > 0);
  }
  return payload;
}

/**
 * Bagi scrap batch: normal sampai jatah toleransi order habis (dikurangi
 * scrap batch sebelumnya), sisanya abnormal.
 */
export function splitScrap(wip: ProductionWipBalance, qtyScrap: number) {
  const left = Math.max(0, roundQty(wip.scrap_allowance - wip.qty_scrap));
  const normal = Math.min(Math.max(0, qtyScrap), left);
  return { normal, abnormal: roundQty(Math.max(0, qtyScrap) - normal) };
}

/**
 * Perkiraan biaya batch, sama dengan aturan server: batch sementara memakai
 * biaya bahan standar (dibatasi saldo WIP) dan porsi biaya konversi; batch
 * terakhir mengambil semua sisa. Tanpa hasil baik, sisa WIP menjadi scrap.
 * Scrap abnormal dihitung seperti satu unit hasil baik dan dibebankan.
 */
export function previewReceipt(flow: ProductionFlow, form: ReceiptForm) {
  const { order } = flow;
  // Bahan sisa yang ikut dikembalikan keluar dari WIP sebelum batch terakhir dihitung.
  const returned = form.final ? returnValue(form.returns, flow.materials) : 0;
  const wip = { ...flow.wip, wip_value: Math.max(0, round2(flow.wip.wip_value - returned)) };
  const good = num(form.qtyGood);
  const qtyScrap = num(form.qtyScrap);
  const { normal, abnormal } = splitScrap(wip, qtyScrap);
  const conversion = form.final
    ? num(form.overhead) + num(form.labor) + num(form.packaging) + num(form.waste)
    : wip.conversion_cost;
  const convLeft = Math.max(0, round2(conversion - wip.conversion_applied));
  const share = (total: number, units: number) => (units > 0 ? round2((total * abnormal) / units) : 0);
  let material = 0;
  let conv = 0;
  let scrap = 0;
  let abnormalMaterial = 0;
  let abnormalConversion = 0;
  if (form.final && good <= 0) {
    abnormalMaterial = share(wip.wip_value, qtyScrap);
    abnormalConversion = share(convLeft, qtyScrap);
    scrap = round2(wip.wip_value - abnormalMaterial);
  } else if (form.final) {
    abnormalMaterial = share(wip.wip_value, good + abnormal);
    abnormalConversion = share(convLeft, good + abnormal);
    material = round2(wip.wip_value - abnormalMaterial);
    conv = round2(convLeft - abnormalConversion);
  } else {
    material = Math.min(wip.wip_value, round2(good * wip.std_material_per_unit));
    abnormalMaterial = Math.min(round2(wip.wip_value - material), round2(abnormal * wip.std_material_per_unit));
    if (order.planned_qty > 0) {
      conv = Math.min(convLeft, round2((conversion * good) / order.planned_qty));
      abnormalConversion = Math.min(round2(convLeft - conv), round2((conversion * abnormal) / order.planned_qty));
    }
  }
  const total = round2(material + conv);
  return {
    material,
    conversion: conv,
    scrap,
    total,
    hpp: good > 0 ? round2(total / good) : 0,
    normalScrap: normal,
    abnormalScrap: abnormal,
    abnormalCost: round2(abnormalMaterial + abnormalConversion),
  };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function roundQty(value: number) {
  return Math.round(value * 10000) / 10000;
}
