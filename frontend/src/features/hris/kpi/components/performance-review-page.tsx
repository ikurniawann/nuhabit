"use client";

import { useState } from "react";
import { ChartNoAxesCombined } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { quarterOf } from "@/lib/kpi/ui-performance";
import { PerformanceCyclesTab } from "./performance-cycles-tab";
import { PerformanceRealtimeTab } from "./performance-realtime-tab";
import { PerformanceReviewDialog } from "./performance-review-dialog";

/**
 * Performance Review kuartalan (owner 2026-08-31, Fase 1) + report KPI
 * berjalan. Nilai akhir 60% Hasil Kerja (KPI otomatis) + 30% Perilaku
 * (Head Division menilai 1–5) + 10% Kontribusi (opsional). UI dirancang
 * ramah HP/tablet (kartu sentuh, tombol besar) seperti Task Departemen.
 */
export function PerformanceReviewPage() {
  const [now] = useState(() => new Date());
  const yearOptions = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const [rtYear, setRtYear] = useState(now.getFullYear());
  const [rtQuarter, setRtQuarter] = useState(quarterOf(now.getMonth()));
  const [detailId, setDetailId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
          <ChartNoAxesCombined className="h-6 w-6 text-brand-text" />
          Performance Review
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Rapor kinerja kuartalan: 60% Hasil Kerja (KPI otomatis) + 30% Perilaku
          (dinilai Head Division) + 10% Kontribusi. Pantau KPI berjalan kapan
          saja tanpa menunggu siklus dibuka.
        </p>
      </div>

      <Tabs defaultValue="realtime">
        <TabsList>
          <TabsTrigger value="realtime">KPI Berjalan</TabsTrigger>
          <TabsTrigger value="cycles">Siklus Review</TabsTrigger>
        </TabsList>

        <TabsContent value="realtime" className="space-y-4">
          <PerformanceRealtimeTab
            year={rtYear}
            quarter={rtQuarter}
            yearOptions={yearOptions}
            onYearChange={setRtYear}
            onQuarterChange={setRtQuarter}
          />
        </TabsContent>

        <TabsContent value="cycles" className="space-y-4">
          <PerformanceCyclesTab yearOptions={yearOptions} onOpenReview={setDetailId} />
        </TabsContent>
      </Tabs>

      <PerformanceReviewDialog reviewId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
