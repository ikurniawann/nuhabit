import { normalizePoDetailRows } from "@/lib/purchasing/report-ui-po";
import type {
  InventoryApiRow,
  PODetailRow,
  InventoryValuationParams,
  PODetailParams,
  POSummaryParams,
  POSummaryResult,
  PoSummaryExportFormat,
  PoSummaryExportResult,
  StockCardParams,
  StockCardResponse,
  SupplierPerfRow,
  ProductionInHouseParams,
  ProductionInHouseResult,
} from "./types";

export type * from "./types";

const BASE = "/api/purchasing/reports";

function buildParams(record: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(record).forEach(([key, value]) => {
    if (value !== undefined && value !== "" && value !== null) {
      params.set(key, String(value));
    }
  });
  return params;
}

type ReportBody = { success?: boolean; data?: unknown; items?: unknown; message?: string; error?: string } | null;

/** Baca JSON laporan; gagal (HTTP atau success:false) dilempar dengan `error` (format baru) atau `message`. */
async function readReport(response: Response, fallback: string): Promise<NonNullable<ReportBody>> {
  const body = (await response.json().catch(() => null)) as ReportBody;
  if (!response.ok || !body || body.success === false) {
    throw new Error(body?.error || body?.message || fallback);
  }
  return body;
}

/** Pesan error dari respons ekspor yang gagal (body JSON bila ada). */
async function exportError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as ReportBody;
  return new Error(body?.error || body?.message || fallback);
}

export async function getSupplierPerformance(params: {
  date_from?: string;
  date_to?: string;
  supplier_id?: string;
}): Promise<SupplierPerfRow[]> {
  const sp = buildParams({
    date_from: params.date_from,
    date_to: params.date_to,
    supplier_id: params.supplier_id,
  });
  const body = await readReport(
    await fetch(`${BASE}/supplier-performance?${sp.toString()}`),
    "Gagal memuat data performa supplier"
  );
  const data = body.data as { suppliers?: unknown[]; vendors?: unknown[] } | undefined;
  const rows = data?.suppliers ?? data?.vendors ?? (body.items as unknown[] | undefined) ?? [];
  return (rows as Record<string, unknown>[]).map((row) => ({
    id: String(row.id || row.supplier_id || row.vendor_id || ""),
    rank: row.rank != null ? Number(row.rank) : undefined,
    supplier_code: (row.supplier_code || row.vendor_code) as string | undefined,
    supplier_name: (row.supplier_name || row.vendor_name) as string | undefined,
    contact_person: row.contact_person as string | undefined,
    telepon: row.telepon as string | undefined,
    email: row.email as string | undefined,
    total_po: Number(row.total_po || 0),
    completed_po: Number(row.completed_po || row.approved_po || 0),
    on_time_count: Number(row.on_time_count || 0),
    late_count: Number(row.late_count || 0),
    on_time_rate:
      row.on_time_rate != null
        ? Number(row.on_time_rate)
        : row.on_time_delivery_rate != null
          ? Number(row.on_time_delivery_rate)
          : null,
    reject_rate: Number(row.reject_rate || 0),
    avg_lead_time_days:
      row.avg_lead_time_days != null ? Number(row.avg_lead_time_days) : null,
    total_value: Number(row.total_value ?? row.total_spent ?? 0),
    avg_po_value: Number(row.avg_po_value || 0),
    quality_score: Number(row.quality_score || 0),
    rating: Number(row.rating || 0),
  }));
}

export async function getPoSummary(
  params: POSummaryParams
): Promise<POSummaryResult> {
  const sp = buildParams({ ...params });
  const body = await readReport(
    await fetch(`${BASE}/po-summary?${sp.toString()}`),
    "Gagal memuat laporan PO Summary"
  );
  const data = (body.data ?? {}) as {
    summary?: POSummaryResult["summary"];
    by_status?: POSummaryResult["byStatus"];
    grand_total?: number;
  };
  return {
    summary: data.summary || [],
    byStatus: data.by_status || [],
    grandTotal: data.grand_total || 0,
  };
}

export async function exportPoSummary(
  params: POSummaryParams,
  format: PoSummaryExportFormat
): Promise<PoSummaryExportResult> {
  const sp = buildParams({ ...params, export: format });
  const response = await fetch(`${BASE}/po-summary?${sp.toString()}`);
  if (!response.ok) throw await exportError(response, "Gagal export laporan PO Summary");
  if (format === "csv") {
    return { blob: await response.blob(), extension: "csv" };
  }
  const result = await response.json();
  return {
    blob: new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    }),
    extension: "json",
  };
}

export async function getStockCard(
  params: StockCardParams
): Promise<StockCardResponse> {
  const sp = buildParams({ ...params, limit: params.limit ?? 500 });
  const body = await readReport(await fetch(`${BASE}/stock-card?${sp.toString()}`), "Gagal memuat stock card");
  return body.data as StockCardResponse;
}

export async function getInventoryValuation(
  params: InventoryValuationParams
): Promise<InventoryApiRow[]> {
  const sp = buildParams({ date_from: params.date_from, date_to: params.date_to });
  const body = await readReport(
    await fetch(`${BASE}/inventory-valuation?${sp.toString()}`, { credentials: "same-origin" }),
    "Gagal memuat valuasi inventory"
  );
  return (body.data || []) as InventoryApiRow[];
}

export async function getPoDetailReport(
  params: PODetailParams
): Promise<PODetailRow[]> {
  const sp = buildParams({ ...params });
  const body = await readReport(
    await fetch(`${BASE}/po-detail?${sp.toString()}`),
    "Gagal memuat laporan Detail PO"
  );
  return normalizePoDetailRows((body.data as { summary?: unknown[] } | undefined)?.summary || []);
}

export async function getProductionInHouseReport(
  params: ProductionInHouseParams
): Promise<ProductionInHouseResult> {
  const sp = buildParams({ ...params });
  const body = await readReport(
    await fetch(`${BASE}/production-in-house?${sp.toString()}`),
    "Gagal memuat laporan Produksi Internal"
  );
  const data = (body.data ?? {}) as {
    orders?: ProductionInHouseResult["orders"];
    by_status?: ProductionInHouseResult["byStatus"];
    summary?: ProductionInHouseResult["summary"];
  };
  return {
    orders: data.orders || [],
    byStatus: data.by_status || [],
    summary: data.summary || {
      total_orders: 0,
      total_planned_qty: 0,
      total_actual_qty: 0,
      total_hpp_value: 0,
      completed_orders: 0,
    },
  };
}

export async function exportProductionInHouseReport(
  params: ProductionInHouseParams
): Promise<Blob> {
  const sp = buildParams({ ...params, export: "csv" });
  const response = await fetch(`${BASE}/production-in-house?${sp.toString()}`);
  if (!response.ok) throw await exportError(response, "Gagal mengekspor laporan Produksi Internal");
  return response.blob();
}
