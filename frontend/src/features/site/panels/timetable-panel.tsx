"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CLASS_COLOR, type ClassColor } from "@/features/gym/scheduling/api";
import { fetchPublicBranches } from "@/features/site-forms/branches";
import { formatTime } from "@/lib/format";
import { todayWib } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  addDays,
  clampWeek,
  DAY_LABELS,
  DAY_SHORT,
  groupByDay,
  type PublicSession,
  type PublicTimetable,
  sessionHref,
  shortDate,
  weekDays,
  weekdayIndex,
  weekWindow,
} from "../lib/timetable";
import { readBranchCookie } from "../shell/panels";

const selectClass =
  "h-11 w-full rounded-2xl border border-border bg-card px-4 text-sm text-foreground outline-none focus-visible:border-forest focus-visible:ring-2 focus-visible:ring-forest/20";

async function fetchTimetable(slug: string, week: string): Promise<PublicTimetable> {
  const params = new URLSearchParams({ branch: slug, week });
  const res = await fetch(`/api/public/site/sessions?${params}`, { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: PublicTimetable; error?: string };
  if (!res.ok || !json.success || !json.data) throw new Error(json.error || "Jadwal tidak dapat dimuat");
  return json.data;
}

function seatsLabel(s: PublicSession): { text: string; full: boolean } {
  if (s.seats_left > 0) return { text: `${s.seats_left} kursi tersisa`, full: false };
  return { text: s.waitlist_open ? "Penuh · daftar tunggu dibuka" : "Penuh", full: true };
}

function SessionRow({ session }: { session: PublicSession }) {
  const seats = seatsLabel(session);
  return (
    <li>
      <Link
        href={sessionHref(session.id)}
        className="grid grid-cols-[minmax(0,3.5rem)_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-2xl bg-card px-4 py-3 shadow-card transition-colors hover:bg-surface-2"
      >
        <span className="font-display text-base font-semibold text-foreground tabular-nums">{formatTime(session.starts_at)}</span>
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", CLASS_COLOR[session.class_type.color as ClassColor]?.bar ?? "bg-forest")} />
          <span className="truncate font-semibold text-foreground">{session.class_type.name}</span>
        </span>
        <span className="text-xs text-muted-foreground">{session.duration_min} mnt</span>
        <span className="flex min-w-0 flex-wrap gap-x-3 text-xs">
          {session.coach_name ? <span className="truncate text-body">Coach {session.coach_name}</span> : null}
          <span className={cn("font-semibold", seats.full ? "text-warning" : "text-forest dark:text-accent")}>{seats.text}</span>
        </span>
      </Link>
    </li>
  );
}

/**
 * The timetable slide-over: branch picker, week navigation inside the
 * API's window, day tabs with today selected, and one link per session
 * into the member app, which handles login and booking.
 */
export default function TimetablePanel({ branchSlug }: { branchSlug?: string; onClose(): void }) {
  const range = useMemo(() => weekWindow(), []);
  const today = todayWib();
  const [picked, setPicked] = useState(() => branchSlug ?? readBranchCookie(document.cookie) ?? "");
  const [week, setWeek] = useState(range.first);
  const [day, setDay] = useState(today);

  const branchesQuery = useQuery({ queryKey: ["public-branches"], queryFn: fetchPublicBranches });
  const branches = branchesQuery.data;
  const slug = picked || branches?.[0]?.slug || "";
  const query = useQuery({
    queryKey: ["public-timetable", slug, week],
    queryFn: () => fetchTimetable(slug, week),
    enabled: Boolean(slug),
  });
  const data = query.data;
  const state = query.isError ? "error" : slug && !query.isPending ? "ready" : "loading";

  const days = weekDays(week);
  const selectedDay = days.includes(day) ? day : days[0];
  const groups = useMemo(() => groupByDay(data?.sessions ?? [], week), [data, week]);
  const sessions = groups.get(selectedDay) ?? [];

  const move = (delta: number) => {
    const next = clampWeek(addDays(week, 7 * delta), range);
    setWeek(next);
    setDay(next === range.first ? today : next);
  };

  if (branches && branches.length === 0) {
    return <p className="text-sm text-body">Belum ada cabang yang membuka jadwal publik.</p>;
  }

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        <span className="mb-1.5 block font-semibold text-foreground">Cabang</span>
        <select className={selectClass} value={slug} onChange={(e) => setPicked(e.target.value)} disabled={!branches}>
          {branches ? null : <option value={slug}>Memuat cabang…</option>}
          {branches?.map((b) => (
            <option key={b.slug} value={b.slug}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="icon" aria-label="Minggu sebelumnya" disabled={week <= range.first} onClick={() => move(-1)}>
          <ChevronLeft />
        </Button>
        <p className="text-sm font-semibold text-foreground">
          {shortDate(days[0])} – {shortDate(days[6])}
        </p>
        <Button variant="ghost" size="icon" aria-label="Minggu berikutnya" disabled={week >= range.last} onClick={() => move(1)}>
          <ChevronRight />
        </Button>
      </div>

      <div role="tablist" aria-label="Hari" className="grid grid-cols-7 gap-1">
        {days.map((d, i) => {
          const active = d === selectedDay;
          const count = groups.get(d)?.length ?? 0;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={`${DAY_LABELS[i]} ${shortDate(d)}`}
              onClick={() => setDay(d)}
              className={cn(
                "flex flex-col items-center rounded-2xl py-2 text-xs transition-colors",
                active ? "bg-ink text-on-ink" : "bg-card text-body shadow-card hover:bg-surface-2",
                d === today && !active && "font-semibold text-foreground",
              )}
            >
              <span>{DAY_SHORT[i]}</span>
              <span className="font-display text-base font-semibold tabular-nums">{d.slice(8)}</span>
              <span aria-hidden className={cn("mt-1 size-1 rounded-full", count > 0 ? (active ? "bg-accent" : "bg-forest") : "bg-transparent")} />
            </button>
          );
        })}
      </div>

      <div role="tabpanel" aria-label={DAY_LABELS[weekdayIndex(selectedDay)]}>
        {state === "loading" ? (
          <ul className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <Skeleton className="h-16 rounded-2xl" />
              </li>
            ))}
          </ul>
        ) : state === "error" ? (
          <p className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
            Jadwal tidak dapat dimuat. Coba lagi sebentar lagi.
          </p>
        ) : sessions.length === 0 ? (
          <p className="rounded-2xl bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-card">
            Belum ada kelas pada {DAY_LABELS[weekdayIndex(selectedDay)]}, {shortDate(selectedDay)}.
          </p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => (
              <SessionRow key={s.id} session={s} />
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted-foreground">Pilih kelas untuk memesan lewat Area Member. Member baru cukup masuk dengan nomor WhatsApp.</p>
    </div>
  );
}
