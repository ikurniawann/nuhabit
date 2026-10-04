"use client";

import { useState } from "react";
import { BotMessageSquare, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { interviewChecklist } from "@/lib/recruitment/pipeline-stage-rules";
import { INTERVIEW_WA_TEMPLATES } from "@/lib/recruitment/pipeline-wa-templates";
import { useCandidateInterview } from "../queries";
import type { InterviewAiSession } from "../types";
import { InterviewSendDialog } from "./interview-send-dialog";
import { InterviewProctorDialog } from "./proctor-evidence-dialog";
import { AiSummaryCard, RecordingsSection, TranscriptSection } from "./interview-session-details";
import {
  DecisionCard,
  InviteSessionMeta,
  PanelError,
  PanelLoading,
  StepChecklistCard,
  WaTemplateCard,
  copyPortalLink,
  positionTitleOf,
  type StagePanelProps,
} from "./stage-panel-parts";

const SESSION_STATUS_LABELS: Record<InterviewAiSession["status"], string> = {
  sent: "Terkirim",
  in_progress: "Sedang berlangsung",
  completed: "Selesai",
  expired: "Kedaluwarsa",
};

/**
 * Action panel tahap Interview (EPIC-003): checklist otomatis, undangan
 * interview AI & hasil per sesi (kesimpulan AI, transkrip, rekaman,
 * proctoring), template WA, keputusan (Lolos → Offer / Talent Pool / Tolak).
 */
export function InterviewActionPanel({ candidate, onMove, moving = false }: StagePanelProps) {
  const interviewQuery = useCandidateInterview(candidate.id);
  const [sendOpen, setSendOpen] = useState(false);
  const [proctorSession, setProctorSession] = useState<InterviewAiSession | null>(null);

  const sessions = interviewQuery.data?.sessions ?? [];
  const hasCompleted = sessions.some((s) => s.status === "completed");
  const positionTitle = positionTitleOf(candidate);

  if (interviewQuery.isLoading) return <PanelLoading />;
  if (interviewQuery.isError) {
    return (
      <PanelError
        error={interviewQuery.error}
        fallback="Gagal memuat data interview"
        onRetry={() => interviewQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <StepChecklistCard
        icon={<BotMessageSquare className="size-4 text-violet-500" />}
        title="Interview AI"
        items={interviewChecklist(sessions)}
      />

      <div className="rounded-xl border border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">Hasil Interview</h4>
          <Button size="sm" variant="outline" onClick={() => setSendOpen(true)}>
            <Plus className="size-3.5" /> Kirim undangan
          </Button>
        </div>

        {sessions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            Belum ada undangan interview. Kirim undangan untuk memulai interview AI (suara, wajib
            on-cam).
          </p>
        ) : (
          <div className="space-y-4">
            {sessions.map((session) => {
              const { token } = session;
              const active = session.status === "sent" || session.status === "in_progress";
              return (
                <div key={session.id} className="space-y-2">
                  <InviteSessionMeta
                    statusLabel={SESSION_STATUS_LABELS[session.status]}
                    live={session.status === "in_progress"}
                    invitedAt={session.invited_at}
                    createdByName={session.created_by_name}
                    proctor={session.proctor}
                    onOpenProctor={() => setProctorSession(session)}
                    onCopyLink={
                      token && active
                        ? () => copyPortalLink(`/interview/${token}`, "Link interview disalin")
                        : undefined
                    }
                  />
                  {session.status === "completed" && <AiSummaryCard session={session} />}
                  <TranscriptSection session={session} />
                  {(session.status === "completed" || session.status === "in_progress") && (
                    <RecordingsSection sessionId={session.id} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <WaTemplateCard
        candidate={candidate}
        positionTitle={positionTitle}
        templates={INTERVIEW_WA_TEMPLATES}
        description="Membuka WhatsApp dengan pesan terisi — pembukaan tercatat di timeline Aktivitas."
      />

      <DecisionCard
        onMove={onMove}
        moving={moving}
        next={{
          stage: "offer",
          label: "Lolos → Offer",
          enabled: hasCompleted,
          lockedHint: 'Tombol "Lolos → Offer" aktif setelah minimal satu sesi interview selesai.',
        }}
      />

      {sendOpen && (
        <InterviewSendDialog candidate={candidate} positionTitle={positionTitle} open onOpenChange={setSendOpen} />
      )}
      {proctorSession && (
        <InterviewProctorDialog
          key={proctorSession.id}
          session={proctorSession}
          open
          onOpenChange={(open) => !open && setProctorSession(null)}
        />
      )}
    </div>
  );
}
