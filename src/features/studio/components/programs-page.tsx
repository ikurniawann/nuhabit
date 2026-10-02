"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { PROGRAM_KIND_LABEL, type ProgramKind } from "@/lib/studio/schedule";
import type { ApiList, ApiMessage, ProgramRow } from "../types";
import { EmptyState, Field, NativeSelect, Pill, StudioPageHeader } from "./ui-bits";

type DialogState = { mode: "create" } | { mode: "edit"; row: ProgramRow } | null;

export function StudioProgramsPage() {
  const [rows, setRows] = useState<ProgramRow[] | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const load = useCallback(async () => {
    try {
      setRows((await apiGet<ApiList<ProgramRow>>("/api/studio/programs")).data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat program");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: ProgramRow) {
    if (!confirm(`Hapus program ${row.name}? Program yang sudah punya sesi hanya dinonaktifkan.`)) return;
    try {
      const res = (await apiDelete(`/api/studio/programs/${row.id}`)) as ApiMessage;
      toast.success(res.message ?? "Program dihapus");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus program");
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <StudioPageHeader
        title="Program Kelas"
        subtitle="Jenis kelas grup dan personal training beserta durasi dan kuota default."
        actions={
          <Button onClick={() => setDialog({ mode: "create" })}>
            <Plus className="size-4" /> Tambah program
          </Button>
        }
      />

      {rows === null ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Belum ada program"
          description="Mulai dari program inti, mis. Hyrox Class, Strength, Running, atau Personal Training."
          action={<Button onClick={() => setDialog({ mode: "create" })}>Tambah program pertama</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-secondary/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Kode</th>
                <th className="px-4 py-3">Program</th>
                <th className="px-4 py-3">Jenis</th>
                <th className="px-4 py-3 text-right">Durasi</th>
                <th className="px-4 py-3 text-right">Kuota</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-border transition hover:bg-nh-lemon/40">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.code}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{p.name}</div>
                    {p.level_label && <div className="text-xs text-muted-foreground">{p.level_label}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <Pill tone={p.kind === "pt" ? "warning" : "positive"}>{PROGRAM_KIND_LABEL[p.kind]}</Pill>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{p.duration_minutes} mnt</td>
                  <td className="px-4 py-3 text-right tabular-nums">{p.default_capacity}</td>
                  <td className="px-4 py-3">{p.is_active ? <Pill tone="positive">Aktif</Pill> : <Pill>Nonaktif</Pill>}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="size-7" aria-label={`Ubah ${p.name}`} onClick={() => setDialog({ mode: "edit", row: p })}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-7" aria-label={`Hapus ${p.name}`} onClick={() => remove(p)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <ProgramDialog
          initial={dialog.mode === "edit" ? dialog.row : null}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function ProgramDialog({ initial, onClose, onSaved }: { initial: ProgramRow | null; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    code: initial?.code ?? "",
    name: initial?.name ?? "",
    kind: (initial?.kind ?? "class") as ProgramKind,
    description: initial?.description ?? "",
    duration_minutes: String(initial?.duration_minutes ?? 60),
    default_capacity: String(initial?.default_capacity ?? 12),
    level_label: initial?.level_label ?? "",
    is_active: initial?.is_active ?? true,
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error("Kode dan nama program wajib diisi");
      return;
    }
    setBusy(true);
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      kind: form.kind,
      description: form.description.trim() || null,
      duration_minutes: Number(form.duration_minutes) || 60,
      default_capacity: form.kind === "pt" ? 1 : Number(form.default_capacity) || 12,
      level_label: form.level_label.trim() || null,
      is_active: form.is_active,
    };
    try {
      const res = initial
        ? await apiPatch<ApiMessage>(`/api/studio/programs/${initial.id}`, payload)
        : await apiPost<ApiMessage>("/api/studio/programs", payload);
      toast.success(res.message ?? "Tersimpan");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan program");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? `Ubah ${initial.name}` : "Program baru"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kode">
            <Input value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="HYX" />
          </Field>
          <Field label="Jenis">
            <NativeSelect value={form.kind} onChange={(e) => set("kind", e.target.value as ProgramKind)}>
              <option value="class">Kelas grup</option>
              <option value="pt">Personal Training</option>
            </NativeSelect>
          </Field>
          <Field label="Nama program" className="sm:col-span-2">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Hyrox Class" />
          </Field>
          <Field label="Durasi (menit)">
            <Input type="number" min={15} max={240} value={form.duration_minutes} onChange={(e) => set("duration_minutes", e.target.value)} />
          </Field>
          <Field label="Kuota default" hint={form.kind === "pt" ? "Personal training selalu 1 orang" : undefined}>
            <Input
              type="number"
              min={1}
              max={200}
              value={form.kind === "pt" ? "1" : form.default_capacity}
              disabled={form.kind === "pt"}
              onChange={(e) => set("default_capacity", e.target.value)}
            />
          </Field>
          <Field label="Label level" hint="Opsional, mis. All levels / Intermediate" className="sm:col-span-2">
            <Input value={form.level_label} onChange={(e) => set("level_label", e.target.value)} />
          </Field>
          <Field label="Deskripsi" className="sm:col-span-2">
            <Textarea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 sm:col-span-2">
            <span className="text-sm text-foreground">Aktif</span>
            <Switch checked={form.is_active} onCheckedChange={(v) => set("is_active", v)} aria-label="Aktif" />
          </div>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />} Simpan
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
