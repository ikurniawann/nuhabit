"use client";

import { CalendarDays, Clock, MapPin, User } from "lucide-react";
import { useState, type ReactNode } from "react";
import { eventSeat, type EventSeat } from "@/lib/member-app/loyalty";
import { formatNumber, formatRupiah } from "@/lib/format";
import { BottomSheet } from "../components/bottom-sheet";
import { ApiError } from "../lib/api";
import { useT, type T } from "../lib/i18n";
import { homeKeys } from "../lib/queries-home";
import {
  bookCrmEvent,
  cancelCrmEvent,
  loyaltyKeys,
  useCrmEvents,
  useRefresh,
  type CrmEvent,
} from "../lib/queries-loyalty";
import { EmptyState, Spinner, formatDayTime, formatTime } from "../ui";
import { Notice, PageTitle } from "./loyalty-ui";

function seatChip(t: T, seat: EventSeat, event: CrmEvent): { label: string; className: string } | null {
  if (seat === "confirmed") return { label: t("Registered"), className: "bg-nh-lime text-nh-ink" };
  if (seat === "waitlist") {
    return { label: t("Waitlist #{n}", { n: event.waitlist_position ?? "" }), className: "bg-nh-raised text-nh-ink" };
  }
  if (seat === "full") return { label: t("Full · waitlist"), className: "bg-nh-raised text-nh-muted" };
  return null;
}

/** Event komunitas CRM (race day, workshop): daftar sekali tap, penuh = waitlist. */
export function EventsPage() {
  const t = useT();
  const { data, isLoading, error } = useCrmEvents();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = data?.find((e) => e.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <PageTitle hint={t("Race days, workshops, and community meetups. Sign up in one tap.")}>{t("Events")}</PageTitle>
      {isLoading ? <Spinner label={t("Loading events…")} /> : null}
      {error ? <Notice ok={false}>{error.message}</Notice> : null}
      {data && data.length === 0 ? (
        <EmptyState
          title={t("No events scheduled")}
          hint={t("We'll let you know in your notifications when something new is up.")}
        />
      ) : null}
      {data?.map((event) => {
        const chip = seatChip(t, eventSeat(event), event);
        const seatsLeft = Math.max(0, event.capacity - event.confirmed_count);
        return (
          <button
            key={event.id}
            type="button"
            onClick={() => setOpenId(event.id)}
            className="nh-card block w-full text-left active:scale-[0.99]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold tracking-[0.18em] text-nh-muted uppercase">
                  {formatDayTime(event.starts_at)}
                </p>
                <p className="nh-display mt-1 text-xl leading-tight">{event.title}</p>
              </div>
              {chip ? <span className={`nh-chip shrink-0 ${chip.className}`}>{chip.label}</span> : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-nh-muted">
              {event.location ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={13} /> {event.location}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <User size={13} /> {seatsLeft > 0 ? t("{n} spots left", { n: seatsLeft }) : t("Full")}
              </span>
              <span className="font-bold text-nh-ink">
                {event.price_idr > 0 ? formatRupiah(event.price_idr) : t("Free")}
              </span>
            </div>
          </button>
        );
      })}
      {open ? <EventSheet event={open} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

function Detail({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0 text-nh-muted">{icon}</span>
      <span>{children}</span>
    </p>
  );
}

function EventSheet({ event, onClose }: { event: CrmEvent; onClose: () => void }) {
  const t = useT();
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const seat = eventSeat(event);
  const active = seat === "confirmed" || seat === "waitlist";

  const act = async (action: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await action() });
      await refresh(loyaltyKeys.events, homeKeys.notifications);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : t("Request failed") });
    } finally {
      setBusy(false);
    }
  };

  const book = () =>
    act(async () => {
      const result = await bookCrmEvent(event.id);
      return result.kind === "confirm"
        ? t("You're registered. See you there!")
        : t("The event is full. You're on the waitlist at #{n}.", { n: result.position ?? "" });
    });
  const cancel = () =>
    act(async () => {
      await cancelCrmEvent(event.booking_id ?? "");
      return t("Registration cancelled.");
    });

  return (
    <BottomSheet kicker={formatDayTime(event.starts_at)} title={event.title} onClose={onClose}>
      <div className="nh-card flex flex-col gap-2.5 text-sm">
        <Detail icon={<Clock size={15} />}>
          {formatDayTime(event.starts_at)} - {formatTime(event.ends_at)}
        </Detail>
        {event.location ? <Detail icon={<MapPin size={15} />}>{event.location}</Detail> : null}
        {event.host_name ? (
          <Detail icon={<User size={15} />}>{t("With {name}", { name: event.host_name })}</Detail>
        ) : null}
        <Detail icon={<CalendarDays size={15} />}>
          {t("{n} of {total} spots taken", {
            n: formatNumber(event.confirmed_count),
            total: formatNumber(event.capacity),
          })}{" "}
          · {event.price_idr > 0 ? t("{amount}, pay at the outlet", { amount: formatRupiah(event.price_idr) }) : t("Free")}
        </Detail>
      </div>
      {event.description ? (
        <p className="mt-4 text-sm whitespace-pre-line text-nh-ink/80">{event.description}</p>
      ) : null}
      {message ? (
        <div className="mt-4">
          <Notice ok={message.ok}>{message.text}</Notice>
        </div>
      ) : null}
      <div className="mt-5">
        {active ? (
          <>
            <button
              type="button"
              className="nh-btn-ghost w-full text-nh-danger"
              disabled={busy}
              onClick={() => void cancel()}
            >
              {seat === "waitlist" ? t("Leave the waitlist") : t("Cancel registration")}
            </button>
            {seat === "confirmed" && event.cancel_deadline_hours > 0 ? (
              <p className="mt-2 text-center text-xs text-nh-muted">
                {t("Cancelling less than {n} hours before the start counts as a late cancel.", {
                  n: event.cancel_deadline_hours,
                })}
              </p>
            ) : null}
          </>
        ) : event.booking_status === null ? (
          <button type="button" className="nh-btn-brand w-full" disabled={busy} onClick={() => void book()}>
            {busy ? t("Processing…") : seat === "full" ? t("Join waitlist") : t("Sign up")}
          </button>
        ) : null}
      </div>
    </BottomSheet>
  );
}
