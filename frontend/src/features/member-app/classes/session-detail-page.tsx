"use client";

import { ArrowLeft, CalendarPlus2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "../lib/api";
import { coverageFor } from "../lib/classes-view";
import { fill, useT } from "../lib/i18n";
import { googleCalendarEventUrl } from "../lib/google-calendar";
import { classTypeKey } from "../lib/images";
import { m } from "../lib/links";
import {
  confirmSpot,
  useBookMutation,
  useCancelMutation,
  useInvalidateAll,
  useSession,
  useWallet,
} from "../lib/queries-classes";
import { sessionRundown } from "./session-rundown";
import { Spinner, formatDayTime } from "../ui";

export function SessionDetailPage() {
  const t = useT();
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const { data: v, isLoading } = useSession(sessionId);
  const { data: wallet } = useWallet();
  const book = useBookMutation();
  const cancel = useCancelMutation();
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const invalidate = useInvalidateAll();

  const onConfirmSpot = async (bookingId: string) => {
    setConfirmBusy(true);
    setMessage(null);
    try {
      await confirmSpot(bookingId);
      setMessage({ kind: "ok", text: t("You're in - spot confirmed!") });
      invalidate();
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof ApiError ? e.message : t("Could not confirm.") });
      invalidate();
    } finally {
      setConfirmBusy(false);
    }
  };

  if (isLoading || !v) return <Spinner label={t("Loading class…")} />;

  const mine = v.myBooking;
  const bookable = ["PUBLISHED", "FULL"].includes(v.session.status);
  // Package coverage indicator: null = no package credits (no restriction).
  const covered = coverageFor(wallet, v.session.classTypeId);
  const calendarUrl = mine?.status === "CONFIRMED"
    ? googleCalendarEventUrl({
        title: v.classTypeName,
        startsAt: v.session.startsAt,
        endsAt: v.session.endsAt,
        branchName: v.branchName,
        coachName: v.coachName,
      })
    : null;

  const onBook = async () => {
    setMessage(null);
    try {
      const res = await book.mutateAsync(v.session.id);
      setMessage({
        kind: "ok",
        text:
          res.decision === "CONFIRMED"
            ? t("You're in! See you at the studio.")
            : fill(t("Class is full - you're #{n} on the waitlist."), { n: res.booking.waitlistPosition ?? "" }),
      });
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof ApiError ? e.message : t("Booking failed.") });
    }
  };

  const onCancel = async () => {
    if (!mine) return;
    setMessage(null);
    try {
      const res = await cancel.mutateAsync(mine.id);
      setMessage({
        kind: "ok",
        text:
          res.outcome === "LATE" && res.penaltyCredits > 0
            ? fill(t("Cancelled after the deadline - {n} credit forfeited."), { n: res.penaltyCredits })
            : t("Booking cancelled."),
      });
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof ApiError ? e.message : t("Cancel failed.") });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
        <ArrowLeft size={16} /> {t("Back")}
      </button>

      <div>
        <h1 className="nh-display text-3xl font-black">{v.classTypeName}</h1>
        <p className="mt-1 text-nh-muted">{formatDayTime(v.session.startsAt)}</p>
      </div>

      {covered === false ? (
        <div className="rounded-xl bg-nh-warn/15 p-3 text-sm font-bold text-nh-warn">
          {t("None of your packages cover this class - top up with a package that includes it.")}
        </div>
      ) : covered === true ? (
        <p className="nh-chip self-start bg-nh-ok/10 text-nh-ok">{t("Covered by your package")}</p>
      ) : null}

      <div className="nh-card grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="nh-label !mb-0.5">{t("Branch")}</p>
          <p className="font-bold">{v.branchName || "-"}</p>
        </div>
        <div>
          <p className="nh-label !mb-0.5">{t("Coach")}</p>
          <p className="font-bold">{v.coachName || "-"}</p>
        </div>
        <div>
          <p className="nh-label !mb-0.5">{t("Cost")}</p>
          <p className="font-bold text-nh-forest">
            {v.session.creditCost} {t(v.session.creditCost === 1 ? "credit" : "credits")}
          </p>
        </div>
        <div>
          <p className="nh-label !mb-0.5">{t("Capacity")}</p>
          <p className="font-bold">
            {v.confirmedCount}/{v.session.capacity} · {v.spotsLeft} {t("slots left")}
            {v.waitlistCount > 0 ? ` · ${v.waitlistCount} ${t("waiting")}` : ""}
          </p>
        </div>
      </div>

      <section className="nh-card">
        <p className="nh-label">{t("Rundown")}</p>
        <div className="flex flex-col">
          {sessionRundown(classTypeKey(v.classTypeName) ?? v.session.classTypeId, v.session.startsAt, v.session.endsAt).map(
            (item, i, arr) => (
              <div key={item.label} className="flex gap-3">
                <p className="w-14 shrink-0 pt-0.5 text-right font-mono text-xs font-bold text-nh-muted">
                  {item.startsAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
                <div className="flex flex-col items-center">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i === 0 ? "bg-nh-forest" : "bg-nh-ink/25"}`} />
                  {i < arr.length - 1 ? <span className="w-px flex-1 bg-nh-line" /> : null}
                </div>
                <div className="pb-4">
                  <p className="text-sm leading-tight font-extrabold">{t(item.label)}</p>
                  <p className="text-xs text-nh-muted">{item.minutes} min</p>
                </div>
              </div>
            )
          )}
        </div>
      </section>

      {message ? (
        <div
          className={`rounded-xl p-3 text-sm font-bold ${
            message.kind === "ok" ? "bg-nh-ok/15 text-nh-ok" : "bg-nh-danger/15 text-nh-danger"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {mine ? (
        <div className="flex flex-col gap-2">
          <div className="nh-card text-sm">
            {mine.status === "CONFIRMED" ? (
              <p className="font-bold text-nh-ok">{t("You're booked. Scan your QR at the gate to check in.")}</p>
            ) : mine.status === "CHECKED_IN" ? (
              <p className="font-bold text-nh-ok">{t("Checked in - enjoy the session!")}</p>
            ) : mine.promotionOfferedAt ? (
              <p className="font-bold text-nh-forest">
                {t("A spot opened up - confirm it before someone else takes it.")}
              </p>
            ) : (
              <p className="font-bold text-nh-warn">
                {fill(t("Waitlist position #{n}."), { n: mine.waitlistPosition ?? "" })}
              </p>
            )}
          </div>
          {calendarUrl ? (
            <a href={calendarUrl} target="_blank" rel="noopener noreferrer" className="nh-btn-ghost inline-flex gap-2 text-nh-forest">
              <CalendarPlus2 size={18} /> {t("Add to Google Calendar")}
            </a>
          ) : null}
          {mine.status === "WAITLIST" && mine.promotionOfferedAt ? (
            <button className="nh-btn-brand" disabled={confirmBusy} onClick={() => void onConfirmSpot(mine.id)}>
              {t("Confirm spot")}
            </button>
          ) : null}
          {["CONFIRMED", "WAITLIST"].includes(mine.status) ? (
            <button className="nh-btn-ghost text-nh-danger" disabled={cancel.isPending} onClick={() => void onCancel()}>
              {mine.status === "WAITLIST" ? t("Leave waitlist") : t("Cancel booking")}
            </button>
          ) : null}
        </div>
      ) : bookable ? (
        <button className="nh-btn-brand" disabled={book.isPending} onClick={() => void onBook()}>
          {v.spotsLeft > 0 ? t("Book this class") : t("Join waitlist")}
        </button>
      ) : (
        <div className="nh-card text-sm text-nh-muted">
          {fill(t("This class is {status}."), { status: t(v.session.status.toLowerCase()) })}
        </div>
      )}

      <Link href={m("/bookings")} className="text-center text-sm font-bold text-nh-forest">
        {t("My bookings")} →
      </Link>
    </div>
  );
}
