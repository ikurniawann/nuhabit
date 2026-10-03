"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Field, TableNote, TEXTAREA } from "@/features/crm/engagement/components/shared";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { angka, CLASS_COLOR, GYM_KEYS, schedulingApi, SELECT, type ClassColor, type ClassType } from "../api";

/** Gym → Jenis Kelas: template durasi, kapasitas, dan biaya kredit untuk sesi baru. */
export function ClassTypesPage() {
  const queryClient = useQueryClient();
  const types = useQuery({ queryKey: GYM_KEYS.classTypes, queryFn: schedulingApi.classTypes });
  const [editing, setEditing] = useState<ClassType | "new" | null>(null);
  const [archiving, setArchiving] = useState<ClassType | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: GYM_KEYS.classTypes });

  const archive = useMutation({
    mutationFn: (id: string) => schedulingApi.archiveClassType(id),
    onSuccess: () => {
      toast.success("Jenis kelas diarsipkan");
      setArchiving(null);
      refresh();
    },
    onError: (error) => toast.error("Gagal mengarsipkan", { description: error.message }),
  });
  const rows = types.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Gym & Kelas"
        title="Jenis Kelas"
        description="Template kelas. Sesi menyalin kapasitas dan biaya kredit saat dibuat, jadi mengubah template tidak mengubah sesi yang sudah ada."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Jenis kelas baru
          </Button>
        }
      />

      <Card className="py-0">
        {types.isLoading ? (
          <TableNote>Memuat jenis kelas…</TableNote>
        ) : types.error ? (
          <TableNote tone="danger">{types.error.message}</TableNote>
        ) : rows.length === 0 ? (
          <TableNote>Belum ada jenis kelas.</TableNote>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kelas</TableHead>
                <TableHead className="text-right">Durasi</TableHead>
                <TableHead className="text-right">Kredit</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Kapasitas</TableHead>
                <TableHead className="hidden text-right md:table-cell">Sesi mendatang</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id} className={t.status === "archived" ? "opacity-60" : undefined}>
                  <TableCell className="max-w-[20rem] whitespace-normal">
                    <p className="flex items-center gap-2 font-medium">
                      <span className={cn("size-2.5 shrink-0 rounded-full", CLASS_COLOR[t.color]?.bar)} aria-hidden />
                      {t.name}
                      {t.status === "archived" && <Badge variant="muted">Arsip</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">{t.description}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{t.default_duration_min} mnt</TableCell>
                  <TableCell className="text-right tabular-nums">{t.default_credit_cost}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{t.default_capacity}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{angka(t.upcoming_sessions)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
                        Ubah
                      </Button>
                      {t.status === "active" && (
                        <Button variant="ghost" size="sm" className="text-danger" onClick={() => setArchiving(t)}>
                          Arsipkan
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {editing && (
        <ClassTypeDialog classType={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={`Arsipkan ${archiving?.name ?? "jenis kelas"}?`}
        description="Jenis kelas arsip tidak bisa dipilih untuk sesi baru. Sesi yang sudah terjadwal tetap berjalan."
        confirmLabel="Arsipkan"
        variant="danger"
        loading={archive.isPending}
        onConfirm={() => archiving && archive.mutate(archiving.id)}
      />
    </div>
  );
}

function ClassTypeDialog({
  classType,
  onClose,
  onSaved,
}: {
  classType: ClassType | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: classType?.name ?? "",
    description: classType?.description ?? "",
    default_duration_min: String(classType?.default_duration_min ?? 60),
    default_credit_cost: String(classType?.default_credit_cost ?? 1),
    default_capacity: String(classType?.default_capacity ?? 16),
    color: classType?.color ?? ("lime" as ClassColor),
    status: classType?.status ?? ("active" as const),
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((cur) => ({ ...cur, [key]: e.target.value }));

  const save = useMutation({
    mutationFn: () =>
      schedulingApi.saveClassType(
        {
          name: form.name.trim(),
          description: form.description.trim(),
          default_duration_min: Number(form.default_duration_min),
          default_credit_cost: Number(form.default_credit_cost),
          default_capacity: Number(form.default_capacity),
          color: form.color,
          status: form.status,
        },
        classType?.id
      ),
    onSuccess: () => {
      toast.success("Jenis kelas disimpan", { description: form.name });
      onSaved();
      onClose();
    },
    onError: (error) => toast.error("Jenis kelas gagal disimpan", { description: error.message }),
  });
  const valid =
    form.name.trim().length >= 3 &&
    Number(form.default_duration_min) >= 15 &&
    Number(form.default_credit_cost) >= 1 &&
    Number(form.default_capacity) >= 1;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPanel size="md">
        <DialogPanelForm
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <DialogPanelHeader>
            <DialogPanelTitle>{classType ? `Ubah ${classType.name}` : "Jenis kelas baru"}</DialogPanelTitle>
            <DialogPanelDescription>Nilai default untuk sesi baru; tiap sesi masih bisa diubah.</DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Nama" className="sm:col-span-2">
              <Input value={form.name} onChange={set("name")} placeholder="Race Simulation" required />
            </Field>
            <Field label="Warna di jadwal">
              <select className={SELECT} value={form.color} onChange={set("color")}>
                {Object.entries(CLASS_COLOR).map(([value, { label }]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Deskripsi" className="sm:col-span-3">
              <textarea className={TEXTAREA} value={form.description} onChange={set("description")} />
            </Field>
            <Field label="Durasi (menit)">
              <Input type="number" min={15} value={form.default_duration_min} onChange={set("default_duration_min")} required />
            </Field>
            <Field label="Biaya kredit" hint="Dipotong saat check-in.">
              <Input type="number" min={1} value={form.default_credit_cost} onChange={set("default_credit_cost")} required />
            </Field>
            <Field label="Kapasitas">
              <Input type="number" min={1} value={form.default_capacity} onChange={set("default_capacity")} required />
            </Field>
            {classType && (
              <Field label="Status">
                <select className={SELECT} value={form.status} onChange={set("status")}>
                  <option value="active">Aktif</option>
                  <option value="archived">Arsip</option>
                </select>
              </Field>
            )}
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
