"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { ApiError } from "../lib/api";
import { joinDot } from "../lib/classes-view";
import { fill, useT } from "../lib/i18n";
import { initialsOf } from "../lib/initials";
import { useLang } from "../lib/lang";
import { m } from "../lib/links";
import { useMyPtSessions, usePtOptions, usePtSlots, useReschedulePt, useRequestPt } from "../lib/queries-coaching";
import { addDays } from "@/lib/dates";
import { localDay } from "@/lib/timezone";
import { Spinner, chipClass, formatDayTime, formatTime } from "../ui";

/** useSearchParams needs a Suspense boundary for prerendering. */
export function PtBookPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <PtBook />
    </Suspense>
  );
}

/**
 * Request a PT session: pick the session type, a coach, a day, then a free
 * slot. The coach confirms it. With ?move=<appointment id> the same picker
 * moves an existing session: the coach and type stay, only the slot changes.
 */
function PtBook() {
  const t = useT();
  const router = useRouter();
  const locale = useLang() === "id" ? "id-ID" : undefined;
  const { data: options, isLoading } = usePtOptions();
  const moveId = useSearchParams().get("move") ?? "";
  const { data: sessions, isLoading: sessionsLoading } = useMyPtSessions();
  const moving = moveId ? sessions?.find((s) => s.appointment_id === moveId && s.can_reschedule) : undefined;
  const [typeId, setTypeId] = useState("");
  const [coachId, setCoachId] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [day, setDay] = useState("");
  const [slot, setSlot] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const request = useRequestPt();
  const reschedule = useReschedulePt();

  // Days and slots read in the coach's branch zone, the zone the coach's hours are set in.
  const coach = options?.coaches.find((c) => c.id === (moving?.coach_id ?? coachId)) ?? options?.coaches[0];
  const firstDay = options ? localDay(options.earliest_start, coach?.timezone) : "";
  const from = firstDay ? addDays(firstDay, weekOffset * 7) : "";
  const type = options?.class_types.find((ct) => ct.id === (moving?.class_type_id ?? typeId)) ?? options?.class_types[0];
  const { data: slots, isLoading: slotsLoading } = usePtSlots(coach?.id ?? "", type?.id ?? "", from);

  const days = useMemo(
    () =>
      from
        ? Array.from({ length: 7 }, (_, i) => {
            const key = addDays(from, i);
            const date = new Date(`${key}T12:00:00+07:00`);
            return { key, date, label: date.toLocaleDateString(locale, { weekday: "short" }) };
          })
        : [],
    [from, locale]
  );
  const byDay = (key: string) => (slots ?? []).filter((s) => localDay(s.starts_at, coach?.timezone) === key);
  const activeDay = day && days.some((d) => d.key === day) ? day : (days.find((d) => byDay(d.key).length > 0)?.key ?? days[0]?.key ?? "");
  const maxOffset = options ? Math.floor((options.horizon_days - 1) / 7) : 0;

  if (isLoading || (moveId && sessionsLoading)) return <Spinner label={t("Loading coaches…")} />;
  if (moveId && !moving) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <div className="nh-card text-sm text-nh-muted">{t("This session can no longer be moved.")}</div>
      </div>
    );
  }
  if (!options || options.class_types.length === 0 || options.coaches.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <div className="nh-card text-sm text-nh-muted">{t("No coach is taking personal training sessions yet.")}</div>
      </div>
    );
  }

  // A move keeps its credits reserved; a new request needs them, unless the pass covers PT.
  const short = Boolean(!moving && !options.pass_covers_pt && type && type.credits_available < type.credit_cost);
  const busy = request.isPending || reschedule.isPending;
  const submit = async () => {
    if (!type || !coach || !slot) return;
    setError("");
    try {
      if (moving) {
        await reschedule.mutateAsync({ appointmentId: moving.appointment_id, startsAt: slot });
      } else {
        await request.mutateAsync({ coach_id: coach.id, class_type_id: type.id, starts_at: slot, notes: notes.trim() });
      }
      router.replace(m("/pt"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : moving ? t("Move failed.") : t("Request failed."));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <BackLink />
      <h1 className="nh-display text-3xl font-black">{moving ? t("Move your PT session") : t("Book a PT session")}</h1>

      {moving ? (
        <div className="nh-card flex flex-col gap-1 text-sm">
          <p className="font-black">{moving.class_type_name}</p>
          <p className="text-nh-muted">{joinDot(formatDayTime(moving.starts_at, moving.timezone), moving.coach_name)}</p>
          <p className="text-xs font-bold text-nh-muted">{fill(t("Moves left after this one: {n}"), { n: moving.reschedules_left - 1 })}</p>
        </div>
      ) : null}

      {!moving && options.class_types.length > 1 ? (
        <section className="flex flex-col gap-2">
          <p className="nh-label !mb-0">{t("Session type")}</p>
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 py-1">
            {options.class_types.map((ct) => (
              <button
                key={ct.id}
                onClick={() => {
                  setTypeId(ct.id);
                  setSlot("");
                }}
                className={chipClass(ct.id === type?.id)}
              >
                {ct.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {type && !moving ? (
        <p className="text-sm text-nh-muted">
          {options.pass_covers_pt
            ? fill(t("{min} min · covered by your pass"), { min: type.duration_min })
            : fill(t("{min} min · {cost} PT credit · you have {left}"), {
                min: type.duration_min,
                cost: type.credit_cost,
                left: type.credits_available,
              })}
        </p>
      ) : null}
      {short ? (
        <div className="rounded-xl bg-nh-warn/15 p-3 text-sm font-bold text-nh-warn">
          {t("Not enough PT credits for this session.")}{" "}
          <Link href={m("/wallet")} className="underline">
            {t("Buy a PT package →")}
          </Link>
        </div>
      ) : null}

      {!moving ? (
        <section className="flex flex-col gap-2">
          <p className="nh-label !mb-0">{t("Coach")}</p>
          <div className="flex flex-col gap-2">
            {options.coaches.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setCoachId(c.id);
                  setSlot("");
                }}
                className={`nh-card flex items-center gap-3 !p-3 text-left ${c.id === coach?.id ? "ring-2 ring-nh-forest" : ""}`}
                aria-pressed={c.id === coach?.id}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-nh-ink-soft text-sm font-black text-white">
                  {initialsOf(c.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-black">{c.name}</span>
                  <span className="block truncate text-xs text-nh-muted">{c.specialization || t("Coach")}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="nh-label !mb-0">{t("Pick a time")}</p>
          <div className="flex gap-1">
            <button
              className="rounded-full bg-nh-cream px-3 py-1 text-xs font-bold text-nh-forest disabled:opacity-40"
              disabled={weekOffset === 0}
              onClick={() => setWeekOffset((w) => w - 1)}
            >
              ←
            </button>
            <button
              className="rounded-full bg-nh-cream px-3 py-1 text-xs font-bold text-nh-forest disabled:opacity-40"
              disabled={weekOffset >= maxOffset}
              onClick={() => setWeekOffset((w) => w + 1)}
            >
              →
            </button>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {days.map((d) => {
            const free = byDay(d.key).length;
            return (
              <button
                key={d.key}
                onClick={() => {
                  setDay(d.key);
                  setSlot("");
                }}
                className={`flex min-w-14 flex-col items-center rounded-2xl border px-3 py-2 transition ${
                  activeDay === d.key
                    ? "nh-surface-ink border-transparent text-white"
                    : free
                      ? "border-nh-line bg-nh-cream text-nh-ink"
                      : "border-nh-line bg-nh-cream text-nh-muted opacity-60"
                }`}
              >
                <span className="text-[11px] font-bold uppercase">{d.label}</span>
                <span className="text-lg font-black">{d.date.getDate()}</span>
              </button>
            );
          })}
        </div>
        {slotsLoading ? (
          <Spinner label={t("Finding free slots…")} />
        ) : byDay(activeDay).length === 0 ? (
          <div className="nh-card text-sm text-nh-muted">{t("No free slots this day. Try another day or coach.")}</div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {byDay(activeDay).map((s) => (
              <button
                key={s.starts_at}
                onClick={() => setSlot(s.starts_at)}
                className={`rounded-xl py-2.5 text-sm font-black tabular-nums ${
                  slot === s.starts_at ? "bg-nh-lime text-nh-ink" : "bg-nh-cream text-nh-ink"
                }`}
                aria-pressed={slot === s.starts_at}
              >
                {formatTime(s.starts_at, coach?.timezone)}
              </button>
            ))}
          </div>
        )}
      </section>

      {!moving ? (
        <section className="flex flex-col gap-2">
          <p className="nh-label !mb-0">{t("Note for the coach")}</p>
          <textarea
            className="nh-input min-h-20"
            value={notes}
            maxLength={500}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("What do you want to work on?")}
          />
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-xl bg-nh-danger/15 p-3 text-sm font-bold text-nh-danger">
          {error}
        </p>
      ) : null}

      <button className="nh-btn-brand" disabled={!slot || short || busy} onClick={() => void submit()}>
        {moving ? t("Confirm new time") : t("Send request")}
      </button>
      <p className="text-center text-xs text-nh-muted">
        {moving
          ? t("Your coach is told about the move. The session keeps its status and credits.")
          : options.pass_covers_pt
            ? t("The coach confirms your request. Your pass covers the session.")
            : t("The coach confirms your request. PT credits are used when the session is done.")}
      </p>
    </div>
  );
}

function BackLink() {
  const t = useT();
  return (
    <Link href={m("/pt")} className="flex items-center gap-1 text-sm font-bold text-nh-muted">
      <ChevronLeft size={16} />
      {t("Personal training")}
    </Link>
  );
}
