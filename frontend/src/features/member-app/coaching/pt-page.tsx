"use client";

import { Dumbbell } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { BottomSheet } from "../components/bottom-sheet";
import { ApiError } from "../lib/api";
import { joinDot } from "../lib/classes-view";
import { fill, useT } from "../lib/i18n";
import { m } from "../lib/links";
import { PT_STATUS, useCancelPt, useMyPtSessions, usePtOptions, type PtSession } from "../lib/queries-coaching";
import { EmptyState, Spinner, StatusBadge, formatDayTime } from "../ui";

const isOpen = (s: PtSession) => s.status === "requested" || s.status === "confirmed";

/** Personal training: PT credits, my sessions, and the way into booking one. */
export function PtPage() {
  const t = useT();
  const { data: options } = usePtOptions();
  const { data: sessions, isLoading } = useMyPtSessions();
  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");
  const [now] = useState(() => Date.now());
  const [cancelling, setCancelling] = useState<PtSession | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const cancel = useCancelPt();

  if (isLoading) return <Spinner label={t("Loading sessions…")} />;

  const upcoming = (s: PtSession) => isOpen(s) && Date.parse(s.ends_at) > now;
  const list = (sessions ?? [])
    .filter((s) => (tab === "upcoming" ? upcoming(s) : !upcoming(s)))
    .sort((a, b) => (tab === "upcoming" ? a.starts_at.localeCompare(b.starts_at) : b.starts_at.localeCompare(a.starts_at)));

  const onCancel = async (s: PtSession) => {
    setMessage(null);
    try {
      const res = await cancel.mutateAsync(s.appointment_id);
      setMessage({
        kind: "ok",
        text:
          res.penalty > 0
            ? fill(t("Cancelled after the deadline - {n} PT credit forfeited."), { n: res.penalty })
            : t("Session cancelled."),
      });
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof ApiError ? e.message : t("Cancel failed.") });
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="nh-display text-3xl font-black">{t("Personal training")}</h1>
        <p className="mt-1 text-sm text-nh-muted">{t("1:1 sessions with a coach, paid with PT credits.")}</p>
      </div>

      {options && options.class_types.length > 0 ? (
        <div className="nh-surface-ink relative overflow-hidden rounded-3xl p-5 text-white">
          <div className="nh-pattern-brand pointer-events-none absolute inset-0" aria-hidden />
          <p className="relative text-[11px] font-extrabold tracking-[0.16em] text-white/60 uppercase">{t("PT credits")}</p>
          <div className="relative mt-2 flex flex-col gap-1.5">
            {options.class_types.map((ct) => (
              <div key={ct.id} className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-bold text-white/80">{ct.name}</span>
                <span className="nh-display text-2xl font-black">{ct.credits_available}</span>
              </div>
            ))}
          </div>
          {options.class_types.every((ct) => ct.credits_available === 0) ? (
            <Link href={m("/wallet")} className="relative mt-3 inline-block text-sm font-bold text-white underline">
              {t("Buy a PT package →")}
            </Link>
          ) : null}
        </div>
      ) : null}

      <Link href={m("/pt/book")} className="nh-btn-brand">
        <Dumbbell size={18} /> {t("Book a PT session")}
      </Link>

      {message ? (
        <div
          role="status"
          className={`rounded-xl p-3 text-sm font-bold ${
            message.kind === "ok" ? "bg-nh-ok/15 text-nh-ok" : "bg-nh-danger/15 text-nh-danger"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <div className="flex rounded-xl bg-nh-cream p-1">
        {(["upcoming", "history"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg py-2 text-sm font-black tracking-wide uppercase ${
              tab === key ? "bg-nh-ink-soft text-white" : "text-nh-muted"
            }`}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState
          title={tab === "upcoming" ? t("No PT sessions coming up") : t("No history yet")}
          hint={tab === "upcoming" ? t("Pick a coach and a free slot to request one.") : undefined}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((s) => {
            const status = PT_STATUS[s.status];
            return (
              <div key={s.participant_id} className="nh-card flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-black">{s.class_type_name}</p>
                    <p className="truncate text-sm text-nh-muted">
                      {joinDot(formatDayTime(s.starts_at, s.timezone), s.coach_name, s.branch_name)}
                    </p>
                  </div>
                  <StatusBadge status={status.label} tone={status.tone} />
                </div>
                {s.cancel_reason && s.status === "cancelled" ? (
                  <p className="text-xs text-nh-muted">{s.cancel_reason}</p>
                ) : null}
                {s.late_cancel || s.credits_charged > 0 ? (
                  <p className="text-xs font-bold text-nh-muted">
                    {fill(t("{n} PT credit used"), { n: s.credits_charged })}
                  </p>
                ) : null}
                {upcoming(s) ? (
                  <div className="flex gap-2">
                    {s.can_reschedule ? (
                      <Link href={m(`/pt/book?move=${s.appointment_id}`)} className="nh-btn-ghost flex-1 !py-2 text-sm">
                        {t("Move session")}
                      </Link>
                    ) : null}
                    <button className="nh-btn-ghost flex-1 !py-2 text-sm text-nh-danger" onClick={() => setCancelling(s)}>
                      {s.status === "requested" ? t("Withdraw request") : t("Cancel session")}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {cancelling ? (
        <BottomSheet title={t("Cancel this session?")} onClose={() => setCancelling(null)}>
          <div className="flex flex-col gap-3 text-sm">
            <p>{joinDot(cancelling.class_type_name, formatDayTime(cancelling.starts_at, cancelling.timezone), cancelling.coach_name)}</p>
            {cancelling.status === "confirmed" && now > Date.parse(cancelling.free_cancel_until) ? (
              <p className="rounded-xl bg-nh-warn/15 p-3 font-bold text-nh-warn">
                {fill(t("The free cancellation window has passed: {n} PT credit may be forfeited."), {
                  n: cancelling.credit_cost,
                })}
              </p>
            ) : (
              <p className="text-nh-muted">{t("No credits are taken for cancelling now.")}</p>
            )}
            <button
              className="nh-btn-brand"
              disabled={cancel.isPending}
              onClick={() => void onCancel(cancelling)}
            >
              {t("Yes, cancel")}
            </button>
            <button className="nh-btn-ghost" onClick={() => setCancelling(null)}>
              {t("Keep it")}
            </button>
          </div>
        </BottomSheet>
      ) : null}
    </div>
  );
}
