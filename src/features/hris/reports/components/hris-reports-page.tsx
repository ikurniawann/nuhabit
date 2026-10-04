"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
import { MONTH_NAMES_ID, monthName, monthYearLabel } from "@/lib/hris/month-label";
import { hrisReportCsv, hrisReportFileName, type HrisReportCsvKind } from "@/lib/hris/hris-reports-csv";
import { useHRISReport } from "../queries";
import { HeadcountSection, TurnoverSummary } from "./headcount-section";
import { AttendanceSection, LeaveSection } from "./attendance-leave-sections";

export function HRISReportsPage() {
  const [now] = useState(() => new Date());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const { data, isLoading } = useHRISReport(month, year);
  const periodLabel = monthYearLabel(month, year);
  const years = Array.from({ length: 4 }, (_, i) => now.getFullYear() - i);

  const exportCsv = (kind: HrisReportCsvKind) => {
    if (data) downloadCSV(hrisReportCsv(data, kind), hrisReportFileName(kind, month, year));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Laporan HRIS</h1>
          <p className="text-sm text-gray-500 mt-1">{periodLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v))}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES_ID.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => exportCsv("hris-lengkap")} disabled={!data} className="gap-1.5">
            <DocumentArrowDownIcon className="w-4 h-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-2 border-gray-300 border-t-blue-500 rounded-full" />
        </div>
      ) : !data ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            Gagal memuat data laporan
          </CardContent>
        </Card>
      ) : (
        <>
          <HeadcountSection report={data} monthLabel={monthName(month)} onExport={() => exportCsv("headcount")} />
          <AttendanceSection report={data} periodLabel={periodLabel} onExport={() => exportCsv("absensi")} />
          <LeaveSection report={data} periodLabel={periodLabel} onExport={() => exportCsv("cuti")} />
          <TurnoverSummary report={data} year={year} />
        </>
      )}
    </div>
  );
}
