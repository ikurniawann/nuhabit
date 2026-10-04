"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatScore, scoreToneClass, toScore } from "@/lib/kpi/ui-performance";
import { usePerfCycles, usePerfReviews } from "../queries";
import { useCreatePerfCycle } from "../mutations";
import { CategoryBadge, PerfLoadingCard } from "./performance-shared";

interface PerformanceCyclesTabProps {
  yearOptions: number[];
  onOpenReview: (reviewId: string) => void;
}

/** Tab "Siklus Review": pilih siklus kuartal, buka siklus baru (HRD), daftar review. */
export function PerformanceCyclesTab({ yearOptions, onOpenReview }: PerformanceCyclesTabProps) {
  const cyclesQuery = usePerfCycles();
  const cycles = cyclesQuery.data ?? null;
  const [selectedCycle, setSelectedCycle] = useState("");
  // Default: siklus terbaru sampai pengguna memilih yang lain.
  const activeCycle = selectedCycle || cycles?.cycles[0]?.id || "";
  const reviewsQuery = usePerfReviews(activeCycle);
  const reviews = reviewsQuery.data ?? null;
  const [createOpen, setCreateOpen] = useState(false);
  const createCycle = useCreatePerfCycle();

  function handleCreate(year: number, quarter: number) {
    createCycle.mutate(
      { year, quarter },
      {
        onSuccess: (res) => {
          toast.success(res.message ?? "Siklus dibuka");
          setCreateOpen(false);
        },
        onError: (err) => toast.error(err.message || "Gagal membuka siklus"),
      }
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {(cycles?.cycles ?? []).map((c) => (
          <Button
            key={c.id}
            size="sm"
            variant={c.id === activeCycle ? "default" : "outline"}
            onClick={() => setSelectedCycle(c.id)}
          >
            {c.name}
            <span className="ml-1 text-xs opacity-70">
              {c.final_reviews}/{c.total_reviews} final
            </span>
          </Button>
        ))}
        {cycles?.is_hr ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />Buka Siklus
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>Buka Siklus Review</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-gray-500">
                  Sistem akan membuat draft review untuk semua karyawan aktif,
                  terisi otomatis rata-rata KPI kuartal tersebut.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {yearOptions.map((y) =>
                    [1, 2, 3, 4].map((q) => (
                      <Button
                        key={`${y}-${q}`}
                        variant="outline"
                        disabled={createCycle.isPending}
                        onClick={() => handleCreate(y, q)}
                      >
                        Q{q} {y}
                      </Button>
                    ))
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </>
        ) : null}
      </div>

      {cyclesQuery.error ? (
        <PerfLoadingCard error={cyclesQuery.error.message || "Gagal memuat siklus"} />
      ) : null}

      {cycles !== null && cycles.cycles.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-gray-500">
          Belum ada siklus review.{" "}
          {cycles.is_hr ? "Klik “Buka Siklus” untuk memulai." : "HRD belum membuka siklus."}
        </p>
      ) : null}

      {activeCycle ? (
        reviews === null ? (
          <PerfLoadingCard
            error={reviewsQuery.error ? reviewsQuery.error.message || "Gagal memuat review" : null}
          />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {reviews.reviews.map((r) => {
              const grand = toScore(r.grand_total_score);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onOpenReview(r.id)}
                  className="rounded-xl border-2 border-gray-200 bg-white p-4 text-left transition-colors hover:border-primary/40 active:bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{r.full_name}</p>
                      <p className="truncate text-xs text-gray-500">{r.department_name ?? "—"}</p>
                    </div>
                    <p className={`text-xl font-bold ${scoreToneClass(grand)}`}>
                      {formatScore(grand, 1, true)}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <CategoryBadge category={r.category} />
                    <Badge variant={r.status === "final" ? "default" : "outline"}>
                      {r.status === "final" ? "Final" : "Draft"}
                    </Badge>
                    <span className="text-xs text-gray-400">
                      Perilaku {r.rated_items}/{r.total_items}
                    </span>
                    {r.employee_sign_date ? (
                      <span className="text-xs text-emerald-600">✓ ttd karyawan</span>
                    ) : null}
                    {r.reviewer_sign_date ? (
                      <span className="text-xs text-emerald-600">✓ ttd reviewer</span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : null}
    </>
  );
}
