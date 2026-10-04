"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Briefcase, ExternalLink, Mail, Phone } from "lucide-react";
import type { PipelineStage } from "@/types";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { initials, neighbourStages, stageMeta } from "@/lib/recruitment/pipeline-board";
import { AppliedActionPanel } from "./applied-action-panel";
import { ScreeningActionPanel } from "./screening-action-panel";
import { PsikotesActionPanel } from "./psikotes-action-panel";
import { InterviewActionPanel } from "./interview-action-panel";
import { OfferActionPanel } from "./offer-action-panel";
import { StageStepper } from "./stage-stepper";
import type { PipelineCandidate } from "./pipeline-board";

function StagePanel({
  candidate,
  onMove,
  moving,
}: {
  candidate: PipelineCandidate;
  onMove: (status: PipelineStage) => void;
  moving: boolean;
}) {
  const props = { candidate, onMove, moving };
  switch (candidate.status) {
    case "applied":
      return <AppliedActionPanel candidate={candidate} />;
    case "screening":
      return <ScreeningActionPanel key={candidate.id} {...props} />;
    case "psikotes":
      return <PsikotesActionPanel key={candidate.id} {...props} />;
    case "interview":
      return <InterviewActionPanel key={candidate.id} {...props} />;
    case "offer":
      return <OfferActionPanel key={candidate.id} {...props} />;
    default:
      return (
        <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
          <p className="text-sm text-gray-500">
            Action untuk tahap <b>{stageMeta(candidate.status)?.label ?? candidate.status}</b> menyusul.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Saat ini action panel tersedia untuk tahap Applied, Screening, Psikotes &amp; Interview.
          </p>
        </div>
      );
  }
}

/** Drawer detail kandidat: header, progres + navigasi tahap, panel aksi per tahap. */
export function PipelineCandidateSheet({
  candidate,
  open,
  onOpenChange,
  onMove,
  moving,
}: {
  candidate: PipelineCandidate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (status: PipelineStage) => void;
  moving: boolean;
}) {
  const current = candidate ? stageMeta(candidate.status) : null;
  const { prev, next } = neighbourStages(candidate?.status ?? "");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 data-[side=right]:sm:max-w-3xl">
        {candidate && (
          <>
            <SheetHeader className="border-b border-gray-100 p-5 pb-4">
              <div className="flex items-start gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                  {initials(candidate.full_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate text-base">{candidate.full_name}</SheetTitle>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Briefcase className="size-3" />
                      {candidate.positions?.title ?? "Posisi belum diisi"}
                    </span>
                    {candidate.brands?.name && <span>{candidate.brands.name}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                    {candidate.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="size-3" /> {candidate.email}
                      </span>
                    )}
                    {candidate.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="size-3" /> {candidate.phone}
                      </span>
                    )}
                  </div>
                </div>
                {current && (
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${current.badge}`}>
                    {current.label}
                  </span>
                )}
              </div>
            </SheetHeader>

            <div className="space-y-5 p-5">
              <div className="rounded-xl border border-gray-200 p-4">
                <h4 className="mb-3 text-sm font-semibold text-gray-800">Progres Pipeline</h4>
                <StageStepper status={candidate.status as PipelineStage} onMove={onMove} />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {prev && (
                    <Button size="sm" variant="outline" onClick={() => onMove(prev)}>
                      <ArrowLeft className="size-3.5" />
                      {stageMeta(prev)?.label}
                    </Button>
                  )}
                  {next && (
                    <Button size="sm" onClick={() => onMove(next)}>
                      {stageMeta(next)?.label}
                      <ArrowRight className="size-3.5" />
                    </Button>
                  )}
                  <div className="ml-auto flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-pink-600 hover:bg-pink-50"
                      onClick={() => onMove("talent_pool")}
                      disabled={candidate.status === "talent_pool"}
                    >
                      Talent Pool
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 hover:bg-red-50"
                      onClick={() => onMove("rejected")}
                      disabled={candidate.status === "rejected"}
                    >
                      Tolak
                    </Button>
                  </div>
                </div>
              </div>

              <StagePanel candidate={candidate} onMove={onMove} moving={moving} />

              <Link
                href={`/dashboard/hris/candidates/${candidate.id}`}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                Buka profil lengkap kandidat <ExternalLink className="size-3.5" />
              </Link>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
