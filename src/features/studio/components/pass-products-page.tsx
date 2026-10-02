"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { isValueSplitValid, PASS_CATEGORY_LABEL, suggestValueSplit, type PassCategory } from "@/lib/studio/pass";
import type { ApiList, ApiMessage, PassProductRow } from "../types";
import { rupiah } from "../types";
import { EmptyState, Field, NativeSelect, Pill, StudioPageHeader } from "./ui-bits";

type DialogState = { mode: "create" } | { mode: "edit"; row: PassProductRow } | null;

function benefitLine(p: Pick<PassProductRow, "class_credits" | "pt_credits" | "facility_access" | "validity_days">) {
  const parts: string[] = [];
  if (p.class_credits) parts.push(`${p.class_credits}x kelas`);
  if (p.pt_credits) parts.push(`${p.pt_credits}x PT`);
  if (p.facility_access) parts.push("akses facility");
  return `${parts.join(" + ")} · ${p.validity_days} hari`;
}

export function StudioPassProductsPage() {
  const [rows, setRows] = useState<PassProductRow[] | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const load = useCallback(async () => {
    try {
      setRows((await apiGet<ApiList<PassProductRow>>("/api/studio/pass-products")).data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memuat paket");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(row: PassProductRow) {
    if (!confirm(`Hapus paket ${row.name}? Paket yang sudah terjual hanya dinonaktifkan.`)) return;
    try {
      const res = (await apiDelete(`/api/studio/pass-products/${row.id}`)) as ApiMessage;
      toast.success(res.message ?? "Paket dihapus");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus paket");
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <StudioPageHeader
        title="Paket Member"
        subtitle="Katalog pass: jumlah kredit kelas/PT, akses facility, masa berlaku, harga, dan pembagian nilai untuk pengakuan revenue."
        actions={
          <Button onClick={() => setDialog({ mode: "create" })}>
            <Plus className="size-4" /> Tambah paket
          </Button>
        }
      />

      {rows === null ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Belum ada paket"
          description="Contoh: 3x kelas dalam 14 hari, 7x kelas dalam 30 hari, atau paket Class + PT + Facility."
          action={<Button onClick={() => setDialog({ mode: "create" })}>Tambah paket pertama</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <article key={p.id} className={`flex flex-col rounded-xl border bg-card p-5 shadow-sm ${p.is_active ? "border-border" : "border-dashed border-border opacity-70"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-muted-foreground">{p.code}</p>
                  <h3 className="font-display text-lg font-semibold leading-tight text-foreground">{p.name}</h3>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" className="size-7" aria-label={`Ubah ${p.name}`} onClick={() => setDialog({ mode: "edit", row: p })}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" aria-label={`Hapus ${p.name}`} onClick={() => remove(p)}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Pill tone={p.category === "class" ? "positive" : p.category === "class_pt" ? "warning" : "brand"}>
                  {PASS_CATEGORY_LABEL[p.category]}
                </Pill>
                {!p.is_active && <Pill>Nonaktif</Pill>}
                {!p.is_public && <Pill>Hanya front desk</Pill>}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{benefitLine(p)}</p>
              <p className="mt-auto pt-4 font-display text-2xl font-semibold tabular-nums text-foreground">{rupiah(p.price)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Nilai: kelas {rupiah(p.class_value)} · PT {rupiah(p.pt_value)}
                {p.facility_access ? ` · facility ${rupiah(p.facility_value)}` : ""}
                {typeof p.sold_count === "number" ? ` · ${p.sold_count} terjual` : ""}
              </p>
            </article>
          ))}
        </div>
      )}

      {dialog && (
        <PassProductDialog
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

function PassProductDialog({ initial, onClose, onSaved }: { initial: PassProductRow | null; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    code: initial?.code ?? "",
    name: initial?.name ?? "",
    category: (initial?.category ?? "class") as PassCategory,
    class_credits: String(initial?.class_credits ?? 3),
    pt_credits: String(initial?.pt_credits ?? 0),
    facility_access: initial?.facility_access ?? false,
    validity_days: String(initial?.validity_days ?? 14),
    price: String(initial?.price ?? ""),
    class_value: String(initial?.class_value ?? ""),
    pt_value: String(initial?.pt_value ?? 0),
    facility_value: String(initial?.facility_value ?? 0),
    description: initial?.description ?? "",
    is_active: initial?.is_active ?? true,
    is_public: initial?.is_public ?? true,
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const num = (v: string) => Number(v.replace(/[^\d.]/g, "")) || 0;

  function pickCategory(category: PassCategory) {
    setForm((f) => ({
      ...f,
      category,
      pt_credits: category === "class" ? "0" : f.pt_credits === "0" ? "1" : f.pt_credits,
      facility_access: category === "class_pt_facility",
      pt_value: category === "class" ? "0" : f.pt_value,
      facility_value: category === "class_pt_facility" ? f.facility_value : "0",
    }));
  }

  function autoSplit() {
    const s = suggestValueSplit(num(form.price), num(form.class_credits), num(form.pt_credits), form.facility_access);
    setForm((f) => ({ ...f, class_value: String(s.class_value), pt_value: String(s.pt_value), facility_value: String(s.facility_value) }));
  }

  const payload = {
    code: form.code.trim(),
    name: form.name.trim(),
    category: form.category,
    class_credits: num(form.class_credits),
    pt_credits: form.category === "class" ? 0 : num(form.pt_credits),
    facility_access: form.facility_access,
    validity_days: num(form.validity_days),
    price: num(form.price),
    class_value: num(form.class_value),
    pt_value: form.category === "class" ? 0 : num(form.pt_value),
    facility_value: form.facility_access ? num(form.facility_value) : 0,
    description: form.description.trim() || null,
    is_active: form.is_active,
    is_public: form.is_public,
  };
  const splitError = payload.price > 0 ? isValueSplitValid(payload) : null;

  async function save() {
    if (!payload.code || !payload.name || payload.validity_days < 1) {
      toast.error("Kode, nama, dan masa berlaku wajib diisi");
      return;
    }
    if (splitError) {
      toast.error(splitError);
      return;
    }
    setBusy(true);
    try {
      const res = initial
        ? await apiPatch<ApiMessage>(`/api/studio/pass-products/${initial.id}`, payload)
        : await apiPost<ApiMessage>("/api/studio/pass-products", payload);
      toast.success(res.message ?? "Tersimpan");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan paket");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? `Ubah ${initial.name}` : "Paket baru"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kode">
            <Input value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="CLASS-3X" />
          </Field>
          <Field label="Tipe">
            <NativeSelect value={form.category} onChange={(e) => pickCategory(e.target.value as PassCategory)}>
              <option value="class">Class</option>
              <option value="class_pt">Class + PT</option>
              <option value="class_pt_facility">Class + PT + Facility</option>
            </NativeSelect>
          </Field>
          <Field label="Nama paket" className="sm:col-span-2">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Starter 3x · 2 minggu" />
          </Field>
          <Field label="Kredit kelas">
            <Input type="number" min={0} value={form.class_credits} onChange={(e) => set("class_credits", e.target.value)} />
          </Field>
          <Field label="Kredit PT">
            <Input type="number" min={0} value={form.category === "class" ? "0" : form.pt_credits} disabled={form.category === "class"} onChange={(e) => set("pt_credits", e.target.value)} />
          </Field>
          <Field label="Masa berlaku (hari)" hint="2 minggu = 14 · 1 bulan = 30">
            <Input type="number" min={1} max={730} value={form.validity_days} onChange={(e) => set("validity_days", e.target.value)} />
          </Field>
          <Field label="Harga (Rp)">
            <Input inputMode="numeric" value={form.price} onChange={(e) => set("price", e.target.value)} placeholder="450000" />
          </Field>

          <div className="rounded-xl border border-border bg-secondary/40 p-4 sm:col-span-2">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-semibold text-foreground">Pembagian nilai (pengakuan revenue)</p>
                <p className="text-xs text-muted-foreground">Dasar revenue kelas vs PT saat kredit dipakai, dan pool komisi coach.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={autoSplit} disabled={!num(form.price)}>
                <Wand2 className="size-3.5" /> Usulkan
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Nilai kelas">
                <Input inputMode="numeric" value={form.class_value} onChange={(e) => set("class_value", e.target.value)} />
              </Field>
              <Field label="Nilai PT">
                <Input inputMode="numeric" value={form.category === "class" ? "0" : form.pt_value} disabled={form.category === "class"} onChange={(e) => set("pt_value", e.target.value)} />
              </Field>
              <Field label="Nilai facility" hint="Diakui saat pass berakhir">
                <Input inputMode="numeric" value={form.facility_access ? form.facility_value : "0"} disabled={!form.facility_access} onChange={(e) => set("facility_value", e.target.value)} />
              </Field>
            </div>
            {splitError && <p className="mt-2 text-xs font-semibold text-destructive">{splitError}</p>}
          </div>

          <Field label="Deskripsi" hint="Tampil di Member App" className="sm:col-span-2">
            <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">Dijual di Member App</span>
            <Switch checked={form.is_public} onCheckedChange={(v) => set("is_public", v)} aria-label="Dijual di Member App" />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">Aktif</span>
            <Switch checked={form.is_active} onCheckedChange={(v) => set("is_active", v)} aria-label="Aktif" />
          </div>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Batal</Button>
          <Button onClick={save} disabled={busy || Boolean(splitError)}>
            {busy && <Loader2 className="size-4 animate-spin" />} Simpan
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
