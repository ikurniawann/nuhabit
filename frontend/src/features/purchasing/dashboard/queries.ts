"use client";

import { useQuery } from "@tanstack/react-query";

// ── Types ───────────────────────────────────────────────────────────────────

export interface PurchasingKPIs {
  totalPOCount: number;
  totalPOCountChange: number;
  totalPOValue: number;
  totalPOValueChange: number;
  lowStockCount: number;
  pendingApprovalCount: number;
}

export interface MonthlyTrend {
  month: string;
  [category: string]: string | number;
}

export interface ActionPO {
  id: string;
  po_number: string;
  supplier_name: string;
  order_date: string;
  expected_date: string;
  status: string;
  days_overdue: number;
  notes?: string;
}

export interface StockAlert {
  id: string;
  material_name: string;
  category: string;
  qty_on_hand: number;
  minimum_stok: number;
  unit: string;
  alert_level: "critical" | "warning";
}

export interface HPPTrend {
  product_name: string;
  current_hpp: number;
  previous_hpp: number;
  change_percent: number;
}

export interface SupplierPerformance {
  supplier_id: string;
  supplier_name: string;
  on_time_rate: number;
  qc_pass_rate: number;
  total_deliveries: number;
  avg_lead_time_days: number;
}

export interface PurchasingDashboardData {
  kpis: PurchasingKPIs;
  monthlyTrends: MonthlyTrend[];
  actionPOs: ActionPO[];
  stockAlerts: StockAlert[];
  hppTrends: HPPTrend[];
  supplierPerformance: SupplierPerformance[];
}

// ── Main hook ───────────────────────────────────────────────────────────────

export function usePurchasingDashboard(
  startDate?: string,
  endDate?: string
) {
  return useQuery<PurchasingDashboardData>({
    queryKey: ["purchasing-dashboard", startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);

      const response = await fetch(`/api/purchasing/dashboard?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch dashboard data");
      }
      return response.json();
    },
    refetchInterval: 1000 * 60 * 5, // 5 menit
    staleTime: 1000 * 60 * 2,
  });
}
