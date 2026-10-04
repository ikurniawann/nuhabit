"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, UserCheck, Users } from "lucide-react";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addDays, GYM_KEYS, schedulingApi, SESSION_BADGE, waktu, wibDay, wibDayStart } from "../api";
import { SELECT } from "@/features/gym/shared";
import { formatNumber } from "@/lib/format";

type Range = "today" | "upcoming" | "past";

function rangeFor(range: Range) {
  const today = wibDay(new Date());
  if (range === "today") return { from: wibDayStart(today), to: wibDayStart(addDays(today, 1)) };
  if (range === "past") return { from: wibDayStart(addDays(today, -14)), to: new Date().toISOString() };
  return { from: new Date().toISOString(), to: wibDayStart(addDays(today, 15)) };
}

/** Gym → Sesi & Absensi: daftar sesi per rentang, buka untuk roster dan check-in. */
export function SessionsPage() {
  const [range, setRange] = useState<Range>("today");
  const [classTypeId, setClassTypeId] = useState("");
  const classTypes = useQuery({ queryKey: GYM_KEYS.classTypes, queryFn: schedulingApi.classTypes });
  const sessions = useQuery({
    queryKey: [...GYM_KEYS.sessions, "list", range, classTypeId],
    queryFn: () => schedulingApi.sessions({ ...rangeFor(range), class_type_id: classTypeId || undefined }),
    refetchInterval: range === "today" ? 30_000 : false,
  });
  const rows = sessions.data ?? [];
  const live = rows.filter((s) => s.status !== "cancelled" && s.status !== "draft");
  const booked = live.reduce((sum, s) => sum + s.confirmed_count, 0);
  const checkedIn = live.reduce((sum, s) => sum + s.checked_in_count, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Sesi & Absensi"
        description="Buka sesi untuk melihat peserta, check-in manual, menandai no-show, atau menutup kelas."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Sesi" value={formatNumber(live.length)} icon={<CalendarClock />} tone="ink" />
        <StatCard label="Kursi terisi" value={formatNumber(booked)} icon={<Users />} />
        <StatCard
          label="Sudah check-in"
          value={formatNumber(checkedIn)}
          unit={booked ? `/ ${formatNumber(booked)}` : undefined}
          icon={<UserCheck />}
          tone={checkedIn ? "success" : "default"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
          <TabsList>
            <TabsTrigger value="today">Hari ini</TabsTrigger>
            <TabsTrigger value="upcoming">14 hari ke depan</TabsTrigger>
            <TabsTrigger value="past">14 hari lalu</TabsTrigger>
          </TabsList>
        </Tabs>
        <select
          className={`${SELECT} sm:w-60`}
          value={classTypeId}
          onChange={(e) => setClassTypeId(e.target.value)}
          aria-label="Filter jenis kelas"
        >
          <option value="">Semua jenis kelas</option>
          {(classTypes.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <Card className="py-0">
        {sessions.isLoading ? (
          <TableNote>Memuat sesi…</TableNote>
        ) : sessions.error ? (
          <TableNote tone="danger">{sessions.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Tidak ada sesi di rentang ini.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kelas</TableHead>
                <TableHead className="hidden md:table-cell">Waktu</TableHead>
                <TableHead className="text-right">Peserta</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Check-in</TableHead>
                <TableHead className="hidden lg:table-cell">Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => {
                const badge = SESSION_BADGE[s.status];
                return (
                  <TableRow key={s.id} className={s.status === "cancelled" ? "opacity-60" : undefined}>
                    <TableCell className="max-w-[16rem] whitespace-normal">
                      <p className="font-medium">{s.class_type_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[s.coach_name ?? "Coach belum ditentukan", s.area].filter(Boolean).join(" · ")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground md:hidden">{waktu(s.starts_at)}</p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{waktu(s.starts_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(s.confirmed_count)} / {formatNumber(s.capacity)}
                      {s.waitlist_count > 0 && <span className="block text-xs text-info">+{formatNumber(s.waitlist_count)} waitlist</span>}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatNumber(s.checked_in_count)}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/dashboard/gym/sessions/${s.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                        Buka
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
