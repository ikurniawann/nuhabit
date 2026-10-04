"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatScore, scoreToneClass, toScore } from "@/lib/kpi/ui-performance";
import { usePerfReview } from "../queries";
import { usePatchPerfReview } from "../mutations";
import type { PerfReviewDetail, PerfReviewPatch } from "../types";
import { CategoryBadge, MonthScoreChip } from "./performance-shared";

/** Dialog detail review: nilai, KPI per bulan, penilaian perilaku 1–5, catatan, ttd. */
export function PerformanceReviewDialog({ reviewId, onClose }: { reviewId: string | null; onClose: () => void }) {
  const { data: detail } = usePerfReview(reviewId);
  return (
    <Dialog open={reviewId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        {!detail || detail.review.id !== reviewId ? (
          <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
          </div>
        ) : (
          // key per review: draft teks mulai dari nilai tersimpan review ini.
          <ReviewBody key={detail.review.id} detail={detail} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReviewBody({ detail }: { detail: PerfReviewDetail }) {
  const { review } = detail;
  const [selfDraft, setSelfDraft] = useState(review.self_assessment ?? "");
  const [notesDraft, setNotesDraft] = useState(review.reviewer_notes ?? "");
  const patch = usePatchPerfReview();
  const busy = patch.isPending;
  const editable = review.status !== "final";

  function save(payload: PerfReviewPatch) {
    if (busy) return;
    patch.mutate(
      { id: review.id, payload },
      {
        onSuccess: (res) => toast.success(res.message ?? "Tersimpan"),
        onError: (err) => toast.error(err.message || "Gagal menyimpan"),
      }
    );
  }

  const summary = [
    { label: "Hasil Kerja (60%)", value: toScore(review.total_work_result_score) },
    { label: "Perilaku (30%)", value: toScore(review.total_behavioral_score) },
    { label: "Kontribusi (10%)", value: toScore(review.total_project_score) },
    { label: "Nilai Akhir", value: toScore(review.grand_total_score) },
  ];

  return (
    <div className="space-y-5">
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          {review.full_name}
          <CategoryBadge category={review.category} />
          <Badge variant={review.status === "final" ? "default" : "outline"}>
            {review.status === "final" ? "Final" : "Draft"}
          </Badge>
        </DialogTitle>
      </DialogHeader>
      <p className="-mt-3 text-sm text-gray-500">
        {review.cycle_name} · {review.department_name ?? "—"}
      </p>

      {/* Ringkasan nilai */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {summary.map((cell) => (
          <div key={cell.label} className="rounded-lg bg-muted/50 p-3 text-center">
            <p className={`text-lg font-bold ${scoreToneClass(cell.value === 0 ? null : cell.value)}`}>
              {formatScore(cell.value, 1, true)}
            </p>
            <p className="text-[11px] text-gray-500">{cell.label}</p>
          </div>
        ))}
      </div>

      {/* KPI per bulan */}
      <div>
        <p className="mb-1 text-sm font-semibold text-gray-700">Hasil Kerja — KPI per bulan</p>
        <div className="flex gap-2">
          {detail.kpi_months.length === 0 ? (
            <p className="text-xs text-gray-400">Belum ada scorecard KPI pada kuartal ini.</p>
          ) : (
            detail.kpi_months.map((m) => (
              <MonthScoreChip key={m.period_month} month={m.period_month} score={m.score} />
            ))
          )}
        </div>
      </div>

      {/* Penilaian perilaku: kartu sentuh 1–5 */}
      <div>
        <p className="mb-1 text-sm font-semibold text-gray-700">
          Perilaku Kerja {detail.can_rate && editable ? "— tap 1–5 untuk menilai" : ""}
        </p>
        <div className="space-y-2">
          {detail.items.map((item) => (
            <div key={item.id} className="rounded-xl border-2 border-gray-200 bg-white p-3">
              <p className="text-sm font-medium text-gray-800">{item.value_name}</p>
              {item.behavioral_standard ? (
                <p className="text-xs text-gray-500">{item.behavioral_standard}</p>
              ) : null}
              <div className="mt-2 flex gap-2">
                {[1, 2, 3, 4, 5].map((s) => {
                  const active = item.score === s;
                  const canTap = detail.can_rate && editable && !busy;
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={!canTap}
                      onClick={() => save({ action: "rate_item", item_id: item.id, score: s })}
                      className={`flex h-11 flex-1 items-center justify-center rounded-lg border-2 text-sm font-semibold transition-colors ${
                        active
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-gray-200 bg-white text-gray-600 active:bg-gray-50"
                      } ${canTap ? "" : "opacity-60"}`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Self assessment */}
      <div>
        <p className="mb-1 text-sm font-semibold text-gray-700">Self Assessment (karyawan)</p>
        {detail.is_owner && editable ? (
          <div className="space-y-2">
            <Textarea
              value={selfDraft}
              onChange={(e) => setSelfDraft(e.target.value)}
              placeholder="Refleksi kinerja kuartal ini: pencapaian, kendala, rencana perbaikan…"
              rows={3}
            />
            <Button size="sm" disabled={busy} onClick={() => save({ action: "self_assessment", text: selfDraft })}>
              Simpan Self Assessment
            </Button>
          </div>
        ) : (
          <p className="rounded-lg bg-muted/50 p-3 text-sm text-gray-600">
            {review.self_assessment || "Belum diisi."}
          </p>
        )}
      </div>

      {/* Catatan reviewer */}
      <div>
        <p className="mb-1 text-sm font-semibold text-gray-700">
          Catatan Reviewer{review.reviewer_name ? ` — ${review.reviewer_name}` : ""}
        </p>
        {detail.can_rate && editable ? (
          <div className="space-y-2">
            <Textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="Catatan pembinaan, apresiasi, atau kontribusi khusus…"
              rows={3}
            />
            <Button size="sm" disabled={busy} onClick={() => save({ action: "reviewer_notes", text: notesDraft })}>
              Simpan Catatan
            </Button>
          </div>
        ) : (
          <p className="rounded-lg bg-muted/50 p-3 text-sm text-gray-600">
            {review.reviewer_notes || "Belum diisi."}
          </p>
        )}
      </div>

      {/* Tanda tangan & finalisasi */}
      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        {detail.is_owner && !review.employee_sign_date ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => save({ action: "sign" })}>
            Tanda Tangan (Karyawan)
          </Button>
        ) : null}
        {detail.can_rate && !review.reviewer_sign_date ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => save({ action: "sign" })}>
            Tanda Tangan (Reviewer)
          </Button>
        ) : null}
        {review.employee_sign_date ? (
          <span className="text-xs text-emerald-600">✓ Karyawan ttd {review.employee_sign_date}</span>
        ) : null}
        {review.reviewer_sign_date ? (
          <span className="text-xs text-emerald-600">✓ Reviewer ttd {review.reviewer_sign_date}</span>
        ) : null}
        {detail.can_finalize && editable ? (
          <Button size="sm" className="ml-auto" disabled={busy} onClick={() => save({ action: "finalize" })}>
            Finalkan (HRD)
          </Button>
        ) : null}
      </div>
    </div>
  );
}
