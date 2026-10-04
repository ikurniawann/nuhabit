import { z } from "zod";
import { formatNumber } from "@/lib/format";
import type { DbClient } from "@/lib/pg/types";
import { toQty } from "@/lib/purchasing/utils";

type Numeric = number | string | null | undefined;

export const supplierPerformanceQuerySchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  supplier_id: z.string().uuid().optional(),
  export: z.enum(["json", "csv"]).default("json"),
});

export type SupplierPerformanceQuery = z.infer<typeof supplierPerformanceQuerySchema>;

export interface SupplierRow {
  id: string;
  kode?: string | null;
  nama_supplier?: string | null;
  pic_name?: string | null;
  telepon?: string | null;
  pic_phone?: string | null;
  email?: string | null;
}

export interface SupplierPoRow {
  id: string;
  supplier_id: string;
  status?: string | null;
  total?: Numeric;
  tanggal_po?: string | null;
  tanggal_dibutuhkan?: string | null;
  tanggal_kirim_estimasi?: string | null;
}

export interface SupplierDeliveryRow {
  purchase_order_id: string;
  supplier_id?: string | null;
  tanggal_aktual_tiba?: string | null;
  tanggal_estimasi_tiba?: string | null;
}

export interface SupplierGrnRow {
  id: string;
  purchase_order_id: string;
  supplier_id?: string | null;
  tanggal_penerimaan?: string | null;
  total_item_diterima?: Numeric;
  total_item_ditolak?: Numeric;
}

export interface QcInspectionRow {
  grn_id: string;
  items?: Array<{ qty_inspected?: Numeric; qty_rejected?: Numeric }> | null;
}

export interface SupplierPerformanceSources {
  suppliers: SupplierRow[];
  pos: SupplierPoRow[];
  deliveries: SupplierDeliveryRow[];
  grns: SupplierGrnRow[];
  inspections: QcInspectionRow[];
}

export function daysBetween(from?: string | null, to?: string | null) {
  if (!from || !to) return null;
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

export function qualityFromReject(rejectRate: number) {
  if (rejectRate === 0) return 100;
  if (rejectRate < 5) return 80;
  if (rejectRate < 10) return 60;
  return 40;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

interface Agg {
  total_po: number;
  completed_po: number;
  total_value: number;
  on_time_count: number;
  late_count: number;
  lead_days: number[];
  qty_accepted: number;
  qty_rejected: number;
}

const newAgg = (): Agg => ({
  total_po: 0,
  completed_po: 0,
  total_value: 0,
  on_time_count: 0,
  late_count: 0,
  lead_days: [],
  qty_accepted: 0,
  qty_rejected: 0,
});

function recordTiming(agg: Agg, arrivedAt: string, deadline: string) {
  if (new Date(arrivedAt) <= new Date(deadline)) agg.on_time_count += 1;
  else agg.late_count += 1;
}

function sumQc(inspections: QcInspectionRow[]) {
  const byGrn = new Map<string, { inspected: number; rejected: number }>();
  for (const inspection of inspections) {
    const items = inspection.items || [];
    byGrn.set(inspection.grn_id, {
      inspected: items.reduce((sum, item) => sum + toQty(item.qty_inspected), 0),
      rejected: items.reduce((sum, item) => sum + toQty(item.qty_rejected), 0),
    });
  }
  return byGrn;
}

/**
 * Kinerja supplier dari PO aktif: tepat waktu (delivery vs estimasi, lalu vs
 * tanggal dibutuhkan/estimasi kirim PO; GRN jadi cadangan kalau PO tidak punya
 * waktu tiba delivery), reject rate (QC, cadangan angka GRN), lead time, nilai.
 * Hasil diurutkan menurut nilai belanja, supplier tanpa PO dibuang.
 */
export function rankSupplierPerformance({ suppliers, pos, deliveries, grns, inspections }: SupplierPerformanceSources) {
  const activePos = pos.filter((po) => String(po.status || "").toLowerCase() !== "cancelled");
  const poById = new Map(activePos.map((po) => [po.id, po]));
  const bySupplier = new Map(suppliers.map((supplier) => [supplier.id, newAgg()]));
  const aggFor = (supplierId?: string | null) => (supplierId ? bySupplier.get(supplierId) : undefined);

  for (const po of activePos) {
    const agg = aggFor(po.supplier_id);
    if (!agg) continue;
    agg.total_po += 1;
    agg.total_value += toQty(po.total);
    if (["received", "partially_received", "partial"].includes(String(po.status || "").toLowerCase())) {
      agg.completed_po += 1;
    }
  }

  for (const delivery of deliveries) {
    const po = poById.get(delivery.purchase_order_id);
    const agg = aggFor(delivery.supplier_id || po?.supplier_id);
    if (!agg) continue;

    const lead = daysBetween(po?.tanggal_po, delivery.tanggal_aktual_tiba);
    if (lead != null) agg.lead_days.push(lead);

    const arrived = delivery.tanggal_aktual_tiba;
    const deadline = delivery.tanggal_estimasi_tiba || po?.tanggal_dibutuhkan || po?.tanggal_kirim_estimasi;
    if (arrived && deadline) recordTiming(agg, arrived, deadline);
  }

  const poWithDeliveryTiming = new Set(
    deliveries.filter((d) => d.tanggal_aktual_tiba).map((d) => d.purchase_order_id)
  );
  const qcByGrn = sumQc(inspections);

  for (const grn of grns) {
    const po = poById.get(grn.purchase_order_id);
    const agg = aggFor(grn.supplier_id || po?.supplier_id);
    if (!agg) continue;

    const qc = qcByGrn.get(grn.id);
    if (qc && qc.inspected > 0) {
      agg.qty_accepted += Math.max(0, qc.inspected - qc.rejected);
      agg.qty_rejected += qc.rejected;
    } else {
      agg.qty_accepted += toQty(grn.total_item_diterima);
      agg.qty_rejected += toQty(grn.total_item_ditolak);
    }

    if (!poWithDeliveryTiming.has(grn.purchase_order_id) && grn.tanggal_penerimaan) {
      const lead = daysBetween(po?.tanggal_po, grn.tanggal_penerimaan);
      if (lead != null) agg.lead_days.push(lead);
      const deadline = po?.tanggal_dibutuhkan || po?.tanggal_kirim_estimasi;
      if (deadline) recordTiming(agg, grn.tanggal_penerimaan, deadline);
    }
  }

  const rows = suppliers.flatMap((supplier) => {
    const agg = bySupplier.get(supplier.id);
    if (!agg || agg.total_po === 0) return [];

    const timed = agg.on_time_count + agg.late_count;
    const onTimeRate = timed > 0 ? (agg.on_time_count / timed) * 100 : null;
    const inspected = agg.qty_accepted + agg.qty_rejected;
    const rejectRate = inspected > 0 ? (agg.qty_rejected / inspected) * 100 : 0;
    const qualityScore = qualityFromReject(rejectRate);
    const avgLead =
      agg.lead_days.length > 0 ? agg.lead_days.reduce((s, d) => s + d, 0) / agg.lead_days.length : null;
    const onTimeRounded = onTimeRate !== null ? round1(onTimeRate) : null;

    return [
      {
        id: supplier.id,
        vendor_id: supplier.id,
        supplier_id: supplier.id,
        supplier_code: supplier.kode,
        vendor_code: supplier.kode,
        supplier_name: supplier.nama_supplier,
        vendor_name: supplier.nama_supplier,
        contact_person: supplier.pic_name,
        telepon: supplier.telepon || supplier.pic_phone,
        email: supplier.email,
        total_po: agg.total_po,
        completed_po: agg.completed_po,
        approved_po: agg.completed_po,
        on_time_count: agg.on_time_count,
        late_count: agg.late_count,
        on_time_rate: onTimeRounded,
        on_time_delivery_rate: onTimeRounded,
        reject_rate: round2(rejectRate),
        avg_lead_time_days: avgLead !== null ? round1(avgLead) : null,
        total_value: round2(agg.total_value),
        total_spent: round2(agg.total_value),
        total_spent_formatted: formatNumber(agg.total_value),
        avg_po_value: round2(agg.total_value / agg.total_po),
        quality_score: qualityScore,
        rating: round1((((onTimeRate ?? 50) * 0.5 + qualityScore * 0.5) / 20)),
      },
    ];
  });

  rows.sort((a, b) => b.total_value - a.total_value);
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

export type RankedSupplier = ReturnType<typeof rankSupplierPerformance>[number];

export function supplierPerformanceSummary(ranked: RankedSupplier[], params: SupplierPerformanceQuery) {
  const totalSpend = round2(ranked.reduce((sum, row) => sum + row.total_value, 0));
  const top = ranked[0]?.supplier_name || null;
  return {
    summary: {
      total_suppliers: ranked.length,
      total_vendors: ranked.length,
      period: { from: params.date_from, to: params.date_to },
      top_supplier: top,
      top_vendor: top,
      total_spend_all_suppliers: totalSpend,
      total_spend_all_vendors: totalSpend,
    },
    vendors: ranked,
    suppliers: ranked,
  };
}

export function supplierPerformanceCsv(ranked: RankedSupplier[]) {
  const header =
    "Rank,Kode,Supplier,PIC,Telepon,Email,Total PO,On-Time,Terlambat,On-Time %,Reject %,Lead Time (Hari),Total Nilai,Rating,Quality Score\n";
  const rows = ranked
    .map(
      (v) =>
        `${v.rank},${v.supplier_code || ""},"${v.supplier_name || ""}","${v.contact_person || ""}","${v.telepon || ""}","${v.email || ""}",${v.total_po},${v.on_time_count},${v.late_count},${v.on_time_rate ?? ""},${v.reject_rate},${v.avg_lead_time_days ?? ""},${v.total_value},${v.rating},${v.quality_score}`
    )
    .join("\n");
  return header + rows;
}

// ── Loaders ─────────────────────────────────────────────────────────────────

export async function loadActiveSuppliers(db: DbClient, supplierId?: string) {
  let query = db
    .from("suppliers")
    .select("id, kode, nama_supplier, pic_name, telepon, pic_phone, email, is_active")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("nama_supplier", { ascending: true });
  if (supplierId) query = query.eq("id", supplierId);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as SupplierRow[];
}

async function loadByPurchaseOrders<T>(db: DbClient, table: string, columns: string, poIds: string[]) {
  if (poIds.length === 0) return [] as T[];
  const { data, error } = await db.from(table).select(columns).in("purchase_order_id", poIds).eq("is_active", true);
  if (error) throw error;
  return (data || []) as T[];
}

/** PO, delivery, GRN dan QC milik supplier terpilih dalam rentang tanggal PO. */
export async function loadSupplierPerformanceSources(
  db: DbClient,
  suppliers: SupplierRow[],
  params: SupplierPerformanceQuery
): Promise<SupplierPerformanceSources> {
  let poQuery = db
    .from("purchase_orders")
    .select("id, supplier_id, status, total, tanggal_po, tanggal_dibutuhkan, tanggal_kirim_estimasi, is_active")
    .in("supplier_id", suppliers.map((s) => s.id))
    .eq("is_active", true)
    .is("deleted_at", null);
  if (params.date_from) poQuery = poQuery.gte("tanggal_po", params.date_from);
  if (params.date_to) poQuery = poQuery.lte("tanggal_po", params.date_to);

  const { data: poData, error: poError } = await poQuery;
  if (poError) throw poError;
  const pos = (poData || []) as SupplierPoRow[];
  const poIds = pos
    .filter((po) => String(po.status || "").toLowerCase() !== "cancelled")
    .map((po) => po.id);

  const deliveries = await loadByPurchaseOrders<SupplierDeliveryRow>(
    db,
    "deliveries",
    "id, purchase_order_id, supplier_id, tanggal_aktual_tiba, tanggal_estimasi_tiba",
    poIds
  );
  const grns = await loadByPurchaseOrders<SupplierGrnRow>(
    db,
    "grn",
    "id, purchase_order_id, supplier_id, tanggal_penerimaan, total_item_diterima, total_item_ditolak",
    poIds
  );

  let inspections: QcInspectionRow[] = [];
  if (grns.length > 0) {
    const qcResult = await db
      .from("grn_qc_inspections")
      .select("grn_id, items:grn_qc_inspection_items(qty_inspected, qty_rejected)")
      .in("grn_id", grns.map((g) => g.id));
    if (qcResult.error) {
      console.warn("QC data unavailable for supplier performance:", qcResult.error);
    } else {
      inspections = (qcResult.data || []) as QcInspectionRow[];
    }
  }

  return { suppliers, pos, deliveries, grns, inspections };
}
