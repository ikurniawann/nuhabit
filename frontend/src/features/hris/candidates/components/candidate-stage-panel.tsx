"use client";

import { RotateCcw, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PromoteCandidateButton } from "@/components/hris/PromoteCandidateButton";
import type { PipelineStage } from "@/types";
import { AppliedActionPanel } from "@/features/hris/pipeline/components/applied-action-panel";
import { ScreeningActionPanel } from "@/features/hris/pipeline/components/screening-action-panel";
import { PsikotesActionPanel } from "@/features/hris/pipeline/components/psikotes-action-panel";
import { InterviewActionPanel } from "@/features/hris/pipeline/components/interview-action-panel";
import { OfferActionPanel } from "@/features/hris/pipeline/components/offer-action-panel";
import type { CandidateView } from "../types";

interface CandidateStagePanelProps {
  candidate: CandidateView;
  status: PipelineStage;
  moving: boolean;
  onMove: (status: PipelineStage) => void;
  onPromoted: () => void;
}

/** Panel aksi sesuai tahap kandidat saat ini. */
export function CandidateStagePanel({ candidate, status, moving, onMove, onPromoted }: CandidateStagePanelProps) {
  const panelProps = { candidate, onMove, moving };

  switch (status) {
    case "applied":
      return <AppliedActionPanel candidate={candidate} showNotes={false} />;
    case "screening":
      return <ScreeningActionPanel key={candidate.id} {...panelProps} />;
    case "psikotes":
      return <PsikotesActionPanel key={candidate.id} {...panelProps} />;
    case "interview":
      return <InterviewActionPanel key={candidate.id} {...panelProps} />;
    case "offer":
      return <OfferActionPanel key={candidate.id} {...panelProps} />;
    case "hired":
      return (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5">
          <div className="flex items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <UserCheck className="size-5" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-emerald-800">Kandidat diterima 🎉</h3>
              {candidate.promoted_to_employee_id ? (
                <p className="mt-1 text-sm text-emerald-700">Sudah dipromosikan menjadi karyawan.</p>
              ) : (
                <>
                  <p className="mt-1 text-sm text-emerald-700">
                    Langkah berikutnya: promosikan menjadi karyawan agar masuk ke HRIS (onboarding, payroll, absensi).
                  </p>
                  <div className="mt-3">
                    <PromoteCandidateButton candidate={candidate} onSuccess={onPromoted} />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      );
    case "talent_pool":
    case "rejected": {
      const pool = status === "talent_pool";
      return (
        <div className={`rounded-xl border p-5 ${pool ? "border-pink-200 bg-pink-50/50" : "border-red-200 bg-red-50/50"}`}>
          <h3 className={`text-sm font-semibold ${pool ? "text-pink-800" : "text-red-800"}`}>
            {pool ? "Kandidat disimpan di Talent Pool" : "Kandidat ditolak"}
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            {pool
              ? "Kandidat potensial untuk kebutuhan mendatang. Bisa dikembalikan ke pipeline kapan saja."
              : "Kandidat tidak dilanjutkan. Bisa dibuka kembali bila dibutuhkan."}
          </p>
          <Button size="sm" variant="outline" className="mt-3" disabled={moving} onClick={() => onMove("applied")}>
            <RotateCcw className="size-3.5" /> Kembalikan ke Pipeline (Applied)
          </Button>
          {pool && !candidate.promoted_to_employee_id && (
            <div className="mt-3">
              <PromoteCandidateButton candidate={candidate} onSuccess={onPromoted} />
            </div>
          )}
        </div>
      );
    }
    default:
      return null;
  }
}
