"use client";

import Link from "next/link";
import { useState } from "react";
import { joinDot } from "../lib/classes-view";
import { useT } from "../lib/i18n";
import { m } from "../lib/links";
import { useMyBookings } from "../lib/queries-classes";
import { EmptyState, Spinner, StatusBadge, formatDayTime } from "../ui";

export function BookingsPage() {
  const t = useT();
  const { data: bookings, isLoading } = useMyBookings();
  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");
  const [now] = useState(() => Date.now());

  if (isLoading) return <Spinner label={t("Loading bookings…")} />;

  const list = (bookings ?? []).filter((b) =>
    tab === "upcoming"
      ? new Date(b.session.startsAt).getTime() > now && ["CONFIRMED", "WAITLIST", "PENDING"].includes(b.booking.status)
      : new Date(b.session.startsAt).getTime() <= now ||
        ["CANCELLED", "COMPLETED", "NO_SHOW", "CHECKED_IN"].includes(b.booking.status)
  );

  return (
    <div className="flex flex-col gap-5">
      <h1 className="nh-display text-3xl font-black">{t("My bookings")}</h1>
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
          title={tab === "upcoming" ? t("Nothing booked") : t("No history yet")}
          hint={tab === "upcoming" ? t("Find your next session on the schedule.") : undefined}
          action={
            tab === "upcoming" ? (
              <Link href={m("/classes")} className="nh-btn-brand mt-2 !py-2 text-sm">
                {t("Browse classes")}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((b) => (
            <Link key={b.booking.id} href={m(`/classes/${b.session.id}`)} className="nh-card flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-black">{b.classTypeName}</p>
                  <p className="truncate text-sm text-nh-muted">
                    {joinDot(formatDayTime(b.session.startsAt), b.branchName)}
                  </p>
                </div>
                <StatusBadge status={b.booking.status} />
              </div>
              {b.booking.status === "WAITLIST" && b.booking.promotionOfferedAt ? (
                <p className="rounded-lg bg-nh-forest/10 px-3 py-1.5 text-xs font-black text-nh-forest">
                  {t("A spot opened up - tap to confirm it.")}
                </p>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
