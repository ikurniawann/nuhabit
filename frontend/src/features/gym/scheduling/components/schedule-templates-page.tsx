"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Field, TableNote } from "@/features/crm/engagement/components/shared";
import { Badge } from "@/components/ui/badge";
import { Can } from "@/components/iam/can";
import { useCan } from "@/components/iam/iam-access-provider";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SELECT } from "@/features/gym/shared";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CLASS_COLOR,
  GYM_KEYS,
  schedulingApi,
  tanggal,
  WEEKDAYS,
  wibDay,
  wibDayStart,
  type GenerateResult,
  type SessionTemplate,
} from "../api";

/** Gym → Template Jadwal: pola mingguan yang membuat sesi otomatis. */
export function ScheduleTemplatesPage() {
  const queryClient = useQueryClient();
  const data = useQuery({ queryKey: GYM_KEYS.templates, queryFn: schedulingApi.templates });
  const [editing, setEditing] = useState<SessionTemplate | "new" | null>(null);
  const [deleting, setDeleting] = useState<SessionTemplate | null>(null);
  const [lastRun, setLastRun] = useState<GenerateResult | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: GYM_KEYS.templates });

  const generate = useMutation({
    mutationFn: schedulingApi.generateFromTemplates,
    onSuccess: (result) => {
      setLastRun(result);
      toast.success(`${formatNumber(result.created)} sesi dibuat`, {
        description: result.skipped ? `${formatNumber(result.skipped)} sesi dilewati karena bentrok.` : undefined,
      });
      refresh();
      void queryClient.invalidateQueries({ queryKey: GYM_KEYS.sessions });
    },
    onError: (error) => toast.error("Generate jadwal gagal", { description: error.message }),
  });
  const canUpdate = useCan("gym.schedule", "update");
  const toggle = useMutation({
    mutationFn: (t: SessionTemplate) => schedulingApi.setTemplateActive(t.id, !t.active),
    onSuccess: (_data, t) => {
      toast.success(t.active ? "Template dinonaktifkan" : "Template diaktifkan");
      refresh();
    },
    onError: (error) => toast.error("Template gagal diubah", { description: error.message }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => schedulingApi.deleteTemplate(id),
    onSuccess: () => {
      toast.success("Template dihapus");
      setDeleting(null);
      refresh();
    },
    onError: (error) => toast.error("Template gagal dihapus", { description: error.message }),
  });

  const rows = data.data?.templates ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Template Jadwal"
        description="Pola mingguan yang membuat sesi terbit otomatis sesuai horizon jadwal di aturan gym. Mengubah template tidak mengubah sesi yang sudah dibuat; sesi yang dibatalkan atau dihapus tidak dibuat ulang."
        actions={
          <>
            <Link href="/dashboard/gym/schedule" className={buttonVariants({ variant: "ghost" })}>
              <CalendarDays /> Jadwal kelas
            </Link>
            <Can menu="gym.schedule" action="create" mode="disable">
              <Button variant="outline" onClick={() => generate.mutate()} disabled={generate.isPending}>
                <RefreshCw className={cn(generate.isPending && "animate-spin")} /> Generate sekarang
              </Button>
              <Button onClick={() => setEditing("new")}>
                <Plus /> Template baru
              </Button>
            </Can>
          </>
        }
      />

      {lastRun && lastRun.conflicts.length > 0 && (
        <Card size="sm" className="gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold">{formatNumber(lastRun.conflicts.length)} sesi dilewati karena bentrok</p>
            <Button variant="ghost" size="icon-xs" onClick={() => setLastRun(null)} aria-label="Tutup daftar bentrok">
              <X />
            </Button>
          </div>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {lastRun.conflicts.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Bereskan bentroknya, lalu generate lagi. Sesi lain sudah dibuat.</p>
        </Card>
      )}

      <Card className="py-0">
        {data.isLoading ? (
          <TableNote>Memuat template…</TableNote>
        ) : data.error ? (
          <TableNote tone="danger">{data.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada template. Buat satu per slot mingguan, misalnya Senin 06.30 Engine Builder.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Jadwal</TableHead>
                <TableHead>Kelas</TableHead>
                <TableHead className="hidden md:table-cell">Area</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Kredit</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Kapasitas</TableHead>
                <TableHead className="hidden lg:table-cell">Berlaku</TableHead>
                <TableHead className="hidden text-right md:table-cell">Sesi mendatang</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id} className={t.active ? undefined : "opacity-60"}>
                  <TableCell className="whitespace-nowrap">
                    <p className="font-medium">{WEEKDAYS[t.weekday - 1]}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {t.start_time.replace(":", ".")} · {t.duration_min} mnt
                    </p>
                  </TableCell>
                  <TableCell className="max-w-[16rem] whitespace-normal">
                    <p className="flex items-center gap-2 font-medium">
                      <span className={cn("size-2.5 shrink-0 rounded-full", CLASS_COLOR[t.color]?.bar)} aria-hidden />
                      {t.class_type_name}
                      {!t.active && <Badge variant="muted">Nonaktif</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">{t.coach_name ?? "Coach belum ditentukan"}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <p>{t.area ?? "–"}</p>
                    {t.branch_name && <p className="text-xs text-muted-foreground">{t.branch_name}</p>}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{t.credit_cost}</TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">{t.capacity}</TableCell>
                  <TableCell className="hidden text-xs lg:table-cell">
                    {tanggal(wibDayStart(t.valid_from))} – {t.valid_until ? tanggal(wibDayStart(t.valid_until)) : "seterusnya"}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {formatNumber(t.upcoming_sessions)}
                    {t.generated_until && (
                      <p className="text-xs text-muted-foreground">s.d. {tanggal(wibDayStart(t.generated_until))}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Switch
                        checked={t.active}
                        onCheckedChange={() => toggle.mutate(t)}
                        disabled={toggle.isPending || !canUpdate}
                        aria-label={t.active ? "Nonaktifkan template" : "Aktifkan template"}
                      />
                      {canUpdate && (
                        <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
                          Ubah
                        </Button>
                      )}
                      <Can menu="gym.schedule" action="delete">
                        <Button variant="ghost" size="sm" className="text-danger" onClick={() => setDeleting(t)}>
                          Hapus
                        </Button>
                      </Can>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {editing && (
        <TemplateDialog
          template={editing === "new" ? null : editing}
          branches={data.data?.branches ?? []}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus template ini?"
        description="Sesi yang sudah dibuat dari template ini tetap ada di jadwal. Nonaktifkan saja bila hanya ingin berhenti sementara."
        confirmLabel="Hapus template"
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}

function TemplateDialog({
  template,
  branches,
  onClose,
  onSaved,
}: {
  template: SessionTemplate | null;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const classTypes = useQuery({ queryKey: GYM_KEYS.classTypes, queryFn: schedulingApi.classTypes });
  const coaches = useQuery({ queryKey: GYM_KEYS.coaches, queryFn: schedulingApi.coaches });
  const [form, setForm] = useState(() => ({
    class_type_id: template?.class_type_id ?? "",
    coach_id: template?.coach_id ?? "",
    branch_id: template?.branch_id ?? (branches.length === 1 ? branches[0].id : ""),
    area: template?.area ?? "Main Floor",
    weekday: String(template?.weekday ?? 1),
    start_time: template?.start_time ?? "18:30",
    duration_min: template ? String(template.duration_min) : "",
    capacity: template ? String(template.capacity) : "",
    credit_cost: template ? String(template.credit_cost) : "",
    valid_from: template?.valid_from ?? wibDay(new Date()),
    valid_until: template?.valid_until ?? "",
    active: template?.active ?? true,
  }));
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((cur) => ({ ...cur, [key]: e.target.value }));

  const types = (classTypes.data ?? []).filter((t) => t.status === "active" || t.id === form.class_type_id);
  const chosenType = types.find((t) => t.id === form.class_type_id);
  const num = (value: string) => (value.trim() ? Number(value) : null);

  const save = useMutation({
    mutationFn: () =>
      schedulingApi.saveTemplate(
        {
          class_type_id: form.class_type_id,
          coach_id: form.coach_id || null,
          branch_id: form.branch_id || null,
          area: form.area.trim() || null,
          weekday: Number(form.weekday),
          start_time: form.start_time,
          duration_min: num(form.duration_min),
          capacity: num(form.capacity),
          credit_cost: num(form.credit_cost),
          valid_from: form.valid_from,
          valid_until: form.valid_until || null,
          active: form.active,
        },
        template?.id
      ),
    onSuccess: () => {
      toast.success(template ? "Template diperbarui" : "Template dibuat", {
        description: "Klik Generate sekarang untuk membuat sesinya.",
      });
      onSaved();
      onClose();
    },
    onError: (error) => toast.error("Template gagal disimpan", { description: error.message }),
  });

  const dateOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  const valid =
    Boolean(form.class_type_id) &&
    /^\d{2}:\d{2}$/.test(form.start_time) &&
    dateOk(form.valid_from) &&
    (!form.valid_until || (dateOk(form.valid_until) && form.valid_until >= form.valid_from));

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
            <DialogPanelTitle>{template ? `Ubah template ${template.class_type_name}` : "Template jadwal baru"}</DialogPanelTitle>
            <DialogPanelDescription>
              Satu template untuk satu slot mingguan. Kosongkan durasi, kapasitas, dan kredit untuk memakai default jenis kelas.
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Jenis kelas" className="sm:col-span-2">
              <select className={SELECT} value={form.class_type_id} onChange={set("class_type_id")} required>
                <option value="">Pilih jenis kelas</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.default_duration_min} mnt · {t.default_credit_cost} kredit
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Hari">
              <select className={SELECT} value={form.weekday} onChange={set("weekday")}>
                {WEEKDAYS.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Jam mulai (WIB)">
              <Input type="time" value={form.start_time} onChange={set("start_time")} required />
            </Field>
            <Field label="Coach" hint="Coach yang sama tidak bisa mengajar dua sesi di jam yang bertumpuk.">
              <select className={SELECT} value={form.coach_id} onChange={set("coach_id")}>
                <option value="">Belum ditentukan</option>
                {(coaches.data ?? [])
                  .filter((c) => c.status === "active" || c.id === form.coach_id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Cabang">
              <select className={SELECT} value={form.branch_id} onChange={set("branch_id")}>
                <option value="">Tanpa cabang</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Area" hint="Satu area hanya untuk satu sesi di jam yang sama.">
              <Input value={form.area} onChange={set("area")} placeholder="Main Floor" />
            </Field>
            <Field label="Durasi (menit)">
              <Input
                type="number"
                min={15}
                max={240}
                value={form.duration_min}
                onChange={set("duration_min")}
                placeholder={chosenType ? String(chosenType.default_duration_min) : "default"}
              />
            </Field>
            <Field label="Kapasitas">
              <Input
                type="number"
                min={1}
                value={form.capacity}
                onChange={set("capacity")}
                placeholder={chosenType ? String(chosenType.default_capacity) : "default"}
              />
            </Field>
            <Field label="Biaya kredit" hint="Dipotong saat check-in.">
              <Input
                type="number"
                min={1}
                max={20}
                value={form.credit_cost}
                onChange={set("credit_cost")}
                placeholder={chosenType ? String(chosenType.default_credit_cost) : "default"}
              />
            </Field>
            <Field label="Berlaku mulai">
              <Input type="date" value={form.valid_from} onChange={set("valid_from")} required />
            </Field>
            <Field label="Berlaku sampai" hint="Kosongkan bila tanpa batas.">
              <Input type="date" value={form.valid_until} min={form.valid_from} onChange={set("valid_until")} />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Switch checked={form.active} onCheckedChange={(active) => setForm((cur) => ({ ...cur, active }))} />
              Aktif (ikut dibuat saat generate)
            </label>
          </DialogPanelBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              Simpan
            </Button>
          </DialogFooter>
        </DialogPanelForm>
      </DialogPanel>
    </Dialog>
  );
}
