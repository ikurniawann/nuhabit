"use client";

import { useMemo, useState } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  isScreeningDirty,
  normalizeScreeningDraft,
  screeningChecklist,
  screeningDraftFrom,
} from "@/lib/recruitment/pipeline-stage-rules";
import { SCREENING_WA_TEMPLATES } from "@/lib/recruitment/pipeline-wa-templates";
import { useCandidateScreening } from "../queries";
import { useSaveCandidateScreening } from "../mutations";
import type { ScreeningPayload } from "../types";
import { ScreeningCallForm } from "./screening-call-form";
import {
  DecisionCard,
  ProgressChecklistCard,
  SavedStamp,
  WaTemplateCard,
  positionTitleOf,
  type StagePanelCandidate,
  type StagePanelProps,
} from "./stage-panel-parts";

interface ScreeningPanelCandidate extends StagePanelCandidate {
  expected_salary?: number | null;
}

/**
 * Action panel tahap Screening: checklist otomatis, form hasil screening call,
 * template WA, keputusan (Lolos → Psikotes aktif setelah rekomendasi tersimpan).
 *
 * State form = draft server (query) + override (edit user). Render dengan
 * `key={candidate.id}` supaya override ikut reset saat ganti kandidat.
 */
export function ScreeningActionPanel({
  candidate,
  onMove,
  moving = false,
}: StagePanelProps<ScreeningPanelCandidate>) {
  const screeningQuery = useCandidateScreening(candidate.id);
  const saveScreening = useSaveCandidateScreening();

  // edit user di atas nilai server; {} = belum ada edit
  const [override, setOverride] = useState<Partial<ScreeningPayload>>({});

  const saved = screeningQuery.data ?? null;
  const serverDraft = useMemo(() => screeningDraftFrom(saved), [saved]);
  const draft: ScreeningPayload = { ...serverDraft, ...override };
  const patch = (p: Partial<ScreeningPayload>) => setOverride((o) => ({ ...o, ...p }));

  const handleSave = () => {
    saveScreening.mutate(
      { id: candidate.id, payload: normalizeScreeningDraft(draft) },
      // cache sudah diisi baris server oleh mutation; override tak dibutuhkan lagi
      { onSuccess: () => setOverride({}) }
    );
  };

  if (screeningQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Memuat hasil screening…
      </div>
    );
  }

  // jangan render form saat fetch gagal: draft kosong bisa menimpa data tersimpan
  if (screeningQuery.isError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
        <p className="text-sm text-red-700 dark:text-red-300">
          Gagal memuat hasil screening —{" "}
          {screeningQuery.error instanceof Error ? screeningQuery.error.message : "terjadi kesalahan"}
        </p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => screeningQuery.refetch()}>
          <RefreshCw className="size-3.5" /> Coba Lagi
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ProgressChecklistCard
        title="Checklist Screening"
        items={screeningChecklist(draft)}
        barClassName="bg-cyan-500"
      />

      <div className="rounded-xl border border-border p-4">
        <h4 className="mb-4 text-sm font-semibold text-foreground">Hasil Screening Call</h4>
        <ScreeningCallForm
          draft={draft}
          expectedSalary={candidate.expected_salary ?? null}
          onPatch={patch}
        />

        {saveScreening.isError && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">
            {saveScreening.error instanceof Error
              ? saveScreening.error.message
              : "Gagal menyimpan hasil screening"}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saveScreening.isPending || !isScreeningDirty(draft, serverDraft)}
          >
            {saveScreening.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Simpan Hasil Screening
          </Button>
          {saved && <SavedStamp by={saved.updated_by_name} at={saved.updated_at} />}
        </div>
      </div>

      <WaTemplateCard
        candidate={candidate}
        positionTitle={positionTitleOf(candidate)}
        templates={SCREENING_WA_TEMPLATES}
        description="Membuka WhatsApp dengan pesan terisi (nama & posisi) — pembukaan tercatat di timeline Aktivitas."
      />

      <DecisionCard
        onMove={onMove}
        moving={moving}
        next={{
          stage: "psikotes",
          label: "Lolos → Psikotes",
          enabled: saved?.recommendation != null,
          lockedHint:
            'Isi & simpan rekomendasi terlebih dahulu untuk mengaktifkan tombol "Lolos → Psikotes".',
        }}
      />
    </div>
  );
}
