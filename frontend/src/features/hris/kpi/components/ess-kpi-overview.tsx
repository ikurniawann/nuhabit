"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ClipboardDocumentCheckIcon, DocumentCheckIcon } from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { currentMonthWib } from "@/lib/hris/attendance-calendar";
import {
  countPendingToday,
  formatScore,
  pickCurrentCycle,
  scoreToneClass,
  summarizeMyQuarter,
  summarizeMyReview,
} from "@/lib/kpi/ui-performance";
import { todayWib } from "@/lib/dates";
import { useDeptTasks, usePerfCycles, usePerfRealtime, usePerfReviews } from "../queries";
import { MonthScoreChip } from "./performance-shared";

/**
 * Ringkasan kuartal berjalan + review + task hari ini (owner 2026-08-31):
 * menyambungkan KPI Saya dengan Performance Review & Task Departemen.
 */
export function EssKpiOverview() {
  const todayIso = useMemo(() => todayWib(), []);

  const realtime = usePerfRealtime();
  const quarter = realtime.data ? summarizeMyQuarter(realtime.data) : null;

  const cyclesQuery = usePerfCycles();
  const cycle = cyclesQuery.data ? pickCurrentCycle(cyclesQuery.data.cycles, todayIso) : undefined;
  const reviewsQuery = usePerfReviews(cycle?.id ?? "");
  const reviewsDone = cyclesQuery.isError || (cyclesQuery.isSuccess && !cycle) || reviewsQuery.isError;
  const myReview =
    cycle && reviewsQuery.data ? summarizeMyReview(cycle.name, reviewsQuery.data) : null;
  const reviewLoading = !reviewsDone && !reviewsQuery.data;

  const tasksQuery = useDeptTasks(currentMonthWib(), "");
  const todayTasks = tasksQuery.data ? countPendingToday(tasksQuery.data.occurrences, todayIso) : null;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            KPI Kuartal Berjalan{quarter?.quarter ? ` — Q${quarter.quarter} ${quarter.year}` : ""}
          </p>
          {quarter === null ? (
            <p className="mt-2 text-sm text-gray-400">Memuat…</p>
          ) : (
            <div className="mt-2 flex items-center gap-3">
              <span className={`text-3xl font-bold ${scoreToneClass(quarter.avg)}`}>
                {formatScore(quarter.avg, 1)}
              </span>
              <div className="flex flex-1 gap-1.5">
                {quarter.monthScores.map((m) => (
                  <MonthScoreChip key={m.month} month={m.month} score={m.score} />
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
            {reviewLoading ? (
              <p className="mt-2 text-sm text-gray-400">Memuat…</p>
            ) : !myReview ? (
              <p className="mt-2 text-sm text-gray-500">
                Siklus review belum dibuka HRD. Skor bulanan Anda otomatis
                jadi bahan rapor saat siklus dibuka.
              </p>
            ) : (
              <div className="mt-2 space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`text-3xl font-bold ${scoreToneClass(myReview.grand)}`}>
                    {formatScore(myReview.grand, 1)}
                  </span>
                  {myReview.category ? <Badge variant="outline">{myReview.category}</Badge> : null}
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
              <p className="mt-2 text-sm text-emerald-600">Semua tugas hari ini beres ✓</p>
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
  );
}
