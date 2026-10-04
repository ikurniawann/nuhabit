import type { StockAlertsResponse } from "@/lib/pos/stock-alerts-types";

export async function fetchStockAlerts(): Promise<StockAlertsResponse> {
  const res = await fetch("/api/pos/stock-alerts", { cache: "no-store" });
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error || "Gagal memuat stok alert");
  }
  return json.data as StockAlertsResponse;
}
