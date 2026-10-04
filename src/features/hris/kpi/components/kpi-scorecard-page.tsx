"use client";

import { useState } from "react";
import { AdjustmentsHorizontalIcon, ChartBarIcon, PlayIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SkeletonTable } from "@/components/ui/skeleton-table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { formatNumber } from "@/lib/format";
import { MONTH_NAMES_ID, monthName } from "@/lib/hris/month-label";
import { toScore } from "@/lib/kpi/ui-performance";
import { useKpiScorecards } from "../queries";
import {
  useRunKpiSnapshot,
  useSaveKpiRubric,
  useUpdateScorecardStatus,
} from "../mutations";
import type { KpiScorecardRow } from "../types";
import { ScorecardBreakdown } from "./scorecard-breakdown";
import { KpiTargetsDialog } from "./targets-dialog";
import { KPI_SCORECARD_ROLES } from "@/lib/kpi/roles";
import { useLogbookDepartments } from "@/features/hris/logbook";

/** Halaman HRD: KPI Scorecard per periode (EPIC-010 Fase C). */
export function KpiScorecardPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [detailId, setDetailId] = useState("");
  const [showRunConfirm, setShowRunConfirm] = useState(false);
  const [showTargets, setShowTargets] = useState(false);
  const [rubricValue, setRubricValue] = useState("");
  const [rubricNotes, setRubricNotes] = useState("");

  const scorecardsQuery = useKpiScorecards({
    period_year: year,
    period_month: month,
  });
  const rows = scorecardsQuery.data?.data ?? [];
  const indicators = scorecardsQuery.data?.indicators ?? [];
  const detail = rows.find((row) => row.id === detailId) || null;

  const departmentsQuery = useLogbookDepartments();
  const departments = departmentsQuery.data ?? [];

  const runMutation = useRunKpiSnapshot();
  const rubricMutation = useSaveKpiRubric();
  const statusMutation = useUpdateScorecardStatus();

  async function runSnapshot() {
    setShowRunConfirm(false);
    try {
      const res = await runMutation.mutateAsync({
        period_month: month,
        period_year: year,
      });
      toast.success(res.message || "Snapshot selesai");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menjalankan snapshot");
    }
  }

  async function saveRubric(scorecard: KpiScorecardRow) {
    if (!rubricValue) {
      toast.error("Pilih nilai rubrik 1-5");
      return;
    }
    try {
      await rubricMutation.mutateAsync({
        employee_id: scorecard.employee_id,
        period_month: month,
        period_year: year,
        value: Number(rubricValue),
        notes: rubricNotes || undefined,
      });
      setRubricValue("");
      setRubricNotes("");
      toast.success("Rubrik tersimpan — skor diperbarui");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan rubrik");
    }
  }

  async function toggleStatus(scorecard: KpiScorecardRow) {
    const action = scorecard.status === "draft" ? "finalize" : "reopen";
    try {
      const res = await statusMutation.mutateAsync({
        action,
        scorecard_id: scorecard.id,
      });
      toast.success(action === "finalize" ? "Scorecard difinalkan" : "Scorecard dibuka kembali");
      // Fase E: buka WhatsApp pemberitahuan skor final (bila ada no. HP)
      if (action === "finalize" && res.wa_link) {
        window.open(res.wa_link, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengubah status");
    }
  }

  const rubricSnapshot = detail?.breakdown?.find(
    (row) => row.code === "supervisor_rubric"
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ChartBarIcon className="h-6 w-6" /> KPI Scorecard
          </h1>
          <p className="text-sm text-muted-foreground">
            Skor kinerja bulanan per karyawan — terisi otomatis dari data
            operasional + rubrik atasan. Skala 0–100.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label>Bulan</Label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES_ID.map((label, index) => (
                  <SelectItem key={label} value={String(index + 1)}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Tahun</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[year - 1, year, year + 1]
                  .filter((value, index, arr) => arr.indexOf(value) === index)
                  .map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={() => setShowTargets(true)}>
            <AdjustmentsHorizontalIcon className="mr-1 h-4 w-4" /> Atur Target
          </Button>
          <Button
            onClick={() => setShowRunConfirm(true)}
            disabled={runMutation.isPending}
          >
            <PlayIcon className="mr-1 h-4 w-4" />
            {runMutation.isPending ? "Menghitung..." : "Jalankan Snapshot"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Scorecard {monthName(month)} {year}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scorecardsQuery.isLoading ? (
            <SkeletonTable rows={5} columns={6} />
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Belum ada scorecard periode ini — jalankan snapshot dulu.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Skor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const score = toScore(row.score);
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        {row.employee?.full_name ?? "-"}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {row.employee?.nip}
                        </span>
                      </TableCell>
                      <TableCell>{row.employee?.department?.name ?? "-"}</TableCell>
                      <TableCell className="text-xs">{row.role_code}</TableCell>
                      <TableCell className="text-right">
                        {score === null ? (
                          <span className="text-muted-foreground">tanpa data</span>
                        ) : (
                          <span className="font-semibold">
                            {formatNumber(score, 3)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            row.status === "final"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-gray-200 bg-gray-100 text-gray-700"
                          }
                        >
                          {row.status === "final" ? "Final" : "Draft"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDetailId(row.id)}
                        >
                          Detail
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetailId("")}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {detail?.employee?.full_name} — {monthName(month)} {year}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-5">
              <ScorecardBreakdown scorecard={detail} indicators={indicators} />

              {detail.status === "draft" && (
                <div className="space-y-2 border-t pt-4">
                  <Label>
                    Penilaian Atasan (rubrik 1–5)
                    {rubricSnapshot?.attainment != null && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        tersimpan: {formatNumber(rubricSnapshot.attainment * 5, 3)}/5
                      </span>
                    )}
                  </Label>
                  <div className="flex gap-2">
                    <Select value={rubricValue} onValueChange={setRubricValue}>
                      <SelectTrigger className="w-24">
                        <SelectValue placeholder="Nilai" />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5].map((v) => (
                          <SelectItem key={v} value={String(v)}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      onClick={() => saveRubric(detail)}
                      disabled={rubricMutation.isPending}
                    >
                      {rubricMutation.isPending ? "Menyimpan..." : "Simpan Rubrik"}
                    </Button>
                  </div>
                  <Textarea
                    value={rubricNotes}
                    onChange={(event) => setRubricNotes(event.target.value)}
                    placeholder="Catatan penilaian (opsional)"
                  />
                </div>
              )}

              <div className="flex justify-end border-t pt-4">
                <Button
                  variant={detail.status === "draft" ? "default" : "outline"}
                  onClick={() => toggleStatus(detail)}
                  disabled={statusMutation.isPending}
                >
                  {detail.status === "draft"
                    ? "Finalisasi Scorecard"
                    : "Buka Kembali (Draft)"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showRunConfirm}
        onOpenChange={setShowRunConfirm}
        title={`Jalankan snapshot ${monthName(month)} ${year}?`}
        description="Angka aktual ditarik ulang dari data operasional. Scorecard berstatus FINAL tidak akan tersentuh."
        confirmLabel="Jalankan"
        loadingLabel="Menghitung..."
        loading={runMutation.isPending}
        onConfirm={runSnapshot}
      />

      <KpiTargetsDialog
        open={showTargets}
        onOpenChange={setShowTargets}
        indicators={indicators}
        roleCodes={[...KPI_SCORECARD_ROLES]}
        departments={departments}
      />

    </div>
  );
}
