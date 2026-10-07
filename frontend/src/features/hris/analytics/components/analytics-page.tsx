"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DocumentArrowDownIcon } from "@heroicons/react/24/outline";
import { downloadCSV } from "@/lib/utils/csv-export";
import { EMPTY_ANALYTICS_VIEW, analyticsCsv } from "@/lib/recruitment/analytics-view";
import { useAnalyticsBrands, useAnalyticsView } from "../queries";
import { AnalyticsKpis } from "./analytics-kpis";
import { AnalyticsCharts } from "./analytics-charts";

export function AnalyticsPage() {
  const [brandFilter, setBrandFilter] = useState("all");
  const [period, setPeriod] = useState("month");

  const { data: brands = [] } = useAnalyticsBrands();
  const viewQuery = useAnalyticsView(brandFilter, period);
  const view = viewQuery.data ?? EMPTY_ANALYTICS_VIEW;
  const loading = viewQuery.isLoading;

  const exportCsv = () => {
    downloadCSV(analyticsCsv(view), "laporan-analytics.csv");
    toast.success("Export CSV berhasil");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-gray-500 text-sm mt-1">Analisis mendalam proses rekrutmen</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} className="gap-2 text-sm">
          <DocumentArrowDownIcon className="w-4 h-4" /> Export CSV
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={brandFilter} onValueChange={(v) => setBrandFilter(v ?? "all")}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Semua Outlet" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Outlet</SelectItem>
            {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={period} onValueChange={(v) => setPeriod(v ?? "month")}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="week">Minggu Ini</SelectItem>
            <SelectItem value="month">Bulan Ini</SelectItem>
            <SelectItem value="3month">3 Bulan</SelectItem>
            <SelectItem value="6month">6 Bulan</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => viewQuery.refetch()}>Refresh</Button>
      </div>

      <AnalyticsKpis view={view} loading={loading} />
      <AnalyticsCharts view={view} loading={loading} />
    </div>
  );
}
