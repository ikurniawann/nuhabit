"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useErrorText } from "../lib/error-codes";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import {
  EMPTY_DRAFT,
  MESSAGE_MAX,
  MESSAGE_MIN,
  draftPayload,
  draftProblem,
  recentCoaches,
  useFeedbackOptions,
  useSendFeedback,
  type FeedbackDraft,
  type FeedbackKind,
} from "../lib/queries-feedback";
import { Notice, PageTitle } from "../loyalty/loyalty-ui";
import { Spinner, chipClass, formatDayTime } from "../ui";

const KINDS: { kind: FeedbackKind; label: string }[] = [
  { kind: "problem", label: "Report a problem" },
  { kind: "feedback", label: "Send feedback" },
];

/** Kirim masukan / laporkan masalah: jenis, kategori, kelas atau coach dari booking terakhir (opsional), dan ceritanya. */
export function FeedbackFormPage() {
  const t = useT();
  const router = useRouter();
  const errorText = useErrorText();
  const options = useFeedbackOptions();
  const send = useSendFeedback();
  const [draft, setDraft] = useState<FeedbackDraft>(EMPTY_DRAFT);
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof FeedbackDraft>(key: K, value: FeedbackDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const problem = draftProblem(draft);
  const classes = options.data?.classes ?? [];

  const submit = () => {
    setTouched(true);
    if (problem) return;
    send.mutate(draftPayload(draft, classes), { onSuccess: ({ id }) => router.replace(m(`/profile/feedback/${id}`)) });
  };

  return (
    <div className="flex flex-col gap-5">
      <PageTitle hint={t("We read every report. Problems get a reply within our service hours.")}>{t("Send feedback or report a problem")}</PageTitle>
      {options.isLoading ? <Spinner label={t("Loading…")} /> : null}
      {options.error ? <Notice ok={false}>{errorText(options.error, t("Request failed"))}</Notice> : null}
      {options.data ? (
        <>
          <div className="flex gap-2" role="radiogroup" aria-label={t("Type")}>
            {KINDS.map((k) => (
              <button key={k.kind} type="button" role="radio" aria-checked={draft.kind === k.kind} className={chipClass(draft.kind === k.kind)} onClick={() => set("kind", k.kind)}>
                {t(k.label)}
              </button>
            ))}
          </div>

          <section className="flex flex-col gap-2">
            <p className="nh-label !mb-0">{t("Category")}</p>
            <div className="flex flex-wrap gap-2">
              {options.data.categories.map((c) => (
                <button key={c.code} type="button" aria-pressed={draft.category === c.code} className={chipClass(draft.category === c.code)} onClick={() => set("category", c.code)}>
                  {c.label}
                </button>
              ))}
            </div>
          </section>

          {classes.length > 0 ? (
            <section className="flex flex-col gap-2">
              <label htmlFor="feedback-class" className="nh-label !mb-0">
                {t("Class (optional)")}
              </label>
              <select id="feedback-class" className="nh-input" value={draft.session_id} onChange={(e) => set("session_id", e.target.value)}>
                <option value="">{t("Not about a class")}</option>
                {classes.map((c) => (
                  <option key={c.session_id} value={c.session_id}>
                    {c.name} · {formatDayTime(c.starts_at, c.timezone)}
                    {c.coach_name ? ` · ${c.coach_name}` : ""}
                  </option>
                ))}
              </select>
              <label htmlFor="feedback-coach" className="nh-label !mb-0">
                {t("Coach (optional)")}
              </label>
              <select id="feedback-coach" className="nh-input" value={draft.coach_id} onChange={(e) => set("coach_id", e.target.value)}>
                <option value="">{draft.session_id ? t("The coach of that class") : t("Not about a coach")}</option>
                {recentCoaches(classes).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </section>
          ) : null}

          <section className="flex flex-col gap-2">
            <label htmlFor="feedback-message" className="nh-label !mb-0">
              {draft.kind === "problem" ? t("What happened?") : t("Your feedback")}
            </label>
            <textarea
              id="feedback-message"
              className="nh-input min-h-32"
              value={draft.message}
              maxLength={MESSAGE_MAX}
              onChange={(e) => set("message", e.target.value)}
            />
            <p className="text-right text-xs text-nh-muted">
              {draft.message.trim().length}/{MESSAGE_MAX}
            </p>
          </section>

          {touched && problem ? <Notice ok={false}>{t(problem, { min: MESSAGE_MIN, max: MESSAGE_MAX })}</Notice> : null}
          {send.error ? <Notice ok={false}>{errorText(send.error, t("Sending failed."))}</Notice> : null}
          <button type="button" className="nh-btn-brand" disabled={send.isPending} onClick={submit}>
            {send.isPending ? t("Sending…") : t("Send")}
          </button>
        </>
      ) : null}
    </div>
  );
}
