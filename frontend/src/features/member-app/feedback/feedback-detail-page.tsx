"use client";

import { useState } from "react";
import { useErrorText } from "../lib/error-codes";
import { useT } from "../lib/i18n";
import { FEEDBACK_STATUS, eventLabel, useAnswerFeedback, useFeedback, type FeedbackDetail } from "../lib/queries-feedback";
import { Notice, PageTitle } from "../loyalty/loyalty-ui";
import { Spinner, StatusBadge, formatDayTime } from "../ui";

/** Satu laporan: isi, balasan tim, dan konfirmasi selesai atau buka lagi. */
export function FeedbackDetailPage({ id }: { id: string }) {
  const t = useT();
  const errorText = useErrorText();
  const { data, isLoading, error } = useFeedback(id);

  return (
    <div className="flex flex-col gap-5">
      <PageTitle>{data ? data.title : t("Report")}</PageTitle>
      {isLoading ? <Spinner label={t("Loading…")} /> : null}
      {error ? <Notice ok={false}>{errorText(error, t("Request failed"))}</Notice> : null}
      {data ? <FeedbackContent report={data} /> : null}
    </div>
  );
}

function FeedbackContent({ report: r }: { report: FeedbackDetail }) {
  const t = useT();
  const status = FEEDBACK_STATUS[r.status];
  return (
    <>
      <section className="nh-card flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold text-nh-muted">
            {r.code} · {r.category_label}
          </span>
          <StatusBadge status={status.label} tone={status.tone} />
        </div>
        {r.description ? <p className="whitespace-pre-wrap">{r.description}</p> : null}
        {r.session_name && r.session_starts_at ? (
          <p className="text-xs text-nh-muted">
            {t("Class")}: {r.session_name} · {formatDayTime(r.session_starts_at, r.timezone)}
          </p>
        ) : null}
        {r.coach_name ? (
          <p className="text-xs text-nh-muted">
            {t("Coach")}: {r.coach_name}
          </p>
        ) : null}
      </section>

      {r.status === "resolved" ? <Answer id={r.id} /> : null}

      <section className="nh-card flex flex-col gap-3 text-sm">
        <p className="nh-label !mb-0">{t("Updates")}</p>
        <ol className="flex flex-col gap-3">
          {[...r.events].reverse().map((e, i) => (
            <li key={`${e.created_at}-${i}`} className={e.kind === "reply" ? "rounded-xl bg-nh-cream p-3" : ""}>
              <p className="font-bold">{t(eventLabel(e))}</p>
              {e.body ? <p className="mt-0.5 whitespace-pre-wrap">{e.body}</p> : null}
              <p className="mt-0.5 text-xs text-nh-muted">{formatDayTime(e.created_at)}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function Answer({ id }: { id: string }) {
  const t = useT();
  const errorText = useErrorText();
  const answer = useAnswerFeedback(id);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <section className="nh-card flex flex-col gap-3 text-sm">
      <p className="font-bold">{t("Is this sorted for you?")}</p>
      {reopening ? (
        <>
          <label htmlFor="reopen-reason" className="nh-label !mb-0">
            {t("What is still wrong?")}
          </label>
          <textarea id="reopen-reason" className="nh-input min-h-20" value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className="nh-btn-brand flex-1"
              disabled={!reason.trim() || answer.isPending}
              onClick={() => answer.mutate({ action: "reopen", reason })}
            >
              {t("Reopen report")}
            </button>
            <button type="button" className="nh-btn-ghost flex-1" onClick={() => setReopening(false)}>
              {t("Cancel")}
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" className="nh-btn-brand flex-1" disabled={answer.isPending} onClick={() => answer.mutate({ action: "confirm" })}>
            {t("Yes, it's resolved")}
          </button>
          <button type="button" className="nh-btn-ghost flex-1" onClick={() => setReopening(true)}>
            {t("No, reopen it")}
          </button>
        </div>
      )}
      {answer.error ? <Notice ok={false}>{errorText(answer.error, t("Request failed"))}</Notice> : null}
    </section>
  );
}
