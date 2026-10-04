"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Copy, Hourglass, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/features/crm/engagement/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { weekStartWib } from "@/lib/gym/booking";
import { cn } from "@/lib/utils";
import { formatNumber, formatTime } from "@/lib/format";
import {
  addDays,
  CLASS_COLOR,
  GYM_KEYS,
  schedulingApi,
  SESSION_BADGE,
  tanggal,
  wibDay,
  wibDayStart,
  type Session,
} from "../api";
import { SessionDialog } from "./session-dialog";

/** Gym → Jadwal Kelas: grid mingguan Senin–Minggu, buat sesi, salin minggu. */
export function SchedulePage() {
  const queryClient = useQueryClient();
  const [week, setWeek] = useState(() => weekStartWib(new Date()));
  const [creatingOn, setCreatingOn] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const range = { from: wibDayStart(week), to: wibDayStart(addDays(week, 7)) };
  const sessions = useQuery({
    queryKey: [...GYM_KEYS.sessions, "week", week],
    queryFn: () => schedulingApi.sessions(range),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: GYM_KEYS.sessions });

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const today = wibDay(new Date());
  const rows = (sessions.data ?? []).filter((s) => s.status !== "cancelled");
  const live = rows.filter((s) => s.status === "published" || s.status === "full");
  const seatsTaken = live.reduce((sum, s) => sum + s.confirmed_count, 0);
  const seatsTotal = live.reduce((sum, s) => sum + s.capacity, 0);
  const waiting = live.reduce((sum, s) => sum + s.waitlist_count, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Jadwal Kelas"
        description="Jadwal mingguan kelas HYROX. Member booking dari portal; kredit dipotong saat check-in."
        actions={
          <>
            <Button variant="outline" onClick={() => setCopying(true)} disabled={rows.length === 0}>
              <Copy /> Salin minggu
            </Button>
            <Button onClick={() => setCreatingOn(days.includes(today) ? today : week)}>
              <Plus /> Sesi baru
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Sesi minggu ini" value={formatNumber(rows.length)} icon={<CalendarDays />} tone="ink" />
        <StatCard
          label="Kursi terisi"
          value={formatNumber(seatsTaken)}
          unit={`/ ${formatNumber(seatsTotal)}`}
          icon={<Users />}
          tone={seatsTotal && seatsTaken >= seatsTotal ? "warning" : "default"}
        />
        <StatCard label="Di waitlist" value={formatNumber(waiting)} unit="member" icon={<Hourglass />} tone={waiting ? "info" : "default"} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => setWeek(addDays(week, -7))} aria-label="Minggu sebelumnya">
          <ChevronLeft /> Sebelumnya
        </Button>
        <p className="text-sm font-semibold">
          {tanggal(wibDayStart(week))} – {tanggal(wibDayStart(addDays(week, 6)))}
        </p>
        <Button variant="ghost" size="sm" onClick={() => setWeek(addDays(week, 7))} aria-label="Minggu berikutnya">
          Berikutnya <ChevronRight />
        </Button>
      </div>

      {sessions.error ? (
        <Card>
          <p className="text-sm text-danger">{sessions.error.message}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
          {days.map((day) => {
            const daySessions = rows.filter((s) => wibDay(s.starts_at) === day);
            return (
              <Card key={day} size="sm" variant={day === today ? "default" : "soft"} className="min-w-0 gap-2 p-3">
                <div className="flex items-center justify-between gap-1">
                  <p className={cn("text-sm font-semibold", day === today && "text-brand-text")}>{tanggal(wibDayStart(day))}</p>
                  <Button variant="ghost" size="icon-xs" onClick={() => setCreatingOn(day)} aria-label={`Sesi baru ${day}`}>
                    <Plus />
                  </Button>
                </div>
                {sessions.isLoading ? (
                  <p className="text-xs text-muted-foreground">Memuat…</p>
                ) : daySessions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Tidak ada kelas</p>
                ) : (
                  daySessions.map((s) => <SessionTile key={s.id} session={s} />)
                )}
              </Card>
            );
          })}
        </div>
      )}

      {creatingOn && <SessionDialog date={creatingOn} onClose={() => setCreatingOn(null)} onSaved={refresh} />}
      {copying && (
        <CopyWeekDialog week={week} count={rows.length} onClose={() => setCopying(false)} onCopied={refresh} />
      )}
    </div>
  );
}

function SessionTile({ session }: { session: Session }) {
  const badge = SESSION_BADGE[session.status];
  return (
    <Link
      href={`/dashboard/gym/sessions/${session.id}`}
      className="flex min-w-0 gap-2 rounded-xl bg-card p-2 shadow-card transition hover:ring-2 hover:ring-forest/30"
    >
      <span className={cn("w-1 shrink-0 rounded-full", CLASS_COLOR[session.color]?.bar ?? "bg-forest")} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground tabular-nums">
          {formatTime(session.starts_at)}–{formatTime(session.ends_at)}
        </span>
        <span className="block truncate text-sm font-semibold">{session.class_type_name}</span>
        <span className="block truncate text-xs text-muted-foreground">{session.coach_name ?? "Coach belum ditentukan"}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1 text-xs tabular-nums">
          {formatNumber(session.confirmed_count)}/{formatNumber(session.capacity)}
          {session.waitlist_count > 0 && <span className="text-info">+{session.waitlist_count}</span>}
          {session.status !== "published" && <Badge variant={badge.variant}>{badge.label}</Badge>}
        </span>
      </span>
    </Link>
  );
}

function CopyWeekDialog({
  week,
  count,
  onClose,
  onCopied,
}: {
  week: string;
  count: number;
  onClose: () => void;
  onCopied: () => void;
}) {
  const [target, setTarget] = useState(addDays(week, 7));
  const [publish, setPublish] = useState(false);
  const targetWeek = weekStartWib(new Date(`${target}T12:00:00+07:00`));
  const copy = useMutation({
    mutationFn: () => schedulingApi.duplicateWeek({ source_week: week, target_week: targetWeek, publish }),
    onSuccess: (data) => {
      toast.success(`${formatNumber(data.created)} sesi disalin`, {
        description: data.skipped ? `${formatNumber(data.skipped)} slot sudah ada dan dilewati.` : undefined,
      });
      onCopied();
      onClose();
    },
    onError: (error) => toast.error("Jadwal gagal disalin", { description: error.message }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="sm">
        <DialogPanelHeader>
          <DialogPanelTitle>Salin jadwal minggu ini</DialogPanelTitle>
          <DialogPanelDescription>
            {formatNumber(count)} sesi (kecuali yang batal) disalin dengan jam dan coach yang sama. Slot yang sudah terisi di
            minggu tujuan dilewati.
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="grid grid-cols-1 gap-4">
          <Field label="Minggu tujuan" hint={`Mulai Senin ${tanggal(wibDayStart(targetWeek))}`}>
            <Input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
            Langsung terbitkan (tanpa centang: disimpan sebagai draf)
          </label>
        </DialogPanelBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={() => copy.mutate()} disabled={copy.isPending || targetWeek === week}>
            Salin jadwal
          </Button>
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
