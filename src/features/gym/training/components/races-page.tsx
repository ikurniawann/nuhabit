"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Flag, Plus, Trophy, Users } from "lucide-react";
import { toast } from "sonner";
import { angka, fromLocalInput, toLocalInput, waktu } from "@/features/crm/engagement/api";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
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
import { DIVISION_LABELS, formatDuration } from "@/lib/gym/hyrox";
import {
  MEMBER_RACE_STATUS_LABELS,
  RACE_REGIONS,
  RACE_STATUS_LABELS,
  RACE_STATUSES,
  type RaceStatus,
} from "@/lib/gym/races";
import { trainingApi, type RaceEventRow } from "../api";
import { SELECT } from "./shared";

const RACES_KEY = ["gym", "races"];

const STATUS_VARIANT: Record<RaceStatus, "outline" | "success" | "warning" | "info" | "ink" | "muted"> = {
  announced: "outline",
  registration_open: "success",
  sold_out: "warning",
  upcoming: "info",
  ongoing: "ink",
  completed: "muted",
  cancelled: "muted",
};

/** Gym → Race HYROX: kalender race yang bisa ditargetkan member dari portal. */
export function RacesPage() {
  const queryClient = useQueryClient();
  const races = useQuery({ queryKey: RACES_KEY, queryFn: trainingApi.races });
  const [editing, setEditing] = useState<RaceEventRow | "new" | null>(null);
  const [roster, setRoster] = useState<RaceEventRow | null>(null);
  const [removing, setRemoving] = useState<RaceEventRow | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: RACES_KEY });

  const removeMutation = useMutation({
    mutationFn: (id: string) => trainingApi.deleteRace(id),
    onSuccess: (data) => {
      toast.success(data.outcome === "deleted" ? "Race dihapus" : "Race dibatalkan", {
        description: data.outcome === "cancelled" ? "Race sudah punya peserta, jadi hanya dibatalkan." : undefined,
      });
      setRemoving(null);
      refresh();
    },
    onError: (error) => toast.error("Race gagal dihapus", { description: error.message }),
  });

  const rows = races.data ?? [];
  const upcoming = rows.filter((r) => !["completed", "cancelled"].includes(r.status) && new Date(r.ends_at) > new Date());
  const training = rows.reduce((sum, r) => sum + r.training_count, 0);
  const raced = rows.reduce((sum, r) => sum + r.raced_count, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym · Race"
        title="Race HYROX"
        description="Kalender race yang muncul di portal. Member memilih race, menetapkan target waktu, lalu mencatat hasilnya setelah race."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Race baru
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Race mendatang" value={angka(upcoming.length)} icon={<CalendarDays />} tone="ink" />
        <StatCard label="Member berlatih menuju race" value={angka(training)} icon={<Users />} />
        <StatCard label="Hasil race tercatat" value={angka(raced)} icon={<Trophy />} tone={raced ? "success" : "default"} />
      </div>

      <Card className="py-0">
        {races.isLoading ? (
          <TableNote>Memuat race…</TableNote>
        ) : races.error ? (
          <TableNote tone="danger">{races.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada race. Klik Race baru untuk menambah race pertama.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Race</TableHead>
                <TableHead className="hidden md:table-cell">Tanggal</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="text-right">Member</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((race) => {
                const past = new Date(race.ends_at) < new Date();
                return (
                  <TableRow key={race.id} className={past || race.status === "cancelled" ? "opacity-60" : undefined}>
                    <TableCell className="max-w-[18rem] whitespace-normal">
                      <p className="font-medium">{race.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[race.venue, race.city, race.country].filter(Boolean).join(" · ")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground md:hidden">{waktu(race.starts_at)}</p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{waktu(race.starts_at)}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant={STATUS_VARIANT[race.status]}>{RACE_STATUS_LABELS[race.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {angka(race.training_count + race.raced_count)}
                      {race.raced_count > 0 && (
                        <span className="block text-xs text-success">{angka(race.raced_count)} hasil</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setRoster(race)}>
                          <Users /> Peserta
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(race)}>
                          Ubah
                        </Button>
                        {race.status !== "cancelled" && (
                          <Button variant="ghost" size="sm" className="text-danger" onClick={() => setRemoving(race)}>
                            Hapus
                          </Button>
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

      {editing && <RaceDialog race={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {roster && <EntrantsDialog race={roster} onClose={() => setRoster(null)} />}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Hapus ${removing?.name ?? "race"}?`}
        description="Race tanpa peserta dihapus. Race yang sudah ditargetkan member hanya dibatalkan supaya riwayat mereka tetap ada."
        confirmLabel="Hapus race"
        variant="danger"
        loading={removeMutation.isPending}
        onConfirm={() => removing && removeMutation.mutate(removing.id)}
      />
    </div>
  );
}

function RaceDialog({ race, onClose, onSaved }: { race: RaceEventRow | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(() => {
    const start = new Date(Date.now() + 60 * 86_400_000);
    start.setHours(7, 0, 0, 0);
    return {
      name: race?.name ?? "",
      country: race?.country ?? "Indonesia",
      region: race?.region ?? "ASIA",
      city: race?.city ?? "",
      venue: race?.venue ?? "",
      starts_at: toLocalInput(race?.starts_at ?? start.toISOString()),
      ends_at: toLocalInput(race?.ends_at ?? new Date(start.getTime() + 35 * 3_600_000).toISOString()),
      registration_url: race?.registration_url ?? "",
      image_url: race?.image_url ?? "",
      status: race?.status ?? "announced",
    };
  });
  const set =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((cur) => ({ ...cur, [key]: e.target.value }));

  const save = useMutation({
    mutationFn: () =>
      trainingApi.saveRace({
        id: race?.id,
        name: form.name.trim(),
        country: form.country.trim(),
        region: form.region as RaceEventRow["region"],
        city: form.city.trim(),
        venue: form.venue.trim(),
        starts_at: fromLocalInput(form.starts_at),
        ends_at: fromLocalInput(form.ends_at),
        registration_url: form.registration_url.trim(),
        image_url: form.image_url.trim() || null,
        status: form.status as RaceStatus,
      }),
    onSuccess: () => {
      toast.success("Race disimpan", { description: form.name });
      onSaved();
      onClose();
    },
    onError: (error) => toast.error("Race gagal disimpan", { description: error.message }),
  });

  const valid =
    form.name.trim().length >= 3 &&
    form.city.trim().length >= 2 &&
    form.country.trim().length >= 2 &&
    new Date(form.ends_at).getTime() >= new Date(form.starts_at).getTime();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>{race ? `Ubah ${race.name}` : "Race baru"}</DialogPanelTitle>
            <DialogPanelDescription>
              Race selesai atau batal tidak bisa lagi ditargetkan member, tapi hasil yang sudah tercatat tetap tersimpan.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nama race" className="sm:col-span-2">
              <Input value={form.name} onChange={set("name")} placeholder="HYROX Jakarta" required />
            </Field>
            <Field label="Kota">
              <Input value={form.city} onChange={set("city")} placeholder="Jakarta" required />
            </Field>
            <Field label="Venue">
              <Input value={form.venue} onChange={set("venue")} placeholder="JIExpo Kemayoran" />
            </Field>
            <Field label="Negara">
              <Input value={form.country} onChange={set("country")} required />
            </Field>
            <Field label="Region">
              <select className={SELECT} value={form.region} onChange={set("region")}>
                {RACE_REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Mulai">
              <Input type="datetime-local" value={form.starts_at} onChange={set("starts_at")} required />
            </Field>
            <Field label="Selesai">
              <Input type="datetime-local" value={form.ends_at} onChange={set("ends_at")} required />
            </Field>
            <Field label="Status">
              <select className={SELECT} value={form.status} onChange={set("status")}>
                {RACE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {RACE_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Link pendaftaran resmi">
              <Input value={form.registration_url} onChange={set("registration_url")} placeholder="https://hyrox.com/…" />
            </Field>
            <Field label="Foto (URL)" className="sm:col-span-2">
              <Input type="url" value={form.image_url} onChange={set("image_url")} placeholder="https://…" />
            </Field>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              Simpan race
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}

function EntrantsDialog({ race, onClose }: { race: RaceEventRow; onClose: () => void }) {
  const entrants = useQuery({ queryKey: ["gym", "race-entrants", race.id], queryFn: () => trainingApi.entrants(race.id) });
  const rows = entrants.data ?? [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="lg">
        <DialogPanelHeader>
          <DialogPanelTitle>Peserta {race.name}</DialogPanelTitle>
          <DialogPanelDescription>
            {waktu(race.starts_at)} · member yang menargetkan race ini dari portal
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="px-0 py-0">
          {entrants.isLoading ? (
            <TableNote>Memuat peserta…</TableNote>
          ) : entrants.error ? (
            <TableNote tone="danger">{entrants.error.message}</TableNote>
          ) : rows.length === 0 ? (
            <TableNote>Belum ada member yang menargetkan race ini.</TableNote>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead className="hidden sm:table-cell">Divisi</TableHead>
                  <TableHead className="text-right">Target</TableHead>
                  <TableHead className="text-right">Hasil</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((entry) => (
                  <TableRow key={entry.id} className={entry.status === "cancelled" ? "opacity-60" : undefined}>
                    <TableCell>
                      <p className="font-medium">{entry.name ?? "Member"}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">{entry.phone}</span> · {MEMBER_RACE_STATUS_LABELS[entry.status]}
                      </p>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{DIVISION_LABELS[entry.division]}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.goal_sec ? formatDuration(entry.goal_sec) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.result_sec ? (
                        <span className="inline-flex items-center gap-1">
                          <Flag className="size-3.5 text-forest" aria-hidden />
                          {formatDuration(entry.result_sec)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogPanelBody>
      </DialogPanel>
    </Dialog>
  );
}
