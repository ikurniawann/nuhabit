"use client";

import { Check, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { PAPI_SCALES, PAPI_SCALE_CODES, scoreBadgeClass } from "@/lib/recruitment/psikotes";
import { usePsikotesTestAnswers } from "../queries";
import type { McqAnswerItem, McqScoreDetail, PapiAnswerItem, PapiScoreDetail } from "../types";

const CORRECT_CLASS = "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300";
const WRONG_CLASS = "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300";

function AnswersLoading() {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" /> Memuat rincian soal…
    </p>
  );
}

/** Daftar soal MCQ lengkap: teks soal, opsi, jawaban kandidat vs kunci. */
function McqQuestionList({ items }: { items: McqAnswerItem[] }) {
  return (
    <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
      {items.map((item, i) => (
        <div key={item.id} className="rounded-lg border border-border p-3">
          <div className="flex items-start gap-2">
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ${
                item.is_correct ? CORRECT_CLASS : WRONG_CLASS
              }`}
            >
              {i + 1}
            </span>
            {item.body ? (
              <p className="text-sm text-foreground">{item.body}</p>
            ) : (
              <p className="text-sm italic text-muted-foreground">
                Soal sudah dihapus dari bank soal
              </p>
            )}
          </div>
          {item.options && (
            <div className="mt-2 space-y-1 pl-8">
              {item.options.map((opt) => {
                const isGiven = opt.key === item.given;
                const isKey = opt.key === item.correct_key;
                return (
                  <div
                    key={opt.key}
                    className={`flex items-start gap-1.5 rounded-md px-2 py-1 text-xs ${
                      isKey
                        ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200"
                        : isGiven
                          ? "bg-red-50 text-red-900 dark:bg-red-500/15 dark:text-red-200"
                          : "text-muted-foreground"
                    }`}
                  >
                    <span className="font-semibold uppercase">{opt.key}.</span>
                    <span className="flex-1">{opt.text}</span>
                    {isGiven && <span className="shrink-0 font-medium">jawaban kandidat</span>}
                    {isKey && <Check className="mt-0.5 size-3.5 shrink-0" />}
                  </div>
                );
              })}
            </div>
          )}
          {item.given === null && (
            <p className="mt-1.5 pl-8 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              Tidak dijawab
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** Daftar pasangan PAPI: pernyataan A/B, pilihan kandidat + kode skala. */
function PapiAnswerList({ items }: { items: PapiAnswerItem[] }) {
  return (
    <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
      {items.map((item, i) => {
        const options = item.options;
        return (
          <div key={item.id} className="rounded-lg border border-border px-3 py-2">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">
              Pasangan {i + 1}
              {item.body ? ` · ${item.body}` : ""}
              {item.given === null && (
                <span className="ml-1 text-amber-600 dark:text-amber-400">— tidak dijawab</span>
              )}
            </p>
            {options ? (
              (["a", "b"] as const).map((k) => {
                const chosen = item.given === k;
                return (
                  <div
                    key={k}
                    className={`flex items-start gap-1.5 rounded-md px-2 py-1 text-xs ${
                      chosen
                        ? "bg-violet-50 font-medium text-violet-900 dark:bg-violet-500/15 dark:text-violet-200"
                        : "text-muted-foreground"
                    }`}
                  >
                    <span className="font-semibold uppercase">{k}.</span>
                    <span className="flex-1">{options[k].text}</span>
                    <span
                      className="shrink-0 text-[10px] opacity-70"
                      title={PAPI_SCALES[options[k].scale]}
                    >
                      {options[k].scale}
                    </span>
                    {chosen && <Check className="mt-0.5 size-3.5 shrink-0" />}
                  </div>
                );
              })
            ) : (
              <p className="text-xs italic text-muted-foreground">Detail soal tidak tersedia</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Hasil MCQ: skor + rincian soal (fallback chip benar/salah bila rincian gagal dimuat). */
export function McqResult({
  answersTestId,
  score,
  detail,
}: {
  /** null = rincian soal tidak dimuat (tes belum berstatus selesai) */
  answersTestId: string | null;
  score: number | null;
  detail: McqScoreDetail;
}) {
  const answersQuery = usePsikotesTestAnswers(answersTestId);
  const answers = answersQuery.data;
  return (
    <>
      <div className="flex items-baseline gap-3">
        <span className={`rounded-lg px-3 py-1 text-2xl font-bold ${scoreBadgeClass(score ?? 0)}`}>
          {score ?? 0}%
        </span>
        <span className="text-sm text-muted-foreground">
          {detail.correct}/{detail.total} benar
        </span>
      </div>
      {detail.per_question && (
        <div>
          <Label className="mb-1.5 block text-xs font-medium">Rincian per Soal</Label>
          {answersQuery.isLoading ? (
            <AnswersLoading />
          ) : answers?.kind === "mcq" && answers.items.length > 0 ? (
            <McqQuestionList items={answers.items} />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {detail.per_question.map((q, i) => (
                <span
                  key={q.id}
                  title={q.given ? `jawaban: ${q.given.toUpperCase()}` : "tidak dijawab"}
                  className={`flex size-8 items-center justify-center rounded-md text-xs font-semibold ${
                    q.is_correct ? CORRECT_CLASS : WRONG_CLASS
                  }`}
                >
                  {i + 1}
                </span>
              ))}
            </div>
          )}
          {answersQuery.isError && (
            <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">
              Gagal memuat teks soal — menampilkan ringkasan benar/salah saja.
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** Hasil PAPI: skala dominan, sebaran 20 skala, rincian pasangan. */
export function PapiResult({ answersTestId, detail }: { answersTestId: string | null; detail: PapiScoreDetail }) {
  const answersQuery = usePsikotesTestAnswers(answersTestId);
  const answers = answersQuery.data;
  const codes = [...PAPI_SCALE_CODES].sort((a, b) => (detail.scales[b] ?? 0) - (detail.scales[a] ?? 0));
  return (
    <>
      {detail.dominant.length > 0 && (
        <div>
          <Label className="mb-1 block text-xs font-medium">Skala Dominan</Label>
          {detail.dominant.map((d) => (
            <p key={d.code} className="text-lg font-semibold text-foreground">
              {d.code} — {d.label}{" "}
              <span className="text-sm font-normal text-muted-foreground">({d.count} pilihan)</span>
            </p>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {detail.answered}/{detail.total} pasangan dijawab. Interpretasi naratif ditulis HR (tidak
        digenerate otomatis).
      </p>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {codes.map((code) => {
          const count = detail.scales[code] ?? 0;
          return (
            <div
              key={code}
              title={PAPI_SCALES[code]}
              className={`rounded-md px-2 py-1.5 text-center text-xs ${
                count > 0
                  ? "bg-violet-50 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <span className="font-semibold">{code}</span> · {count}
            </div>
          );
        })}
      </div>
      <div>
        <Label className="mb-1.5 block text-xs font-medium">Rincian Soal &amp; Jawaban</Label>
        {answersQuery.isLoading ? (
          <AnswersLoading />
        ) : answers?.kind === "forced_choice" && answers.items.length > 0 ? (
          <PapiAnswerList items={answers.items} />
        ) : (
          <p className="text-xs text-muted-foreground">
            {answersQuery.isError
              ? "Gagal memuat rincian soal."
              : "Rincian soal tidak tersedia (bank soal kosong atau sudah dihapus)."}
          </p>
        )}
      </div>
    </>
  );
}
