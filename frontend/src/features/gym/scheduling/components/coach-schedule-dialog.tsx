"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { monthLabel } from "@/features/gym/incentives/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { formatDate, formatNumber } from "@/lib/format";
import { addDays, GYM_KEYS, rentangJam, schedulingApi, SESSION_BADGE, tanggal, type Coach } from "../api";
import { bookedSeats, fillLabel, sessionsByDay } from "../coach-schedule";
import { CoachAvatar } from "./coach-avatar";
import { MiniStats } from "./mini-stats";

/** Minggu seorang coach: sesi per hari dan beban kerja minggu serta bulan ini. */
export function CoachScheduleDialog({ coach, onClose }: { coach: Coach; onClose: () => void }) {
  // Kosong berarti minggu ini (dihitung server di zona cabang coach).
  const [day, setDay] = useState("");
  const schedule = useQuery({
    queryKey: [...GYM_KEYS.coaches, "schedule", coach.id, day],
    queryFn: () => schedulingApi.coachSchedule(coach.id, day || undefined),
    placeholderData: keepPreviousData,
  });
  const data = schedule.data;
  const weekStart = data?.week_start;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <div className="flex items-center gap-3">
            <CoachAvatar name={coach.name} url={coach.photo_url} className="size-12" />
            <div className="min-w-0">
              <DialogPanelTitle>Jadwal {coach.name}</DialogPanelTitle>
              <DialogPanelDescription>
                {weekStart ? `${formatDate(weekStart)} – ${formatDate(addDays(weekStart, 6))}` : "Memuat minggu…"}
              </DialogPanelDescription>
            </div>
          </div>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!weekStart}
              onClick={() => weekStart && setDay(addDays(weekStart, -7))}
            >
              <ChevronLeft /> Minggu lalu
            </Button>
            <Button variant="ghost" size="sm" disabled={!day} onClick={() => setDay("")}>
              Minggu ini
            </Button>
            <Button variant="outline" size="sm" disabled={!weekStart} onClick={() => weekStart && setDay(addDays(weekStart, 7))}>
              Minggu depan <ChevronRight />
            </Button>
          </div>

          {data && (
            <MiniStats
              items={[
                { label: "Sesi seminggu", value: formatNumber(data.workload.week_sessions) },
                { label: `Sesi ${monthLabel(data.month)}`, value: formatNumber(data.workload.month_sessions) },
                { label: "Rata-rata terisi", value: fillLabel(data.workload.avg_fill) },
              ]}
            />
          )}

          {schedule.isLoading ? (
            <TableNote>Memuat jadwal…</TableNote>
          ) : schedule.error ? (
            <TableNote tone="danger">{schedule.error.message}</TableNote>
          ) : !data || data.sessions.length === 0 ? (
            <TableNote>Tidak ada kelas minggu ini.</TableNote>
          ) : (
            <ol className="space-y-3">
              {sessionsByDay(data.sessions).map((group) => (
                <li key={group.day}>
                  <p className="mb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                    {tanggal(group.sessions[0].starts_at, group.sessions[0].timezone)}
                  </p>
                  <ul className="divide-y divide-border rounded-2xl border border-border">
                    {group.sessions.map((s) => {
                      const badge = SESSION_BADGE[s.status];
                      return (
                        <li key={s.id}>
                          <Link
                            href={`/dashboard/gym/sessions/${s.id}`}
                            className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">{s.class_type_name}</span>
                              <span className="block text-xs text-muted-foreground">
                                {rentangJam(s.starts_at, s.ends_at, s.timezone)}
                                {s.area ? ` · ${s.area}` : ""}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {formatNumber(bookedSeats(s))}/{formatNumber(s.capacity)}
                              </span>
                              <Badge variant={badge.variant}>{badge.label}</Badge>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </DialogPanelBody>
      </DialogPanel>
    </Dialog>
  );
}
