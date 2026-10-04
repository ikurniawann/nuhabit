import { rawMaterialStockSource } from "@/lib/api/stall-scope";
import type { DbClient } from "@/lib/pg/types";
import { toQty } from "@/lib/purchasing/utils";

type Numeric = number | string | null | undefined;

interface PoValueRow {
  total?: Numeric;
  grand_total?: Numeric;
  created_at?: string | null;
  source_type?: string | null;
}

interface ActionPoRow {
  id: string;
  nomor_po?: string | null;
  tanggal_po?: string | null;
  tanggal_kirim_estimasi?: string | null;
  status?: string | null;
  nama_supplier?: string | null;
}

interface StockAlertRow {
  id: string;
  nama?: string | null;
  kategori?: string | null;
  qty_onhand?: number | null;
  min_stock?: number | null;
  satuan?: string | null;
}

interface SupplierRow {
  id: string;
  nama_supplier?: string | null;
}

const DAY_MS = 1000 * 60 * 60 * 24;

/** Periode KPI: start/end dari query, default bulan berjalan; plus periode yang sama sebulan sebelumnya. */
export function resolveDashboardPeriod(startDate: string | null, endDate: string | null, now = new Date()) {
  const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = endDate
    ? new Date(endDate)
    : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const prevStart = new Date(start);
  prevStart.setMonth(prevStart.getMonth() - 1);
  const prevEnd = new Date(end);
  prevEnd.setMonth(prevEnd.getMonth() - 1);
  return { start, end, prevStart, prevEnd };
}

/** Perubahan dalam persen (1 desimal); 0 kalau periode pembanding kosong. */
export function percentChange(current: number, previous: number) {
  return previous > 0 ? Math.round(((current - previous) / previous) * 100 * 10) / 10 : 0;
}

/** grand_total kalau terisi, selain itu total (urutan pilih lama). */
const poValue = (po: PoValueRow) => toQty(po.grand_total || po.total);

export function sumPoValue(rows: PoValueRow[]) {
  return rows.reduce((sum, po) => sum + poValue(po), 0);
}

export function daysOverdue(expectedDate: string | null | undefined, now = new Date()) {
  if (!expectedDate) return 0;
  return Math.max(0, Math.floor((now.getTime() - new Date(expectedDate).getTime()) / DAY_MS));
}

/** Nilai PO per bulan (label "Okt") dipecah per source_type. */
export function buildMonthlyTrends(rows: PoValueRow[], now = new Date()) {
  const months = new Map<string, Record<string, string | number>>();
  for (const po of rows) {
    const date = po.created_at ? new Date(po.created_at) : now;
    const month = date.toLocaleString("id-ID", { month: "short" });
    const category = po.source_type || "manual";
    const bucket = months.get(month) ?? { month };
    bucket[category] = toQty(bucket[category]) + poValue(po);
    months.set(month, bucket);
  }
  return Array.from(months.values());
}

async function poValuesBetween(db: DbClient, from: Date, to: Date) {
  const { data, error } = await db
    .from("v_purchase_orders")
    .select("id, total, grand_total, created_at")
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString());
  return { rows: (data || []) as PoValueRow[], error };
}

export async function loadPurchasingDashboard(
  db: DbClient,
  startDate: string | null,
  endDate: string | null
) {
  // KPI stok & stock alert mengikuti stall aktif di sidebar.
  const { view: stockView, warehouseId } = await rawMaterialStockSource();
  let lowStockQuery = db
    .from(stockView)
    .select("id", { count: "exact", head: true })
    .in("status_stok", ["MENIPIS", "HABIS"]);
  if (warehouseId) lowStockQuery = lowStockQuery.eq("warehouse_id", warehouseId);

  const period = resolveDashboardPeriod(startDate, endDate);
  const [current, previous, { count: lowStockCount }, { count: pendingApprovalCount }] = await Promise.all([
    poValuesBetween(db, period.start, period.end),
    poValuesBetween(db, period.prevStart, period.prevEnd),
    lowStockQuery,
    db
      .from("v_purchase_orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending_approval"),
  ]);
  if (current.error) throw current.error;

  const totalPOValue = sumPoValue(current.rows);

  // Panel di bawah KPI bersifat best-effort: galat query = daftar kosong.
  const { data: actionPOs } = await db
    .from("v_purchase_orders")
    .select("id, nomor_po, tanggal_po, tanggal_kirim_estimasi, status, nama_supplier")
    .or("status.eq.sent,status.eq.pending_approval")
    .order("tanggal_kirim_estimasi", { ascending: true, nullsFirst: false })
    .limit(10);

  let stockAlertsQuery = db
    .from(stockView)
    .select("id, nama, kategori, qty_onhand, min_stock, satuan")
    .in("status_stok", ["MENIPIS", "HABIS"]);
  if (warehouseId) stockAlertsQuery = stockAlertsQuery.eq("warehouse_id", warehouseId);
  const { data: stockAlerts } = await stockAlertsQuery.order("qty_onhand", { ascending: true }).limit(10);

  const { data: monthlyData } = await db
    .from("v_purchase_orders")
    .select("grand_total, total, created_at, source_type")
    .order("created_at", { ascending: true })
    .limit(100);

  const { data: suppliers } = await db.from("suppliers").select("id, nama_supplier").limit(10);

  return {
    kpis: {
      totalPOCount: current.rows.length,
      totalPOCountChange: percentChange(current.rows.length, previous.rows.length),
      totalPOValue,
      totalPOValueChange: percentChange(totalPOValue, sumPoValue(previous.rows)),
      lowStockCount: lowStockCount ?? 0,
      pendingApprovalCount: pendingApprovalCount ?? 0,
    },
    monthlyTrends: buildMonthlyTrends((monthlyData || []) as PoValueRow[]),
    actionPOs: ((actionPOs || []) as ActionPoRow[]).map((po) => ({
      id: po.id,
      po_number: po.nomor_po,
      supplier_name: po.nama_supplier || "Unknown",
      order_date: po.tanggal_po,
      expected_date: po.tanggal_kirim_estimasi,
      status: po.status,
      days_overdue: daysOverdue(po.tanggal_kirim_estimasi),
    })),
    stockAlerts: ((stockAlerts || []) as StockAlertRow[]).map((item) => ({
      id: item.id,
      material_name: item.nama,
      category: item.kategori || "Uncategorized",
      qty_on_hand: item.qty_onhand || 0,
      minimum_stok: item.min_stock || 0,
      unit: item.satuan || "unit",
      alert_level: item.qty_onhand === 0 ? "critical" : "warning",
    })),
    // HPP trend belum dihitung; panel menampilkan keadaan kosong.
    hppTrends: [] as Array<Record<string, string | number>>,
    // Angka kinerja masih placeholder tetap (perilaku lama).
    supplierPerformance: ((suppliers || []) as SupplierRow[]).map((supplier) => ({
      supplier_id: supplier.id,
      supplier_name: supplier.nama_supplier,
      on_time_rate: 85,
      qc_pass_rate: 95,
      total_deliveries: 0,
      avg_lead_time_days: 3,
    })),
  };
}
