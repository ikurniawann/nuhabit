"use client";

import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";
import { answersComplete, answersPayload, initialAnswers, questionText, type ParqAnswers, type ParqStatus } from "../lib/parq";
import { useParq, useSubmitParq } from "../lib/queries-health";
import { Spinner, formatDay } from "../ui";

const DETAILS_MAX = 500;

/**
 * Deklarasi kesehatan PAR-Q+: tujuh pertanyaan ya/tidak, berlaku 12 bulan.
 * Jawaban "ya" diteruskan ke coach untuk ditinjau sebelum latihan berat.
 */
export function HealthPage() {
  const t = useT();
  const router = useRouter();
  const { data: status, isLoading } = useParq();
  if (isLoading || !status) return <Spinner label={t("Loading…")} />;
  return (
    <div className="flex flex-col gap-5">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
        <ArrowLeft size={16} /> {t("Back")}
      </button>
      <h1 className="nh-display text-3xl">{t("Health declaration")}</h1>
      <HealthForm key={status.last?.id ?? "new"} status={status} />
    </div>
  );
}

function HealthForm({ status }: { status: ParqStatus }) {
  const t = useT();
  const submit = useSubmitParq();
  const [answers, setAnswers] = useState<ParqAnswers>(() => initialAnswers(status));
  const [details, setDetails] = useState(status.due ? "" : (status.last?.details ?? ""));
  const [editing, setEditing] = useState(status.due);
  const [error, setError] = useState("");
  const hasYes = status.questions.some((q) => answers[q.code] === true);
  const last = status.last;

  const save = async () => {
    setError("");
    try {
      await submit.mutateAsync({ answers: answersPayload(answers, status), details: hasYes ? details.trim() : "" });
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Save failed."));
    }
  };

  if (!editing && last) {
    return (
      <div className="flex flex-col gap-4">
        <div className="nh-card flex items-start gap-3 text-sm">
          <ShieldCheck className="mt-0.5 shrink-0 text-nh-ok" size={20} />
          <div>
            <p className="font-bold">{t("Filled {date}", { date: formatDay(last.submitted_at) })}</p>
            <p className="text-nh-muted">{t("Valid until {date}.", { date: formatDay(last.expires_at) })}</p>
            {last.has_yes && (
              <p className="mt-2 text-nh-muted">
                {t("You answered yes to at least one question. A coach reviews it before your next hard session.")}
              </p>
            )}
          </div>
        </div>
        <button className="nh-btn-ghost" onClick={() => setEditing(true)}>
          {t("Update my answers")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-nh-muted">
        {last
          ? t("Your last declaration is more than 12 months old or the questions changed. Answer again to keep training safely.")
          : t("Answer seven yes or no questions before you train. It takes a minute and stays valid for 12 months.")}
      </p>
      <ol className="flex flex-col gap-3">
        {status.questions.map((q, i) => (
          <li key={q.code} className="nh-card flex flex-col gap-3 !p-4 text-sm">
            <p>
              <span className="font-black">{i + 1}. </span>
              {t(questionText(q.code))}
            </p>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t(questionText(q.code))}>
              {[true, false].map((value) => {
                const active = answers[q.code] === value;
                return (
                  <button
                    key={String(value)}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setAnswers((cur) => ({ ...cur, [q.code]: value }))}
                    className={`rounded-xl px-4 py-2.5 font-bold transition ${
                      active ? "bg-nh-forest text-white" : "bg-nh-raised text-nh-ink"
                    }`}
                  >
                    {value ? t("Yes") : t("No")}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
      {hasYes && (
        <label className="flex flex-col gap-2 text-sm">
          <span className="nh-label !mb-0">{t("Tell your coach more (optional)")}</span>
          <textarea
            value={details}
            maxLength={DETAILS_MAX}
            onChange={(e) => setDetails(e.target.value)}
            placeholder={t("For example: left knee surgery in 2024, cleared by my doctor.")}
            className="min-h-24 w-full rounded-2xl bg-nh-raised px-4 py-3 text-base outline-none focus:ring-2 focus:ring-nh-forest"
          />
        </label>
      )}
      <p className="text-xs text-nh-muted">
        {t("Only your coaches and the gym manager see your answers. A yes does not stop you from training; a coach reviews it with you.")}
      </p>
      {error ? <p className="text-sm font-bold text-nh-danger">{error}</p> : null}
      <button className="nh-btn-brand" disabled={submit.isPending || !answersComplete(answers, status)} onClick={() => void save()}>
        {t("Submit declaration")}
      </button>
    </div>
  );
}
