"use client";

import { useState } from "react";
import { ClipboardDocumentListIcon } from "@heroicons/react/24/outline";
import { Loader2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { CUSTOM_FIELD_OBJECTS, CUSTOM_FIELD_TYPES } from "@/lib/crm/custom-fields";
import { useCreateCustomField, useCustomFields, useDeleteCustomField, useUpdateCustomField } from "../queries";
import { OBJECT_LABELS, type CustomFieldInput, type CustomFieldRow } from "../types";

const TYPE_LABELS: Record<(typeof CUSTOM_FIELD_TYPES)[number], string> = {
  text: "Teks",
  textarea: "Teks panjang",
  number: "Angka",
  date: "Tanggal",
  boolean: "Ya/Tidak",
  picklist: "Pilihan (satu)",
  multipicklist: "Pilihan (banyak)",
  url: "URL",
  email: "Email",
  phone: "Telepon",
};

interface FormState {
  object: CustomFieldInput["object"];
  key: string;
  label: string;
  field_type: CustomFieldInput["field_type"];
  options: string;
  is_required: boolean;
  min: string;
  max: string;
  pattern: string;
  help_text: string;
  show_in_list: boolean;
  is_active: boolean;
}
const EMPTY: FormState = { object: "lead", key: "", label: "", field_type: "text", options: "", is_required: false, min: "", max: "", pattern: "", help_text: "", show_in_list: false, is_active: true };

function rowToForm(r: CustomFieldRow): FormState {
  return {
    object: r.object, key: r.key, label: r.label, field_type: r.field_type, options: (r.options ?? []).join(", "),
    is_required: r.is_required, min: r.validation?.min?.toString() ?? "", max: r.validation?.max?.toString() ?? "",
    pattern: r.validation?.pattern ?? "", help_text: r.help_text ?? "", show_in_list: Boolean(r.show_in_list), is_active: r.is_active,
  };
}
function formToInput(f: FormState): CustomFieldInput {
  const validation: CustomFieldInput["validation"] = {};
  if (f.min !== "") validation.min = Number(f.min);
  if (f.max !== "") validation.max = Number(f.max);
  if (f.pattern.trim()) validation.pattern = f.pattern.trim();
  return {
    object: f.object, key: f.key.trim(), label: f.label.trim(), field_type: f.field_type,
    options: f.options.split(",").map((x) => x.trim()).filter(Boolean),
    is_required: f.is_required, validation, help_text: f.help_text.trim() || null, show_in_list: f.show_in_list, sort_order: 0, is_active: f.is_active,
  };
}

/** EPIC-050 T-3.3 — Pengaturan CRM → Custom Fields. */
export function CustomFieldsPage() {
  const fieldsQuery = useCustomFields();
  const createMutation = useCreateCustomField();
  const updateMutation = useUpdateCustomField();
  const deleteMutation = useDeleteCustomField();
  const [editing, setEditing] = useState<CustomFieldRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<CustomFieldRow | null>(null);
  const fields = fieldsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Custom Fields</h1>
          <p className="mt-1 text-sm text-gray-500">Field tambahan untuk Lead, Deal, Account, Contact. Langsung muncul di form dan bisa dipakai kondisi workflow (custom.&lt;key&gt;).</p>
        </div>
        <Button type="button" className="h-10 gap-2 rounded-lg bg-pink-600 text-white hover:bg-pink-700" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="h-4 w-4" /> Field
        </Button>
      </div>

      <PurchasingListSection icon={ClipboardDocumentListIcon} title="Daftar Field" description="Key tidak bisa diubah setelah dibuat karena nilai tersimpan mengacu key.">
        {fieldsQuery.isLoading ? (
          <div className="py-14 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" /></div>
        ) : fields.length === 0 ? (
          <p className="py-14 text-center text-sm text-gray-500">Belum ada custom field.</p>
        ) : (
          <ul className="divide-y divide-gray-200/60">
            {fields.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <Switch checked={f.is_active} onCheckedChange={(v) => updateMutation.mutate({ id: f.id, values: { is_active: Boolean(v) } })} />
                <Badge className="border-0 bg-gray-900 font-semibold text-white">{OBJECT_LABELS[f.object]}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900">{f.label} <span className="font-mono text-xs text-gray-400">{f.key}</span></p>
                  <p className="text-xs text-gray-500">
                    {TYPE_LABELS[f.field_type]}{f.is_required ? " · wajib" : ""}{f.options?.length ? ` · ${f.options.join(" / ")}` : ""}{f.show_in_list ? " · tampil di daftar" : ""}
                  </p>
                </div>
                {f.company_id === null ? <Badge className="border-0 bg-violet-100 font-normal text-violet-700">global</Badge> : null}
                <button type="button" className="text-xs text-gray-500 hover:text-pink-700" onClick={() => { setEditing(f); setFormOpen(true); }}>Edit</button>
                <button type="button" className="text-xs text-gray-400 hover:text-red-600" onClick={() => setDeleting(f)}>Hapus</button>
              </li>
            ))}
          </ul>
        )}
      </PurchasingListSection>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-xl">
          {formOpen ? (
            <FieldForm
              key={editing?.id ?? "new"}
              initial={editing ? rowToForm(editing) : EMPTY}
              isEdit={Boolean(editing)}
              pending={createMutation.isPending || updateMutation.isPending}
              onCancel={() => setFormOpen(false)}
              onSubmit={(f) => {
                const input = formToInput(f);
                if (editing) {
                  const { key: _k, object: _o, ...rest } = input;
                  void _k; void _o;
                  updateMutation.mutate({ id: editing.id, values: rest }, { onSuccess: () => setFormOpen(false) });
                } else createMutation.mutate(input, { onSuccess: () => setFormOpen(false) });
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Hapus definisi field?"
        description={`"${deleting?.label ?? ""}" dihapus dari form. Nilai yang sudah tersimpan di record tidak ikut terhapus.`}
        confirmLabel="Hapus"
        variant="danger"
        onConfirm={() => { if (deleting) deleteMutation.mutate(deleting.id); setDeleting(null); }}
      />
    </div>
  );
}

function FieldForm({ initial, isEdit, pending, onCancel, onSubmit }: { initial: FormState; isEdit: boolean; pending: boolean; onCancel: () => void; onSubmit: (f: FormState) => void }) {
  const [f, setF] = useState<FormState>(initial);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const isPick = f.field_type === "picklist" || f.field_type === "multipicklist";
  const canSubmit = f.label.trim() && /^[a-z][a-z0-9_]{1,39}$/.test(f.key) && (!isPick || f.options.trim());
  return (
    <>
      <DialogHeader><DialogTitle>{isEdit ? "Edit Custom Field" : "Custom Field Baru"}</DialogTitle></DialogHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Objek</Label>
          {isEdit ? (
            <Input value={OBJECT_LABELS[f.object]} disabled />
          ) : (
            <Select value={f.object} onValueChange={(v) => set("object", v as FormState["object"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CUSTOM_FIELD_OBJECTS.map((o) => <SelectItem key={o} value={o}>{OBJECT_LABELS[o]}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Tipe</Label>
          <Select value={f.field_type} onValueChange={(v) => set("field_type", v as FormState["field_type"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CUSTOM_FIELD_TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Label</Label>
          <Input value={f.label} onChange={(e) => { set("label", e.target.value); if (!isEdit && !f.key) set("key", e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40)); }} placeholder="cth. Budget (Rp)" />
        </div>
        <div className="space-y-1.5">
          <Label>Key (huruf kecil, angka, _)</Label>
          <Input value={f.key} onChange={(e) => set("key", e.target.value.toLowerCase())} disabled={isEdit} placeholder="budget" className="font-mono" />
        </div>
        {isPick ? (
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Pilihan (pisah koma)</Label>
            <Input value={f.options} onChange={(e) => set("options", e.target.value)} placeholder="Kecil, Sedang, Besar" />
          </div>
        ) : null}
        {f.field_type === "number" ? (
          <>
            <div className="space-y-1.5"><Label>Minimum</Label><Input type="number" value={f.min} onChange={(e) => set("min", e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Maksimum</Label><Input type="number" value={f.max} onChange={(e) => set("max", e.target.value)} /></div>
          </>
        ) : null}
        {f.field_type === "text" ? (
          <div className="space-y-1.5 sm:col-span-2"><Label>Pola regex (opsional)</Label><Input value={f.pattern} onChange={(e) => set("pattern", e.target.value)} placeholder="^[A-Z]{3}-\\d{4}$" className="font-mono" /></div>
        ) : null}
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Teks bantuan (opsional)</Label>
          <Input value={f.help_text} onChange={(e) => set("help_text", e.target.value)} />
        </div>
        <label className="inline-flex items-center gap-2 text-sm"><Switch checked={f.is_required} onCheckedChange={(v) => set("is_required", Boolean(v))} /> Wajib diisi</label>
        <label className="inline-flex items-center gap-2 text-sm"><Switch checked={f.show_in_list} onCheckedChange={(v) => set("show_in_list", Boolean(v))} /> Tampil di daftar</label>
        <label className="inline-flex items-center gap-2 text-sm"><Switch checked={f.is_active} onCheckedChange={(v) => set("is_active", Boolean(v))} /> Aktif</label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>Batal</Button>
        <Button onClick={() => onSubmit(f)} disabled={!canSubmit || pending}>{pending ? "Menyimpan…" : "Simpan"}</Button>
      </DialogFooter>
    </>
  );
}
