"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { joinDot } from "../lib/classes-view";
import { fill, useT } from "../lib/i18n";
import { initialsOf } from "../lib/initials";
import { m } from "../lib/links";
import { useTrainer } from "../lib/queries-classes";
import { Spinner, formatDayTime } from "../ui";

/** One trainer: who they are, and every class of theirs a member can book. */
export function TrainerDetailPage() {
  const t = useT();
  const { coachId = "" } = useParams<{ coachId: string }>();
  const { data, isLoading, isError } = useTrainer(coachId);

  if (isLoading) return <Spinner label={t("Loading trainer…")} />;
  if (isError || !data) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <div className="nh-card text-sm text-nh-muted">{t("We could not find that trainer.")}</div>
      </div>
    );
  }

  const { coach, branchName, upcoming, classTypeNames } = data;

  return (
    <div className="flex flex-col gap-5">
      <BackLink />

      <div className="nh-surface-ink relative overflow-hidden rounded-3xl p-6 text-white">
        <div className="nh-pattern-brand pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative flex items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-nh-lime text-lg font-black text-nh-ink">
            {initialsOf(coach.name)}
          </span>
          <div className="min-w-0">
            <h1 className="nh-display truncate text-2xl font-black">{coach.name}</h1>
            <p className="truncate text-sm text-white/60">{joinDot(coach.specialization || t("Coach"), branchName)}</p>
          </div>
        </div>
        {coach.bio ? <p className="relative mt-4 text-sm text-white/70">{coach.bio}</p> : null}
        {classTypeNames.length > 0 ? (
          <div className="relative mt-4 flex flex-wrap gap-1.5">
            {classTypeNames.map((name) => (
              <span key={name} className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold text-white/80">
                {name}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-black tracking-wider text-nh-muted uppercase">{t("Coming up")}</h2>
        <Link href={m("/classes")} className="text-xs font-bold text-nh-forest">
          {t("Full schedule →")}
        </Link>
      </div>

      {upcoming.length === 0 ? (
        <div className="nh-card text-sm text-nh-muted">
          {fill(t("{name} has nothing scheduled in the next fortnight."), { name: coach.name.split(" ")[0] ?? "" })}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {upcoming.map((v) => {
            const mine = v.myBooking;
            const full = v.spotsLeft === 0;
            return (
              <Link key={v.session.id} href={m(`/classes/${v.session.id}`)} className="nh-card flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-black">{v.classTypeName}</p>
                  <p className="truncate text-sm text-nh-muted">
                    {joinDot(formatDayTime(v.session.startsAt), v.branchName)}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs font-black uppercase">
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

function BackLink() {
  const t = useT();
  return (
    <Link href={m("/trainers")} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
      <ChevronLeft size={16} />
      {t("Trainers")}
    </Link>
  );
}
