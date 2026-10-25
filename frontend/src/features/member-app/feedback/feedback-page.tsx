"use client";

import { ChevronRight, MessageSquarePlus } from "lucide-react";
import Link from "next/link";
import { useErrorText } from "../lib/error-codes";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { FEEDBACK_STATUS, useMyFeedback } from "../lib/queries-feedback";
import { Notice, PageTitle } from "../loyalty/loyalty-ui";
import { EmptyState, Spinner, StatusBadge, formatDay } from "../ui";

/** Masukan & laporan: tombol kirim laporan baru dan daftar laporan member beserta statusnya. */
export function FeedbackPage() {
  const t = useT();
  const errorText = useErrorText();
  const { data, isLoading, error } = useMyFeedback();

  return (
    <div className="flex flex-col gap-5">
      <PageTitle hint={t("Tell us what went well or what went wrong. The team replies here.")}>{t("Feedback & reports")}</PageTitle>
      <Link href={m("/profile/feedback/new")} className="nh-btn-brand">
        <MessageSquarePlus size={18} /> {t("Send feedback or report a problem")}
      </Link>
      {isLoading ? <Spinner label={t("Loading…")} /> : null}
      {error ? <Notice ok={false}>{errorText(error, t("Request failed"))}</Notice> : null}
      {data ? (
        <section className="nh-card flex flex-col gap-3 text-sm">
          <p className="nh-label !mb-0">{t("Your reports")}</p>
          {data.length === 0 ? (
            <EmptyState title={t("No reports yet")} hint={t("Reports you send show up here with their status.")} />
          ) : (
            <ul className="flex flex-col divide-y divide-nh-line">
              {data.map((r) => (
                <li key={r.id}>
                  <Link href={m(`/profile/feedback/${r.id}`)} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{r.title}</span>
                      <span className="block text-xs text-nh-muted">
                        {r.code} · {r.category_label} · {formatDay(r.created_at)}
                      </span>
                    </span>
                    <StatusBadge status={FEEDBACK_STATUS[r.status].label} tone={FEEDBACK_STATUS[r.status].tone} />
                    <ChevronRight size={16} className="text-nh-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
