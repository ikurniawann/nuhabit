"use client";

import { useState } from "react";
import { usePurchasingDashboard } from "@/features/purchasing/dashboard/queries";
import { KPICards } from "@/features/purchasing/dashboard/components/kpi-cards";
import { TrendChart } from "@/features/purchasing/dashboard/components/trend-chart";
import { ActionPOPanel } from "@/features/purchasing/dashboard/components/action-po-panel";
import { StockAlertPanel } from "@/features/purchasing/dashboard/components/stock-alert-panel";
import { HPPTrendPanel } from "@/features/purchasing/dashboard/components/hpp-trend-panel";
import { SupplierPerfChart } from "@/features/purchasing/dashboard/components/supplier-perf-chart";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/datepicker";
import { RefreshCw } from "lucide-react";

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* KPI cards skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div className="h-10 w-10 bg-gray-200 rounded-lg" />
              <div className="h-7 w-16 bg-gray-200 rounded" />
              <div className="h-3 w-24 bg-gray-100 rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
      {/* Chart skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm h-80 bg-gray-100" />
        <Card className="border-0 shadow-sm h-80 bg-gray-100" />
      </div>
    </div>
  );
}

function ErrorState({ error }: { error: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-red-500 font-medium">Gagal memuat dashboard</p>
      <p className="text-sm text-gray-400 mt-1">{error}</p>
    </div>
  );
}

export function PurchasingDashboardPage() {
  const [dateRange, setDateRange] = useState({
    start: "",
    end: "",
  });

  const { data, isLoading, isError, error, refetch, isFetching } = usePurchasingDashboard(
    dateRange.start || undefined,
    dateRange.end || undefined
  );



  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Dashboard Purchasing</h1>
            <p className="text-sm text-gray-500">
              Ringkasan performa procurement & supply chain
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {/* Date Range Filter */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-gray-600">
                    Tanggal Mulai
                  </label>
                  <DatePicker
                    value={dateRange.start}
                    onChange={(v) => setDateRange((prev) => ({ ...prev, start: v }))}
                    placeholder="Dari..."
                    className="w-full"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-gray-600">
                    Tanggal Akhir
                  </label>
                  <DatePicker
                    value={dateRange.end}
                    onChange={(v) => setDateRange((prev) => ({ ...prev, end: v }))}
                    placeholder="Sampai..."
                    className="w-full"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDateRange({ start: "", end: "" })}
                  disabled={!dateRange.start && !dateRange.end}
                  className="flex-1 sm:flex-none"
                >
                  Reset
                </Button>
                <Button
                  size="sm"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className="flex-1 sm:flex-none"
                >
                  {isFetching ? "Loading..." : "Terapkan Filter"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Access Links */}
      {/* Quick Access Links */}

      {isLoading ? (
        <DashboardSkeleton />
      ) : isError ? (
        <ErrorState error={error?.message ?? "Unknown error"} />
      ) : data ? (
        <>
          {/* Widget 1: KPI Cards */}
          <KPICards kpis={data.kpis} />

          {/* Widget 2 & 5: Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TrendChart data={data.monthlyTrends} />
            <HPPTrendPanel trends={data.hppTrends} />
          </div>

          {/* Widget 3 & 4: Action PO + Stock Alert */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ActionPOPanel pos={data.actionPOs} />
            <StockAlertPanel alerts={data.stockAlerts} />
          </div>

          {/* Widget 6: Supplier Performance */}
          <SupplierPerfChart suppliers={data.supplierPerformance} />
        </>
      ) : null}
    </div>
  );
}
