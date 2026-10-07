"use client";

import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelDescription,
} from "@/components/ui/dialog";
import { PAPI_SCALES } from "@/lib/recruitment/psikotes";
import { usePsikotesQuestions } from "../queries";
import { useDeleteQuestion, useUpdateQuestion } from "../mutations";
import type { McqOption, PapiStatement, PsikotesInstrument, PsikotesQuestion } from "../types";
import { QuestionFormDialog, toQuestionPayload } from "./question-form-dialog";

interface QuestionManagerDialogProps {
  instrument: PsikotesInstrument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function isMcqOptions(options: PsikotesQuestion["options"]): options is McqOption[] {
  return Array.isArray(options);
}

/** Ringkasan satu baris soal utk daftar (stem mcq / pasangan A-B papi). */
function questionSummary(question: PsikotesQuestion): string {
  if (isMcqOptions(question.options)) return question.body;
  const pair = question.options as { a: PapiStatement; b: PapiStatement } | null;
  if (!pair) return question.body;
  return `A (${pair.a.scale}): ${pair.a.text} — B (${pair.b.scale}): ${pair.b.text}`;
}

/** Kelola bank soal satu instrumen: daftar, tambah, edit, aktif/nonaktif, hapus. */
export function QuestionManagerDialog({
  instrument,
  open,
  onOpenChange,
}: QuestionManagerDialogProps) {
  const { data: questions, isLoading } = usePsikotesQuestions(open ? instrument.id : null);
  const updateQuestion = useUpdateQuestion();
  const deleteQuestion = useDeleteQuestion();

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PsikotesQuestion | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PsikotesQuestion | null>(null);

  const isMcq = instrument.kind === "mcq";

  const handleToggleActive = (question: PsikotesQuestion) => {
    const payload = toQuestionPayload(instrument.kind, question);
    if (!payload) return;
    updateQuestion.mutate(
      {
        id: question.id,
        instrumentId: instrument.id,
        payload: { ...payload, is_active: !question.is_active },
      },
      {
        onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal menyimpan"),
      }
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteQuestion.mutate(
      { id: deleteTarget.id, instrumentId: instrument.id },
      {
        onSuccess: () => {
          toast.success("Soal dihapus");
          setDeleteTarget(null);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal menghapus"),
      }
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogPanel size="lg">
          <DialogPanelHeader>
            <DialogPanelTitle>Bank Soal — {instrument.name}</DialogPanelTitle>
            <DialogPanelDescription>
              {isMcq
                ? "Soal pilihan ganda dengan kunci jawaban. Soal nonaktif tidak ditarik ke tes kandidat."
                : "Pasangan pernyataan A/B dengan mapping skala PAPI. Soal nonaktif tidak ditarik ke tes kandidat."}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {questions?.length ?? 0} soal · {questions?.filter((q) => q.is_active).length ?? 0}{" "}
                aktif
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setEditTarget(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="size-4" /> Tambah Soal
              </Button>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : (questions ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                Belum ada soal. Tambahkan soal pertama untuk instrumen ini.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {(questions ?? []).map((question, index) => (
                  <li key={question.id} className="flex items-start gap-3 px-3 py-2.5">
                    <span className="mt-0.5 w-6 shrink-0 text-right text-xs text-muted-foreground">
                      {index + 1}.
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`line-clamp-2 text-sm ${question.is_active ? "text-foreground" : "text-muted-foreground line-through"}`}
                      >
                        {questionSummary(question)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {isMcqOptions(question.options)
                          ? `${question.options.length} opsi · kunci: ${question.answer_key?.correct?.toUpperCase() ?? "—"}`
                          : (() => {
                              const pair = question.options as {
                                a: PapiStatement;
                                b: PapiStatement;
                              } | null;
                              return pair
                                ? `Skala: ${pair.a.scale} — ${PAPI_SCALES[pair.a.scale]} vs ${pair.b.scale} — ${PAPI_SCALES[pair.b.scale]}`
                                : "";
                            })()}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleActive(question)}
                        disabled={updateQuestion.isPending}
                      >
                        {question.is_active ? "Nonaktifkan" : "Aktifkan"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon" className="size-8"
                        aria-label="Edit soal"
                        onClick={() => {
                          setEditTarget(question);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon" className="size-8"
                        aria-label="Hapus soal"
                        onClick={() => setDeleteTarget(question)}
                      >
                        <Trash2 className="size-4 text-red-500" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </DialogPanelBody>
        </DialogPanel>
      </Dialog>

      {formOpen && (
        <QuestionFormDialog
          key={editTarget?.id ?? "new"}
          instrument={instrument}
          question={editTarget}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        title="Hapus soal ini?"
        description="Soal dihapus permanen dari bank soal. Untuk sekadar mengecualikan dari tes, gunakan Nonaktifkan."
        confirmLabel="Hapus"
        cancelLabel="Batal"
        loading={deleteQuestion.isPending}
        onConfirm={handleDelete}
      />
    </>
  );
}
