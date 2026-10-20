"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, ChevronLeft, ChevronRight, Hourglass, Plus, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { TableNote } from "@/features/crm/engagement/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { weekStartWib } from "@/lib/gym/booking";
import { formatNumber, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SELECT } from "@/features/gym/shared";
import { addDays, tanggal, wibDay, wibDayStart } from "@/features/gym/scheduling/api";
import { COACHING_KEYS, coachingApi, PT_BADGE, type PtAppointment } from "../api";
import { AppointmentDialog } from "./appointment-dialog";
import { AvailabilityPanel } from "./availability-panel";
import { BookDialog } from "./book-dialog";

const TABS = [
  { value: "jadwal", label: "Jadwal PT" },
  { value: "ketersediaan", label: "Ketersediaan coach" },
  { value: "jenis", label: "Jenis sesi" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

/** Gym → Personal Training: jadwal PT per minggu, ketersediaan coach, jenis sesi PT. */
export function PtPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const tab: TabValue = TABS.some((t) => t.value === requested) ? (requested as TabValue) : "jadwal";
  const coaches = useQuery({ queryKey: COACHING_KEYS.coaches(true), queryFn: () => coachingApi.coaches(true) });

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Personal Training"
        description="Sesi 1:1 dan small group bersama coach. Kredit PT dicek saat booking dan dipotong saat sesi selesai."
      />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams);
          if (value === "jadwal") next.delete("tab");
          else next.set("tab", String(value));
          const search = next.toString();
          router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
        }}
        className="w-full flex-col"
      >
        <TabsList variant="line">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="jadwal" className="mt-4">
          <Agenda coachOptions={coaches.data ?? []} />
        </TabsContent>
        <TabsContent value="ketersediaan" className="mt-4">
          {coaches.isLoading ? (
            <Card>
              <TableNote>Memuat coach…</TableNote>
            </Card>
          ) : coaches.error ? (
            <Card>
              <TableNote tone="danger">{coaches.error.message}</TableNote>
            </Card>
          ) : (
            <AvailabilityPanel coaches={coaches.data ?? []} />
          )}
        </TabsContent>
        <TabsContent value="jenis" className="mt-4">
          <TypeFlags />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Agenda({ coachOptions }: { coachOptions: { id: string; name: string }[] }) {
  const queryClient = useQueryClient();
  const [week, setWeek] = useState(() => weekStartWib(new Date()));
  const [coachId, setCoachId] = useState("");
  const [status, setStatus] = useState("");
  const [booking, setBooking] = useState(false);
  const [open, setOpen] = useState<PtAppointment | null>(null);
  const params = { from: wibDayStart(week), to: wibDayStart(addDays(week, 7)), coach_id: coachId, status };
  const list = useQuery({
    queryKey: [...COACHING_KEYS.appointments, params],
    queryFn: () => coachingApi.appointments(params),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: COACHING_KEYS.appointments });

  const rows = list.data ?? [];
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const today = wibDay(new Date());
  const requestedCount = rows.filter((a) => a.status === "requested").length;
  const confirmedCount = rows.filter((a) => a.status === "confirmed").length;
  const completedCount = rows.filter((a) => a.status === "completed").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard
          label="Menunggu konfirmasi"
          value={formatNumber(requestedCount)}
          unit="sesi"
          icon={<Hourglass />}
          tone={requestedCount ? "info" : "default"}
        />
        <StatCard label="Terkonfirmasi" value={formatNumber(confirmedCount)} unit="sesi" icon={<CalendarCheck />} tone="ink" />
        <StatCard label="Selesai" value={formatNumber(completedCount)} unit="sesi" icon={<UserCheck />} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className={cn(SELECT, "w-auto min-w-40")} value={coachId} onChange={(e) => setCoachId(e.target.value)} aria-label="Coach">
          <option value="">Semua coach</option>
          {coachOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className={cn(SELECT, "w-auto min-w-40")} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Semua status</option>
          <option value="requested">Menunggu konfirmasi</option>
          <option value="confirmed">Terkonfirmasi</option>
          <option value="completed">Selesai</option>
          <option value="cancelled">Batal</option>
        </select>
        <Button className="ml-auto" onClick={() => setBooking(true)}>
          <Plus /> Booking PT
        </Button>
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

      {list.error ? (
        <Card>
          <TableNote tone="danger">{list.error.message}</TableNote>
        </Card>
      ) : list.isLoading ? (
        <Card>
          <TableNote>Memuat jadwal PT…</TableNote>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
          {days.map((day) => {
            const items = rows.filter((a) => wibDay(a.starts_at) === day);
            return (
              <Card key={day} size="sm" variant={day === today ? "default" : "soft"} className="min-w-0 gap-2 p-3">
                <p className={cn("text-sm font-semibold", day === today && "text-brand-text")}>{tanggal(wibDayStart(day))}</p>
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Tidak ada sesi</p>
                ) : (
                  items.map((a) => <AppointmentTile key={a.id} appointment={a} onOpen={() => setOpen(a)} />)
                )}
              </Card>
            );
          })}
        </div>
      )}

      {booking && <BookDialog coachId={coachId || undefined} date={days.includes(today) ? today : week} onClose={() => setBooking(false)} onBooked={refresh} />}
      {open && <AppointmentDialog appointment={open} onClose={() => setOpen(null)} onChanged={refresh} />}
    </div>
  );
}

function AppointmentTile({ appointment: a, onOpen }: { appointment: PtAppointment; onOpen: () => void }) {
  const badge = PT_BADGE[a.status];
  const names = a.participants
    .filter((p) => p.status !== "cancelled")
    .map((p) => p.name ?? "Member")
    .join(", ");
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex min-w-0 flex-col rounded-xl bg-card p-2 text-left shadow-card transition hover:ring-2 hover:ring-forest/30",
        a.status === "cancelled" && "opacity-60"
      )}
    >
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatTime(a.starts_at)}–{formatTime(a.ends_at)}
      </span>
      <span className="truncate text-sm font-semibold">{names || a.class_type_name}</span>
      <span className="truncate text-xs text-muted-foreground">
        {a.coach_name} · {a.class_type_name}
      </span>
      <span className="mt-1">
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </span>
    </button>
  );
}

/** Jenis kelas mana yang sesi PT. Kredit paket tanpa batasan jenis kelas tidak berlaku untuk jenis PT. */
function TypeFlags() {
  const queryClient = useQueryClient();
  const flags = useQuery({ queryKey: COACHING_KEYS.flags, queryFn: coachingApi.typeFlags });
  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => coachingApi.setPersonal(id, on),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: COACHING_KEYS.flags });
      void queryClient.invalidateQueries({ queryKey: COACHING_KEYS.types });
    },
    onError: (error) => toast.error("Jenis sesi gagal diubah", { description: error.message }),
  });
  return (
    <Card className="gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Jenis sesi PT</h2>
        <p className="text-xs text-muted-foreground">
          Jenis kelas yang ditandai PT hanya bisa dibayar dengan paket yang menyebut jenis itu (paket PT). Kredit kelas grup
          tidak berlaku untuk PT, dan kredit PT tidak berlaku untuk kelas grup.
        </p>
      </div>
      {flags.isLoading ? (
        <p className="text-sm text-muted-foreground">Memuat…</p>
      ) : flags.error ? (
        <p className="text-sm text-danger">{flags.error.message}</p>
      ) : (
        <ul className="divide-y divide-border">
          {(flags.data ?? []).map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="font-medium">{f.name}</span>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={f.is_personal}
                  disabled={toggle.isPending}
                  onChange={(e) => toggle.mutate({ id: f.id, on: e.target.checked })}
                />
                Sesi PT
              </label>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
