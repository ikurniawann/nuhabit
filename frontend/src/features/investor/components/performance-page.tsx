"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { Field } from "@/features/crm/engagement/components/shared";
import { ReportTable } from "@/features/gym/reports/components/report-table";
import { SELECT } from "@/features/gym/shared";
import { formatNumber, formatRupiah } from "@/lib/format";
import { INVESTOR_KEYS, investorApi } from "../api";
import { csvFilename, monthColumns, monthLabel, percent } from "../format";
import { MemberGrowthChart, MonthlyPnlChart } from "./charts";
import { BranchFilter, QueryState, useBranches } from "./shared";

const SPANS = [6, 12, 24] as const;

const pct = (ratio: number | null) => (ratio === null ? "-" : `${formatNumber(percent(ratio), 1)}%`);
const columns = monthColumns(formatRupiah, pct);

/** Investor → Laporan Kinerja: tabel dan grafik bulanan, unduh CSV. */
export function InvestorPerformancePage() {
  const [branchId, setBranchId] = useState("");
  const [months, setMonths] = useState<number>(12);
  const branches = useBranches();
  const report = useQuery({
    queryKey: INVESTOR_KEYS.performance(branchId, months),
    queryFn: () => investorApi.performance(branchId, months),
    placeholderData: keepPreviousData,
  });
  const d = report.data;

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Investor"
        title="Laporan Kinerja"
        description={d ? `Per bulan, ${monthLabel(d.months[0]?.month ?? d.from.slice(0, 7))} s.d. ${monthLabel(d.to.slice(0, 7))}. Angka buku mengikuti jurnal yang sudah diposting.` : "Memuat laporan..."}
      />
      <BranchFilter value={branchId} onChange={setBranchId} branches={branches.data}>
        <Field label="Rentang">
          <select className={SELECT} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {SPANS.map((n) => (
              <option key={n} value={n}>
                {n} bulan terakhir
              </option>
            ))}
          </select>
        </Field>
      </BranchFilter>
      <QueryState loading={report.isPending} error={report.error} />
      {d && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <MonthlyPnlChart months={d.months} />
            <MemberGrowthChart months={d.months} />
          </div>
          <ReportTable
            title="Kinerja per bulan"
            description="Pendapatan dari penjualan paket, pass, PT dan toko; margin dan beban dari buku; retensi adalah member bulan lalu yang kembali bulan ini."
            rows={d.months}
            columns={columns}
            rowKey={(r) => r.month}
            csvName="kinerja"
            filename={csvFilename("kinerja", d.from, d.to)}
            period={{ from: d.from, to: d.to }}
          />
        </>
      )}
    </div>
  );
}
