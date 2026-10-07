"use client";

import { useState } from "react";
import { Clock, ListChecks, Loader2, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { FadeIn } from "@/components/motion";
import { INSTRUMENT_KIND_BADGES, INSTRUMENT_KIND_LABELS } from "@/lib/recruitment/psikotes";
import { usePsikotesInstruments } from "../queries";
import { useUpdateInstrument } from "../mutations";
import type { PsikotesInstrument } from "../types";
import { InstrumentConfigDialog } from "./instrument-config-dialog";
import { QuestionManagerDialog } from "./question-manager-dialog";

/**
 * Halaman manajemen Psikotes (/dashboard/hris/psikotes):
 * daftar instrumen + toggle aktif, pengaturan config (durasi, jumlah soal,
 * acak, instruksi), dan kelola bank soal (mcq & forced_choice).
 */
export function PsikotesAdminPage() {
  const { data: instruments, isLoading, error, refetch } = usePsikotesInstruments();
  const updateInstrument = useUpdateInstrument();
  const [configTarget, setConfigTarget] = useState<PsikotesInstrument | null>(null);
  const [questionsTarget, setQuestionsTarget] = useState<PsikotesInstrument | null>(null);

  const handleToggleActive = (instrument: PsikotesInstrument, checked: boolean) => {
    updateInstrument.mutate(
      { id: instrument.id, payload: { is_active: checked } },
      {
        onSuccess: () =>
          toast.success(`${instrument.name} ${checked ? "diaktifkan" : "dinonaktifkan"}`),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal menyimpan"),
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <p className="text-sm text-red-600">
          {error instanceof Error ? error.message : "Gagal memuat instrumen"}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
          Coba Lagi
        </Button>
      </div>
    );
  }

  return (
    <FadeIn className="flex w-full flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Psikotes</h1>
        <p className="text-sm text-muted-foreground">
          Kelola instrumen tes, durasi, instruksi, dan bank soal. Instrumen nonaktif tidak
          ditawarkan saat HR mengirim undangan tes ke kandidat.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(instruments ?? []).map((instrument) => {
          const durationMinutes = Math.round((instrument.config.duration_seconds ?? 0) / 60);
          const hasQuestionBank = instrument.kind !== "drawing";
          return (
            <Card key={instrument.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-foreground">{instrument.name}</div>
                  <span
                    className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${INSTRUMENT_KIND_BADGES[instrument.kind]}`}
                  >
                    {INSTRUMENT_KIND_LABELS[instrument.kind]}
                  </span>
                </div>
                <Switch
                  checked={instrument.is_active}
                  onCheckedChange={(checked) => handleToggleActive(instrument, checked)}
                  disabled={
                    updateInstrument.isPending &&
                    updateInstrument.variables?.id === instrument.id
                  }
                  aria-label={`Aktifkan ${instrument.name}`}
                />
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" /> {durationMinutes} menit
                </span>
                {hasQuestionBank && (
                  <span className="inline-flex items-center gap-1">
                    <ListChecks className="size-3.5" /> {instrument.active_question_count} soal aktif
                    {instrument.question_count > instrument.active_question_count &&
                      ` (${instrument.question_count} total)`}
                  </span>
                )}
                {instrument.kind === "mcq" && instrument.config.question_count != null && (
                  <span>Ditarik {instrument.config.question_count} soal/tes</span>
                )}
              </div>

              {hasQuestionBank && instrument.active_question_count === 0 && (
                <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
                  Bank soal kosong — instrumen ini belum bisa dikerjakan kandidat.
                </p>
              )}

              <div className="mt-auto flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfigTarget(instrument)}
                >
                  <Settings2 className="size-4" /> Pengaturan
                </Button>
                {hasQuestionBank && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setQuestionsTarget(instrument)}
                  >
                    <ListChecks className="size-4" /> Kelola Soal
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {configTarget && (
        <InstrumentConfigDialog
          key={configTarget.id}
          instrument={configTarget}
          open
          onOpenChange={(open) => {
            if (!open) setConfigTarget(null);
          }}
        />
      )}
      {questionsTarget && (
        <QuestionManagerDialog
          key={questionsTarget.id}
          instrument={questionsTarget}
          open
          onOpenChange={(open) => {
            if (!open) setQuestionsTarget(null);
          }}
        />
      )}
    </FadeIn>
  );
}
