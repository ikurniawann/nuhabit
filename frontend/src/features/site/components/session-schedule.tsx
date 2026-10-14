"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSiteDate, formatSiteTime, formatSiteWeekday } from "../lib/dates";
import { sessionHref, wibDay, type PublicSession } from "../lib/timetable";
import { EmptyNote } from "./site-section";

export type ScheduledSession = PublicSession & { branch: { slug: string; name: string } };

function seats(session: PublicSession): string {
  if (session.seats_left > 0) return `${session.seats_left} ${session.seats_left === 1 ? "seat" : "seats"} left`;
  return session.waitlist_open ? "Waitlist open" : "Full";
}

/** Sessions in date order, split into one list per WIB calendar day. */
export function groupByWibDay<T extends PublicSession>(sessions: T[]): T[][] {
  const days = new Map<string, T[]>();
  for (const session of sessions) {
    const day = wibDay(session.starts_at);
    days.set(day, [...(days.get(day) ?? []), session]);
  }
  return [...days.values()];
}

/** Classes grouped by day, with a branch filter when they span more than one branch. */
export function SessionSchedule({ sessions }: { sessions: ScheduledSession[] }) {
  const branches = [...new Map(sessions.map((s) => [s.branch.slug, s.branch.name])).entries()];
  const [branch, setBranch] = useState<string | null>(null);
  const shown = branch ? sessions.filter((s) => s.branch.slug === branch) : sessions;
  const days = groupByWibDay(shown);

  if (sessions.length === 0) return <EmptyNote>No classes on the timetable for the next two weeks.</EmptyNote>;
  return (
    <div className="space-y-5">
      {branches.length > 1 ? (
        <div role="group" aria-label="Filter by branch" className="flex flex-wrap gap-2">
          {[[null, "All branches"] as const, ...branches].map(([slug, name]) => (
            <button
              key={slug ?? "all"}
              type="button"
              aria-pressed={branch === slug}
              onClick={() => setBranch(slug)}
              className={cn(
                "rounded-full px-4 py-2 text-xs font-bold tracking-wider uppercase transition-colors",
                branch === slug ? "bg-ink text-on-ink" : "border border-border text-body hover:bg-surface-2",
              )}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      <ol className="border-t border-border">
        {days.map((day) => (
          <li key={day[0].starts_at} className="grid gap-3 border-b border-border py-5 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-8">
            <div>
              <p className="font-display text-xl font-extrabold uppercase">{formatSiteWeekday(day[0].starts_at)}</p>
              <p className="text-sm text-muted-foreground">{formatSiteDate(day[0].starts_at)}</p>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {day.map((session) => (
                <li key={session.id}>
                  <Link href={sessionHref(session.id)} className="group flex items-center gap-4 border border-border bg-card p-4 transition-colors hover:border-forest/40">
                    <span className="font-display text-3xl font-extrabold tabular-nums">{formatSiteTime(session.starts_at)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display font-extrabold uppercase">{session.class_type.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{session.branch.name} · {session.duration_min} min · {seats(session)}</span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-1" />
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
