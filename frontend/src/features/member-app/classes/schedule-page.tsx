"use client";

import { Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useLang } from "../lib/lang";
import { joinDot } from "../lib/classes-view";
import { useT } from "../lib/i18n";
import { initialsOf } from "../lib/initials";
import { m } from "../lib/links";
import { useBranches, useSessions, useTrainers } from "../lib/queries-classes";
import { Spinner, formatTime } from "../ui";

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function SchedulePage() {
  const t = useT();
  const locale = useLang() === "id" ? "id-ID" : undefined;
  const [branchId, setBranchId] = useState<string>("");
  const [coachId, setCoachId] = useState<string>("");
  const { data: branches } = useBranches();
  // The trainer chips come from the same list the browse screen uses, so a
  // coach with nothing on this fortnight is not offered as a filter.
  const { data: trainers } = useTrainers(branchId || undefined);
  const { data: sessions, isLoading } = useSessions(branchId || undefined, coachId || undefined);

  const selectedTrainer = (trainers ?? []).find((tr) => tr.coach.id === coachId);

  const days = useMemo(() => {
    const out: { key: string; date: Date; label: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      out.push({
        key: dayKey(d.toISOString()),
        date: d,
        label: i === 0 ? "Today" : i === 1 ? "Tmrw" : d.toLocaleDateString(locale, { weekday: "short" }),
      });
    }
    return out;
  }, [locale]);
  const [selectedDay, setSelectedDay] = useState(days[0]!.key);
  const [now] = useState(() => Date.now());

  const visible = (sessions ?? []).filter(
    (v) =>
      dayKey(v.session.startsAt) === selectedDay &&
      ["PUBLISHED", "FULL"].includes(v.session.status) &&
      new Date(v.session.endsAt).getTime() > now
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="nh-display text-3xl font-black">{t("Classes")}</h1>
        <Link
          href={m("/trainers")}
          className="flex items-center gap-1.5 rounded-full bg-nh-cream px-3.5 py-1.5 text-sm font-bold text-nh-forest"
        >
          <Users size={15} />
          {t("Trainers")}
        </Link>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {days.map((d) => (
          <button
            key={d.key}
            onClick={() => setSelectedDay(d.key)}
            className={`flex min-w-14 flex-col items-center rounded-2xl border px-3 py-2 transition ${
              selectedDay === d.key
                ? "nh-surface-ink border-transparent text-white shadow-[0_8px_20px_rgb(0_40_26/0.25)]"
                : "border-nh-line bg-nh-cream text-nh-muted"
            }`}
          >
            <span className="text-[11px] font-bold uppercase">{t(d.label)}</span>
            <span className="text-lg font-black">{d.date.getDate()}</span>
          </button>
        ))}
      </div>

      {/* Branch filter: only worth showing when there is more than one branch. */}
      {(branches ?? []).length > 1 ? (
        <div className="flex gap-2">
          <button
            onClick={() => setBranchId("")}
            className={`rounded-full px-4 py-1.5 text-sm font-bold transition ${
              branchId === "" ? "bg-nh-forest/10 text-nh-forest ring-1 ring-nh-forest/20" : "bg-nh-cream text-nh-muted"
            }`}
          >
            {t("All branches")}
          </button>
          {(branches ?? []).map((b) => (
            <button
              key={b.id}
              onClick={() => setBranchId(b.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-bold transition ${
                branchId === b.id ? "bg-nh-forest/10 text-nh-forest ring-1 ring-nh-forest/20" : "bg-nh-cream text-nh-muted"
              }`}
            >
              {b.name}
            </button>
          ))}
        </div>
      ) : null}

      {/* Who is teaching. Only coaches with classes in the window appear, so a
          chip never leads to an empty day. */}
      {(trainers ?? []).some((tr) => tr.upcomingCount > 0) ? (
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          <button
            onClick={() => setCoachId("")}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-bold transition ${
              coachId === "" ? "bg-nh-forest/10 text-nh-forest ring-1 ring-nh-forest/20" : "bg-nh-cream text-nh-muted"
            }`}
          >
            {t("Any trainer")}
          </button>
          {(trainers ?? [])
            .filter((tr) => tr.upcomingCount > 0)
            .map((tr) => (
              <button
                key={tr.coach.id}
                onClick={() => setCoachId(coachId === tr.coach.id ? "" : tr.coach.id)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-bold transition ${
                  coachId === tr.coach.id
                    ? "bg-nh-forest/10 text-nh-forest ring-1 ring-nh-forest/20"
                    : "bg-nh-cream text-nh-muted"
                }`}
              >
                {tr.coach.name.split(" ")[0]}
              </button>
            ))}
        </div>
      ) : null}

      {selectedTrainer ? (
        <Link href={m(`/trainers/${selectedTrainer.coach.id}`)} className="nh-card flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-nh-forest text-sm font-black text-nh-lime">
            {initialsOf(selectedTrainer.coach.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-black">{selectedTrainer.coach.name}</span>
            <span className="block truncate text-sm text-nh-muted">
              {selectedTrainer.coach.specialization || selectedTrainer.branchName}
            </span>
          </span>
          <span className="text-xs font-bold text-nh-forest">{t("See profile →")}</span>
        </Link>
      ) : null}

      {isLoading ? (
        <Spinner label={t("Loading schedule…")} />
      ) : visible.length === 0 ? (
        <div className="nh-card text-sm text-nh-muted">
          {coachId
            ? t("Nothing from this trainer on this day. Try another day, or clear the filter.")
            : t("No more classes this day.")}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((v) => {
            const mine = v.myBooking;
            const full = v.spotsLeft === 0;
            return (
              <Link key={v.session.id} href={m(`/classes/${v.session.id}`)} className="nh-card flex items-center gap-4">
                <div className="w-14 text-center">
                  <p className="nh-display text-lg leading-tight font-black">{formatTime(v.session.startsAt)}</p>
                  <p className="text-[11px] text-nh-muted">{v.session.creditCost} cr</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-black">{v.classTypeName}</p>
                  <p className="truncate text-sm text-nh-muted">{joinDot(v.branchName, v.coachName)}</p>
                </div>
                <div className="text-right text-xs font-black uppercase">
                  {mine ? (
                    <span className={mine.status === "CONFIRMED" ? "text-nh-ok" : "text-nh-warn"}>
                      {mine.status === "WAITLIST" ? `WL #${mine.waitlistPosition}` : t("Booked")}
                    </span>
                  ) : full ? (
                    <span className="text-nh-warn">{t("Full · WL")}</span>
                  ) : (
                    <span className="text-nh-forest">
                      {v.spotsLeft} {t("left")}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
