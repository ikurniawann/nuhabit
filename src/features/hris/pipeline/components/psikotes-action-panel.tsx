"use client";

import { useState } from "react";
import { BrainCircuit, Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { psikotesChecklist } from "@/lib/recruitment/pipeline-stage-rules";
import { PSIKOTES_WA_TEMPLATES } from "@/lib/recruitment/pipeline-wa-templates";
import { useCandidatePsikotes } from "../queries";
import { useSavePsikotesSummary } from "../mutations";
import type { PsikotesSession, PsikotesSummaryPayload } from "../types";
import { PsikotesSendDialog } from "./psikotes-send-dialog";
import { PsikotesTestDetailDialog } from "./psikotes-test-detail-dialog";
import { PsikotesProctorDialog } from "./proctor-evidence-dialog";
import { PsikotesSessionList } from "./psikotes-session-list";
import {
  DecisionCard,
  PanelError,
  PanelLoading,
  RecommendationPicker,
  SavedStamp,
  StepChecklistCard,
  WaTemplateCard,
  positionTitleOf,
  type StagePanelProps,
} from "./stage-panel-parts";

/**
 * Action panel tahap Psikotes (EPIC-002 TG4): checklist otomatis, kirim tes
 * & kartu hasil per instrumen, rekomendasi (gate keputusan), template WA.
 * Render dgn `key={candidate.id}` supaya draft reset saat ganti kandidat.
 */
export function PsikotesActionPanel({ candidate, onMove, moving = false }: StagePanelProps) {
  const psikotesQuery = useCandidatePsikotes(candidate.id);
  const saveSummary = useSavePsikotesSummary();

  const [sendOpen, setSendOpen] = useState(false);
  const [detailTestId, setDetailTestId] = useState<string | null>(null);
  const [proctorSession, setProctorSession] = useState<PsikotesSession | null>(null);
  const [override, setOverride] = useState<Partial<PsikotesSummaryPayload>>({});

  const summary = psikotesQuery.data?.summary ?? null;
  const sessions = psikotesQuery.data?.sessions ?? [];
  const positionTitle = positionTitleOf(candidate);
  // diturunkan dari cache supaya insight/review terbaru langsung tampil di dialog
  const detailTest = sessions.flatMap((s) => s.tests).find((t) => t.id === detailTestId) ?? null;

  const draft: PsikotesSummaryPayload = {
    recommendation: override.recommendation !== undefined ? override.recommendation : (summary?.recommendation ?? null),
    notes: override.notes !== undefined ? override.notes : (summary?.notes ?? null),
  };
  const draftDirty =
    draft.recommendation !== (summary?.recommendation ?? null) ||
    (draft.notes?.trim() || null) !== (summary?.notes ?? null);
  const recommendationSaved = Boolean(summary?.recommendation);

  const handleSaveSummary = () => {
    saveSummary.mutate(
      {
        id: candidate.id,
        payload: { recommendation: draft.recommendation, notes: draft.notes?.trim() || null },
      },
      {
        onSuccess: () => {
          setOverride({});
          toast.success("Rekomendasi psikotes tersimpan");
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal menyimpan"),
      }
    );
  };

  if (psikotesQuery.isLoading) return <PanelLoading />;
  if (psikotesQuery.isError) {
    return (
      <PanelError
        error={psikotesQuery.error}
        fallback="Gagal memuat data psikotes"
        onRetry={() => psikotesQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <StepChecklistCard
        icon={<BrainCircuit className="size-4 text-violet-500" />}
        title="Psikotes Online"
        items={psikotesChecklist(sessions, recommendationSaved)}
      />

      <div className="rounded-xl border border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">Hasil Tes</h4>
          <Button size="sm" variant="outline" onClick={() => setSendOpen(true)}>
            <Plus className="size-3.5" /> Kirim / jadwalkan tes
          </Button>
        </div>
        <PsikotesSessionList
          sessions={sessions}
          onOpenTest={(test) => setDetailTestId(test.id)}
          onOpenProctor={setProctorSession}
        />
      </div>

      <div className="rounded-xl border border-border p-4">
        <h4 className="mb-1 text-sm font-semibold text-foreground">Rekomendasi Psikotes</h4>
        <p className="mb-3 text-xs text-muted-foreground">
          Kesimpulan keseluruhan hasil tes — menjadi syarat tombol &quot;Lolos → Interview&quot;.
        </p>
        <div className="mb-3">
          <RecommendationPicker
            value={draft.recommendation}
            onChange={(recommendation) => setOverride((o) => ({ ...o, recommendation }))}
          />
        </div>
        <Textarea
          value={draft.notes ?? ""}
          onChange={(e) => setOverride((o) => ({ ...o, notes: e.target.value }))}
          rows={2}
          maxLength={2000}
          placeholder="Catatan interpretasi (mis. ringkasan PAPI & tes gambar)"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={handleSaveSummary} disabled={saveSummary.isPending || !draftDirty}>
            {saveSummary.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Simpan Rekomendasi
          </Button>
          {summary && <SavedStamp by={summary.updated_by_name} at={summary.updated_at} />}
        </div>
      </div>

      <WaTemplateCard
        candidate={candidate}
        positionTitle={positionTitle}
        templates={PSIKOTES_WA_TEMPLATES}
        description="Membuka WhatsApp dengan pesan terisi — pembukaan tercatat di timeline Aktivitas."
      />

      <DecisionCard
        onMove={onMove}
        moving={moving}
        next={{
          stage: "interview",
          label: "Lolos → Interview",
          enabled: recommendationSaved,
          lockedHint:
            'Isi & simpan rekomendasi terlebih dahulu untuk mengaktifkan tombol "Lolos → Interview".',
        }}
      />

      {sendOpen && (
        <PsikotesSendDialog candidate={candidate} positionTitle={positionTitle} open onOpenChange={setSendOpen} />
      )}
      {detailTest && (
        <PsikotesTestDetailDialog
          key={detailTest.id}
          test={detailTest}
          candidateId={candidate.id}
          open
          onOpenChange={(open) => !open && setDetailTestId(null)}
        />
      )}
      {proctorSession && (
        <PsikotesProctorDialog
          key={proctorSession.id}
          session={proctorSession}
          open
          onOpenChange={(open) => !open && setProctorSession(null)}
        />
      )}
    </div>
  );
}
