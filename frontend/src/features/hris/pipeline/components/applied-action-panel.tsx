"use client";

import { appliedChecklist } from "@/lib/recruitment/pipeline-stage-rules";
import { useCandidateAiAnalysis, useCandidateNotes } from "../queries";
import { CvAnalysisCard, CvPreviewCard } from "./cv-analysis-cards";
import { HrNotesCard } from "./hr-notes-card";
import { ProgressChecklistCard } from "./stage-panel-parts";

/** Field minimal yang dibutuhkan panel: kompatibel dgn Candidate & CandidateView. */
interface AppliedPanelCandidate {
  id: string;
  cv_url?: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * Action panel tahap Applied: checklist kelengkapan (dihitung dari data),
 * preview CV, analisis CV oleh AI, catatan internal HR.
 */
export function AppliedActionPanel({
  candidate,
  showNotes = true,
}: {
  candidate: AppliedPanelCandidate;
  showNotes?: boolean;
}) {
  const analysisQuery = useCandidateAiAnalysis(candidate.id);
  const notesQuery = useCandidateNotes(candidate.id);
  const notes = notesQuery.data ?? [];

  return (
    <div className="space-y-5">
      <ProgressChecklistCard
        title="Checklist Applied"
        barClassName="bg-emerald-500"
        items={appliedChecklist({
          cvUrl: candidate.cv_url,
          email: candidate.email,
          phone: candidate.phone,
          hasAnalysis: Boolean(analysisQuery.data),
          noteCount: notes.length,
        })}
      />
      <CvPreviewCard cvUrl={candidate.cv_url} />
      <CvAnalysisCard
        candidateId={candidate.id}
        hasCv={Boolean(candidate.cv_url)}
        analysis={analysisQuery.data}
        loading={analysisQuery.isLoading}
      />
      {showNotes && (
        <HrNotesCard
          key={candidate.id}
          candidateId={candidate.id}
          notes={notes}
          loading={notesQuery.isLoading}
        />
      )}
    </div>
  );
}
