"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { addDays, SESSION_BADGE, tanggal, wibDay, wibDayStart, type Session } from "@/features/gym/scheduling/api";
import { bookedSeats, sessionsByDay } from "@/features/gym/scheduling/coach-schedule";
import { CoachAvatar } from "@/features/gym/scheduling/components/coach-avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumber, formatTime } from "@/lib/format";
import { MY_CLASSES_KEYS, myClassesApi } from "../api";
import { MyIncentives } from "./my-incentives";

const UPCOMING_DAYS = 14;
const HISTORY_DAYS = 30;

/** Rentang yang dibaca sekali saat halaman dibuka: hari ini s.d. 14 hari, dan 30 hari ke belakang. */
function windows() {
  const today = wibDay(new Date());
  return {
    today,
    upcoming: { from: wibDayStart(today), to: wibDayStart(addDays(today, UPCOMING_DAYS)) },
    history: { from: wibDayStart(addDays(today, -HISTORY_DAYS)), to: wibDayStart(today) },
  };
}

/** Gym → Kelas Saya: kelas yang dilatih akun ini, roster dan absensinya, serta insentifnya. */
export function MyClassesPage() {
  const [range] = useState(windows);
  const upcoming = useQuery({
    queryKey: MY_CLASSES_KEYS.classes(range.upcoming.from, range.upcoming.to),
    queryFn: () => myClassesApi.classes(range.upcoming.from, range.upcoming.to),
    refetchInterval: 60_000,
  });
  const history = useQuery({
    queryKey: MY_CLASSES_KEYS.classes(range.history.from, range.history.to),
    queryFn: () => myClassesApi.classes(range.history.from, range.history.to),
  });
  const coach = upcoming.data?.coach;

  if (upcoming.isLoading) return <TableNote>Memuat kelas…</TableNote>;
  if (upcoming.error) return <TableNote tone="danger">{upcoming.error.message}</TableNote>;
  if (!coach) {
    return (
      <div className="space-y-4">
        <PageHeader kicker="Gym & Kelas" title="Kelas Saya" />
        <Card className="p-5 text-sm text-body">
          Akun ini belum tertaut ke profil coach. Minta manajer gym menautkan akunmu di menu Coach, lalu muat ulang halaman ini.
        </Card>
      </div>
    );
  }

  const sessions = upcoming.data?.sessions ?? [];
  const live = sessions.filter((s) => s.status !== "cancelled");
  const todayCount = live.filter((s) => wibDay(s.starts_at) === range.today).length;
  const past = [...(history.data?.sessions ?? [])].filter((s) => s.status !== "cancelled").reverse();

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Kelas Saya"
        description="Kelas yang kamu latih. Buka kelas untuk check-in member dan menandai yang tidak hadir."
      />
      <div className="flex items-center gap-3">
        <CoachAvatar name={coach.name} url={coach.photo_url} className="size-12" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{coach.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatNumber(todayCount)} kelas hari ini · {formatNumber(live.length)} kelas dalam {UPCOMING_DAYS} hari
          </p>
        </div>
      </div>

      <Tabs defaultValue="schedule" className="w-full flex-col">
        <TabsList>
          <TabsTrigger value="schedule">Jadwal</TabsTrigger>
          <TabsTrigger value="history">Riwayat</TabsTrigger>
          <TabsTrigger value="incentives">Insentif</TabsTrigger>
        </TabsList>
        <TabsContent value="schedule" className="mt-4">
          {sessions.length === 0 ? (
            <Card className="py-0">
              <TableNote>Belum ada kelas dalam {UPCOMING_DAYS} hari ke depan.</TableNote>
            </Card>
          ) : (
            <DayList sessions={sessions} today={range.today} render={(s) => <UpcomingRow session={s} />} />
          )}
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          {history.isLoading ? (
            <TableNote>Memuat riwayat…</TableNote>
          ) : history.error ? (
            <TableNote tone="danger">{history.error.message}</TableNote>
          ) : past.length === 0 ? (
            <Card className="py-0">
              <TableNote>Belum ada kelas dalam {HISTORY_DAYS} hari terakhir.</TableNote>
            </Card>
          ) : (
            <Card className="divide-y divide-border py-0">
              {past.map((s) => (
                <HistoryRow key={s.id} session={s} />
              ))}
            </Card>
          )}
        </TabsContent>
        <TabsContent value="incentives" className="mt-4">
          <MyIncentives />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DayList({ sessions, today, render }: { sessions: Session[]; today: string; render: (s: Session) => ReactNode }) {
  return (
    <ol className="space-y-4">
      {sessionsByDay(sessions).map((group) => (
        <li key={group.day}>
          <p className="mb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {group.day === today ? "Hari ini" : tanggal(group.sessions[0].starts_at)}
          </p>
          <Card className="divide-y divide-border py-0">
            {group.sessions.map((s) => (
              <div key={s.id}>{render(s)}</div>
            ))}
          </Card>
        </li>
      ))}
    </ol>
  );
}

function UpcomingRow({ session: s }: { session: Session }) {
  const badge = SESSION_BADGE[s.status];
  return (
    <Link href={`/dashboard/gym/my-classes/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface">
      <span className="w-12 shrink-0 text-sm font-semibold tabular-nums">{formatTime(s.starts_at)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{s.class_type_name}</span>
        <span className="block text-xs text-muted-foreground">
          {formatNumber(s.confirmed_count)}/{formatNumber(s.capacity)} terdaftar
          {s.checked_in_count > 0 && ` · ${formatNumber(s.checked_in_count)} check-in`}
          {s.waitlist_count > 0 && ` · ${formatNumber(s.waitlist_count)} waitlist`}
          {s.area && ` · ${s.area}`}
        </span>
      </span>
      {s.status !== "published" && <Badge variant={badge.variant}>{badge.label}</Badge>}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

function HistoryRow({ session: s }: { session: Session }) {
  const badge = SESSION_BADGE[s.status];
  return (
    <Link href={`/dashboard/gym/my-classes/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{s.class_type_name}</span>
        <span className="block text-xs text-muted-foreground">
          {tanggal(s.starts_at)}, {formatTime(s.starts_at)} · {formatNumber(bookedSeats(s))}/{formatNumber(s.capacity)} booking
        </span>
      </span>
      <span className="shrink-0 text-right text-xs tabular-nums">
        <span className="block font-semibold text-success">{formatNumber(s.checked_in_count)} hadir</span>
        {s.no_show_count > 0 && <span className="block text-danger">{formatNumber(s.no_show_count)} tidak hadir</span>}
      </span>
      {s.status !== "completed" && <Badge variant={badge.variant}>{badge.label}</Badge>}
    </Link>
  );
}
