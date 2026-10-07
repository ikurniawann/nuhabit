"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatScore, scoreToneClass, toScore } from "@/lib/kpi/ui-performance";
import { usePerfRealtime } from "../queries";
import { MonthScoreChip, PerfLoadingCard } from "./performance-shared";

interface PerformanceRealtimeTabProps {
  year: number;
  quarter: number;
  yearOptions: number[];
  onYearChange: (year: number) => void;
  onQuarterChange: (quarter: number) => void;
}

/** Tab "KPI Berjalan": rata-rata KPI kuartal-ke-tanggal per karyawan. */
export function PerformanceRealtimeTab({
  year,
  quarter,
  yearOptions,
  onYearChange,
  onQuarterChange,
}: PerformanceRealtimeTabProps) {
  const { data: rt, error } = usePerfRealtime(year, quarter);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {yearOptions.map((y) => (
          <Button key={y} size="sm" variant={y === year ? "default" : "outline"} onClick={() => onYearChange(y)}>
            {y}
          </Button>
        ))}
        <span className="mx-1 text-gray-300">|</span>
        {[1, 2, 3, 4].map((q) => (
          <Button key={q} size="sm" variant={q === quarter ? "default" : "outline"} onClick={() => onQuarterChange(q)}>
            Q{q}
          </Button>
        ))}
      </div>

      {!rt ? (
        <PerfLoadingCard error={error ? error.message || "Gagal memuat KPI berjalan" : null} />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rt.employees.map((emp) => {
            const avg = toScore(emp.avg_score);
            return (
              <Card key={emp.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{emp.full_name}</p>
                      <p className="truncate text-xs text-gray-500">{emp.department_name ?? "—"}</p>
                    </div>
                    <p className={`text-xl font-bold ${scoreToneClass(avg)}`}>{formatScore(avg, 1)}</p>
                  </div>
                  <div className="mt-2 flex gap-2">
                    {rt.months.map((m) => (
                      <MonthScoreChip
                        key={m}
                        month={m}
                        score={(emp.months ?? []).find((row) => row.month === m)?.score ?? null}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {rt.employees.length === 0 ? (
            <p className="col-span-full rounded-lg border border-dashed p-6 text-center text-sm text-gray-500">
              Belum ada data KPI pada kuartal ini.
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
