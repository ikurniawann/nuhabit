"use client";

import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatScore, scoreToneClass, toScore } from "@/lib/kpi/ui-performance";
import { useFeedbackSummaries } from "../queries";
import { cycleWeights, gradeVariant, SUMMARY_CATEGORIES, sortSummaries } from "../view";
import type { FeedbackCycle, PgNumeric } from "../types";
import { CycleSelect, QueryState } from "./feedback-shared";

interface FeedbackResultsTabProps {
  cycles: readonly FeedbackCycle[];
  cycleId: string;
  onCycleChange: (id: string) => void;
}

function Score({ value, strong }: { value: PgNumeric; strong?: boolean }) {
  const n = toScore(value);
  return <span className={`tabular-nums ${strong ? "font-semibold" : ""} ${scoreToneClass(n)}`}>{formatScore(n, 1)}</span>;
}

/** Tab "Hasil": nilai per kategori, skor 360°, KPI, nilai akhir dan grade per karyawan. */
export function FeedbackResultsTab({ cycles, cycleId, onCycleChange }: FeedbackResultsTabProps) {
  const cycle = cycles.find((c) => c.id === cycleId) ?? null;
  const query = useFeedbackSummaries(cycleId);
  const rows = sortSummaries(query.data ?? []);

  if (cycles.length === 0) return <QueryState empty="Buat siklus terlebih dahulu di tab Siklus." />;

  const weights = cycleWeights(cycle);

  return (
    <div className="space-y-4">
      <CycleSelect id="results-cycle" cycles={cycles} value={cycleId} onChange={onCycleChange} />
      <p className="text-sm text-muted-foreground">
        Nilai kategori = rata-rata rating (1 sampai 5) × 20 dari penilaian yang terkirim atau disetujui. Nilai akhir =
        KPI × {weights.kpi}% + 360° × {weights.feedback}%. KPI diambil dari rata-rata scorecard dalam rentang siklus.
        Grade: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, E di bawahnya.
      </p>

      <QueryState
        loading={query.isLoading}
        error={query.error}
        empty={rows.length === 0 ? "Belum ada hasil. Hasil muncul setelah penilaian pertama terkirim." : undefined}
      />

      {rows.length > 0 ? (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  {SUMMARY_CATEGORIES.map((c) => (
                    <TableHead key={c.key} className="text-right">
                      {c.label}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">360°</TableHead>
                  <TableHead className="text-right">KPI</TableHead>
                  <TableHead className="text-right">Akhir</TableHead>
                  <TableHead>Grade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <p className="flex items-center gap-1 font-medium">
                        {row.employee?.full_name ?? "—"}
                        {row.is_locked ? <Lock className="h-3 w-3 text-muted-foreground" aria-label="Terkunci" /> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">{row.employee?.department?.name ?? ""}</p>
                    </TableCell>
                    {SUMMARY_CATEGORIES.map((c) => (
                      <TableCell key={c.key} className="text-right">
                        <Score value={row[c.key]} />
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                      <Score value={row.overall_360_score} strong />
                    </TableCell>
                    <TableCell className="text-right">
                      <Score value={row.kpi_score} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Score value={row.final_score} strong />
                    </TableCell>
                    <TableCell>
                      {row.final_grade ? <Badge variant={gradeVariant(row.final_grade)}>{row.final_grade}</Badge> : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
