"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ChartBarIcon,
  ClipboardDocumentCheckIcon,
  DocumentCheckIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { SkeletonCard } from "@/components/ui/skeleton-table";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { apiGet } from "@/lib/api-client";
import { useKpiHistory, useKpiTeam } from "../queries";
import { useSaveKpiRubric } from "../mutations";
import type { KpiScorecardRow } from "../types";
import { ScorecardBreakdown } from "./scorecard-breakdown";

const MONTH_LABELS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const num = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const periodLabel = (row: KpiScorecardRow) =>
  `${MONTH_LABELS[row.period_month - 1]} ${row.period_year}`;

const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const scoreCls = (v: number | null): string => {
  if (v === null) return "text-gray-400";
  if (v >= 90) return "text-emerald-600";
  if (v >= 75) return "text-blue-600";
  if (v >= 60) return "text-amber-600";
  return "text-red-600";
};

/** Ringkasan kuartal berjalan + review + task hari ini (owner 2026-08-31 —
 *  menyambungkan KPI Saya dengan Performance Review & Task Departemen). */
interface QuarterSummary {
  quarter: number;
  year: number;
  months: number[];
  monthScores: { month: number; score: number | null }[];
  avg: number | null;
}
interface MyReviewSummary {
  cycleName: string;
  grand: number | null;
  category: string | null;
  status: string;
  selfDone: boolean;
  signed: boolean;
}

/**
 * ESS → KPI Saya: riwayat skor bulanan pribadi (Fase C) + section
 * "Tim Saya" utk atasan langsung menilai rubrik bawahannya (Fase E/MSS).
 */
export function EssKpiPage() {
  const { toasts, showToast, removeToast } = useToast();
  const [detail, setDetail] = useState<KpiScorecardRow | null>(null);
  const [teamDetail, setTeamDetail] = useState<KpiScorecardRow | null>(null);
  const [rubricValue, setRubricValue] = useState("");
  const [rubricNotes, setRubricNotes] = useState("");

  // Sambungan ke Performance Review & Task Departemen (owner 2026-08-31):
  // QTD kuartal berjalan, status review kuartal saya, dan tugas hari ini.
  const [quarterSummary, setQuarterSummary] = useState<QuarterSummary | null>(null);
  const [myReview, setMyReview] = useState<MyReviewSummary | null | "none">(null);
  const [todayTasks, setTodayTasks] = useState<number | null>(null);

  useEffect(() => {
    interface RtResponse {
      data: {
        employees: { id: string; avg_score: number | string | null; months: { month: number; score: number | string | null }[] | null }[];
        months: number[]; year: number; quarter: number; my_employee_id: string | null;
      };
    }
    apiGet<RtResponse>("/api/hris/performance/realtime")
      .then((res) => {
        const d = res.data;
        const mine = d.employees.find((e) => e.id === d.my_employee_id) ?? d.employees[0];
        setQuarterSummary({
          quarter: d.quarter,
          year: d.year,
          months: d.months,
          monthScores: d.months.map((m) => {
            const found = (mine?.months ?? []).find((row) => row.month === m);
            const parsed = found?.score === null || found?.score === undefined ? null : Number(found.score);
            return { month: m, score: Number.isFinite(parsed as number) ? (parsed as number) : null };
          }),
          avg: mine?.avg_score === null || mine?.avg_score === undefined ? null : Number(mine.avg_score),
        });
      })
      .catch(() => setQuarterSummary(null));

    interface CyclesResponse {
      data: { cycles: { id: string; name: string; start_date: string; end_date: string }[] };
    }
    interface ReviewsResponse {
      data: {
        my_employee_id: string | null;
        reviews: {
          employee_id: string; status: string; category: string | null;
          grand_total_score: number | string | null; self_done: boolean;
          employee_sign_date: string | null;
        }[];
      };
    }
    apiGet<CyclesResponse>("/api/hris/performance/cycles")
      .then(async (res) => {
        const today = new Date().toISOString().slice(0, 10);
        const cycle =
          res.data.cycles.find((c) => c.start_date <= today && today <= c.end_date) ??
          res.data.cycles[0];
        if (!cycle) {
          setMyReview("none");
          return;
        }
        const rev = await apiGet<ReviewsResponse>(
          `/api/hris/performance/reviews?cycle_id=${cycle.id}`
        );
        const mine = rev.data.reviews.find((r) => r.employee_id === rev.data.my_employee_id);
        if (!mine) {
          setMyReview("none");
          return;
        }
        const grand = mine.grand_total_score === null ? null : Number(mine.grand_total_score);
        setMyReview({
          cycleName: cycle.name,
          grand: Number.isFinite(grand as number) && grand !== 0 ? grand : null,
          category: mine.category,
          status: mine.status,
          selfDone: mine.self_done,
          signed: mine.employee_sign_date !== null,
        });
      })
      .catch(() => setMyReview("none"));

    interface TasksResponse {
      data: { occurrences: { occurrence_date: string; status: string }[] };
    }
    const month = new Date().toISOString().slice(0, 7);
    apiGet<TasksResponse>(`/api/hris/dept-tasks?month=${month}`)
      .then((res) => {
        const today = new Date().toISOString().slice(0, 10);
        setTodayTasks(
          res.data.occurrences.filter(
            (o) => o.occurrence_date === today && (o.status === "pending" || o.status === "in_progress")
          ).length
        );
      })
      .catch(() => setTodayTasks(null));
  }, []);

  const historyQuery = useKpiHistory("me", 12);
  const rows = historyQuery.data?.data ?? [];
  const indicators = historyQuery.data?.indicators ?? [];
  const latest = rows[0] ?? null;
  const latestScore = latest ? num(latest.score) : null;

  const now = new Date();
  const teamQuery = useKpiTeam({
    period_year: now.getFullYear(),
    period_month: now.getMonth() + 1,
  });
  const teamRows = teamQuery.data?.data ?? [];
  const teamIndicators = teamQuery.data?.indicators ?? [];
  const rubricMutation = useSaveKpiRubric();

  async function saveTeamRubric() {
    if (!teamDetail || !rubricValue) {
      showToast("Pilih nilai rubrik 1-5", "error");
      return;
    }
    try {
      await rubricMutation.mutateAsync({
        employee_id: teamDetail.employee_id,
        period_month: teamDetail.period_month,
        period_year: teamDetail.period_year,
        value: Number(rubricValue),
        notes: rubricNotes || undefined,
      });
      setRubricValue("");
      setRubricNotes("");
      setTeamDetail(null);
      showToast("Penilaian tersimpan — skor diperbarui", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Gagal menyimpan penilaian",
        "error"
      );
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <ChartBarIcon className="h-6 w-6" /> KPI Saya
        </h1>
        <p className="text-sm text-muted-foreground">
          Skor kinerja bulanan Anda (0–100), dihitung dari data operasional +
          penilaian atasan — dan menjadi 60% nilai Performance Review kuartalan.
        </p>
      </div>

      {/* Sambungan kuartal berjalan → Performance Review & Task Departemen */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              KPI Kuartal Berjalan{quarterSummary ? ` — Q${quarterSummary.quarter} ${quarterSummary.year}` : ""}
            </p>
            {quarterSummary === null ? (
              <p className="mt-2 text-sm text-gray-400">Memuat…</p>
            ) : (
              <div className="mt-2 flex items-center gap-3">
                <span className={`text-3xl font-bold ${scoreCls(quarterSummary.avg)}`}>
                  {quarterSummary.avg === null ? "—" : quarterSummary.avg.toFixed(1)}
                </span>
                <div className="flex flex-1 gap-1.5">
                  {quarterSummary.monthScores.map((m) => (
                    <span key={m.month} className="flex-1 rounded-md bg-muted/60 px-1 py-1 text-center text-xs">
                      <span className="block text-[10px] text-gray-400">{MONTH_SHORT[m.month]}</span>
                      <span className={`font-semibold ${scoreCls(m.score)}`}>
                        {m.score === null ? "—" : m.score.toFixed(0)}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Link href="/dashboard/hris/performance" className="block">
          <Card className="h-full transition-colors hover:border-primary/40">
            <CardContent className="p-4">
              <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <DocumentCheckIcon className="h-4 w-4" /> Performance Review
              </p>
              {myReview === null ? (
                <p className="mt-2 text-sm text-gray-400">Memuat…</p>
              ) : myReview === "none" ? (
                <p className="mt-2 text-sm text-gray-500">
                  Siklus review belum dibuka HRD. Skor bulanan Anda otomatis
                  jadi bahan rapor saat siklus dibuka.
                </p>
              ) : (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-3xl font-bold ${scoreCls(myReview.grand)}`}>
                      {myReview.grand === null ? "—" : myReview.grand.toFixed(1)}
                    </span>
                    {myReview.category ? (
                      <Badge variant="outline">{myReview.category}</Badge>
                    ) : null}
                    <Badge variant={myReview.status === "final" ? "default" : "outline"}>
                      {myReview.status === "final" ? "Final" : "Draft"}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-500">
                    {myReview.cycleName}
                    {!myReview.selfDone && myReview.status !== "final"
                      ? " · self assessment belum diisi — tap untuk mengisi"
                      : !myReview.signed
                        ? " · belum ditandatangani — tap untuk tanda tangan"
                        : " · lengkap"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/hris/dept-tasks" className="block">
          <Card className="h-full transition-colors hover:border-primary/40">
            <CardContent className="p-4">
              <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <ClipboardDocumentCheckIcon className="h-4 w-4" /> Task Departemen
              </p>
              {todayTasks === null ? (
                <p className="mt-2 text-sm text-gray-400">Memuat…</p>
              ) : todayTasks === 0 ? (
                <p className="mt-2 text-sm text-emerald-600">
                  Semua tugas hari ini beres ✓
                </p>
              ) : (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-3xl font-bold text-amber-600">{todayTasks}</span>
                  <p className="text-sm text-gray-600">
                    tugas hari ini menunggu diceklis — ikut dihitung ke KPI Anda
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </Link>
      </div>

      {historyQuery.isLoading && <SkeletonCard />}

      {!historyQuery.isLoading && rows.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Belum ada scorecard KPI untuk akun Anda.
          </CardContent>
        </Card>
      )}

      {latest && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Skor Terakhir — {periodLabel(latest)}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-6">
            <span className="text-5xl font-bold">
              {latestScore === null ? "—" : latestScore.toLocaleString("id-ID")}
            </span>
            <div className="space-y-1">
              <Badge
                variant="outline"
                className={
                  latest.status === "final"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-gray-200 bg-gray-100 text-gray-700"
                }
              >
                {latest.status === "final" ? "Final" : "Draft"}
              </Badge>
              <p className="text-xs text-muted-foreground">
                {latestScore === null
                  ? "Belum ada data terkumpul periode ini."
                  : "Klik riwayat di bawah untuk rincian per indikator."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Riwayat 12 Bulan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {rows.map((row) => {
              const score = num(row.score);
              return (
                <button
                  key={row.id}
                  onClick={() => setDetail(row)}
                  className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition hover:bg-muted/40"
                >
                  <span className="font-medium">{periodLabel(row)}</span>
                  <span className="flex items-center gap-3">
                    <span className="h-2 w-32 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-2 rounded-full bg-emerald-500"
                        style={{ width: `${Math.min(100, score ?? 0)}%` }}
                      />
                    </span>
                    <span className="w-12 text-right font-semibold">
                      {score === null ? "—" : score.toLocaleString("id-ID")}
                    </span>
                  </span>
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}

      {teamRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersIcon className="h-4 w-4" /> Tim Saya — Penilaian Bulan Ini
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Sebagai atasan langsung, Anda menilai rubrik (1–5) anggota tim.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {teamRows.map((row) => {
              const score = num(row.score);
              return (
                <button
                  key={row.id}
                  onClick={() => setTeamDetail(row)}
                  className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition hover:bg-muted/40"
                >
                  <span>
                    <span className="font-medium">
                      {row.employee?.full_name ?? "-"}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {row.employee?.department?.name ?? ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
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
                    <span className="w-12 text-right font-semibold">
                      {score === null ? "—" : score.toLocaleString("id-ID")}
                    </span>
                  </span>
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>KPI {detail ? periodLabel(detail) : ""}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <ScorecardBreakdown scorecard={detail} indicators={indicators} />
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setDetail(null)}>
                  Tutup
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!teamDetail}
        onOpenChange={(open) => !open && setTeamDetail(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {teamDetail?.employee?.full_name} —{" "}
              {teamDetail ? periodLabel(teamDetail) : ""}
            </DialogTitle>
          </DialogHeader>
          {teamDetail && (
            <div className="space-y-4">
              <ScorecardBreakdown
                scorecard={teamDetail}
                indicators={teamIndicators}
              />
              {teamDetail.status === "draft" ? (
                <div className="space-y-2 border-t pt-4">
                  <Label>Penilaian Anda (rubrik 1–5)</Label>
                  <div className="flex gap-2">
                    <Select value={rubricValue} onValueChange={setRubricValue}>
                      <SelectTrigger className="w-24">
                        <SelectValue placeholder="Nilai" />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5].map((value) => (
                          <SelectItem key={value} value={String(value)}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      onClick={saveTeamRubric}
                      disabled={rubricMutation.isPending}
                    >
                      {rubricMutation.isPending ? "Menyimpan..." : "Simpan Penilaian"}
                    </Button>
                  </div>
                  <Textarea
                    value={rubricNotes}
                    onChange={(event) => setRubricNotes(event.target.value)}
                    placeholder="Catatan penilaian (opsional)"
                  />
                </div>
              ) : (
                <p className="border-t pt-4 text-xs text-muted-foreground">
                  Scorecard sudah final — penilaian tidak bisa diubah.
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}
