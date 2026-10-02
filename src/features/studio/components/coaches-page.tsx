"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { COACH_LEVEL_LABEL, type CoachLevel } from "@/lib/studio/schedule";
import type { ApiList, ApiMessage, CoachRow, EmployeeOption } from "../types";
import { initials } from "../types";
import { EmptyState, Field, NativeSelect, Pill, StudioPageHeader } from "./ui-bits";

type DialogState = { mode: "create" } | { mode: "edit"; row: CoachRow } | null;

export function StudioCoachesPage() {
  const [rows, setRows] = useState<CoachRow[] | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<ApiList<CoachRow>>("/api/studio/coaches");
      setRows(res.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat coach");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: CoachRow) {
    if (!confirm(`Hapus coach ${row.full_name}? Coach yang sudah punya jadwal hanya dinonaktifkan.`)) return;
    try {
      const res = (await apiDelete(`/api/studio/coaches/${row.id}`)) as ApiMessage;
      toast.success(res.message ?? "Coach dihapus");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus coach");
    }
  }

  const active = rows?.filter((r) => r.is_active) ?? [];
  const inactive = rows?.filter((r) => !r.is_active) ?? [];

  return (
    <div className="p-4 sm:p-6">
      <StudioPageHeader
        title="Coach"
        subtitle="Profil coach yang tampil di Member App, level (Head Coach / Coach), dan tautan ke data karyawan untuk gaji tetap."
        actions={
          <Button onClick={() => setDialog({ mode: "create" })}>
            <Plus className="size-4" /> Tambah coach
          </Button>
        }
      />

      {rows === null ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Belum ada coach"
          description="Tambahkan Head Coach dan coach yang mengajar kelas maupun personal training."
          action={<Button onClick={() => setDialog({ mode: "create" })}>Tambah coach pertama</Button>}
        />
      ) : (
        <div className="space-y-8">
          <CoachGrid rows={active} onEdit={(row) => setDialog({ mode: "edit", row })} onRemove={remove} />
          {inactive.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Nonaktif</h2>
              <CoachGrid rows={inactive} onEdit={(row) => setDialog({ mode: "edit", row })} onRemove={remove} />
            </div>
          )}
        </div>
      )}

      {dialog && (
        <CoachDialog
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

function CoachGrid({ rows, onEdit, onRemove }: { rows: CoachRow[]; onEdit: (r: CoachRow) => void; onRemove: (r: CoachRow) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((c) => (
        <article key={c.id} className="flex gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
          {c.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.photo_url} alt={c.full_name} className="size-16 shrink-0 rounded-xl object-cover" />
          ) : (
            <div className="grid size-16 shrink-0 place-items-center rounded-xl bg-nh-forest font-display text-lg font-semibold text-nh-lime">
              {initials(c.full_name)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate font-display text-base font-semibold text-foreground">{c.display_name || c.full_name}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Pill tone={c.level === "head_coach" ? "brand" : "positive"}>{COACH_LEVEL_LABEL[c.level]}</Pill>
                  {!c.is_public && <Pill>Tidak tampil di app</Pill>}
                  {!c.is_active && <Pill tone="danger">Nonaktif</Pill>}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="icon" className="size-7" aria-label={`Ubah ${c.full_name}`} onClick={() => onEdit(c)}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" className="size-7" aria-label={`Hapus ${c.full_name}`} onClick={() => onRemove(c)}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </div>
            {c.specialties.length > 0 && (
              <p className="mt-2 truncate text-xs text-muted-foreground">{c.specialties.join(" · ")}</p>
            )}
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {c.employee_name ? `Karyawan: ${c.employee_name}${c.employee_nip ? ` (${c.employee_nip})` : ""}` : "Belum ditautkan ke karyawan"}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}

function CoachDialog({ initial, onClose, onSaved }: { initial: CoachRow | null; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [form, setForm] = useState({
    employee_id: initial?.employee_id ?? "",
    full_name: initial?.full_name ?? "",
    display_name: initial?.display_name ?? "",
    level: (initial?.level ?? "coach") as CoachLevel,
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    photo_url: initial?.photo_url ?? "",
    bio: initial?.bio ?? "",
    certifications: initial?.certifications ?? "",
    specialties: (initial?.specialties ?? []).join(", "),
    is_public: initial?.is_public ?? true,
    is_active: initial?.is_active ?? true,
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    apiGet<ApiList<EmployeeOption>>("/api/studio/coaches/employee-options")
      .then((res) => setEmployees(res.data))
      .catch(() => setEmployees([]));
  }, []);

  const employeeChoices = useMemo(
    () => employees.filter((e) => !e.linked || e.id === initial?.employee_id),
    [employees, initial?.employee_id]
  );

  function pickEmployee(id: string) {
    const emp = employees.find((e) => e.id === id);
    setForm((f) => ({
      ...f,
      employee_id: id,
      full_name: f.full_name || emp?.full_name || "",
      phone: f.phone || emp?.phone || "",
      email: f.email || emp?.email || "",
    }));
  }

  async function save() {
    if (!form.full_name.trim()) {
      toast.error("Nama coach wajib diisi");
      return;
    }
    setBusy(true);
    const payload = {
      employee_id: form.employee_id || null,
      full_name: form.full_name.trim(),
      display_name: form.display_name.trim() || null,
      level: form.level,
      phone: form.phone.trim() || null,
      email: form.email.trim(),
      photo_url: form.photo_url.trim() || null,
      bio: form.bio.trim() || null,
      certifications: form.certifications.trim() || null,
      specialties: form.specialties.split(",").map((s) => s.trim()).filter(Boolean),
      is_public: form.is_public,
      is_active: form.is_active,
    };
    try {
      const res = initial
        ? await apiPatch<ApiMessage>(`/api/studio/coaches/${initial.id}`, payload)
        : await apiPost<ApiMessage>("/api/studio/coaches", payload);
      toast.success(res.message ?? "Tersimpan");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan coach");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? `Ubah ${initial.full_name}` : "Coach baru"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tautkan ke karyawan" hint="Gaji tetap tetap lewat payroll HRIS" className="sm:col-span-2">
            <NativeSelect value={form.employee_id} onChange={(e) => pickEmployee(e.target.value)}>
              <option value="">— Tidak ditautkan —</option>
              {employeeChoices.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}{e.nip ? ` · ${e.nip}` : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Nama lengkap">
            <Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </Field>
          <Field label="Nama tampilan" hint="Opsional, untuk Member App">
            <Input value={form.display_name} onChange={(e) => set("display_name", e.target.value)} />
          </Field>
          <Field label="Level">
            <NativeSelect value={form.level} onChange={(e) => set("level", e.target.value as CoachLevel)}>
              <option value="coach">Coach</option>
              <option value="head_coach">Head Coach</option>
            </NativeSelect>
          </Field>
          <Field label="No. HP">
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" />
          </Field>
          <Field label="Email" className="sm:col-span-2">
            <Input value={form.email} onChange={(e) => set("email", e.target.value)} type="email" />
          </Field>
          <Field label="URL foto" hint="Foto profil untuk Member App" className="sm:col-span-2">
            <Input value={form.photo_url} onChange={(e) => set("photo_url", e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Spesialisasi" hint="Pisahkan dengan koma, mis. Hyrox, Strength, Running" className="sm:col-span-2">
            <Input value={form.specialties} onChange={(e) => set("specialties", e.target.value)} />
          </Field>
          <Field label="Background / bio" className="sm:col-span-2">
            <Textarea rows={3} value={form.bio} onChange={(e) => set("bio", e.target.value)} />
          </Field>
          <Field label="Sertifikasi" className="sm:col-span-2">
            <Textarea rows={2} value={form.certifications} onChange={(e) => set("certifications", e.target.value)} />
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">Tampil di Member App</span>
            <Switch checked={form.is_public} onCheckedChange={(v) => set("is_public", v)} aria-label="Tampil di Member App" />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
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
