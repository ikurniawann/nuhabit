"use client";

import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonCard } from "@/components/ui/skeleton-table";
import { useLogbookSummary } from "../queries";
import { LogbookQueryError } from "./query-error";

/** Tab Ringkasan KPI — agregasi per department (server sudah men-scope). */
export function LogbookKpiSummaryTab({ departmentId }: { departmentId: string }) {
  const summaryQuery = useLogbookSummary({
    department_id: departmentId || undefined,
  });
  const summary = summaryQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Star className="h-4 w-4" /> Ringkasan KPI per Department
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          KPI dihitung otomatis dari bobot checklist yang terselesaikan.
        </p>
      </CardHeader>
      <CardContent>
        {summaryQuery.isLoading && <SkeletonCard />}
        {summaryQuery.isError && <LogbookQueryError error={summaryQuery.error} />}
        {!summaryQuery.isLoading && !summaryQuery.isError && summary.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Belum ada data logbook untuk diringkas.
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {summary.map((row) => (
            <div key={row.department?.id ?? "unknown"} className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">{row.department?.name ?? "-"}</p>
                <Badge variant="outline">{row.avg_kpi_score}% KPI</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {row.total_entries} logbook · {row.submitted_entries} submitted ·{" "}
                {row.reviewed_entries} direview
              </p>
              <div className="mt-3 h-2 rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-emerald-500"
                  style={{ width: `${Math.min(100, row.avg_completion)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Rata-rata penyelesaian {row.avg_completion}%
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
