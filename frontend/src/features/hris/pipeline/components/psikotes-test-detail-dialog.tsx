"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import { useReviewPsikotesTest } from "../mutations";
import type { PsikotesSessionTest } from "../types";
import { PSIKOTES_TEST_STATUS } from "./psikotes-status";
import { McqResult, PapiResult } from "./psikotes-test-results";
import { DrawingInsightPanel } from "./drawing-insight-panel";

interface PsikotesTestDetailDialogProps {
  test: PsikotesSessionTest;
  candidateId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Detail hasil satu instrumen:
 * - MCQ: skor + rincian benar/salah per soal.
 * - PAPI: skala dominan + tabel 20 skala.
 * - Gambar: preview (storage private via /api/psikotes/files) + insight AI
 *   + form review manual (kesimpulan → status reviewed, reviewer terekam).
 */
export function PsikotesTestDetailDialog({ test, candidateId, open, onOpenChange }: PsikotesTestDetailDialogProps) {
  const review = useReviewPsikotesTest();
  const [reviewNotes, setReviewNotes] = useState(test.review_notes ?? "");

  const statusMeta = PSIKOTES_TEST_STATUS[test.status];
  const reviewable = test.status === "perlu_review" || test.status === "reviewed";
  // rincian soal+jawaban hanya utk MCQ & PAPI yang sudah dikerjakan
  const answersTestId = test.status === "selesai" ? test.id : null;

  const handleReview = () => {
    if (!reviewNotes.trim()) {
      toast.error("Tulis kesimpulan review terlebih dahulu");
      return;
    }
    review.mutate(
      { testId: test.id, candidateId, reviewNotes: reviewNotes.trim() },
      {
        onSuccess: () => {
          toast.success("Review tersimpan");
          onOpenChange(false);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal menyimpan review"),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>{test.instrument_name}</DialogPanelTitle>
          <DialogPanelDescription>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusMeta.badge}`}>
              {statusMeta.label}
            </span>
            {test.completed_at && ` · selesai ${formatDateTime(test.completed_at)}`}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {test.instrument_kind === "mcq" && test.score_detail && (
            <McqResult answersTestId={answersTestId} score={test.score} detail={test.score_detail} />
          )}

          {test.instrument_kind === "forced_choice" && test.score_detail && (
            <PapiResult answersTestId={answersTestId} detail={test.score_detail} />
          )}

          {test.instrument_kind === "drawing" && (
            <>
              {test.attachment_path ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/psikotes/files/${test.attachment_path}`}
                  alt={`Hasil ${test.instrument_name}`}
                  className="max-h-96 w-full rounded-lg border border-border object-contain"
                />
              ) : (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  Kandidat tidak mengunggah gambar (waktu habis).
                </p>
              )}
              {reviewable && (
                <DrawingInsightPanel testId={test.id} candidateId={candidateId} existing={test.ai_insight} />
              )}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Kesimpulan Review Manual</Label>
                <Textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Contoh: Gambar menunjukkan stabilitas dan keterbukaan terhadap pengalaman baru…"
                />
                {test.status === "reviewed" && test.reviewed_by_name && (
                  <p className="text-xs text-muted-foreground">Direview oleh {test.reviewed_by_name}</p>
                )}
              </div>
            </>
          )}
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
          {test.instrument_kind === "drawing" && reviewable && (
            <Button type="button" onClick={handleReview} disabled={review.isPending}>
              {review.isPending && <Loader2 className="size-4 animate-spin" />}
              {test.status === "reviewed" ? "Perbarui Review" : "Tandai Sudah Direview"}
            </Button>
          )}
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
