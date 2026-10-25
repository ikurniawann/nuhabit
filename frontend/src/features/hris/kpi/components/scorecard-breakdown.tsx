"use client";

import Link from "next/link";
import { useIamAccess } from "@/components/iam/iam-access-provider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTaskContributions } from "@/features/tasks/queries";
import { formatNumber } from "@/lib/format";
import { IAM } from "@/lib/iam/prefixes";
import { toScore } from "@/lib/kpi/ui-performance";
import type { KpiBreakdownRow, KpiIndicatorInfo, KpiScorecardRow } from "../types";

const fmtPct = (fraction: number | null): string =>
  fraction === null ? "—" : `${formatNumber(fraction * 100, 1)}%`;

/** Rincian komposisi skor satu scorecard — dipakai dialog HRD & ESS. */
export function ScorecardBreakdown({
  scorecard,
  indicators,
}: {
  scorecard: KpiScorecardRow;
  indicators: KpiIndicatorInfo[];
}) {
  const byCode = new Map(indicators.map((i) => [i.code, i]));
  const rows: KpiBreakdownRow[] = scorecard.breakdown ?? [];
  const excluded = rows.filter((row) => row.attainment === null);
  const score = toScore(scorecard.score);
  const rawScore = toScore(scorecard.raw_score);
  const month = `${scorecard.period_year}-${String(scorecard.period_month).padStart(2, "0")}`;
  // Tugas terkait indikator tampil sebagai konteks (modul tasks); skor tidak berubah.
  const showTasks = useIamAccess().hasPrefix(IAM.tasks);
  const contributions = useTaskContributions({ employee_id: scorecard.employee_id, month }, showTasks);
  const contributionByCode = new Map((contributions.data ?? []).map((c) => [c.code, c]));
  const departmentQuery = scorecard.employee?.department_id ? `&department_id=${scorecard.employee.department_id}` : "";

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-bold">
          {score === null ? "—" : formatNumber(score, 3)}
        </span>
        <span className="text-sm text-muted-foreground">/ 100</span>
        {rawScore !== null && rawScore > 100 && (
          <span className="text-xs text-muted-foreground">
            (raw {formatNumber(rawScore, 3)} — over-achievement)
          </span>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Indikator</TableHead>
            <TableHead className="text-right">Bobot</TableHead>
            <TableHead className="text-right">Bobot Efektif</TableHead>
            <TableHead className="text-right">Pencapaian</TableHead>
            <TableHead className="text-right">Kontribusi</TableHead>
            {showTasks && <TableHead className="text-right">Tugas</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const indicator = byCode.get(row.code);
            const tasks = contributionByCode.get(row.code);
            return (
              <TableRow
                key={row.code}
                className={row.attainment === null ? "opacity-50" : ""}
              >
                <TableCell>{indicator?.name ?? row.code}</TableCell>
                <TableCell className="text-right">{row.weight}</TableCell>
                <TableCell className="text-right">{row.effectiveWeight}</TableCell>
                <TableCell className="text-right">{fmtPct(row.attainment)}</TableCell>
                <TableCell className="text-right">
                  {row.attainment === null ? "—" : formatNumber(row.contribution, 3)}
                </TableCell>
                {showTasks && (
                  <TableCell className="text-right text-xs">
                    {indicator ? (
                      <Link
                        href={`/dashboard/tasks/kpi?indicator=${indicator.id}&month=${month}${departmentQuery}`}
                        className="text-brand-text underline-offset-4 hover:underline"
                        aria-label={`Tugas terkait ${indicator.name}`}
                      >
                        {tasks
                          ? `${tasks.tasks_done}/${tasks.tasks_total} selesai${tasks.contribution_total ? ` · +${formatNumber(tasks.contribution_total)}` : ""}`
                          : "Lihat tugas"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {excluded.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {excluded.length} indikator tanpa data periode ini (
          {excluded.map((row) => byCode.get(row.code)?.name ?? row.code).join(", ")}
          ) — bobotnya didistribusikan ulang ke indikator lain.
        </p>
      )}
    </div>
  );
}
