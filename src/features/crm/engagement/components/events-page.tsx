"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Hourglass, Plus, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelForm,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  angka,
  engagementApi,
  fromLocalInput,
  rupiah,
  toLocalInput,
  waktu,
  type CrmEvent,
  type EventBooking,
  type EventInput,
} from "../api";
import { Field, TableNote, TEXTAREA } from "./shared";

const EVENTS_KEY = ["crm-engagement", "events"];

const STATUS_BADGE: Record<CrmEvent["status"], { label: string; variant: "outline" | "success" | "muted" }> = {
  draft: { label: "Draf", variant: "outline" },
  published: { label: "Terbit", variant: "success" },
  cancelled: { label: "Dibatalkan", variant: "muted" },
};

const BOOKING_BADGE: Record<
  EventBooking["status"],
  { label: string; variant: "ink" | "info" | "success" | "destructive" | "muted" }
> = {
  confirmed: { label: "Terdaftar", variant: "ink" },
  waitlist: { label: "Waitlist", variant: "info" },
  attended: { label: "Hadir", variant: "success" },
  no_show: { label: "Tidak hadir", variant: "destructive" },
  cancelled: { label: "Batal", variant: "muted" },
};

/** CRM → Engagement → Event & Kelas: jadwal, kapasitas, waitlist, kehadiran. */
export function EventsPage() {
  const queryClient = useQueryClient();
  const events = useQuery({ queryKey: EVENTS_KEY, queryFn: engagementApi.events });
  const [editing, setEditing] = useState<CrmEvent | "new" | null>(null);
  const [roster, setRoster] = useState<CrmEvent | null>(null);
  const [cancelling, setCancelling] = useState<CrmEvent | null>(null);

  const cancelMutation = useMutation({
    mutationFn: (id: string) => engagementApi.cancelEvent(id),
    onSuccess: (data) => {
      toast.success("Event dibatalkan", { description: `${angka(data.notified)} member dikabari lewat portal.` });
      setCancelling(null);
      void queryClient.invalidateQueries({ queryKey: EVENTS_KEY });
    },
    onError: (error) => toast.error("Event gagal dibatalkan", { description: error.message }),
  });

  const rows = events.data ?? [];
  const upcoming = rows.filter((e) => e.status === "published" && new Date(e.ends_at) > new Date());
  const seatsTaken = upcoming.reduce((sum, e) => sum + e.confirmed_count, 0);
  const seatsTotal = upcoming.reduce((sum, e) => sum + e.capacity, 0);
  const waiting = upcoming.reduce((sum, e) => sum + e.waitlist_count, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="CRM · Engagement"
        title="Event & Kelas"
        description="Jadwalkan HYROX race day, workshop, atau acara komunitas. Member mendaftar dari portal; kursi kosong otomatis jatuh ke waitlist."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Event baru
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Event mendatang" value={angka(upcoming.length)} icon={<CalendarDays />} tone="ink" />
        <StatCard
          label="Kursi terisi"
          value={angka(seatsTaken)}
          unit={`/ ${angka(seatsTotal)}`}
          icon={<Users />}
          tone={seatsTotal && seatsTaken >= seatsTotal ? "warning" : "default"}
        />
        <StatCard label="Di waitlist" value={angka(waiting)} unit="member" icon={<Hourglass />} tone={waiting ? "info" : "default"} />
      </div>

      <Card className="py-0">
        {events.isLoading ? (
          <TableNote>Memuat event…</TableNote>
        ) : events.error ? (
          <TableNote tone="danger">{events.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada event. Klik Event baru untuk menjadwalkan yang pertama.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead className="hidden md:table-cell">Waktu</TableHead>
                <TableHead className="text-right">Peserta</TableHead>
                <TableHead className="hidden lg:table-cell">Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((event) => {
                const ended = new Date(event.ends_at) < new Date();
                const badge = STATUS_BADGE[event.status];
                return (
                  <TableRow key={event.id} className={ended || event.status === "cancelled" ? "opacity-60" : undefined}>
                    <TableCell className="max-w-[16rem] whitespace-normal">
                      <p className="font-medium">{event.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {[event.host_name, event.location, event.price_idr > 0 ? rupiah(event.price_idr) : "Gratis"]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground md:hidden">{waktu(event.starts_at)}</p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{waktu(event.starts_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {angka(event.confirmed_count)} / {angka(event.capacity)}
                      {event.waitlist_count > 0 && (
                        <span className="block text-xs text-info">+{angka(event.waitlist_count)} waitlist</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <Badge variant={badge.variant}>{ended && event.status === "published" ? "Selesai" : badge.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setRoster(event)}>
                          <UserCheck /> Peserta
                        </Button>
                        {event.status !== "cancelled" && !ended && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => setEditing(event)}>
                              Ubah
                            </Button>
                            <Button variant="ghost" size="sm" className="text-danger" onClick={() => setCancelling(event)}>
                              Batalkan
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {editing && (
        <EventDialog
          event={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: EVENTS_KEY })}
        />
      )}
      {roster && <RosterDialog event={roster} onClose={() => setRoster(null)} />}
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title={`Batalkan ${cancelling?.title ?? "event"}?`}
        description="Semua pendaftaran dan waitlist ikut batal, dan setiap member mendapat notifikasi di portal."
        confirmLabel="Batalkan event"
        variant="danger"
        loading={cancelMutation.isPending}
        onConfirm={() => cancelling && cancelMutation.mutate(cancelling.id)}
      />
    </div>
  );
}

function EventDialog({ event, onClose, onSaved }: { event: CrmEvent | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(() => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    tomorrow.setHours(15, 0, 0, 0);
    return {
      title: event?.title ?? "",
      description: event?.description ?? "",
      host_name: event?.host_name ?? "",
      location: event?.location ?? "",
      starts_at: toLocalInput(event?.starts_at ?? tomorrow.toISOString()),
      ends_at: toLocalInput(event?.ends_at ?? new Date(tomorrow.getTime() + 2 * 3_600_000).toISOString()),
      capacity: String(event?.capacity ?? 12),
      price_idr: String(event?.price_idr ?? 0),
      booking_closes_hours: String(event?.booking_closes_hours ?? 0),
      cancel_deadline_hours: String(event?.cancel_deadline_hours ?? 2),
    };
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((cur) => ({ ...cur, [key]: e.target.value }));

  const save = useMutation({
    mutationFn: (status: EventInput["status"]) =>
      engagementApi.saveEvent({
        id: event?.id,
        title: form.title.trim(),
        description: form.description,
        host_name: form.host_name.trim() || null,
        location: form.location.trim() || null,
        starts_at: fromLocalInput(form.starts_at),
        ends_at: fromLocalInput(form.ends_at),
        capacity: Number(form.capacity) || 0,
        price_idr: Number(form.price_idr) || 0,
        booking_closes_hours: Number(form.booking_closes_hours) || 0,
        cancel_deadline_hours: Number(form.cancel_deadline_hours) || 0,
        status,
      }),
    onSuccess: (_data, status) => {
      toast.success(status === "published" ? "Event diterbitkan" : "Draf event disimpan", { description: form.title });
      onSaved();
      onClose();
    },
    onError: (error) => toast.error("Event gagal disimpan", { description: error.message }),
  });

  const valid =
    form.title.trim().length >= 3 &&
    Number(form.capacity) > 0 &&
    new Date(form.ends_at).getTime() > new Date(form.starts_at).getTime();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate("published");
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>{event ? `Ubah ${event.title}` : "Event baru"}</DialogPanelTitle>
            <DialogPanelDescription>
              Draf belum terlihat oleh member. Event terbit langsung muncul di portal.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Judul" className="sm:col-span-2">
              <Input value={form.title} onChange={set("title")} placeholder="HYROX Simulation Day" required />
            </Field>
            <Field label="Deskripsi" className="sm:col-span-2">
              <textarea className={TEXTAREA} value={form.description} onChange={set("description")} />
            </Field>
            <Field label="Host">
              <Input value={form.host_name} onChange={set("host_name")} placeholder="Head coach" />
            </Field>
            <Field label="Lokasi">
              <Input value={form.location} onChange={set("location")} placeholder="BCD Dago, lantai 2" />
            </Field>
            <Field label="Mulai">
              <Input type="datetime-local" value={form.starts_at} onChange={set("starts_at")} required />
            </Field>
            <Field label="Selesai">
              <Input type="datetime-local" value={form.ends_at} onChange={set("ends_at")} required />
            </Field>
            <Field label="Kapasitas" hint="Pendaftar setelah penuh masuk waitlist.">
              <Input type="number" min={1} value={form.capacity} onChange={set("capacity")} required />
            </Field>
            <Field label="Harga (Rp)" hint="0 = gratis. Dibayar di outlet.">
              <Input type="number" min={0} value={form.price_idr} onChange={set("price_idr")} />
            </Field>
            <Field label="Pendaftaran tutup (jam sebelum mulai)">
              <Input type="number" min={0} value={form.booking_closes_hours} onChange={set("booking_closes_hours")} />
            </Field>
            <Field label="Batas batal tanpa catatan (jam)" hint="Batal setelah ini dicatat sebagai batal terlambat.">
              <Input type="number" min={0} value={form.cancel_deadline_hours} onChange={set("cancel_deadline_hours")} />
            </Field>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => save.mutate("draft")} disabled={!valid || save.isPending}>
              Simpan draf
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              {event?.status === "published" ? "Simpan perubahan" : "Terbitkan"}
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

function RosterDialog({ event, onClose }: { event: CrmEvent; onClose: () => void }) {
  const queryClient = useQueryClient();
  const key = ["crm-engagement", "bookings", event.id];
  const bookings = useQuery({ queryKey: key, queryFn: () => engagementApi.bookings(event.id) });
  const change = useMutation({
    mutationFn: (input: { id: string; status: "attended" | "no_show" | "cancelled" }) =>
      engagementApi.changeBooking(input.id, input.status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: EVENTS_KEY });
    },
    onError: (error) => toast.error("Status peserta gagal diubah", { description: error.message }),
  });
  const rows = bookings.data ?? [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>Peserta {event.title}</DialogPanelTitle>
          <DialogPanelDescription>
            {waktu(event.starts_at)} · {angka(event.confirmed_count)} dari {angka(event.capacity)} kursi terisi
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="px-0 py-0">
          {bookings.isLoading ? (
            <TableNote>Memuat peserta…</TableNote>
          ) : rows.length === 0 ? (
            <TableNote>Belum ada member yang mendaftar.</TableNote>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Tandai</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => {
                  const badge = BOOKING_BADGE[b.status];
                  return (
                    <TableRow key={b.id}>
                      <TableCell>
                        <p className="font-medium">{b.name ?? "Member"}</p>
                        <p className="font-mono text-xs text-muted-foreground">{b.phone}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>
                          {b.status === "waitlist" ? `Waitlist #${b.waitlist_position}` : badge.label}
                        </Badge>
                        {b.late_cancel && <span className="ml-2 text-xs text-warning">batal terlambat</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {b.status === "confirmed" && (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="soft" onClick={() => change.mutate({ id: b.id, status: "attended" })}>
                              Hadir
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => change.mutate({ id: b.id, status: "no_show" })}>
                              Tidak hadir
                            </Button>
                          </div>
                        )}
                        {b.status === "waitlist" && (
                          <Button size="sm" variant="ghost" onClick={() => change.mutate({ id: b.id, status: "cancelled" })}>
                            Keluarkan
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </DialogPanelBody>
      </DialogPanel>
    </Dialog>
  );
}
