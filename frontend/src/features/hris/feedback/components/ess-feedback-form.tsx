"use client";

import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import { toScore } from "@/lib/kpi/ui-performance";
import { useSaveMyFeedback } from "../mutations";
import { useMyFeedbackDetail } from "../queries";
import { answerProgress, answersFrom, RATING_SCALE, relationshipLabel, toSavePayload, type AnswerMap } from "../view";
import type { FeedbackCriterion, MyFeedbackDetail } from "../types";
import { AssignmentStatusBadge, QueryState } from "./feedback-shared";

export function EssFeedbackForm({ id, onBack }: { id: string; onBack: () => void }) {
  const query = useMyFeedbackDetail(id);
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
        Kembali ke daftar
      </Button>
      {query.data ? (
        <FormBody detail={query.data} onDone={onBack} />
      ) : (
        <QueryState loading={query.isLoading} error={query.error} />
      )}
    </div>
  );
}

function FormBody({ detail, onDone }: { detail: MyFeedbackDetail; onDone: () => void }) {
  const [answers, setAnswers] = useState<AnswerMap>(() => answersFrom(detail.responses));
  const save = useSaveMyFeedback();
  const progress = answerProgress(answers, detail.categories);
  const readOnly = !detail.editable;
  const self = detail.relationship_type === "self";
  const name = self ? "Penilaian diri" : (detail.employee?.full_name ?? "Karyawan");

  const setAnswer = (criteriaId: string, patch: Partial<AnswerMap[string]>) =>
    setAnswers((a) => ({ ...a, [criteriaId]: { ...(a[criteriaId] ?? { rating: null, comments: "" }), ...patch } }));

  function handleSave(submit: boolean) {
    save.mutate(
      { id: detail.id, payload: toSavePayload(answers, submit) },
      {
        onSuccess: (res) => {
          toast.success(res.message ?? (submit ? "Penilaian terkirim" : "Draf penilaian tersimpan"));
          if (submit) onDone();
        },
        onError: (err) => toast.error(err.message || "Gagal menyimpan penilaian"),
      }
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{name}</h1>
          <p className="text-sm text-muted-foreground">
            {self ? "Diri sendiri" : `Anda menilai sebagai ${relationshipLabel(detail.relationship_type).toLowerCase()}`} ·{" "}
            {detail.cycle?.name ?? "Siklus"} · tenggat {formatDate(detail.due_date ?? detail.cycle?.end_date)}
          </p>
        </div>
        <AssignmentStatusBadge status={detail.status} />
      </div>

      {detail.status === "rejected" && detail.rejection_reason ? (
        <p className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
          Dikembalikan HR: {detail.rejection_reason}. Perbaiki lalu kirim ulang.
        </p>
      ) : null}
      {readOnly ? (
        <p className="rounded-lg bg-surface px-4 py-3 text-sm">Penilaian ini sudah dikirim dan tidak bisa diubah lagi.</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {detail.cycle?.is_anonymous && !self
            ? "Nama Anda tidak ditampilkan kepada karyawan yang dinilai. "
            : ""}
          Pilih nilai 1 (sangat kurang) sampai 5 (sangat baik) untuk setiap kriteria. Catatan boleh dikosongkan.
        </p>
      )}

      {detail.categories.map((category) => (
        <Card key={category.id}>
          <CardHeader>
            <CardTitle className="text-base">
              {category.name}
              {toScore(category.weight) !== null ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">bobot {toScore(category.weight)}%</span>
              ) : null}
            </CardTitle>
            {category.description ? <p className="text-sm text-muted-foreground">{category.description}</p> : null}
          </CardHeader>
          <CardContent className="space-y-5">
            {category.criteria.map((criterion) => (
              <CriterionField
                key={criterion.id}
                criterion={criterion}
                rating={answers[criterion.id]?.rating ?? null}
                comments={answers[criterion.id]?.comments ?? ""}
                disabled={readOnly}
                onChange={(patch) => setAnswer(criterion.id, patch)}
              />
            ))}
          </CardContent>
        </Card>
      ))}

      {!readOnly ? (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t bg-background py-3">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {progress.answered} dari {progress.total} kriteria dinilai
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleSave(false)} disabled={save.isPending}>
              Simpan Draf
            </Button>
            <Button onClick={() => handleSave(true)} disabled={save.isPending || !progress.complete}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Kirim Penilaian"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface CriterionFieldProps {
  criterion: FeedbackCriterion;
  rating: number | null;
  comments: string;
  disabled: boolean;
  onChange: (patch: { rating?: number; comments?: string }) => void;
}

function CriterionField({ criterion, rating, comments, disabled, onChange }: CriterionFieldProps) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">{criterion.name}</legend>
      {criterion.description ? <p className="text-xs text-muted-foreground">{criterion.description}</p> : null}
      <div className="flex flex-wrap gap-2">
        {RATING_SCALE.map((option) => (
          <label key={option.value} className="cursor-pointer">
            <input
              type="radio"
              className="peer sr-only"
              name={`rating-${criterion.id}`}
              value={option.value}
              checked={rating === option.value}
              onChange={() => onChange({ rating: option.value })}
              aria-label={`${option.value} ${option.label}`}
            />
            <span className="flex min-w-24 flex-col items-center rounded-lg border px-3 py-2 text-center transition-colors peer-checked:border-transparent peer-checked:bg-accent-strong peer-checked:text-accent-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-forest/40 peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              <span className="text-lg font-semibold">{option.value}</span>
              <span className="text-[11px]">{option.label}</span>
            </span>
          </label>
        ))}
      </div>
      <Input
        aria-label={`Catatan untuk ${criterion.name}`}
        placeholder="Catatan (opsional)"
        value={comments}
        maxLength={5000}
        onChange={(e) => onChange({ comments: e.target.value })}
      />
    </fieldset>
  );
}
