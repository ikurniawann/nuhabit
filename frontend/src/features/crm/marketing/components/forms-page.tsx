"use client";

import { useState } from "react";
import Link from "next/link";
import { DocumentTextIcon } from "@heroicons/react/24/outline";
import { ExternalLink, Loader2, Plus, ShieldAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PurchasingListSection } from "@/features/purchasing/components/shared/purchasing-list-section";
import { useOwners } from "@/features/crm/advance/queries";
import {
  DEFAULT_FORM_FIELDS, LEAD_MAPPED_LABELS, PUBLIC_FIELD_TYPES, PUBLIC_FIELD_TYPE_LABELS, toLeadSource,
} from "@/lib/crm/public-forms";
import { useCreateForm, useDeleteForm, useFormSubmissions, useForms, useUpdateForm } from "../queries";
import type { FormRow, PublicFieldDef, PublicFormInput } from "../types";
import { formatDateTime } from "@/lib/format";

/** EPIC-050 T-5.3 — kelola form publik yang tampil di poskopi.reddie.id/public. */
export function PublicFormsPage() {
  const formsQuery = useForms();
  const updateMutation = useUpdateForm();
  const deleteMutation = useDeleteForm();
  const [editing, setEditing] = useState<FormRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<FormRow | null>(null);
  const [deleting, setDeleting] = useState<FormRow | null>(null);
  const forms = formsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Form Publik</h1>
          <p className="mt-1 text-sm text-gray-500">
            Formulir yang bisa diisi siapa pun tanpa login. Setiap kiriman menjadi lead baru, ikut dinilai skor dan memicu workflow.
          </p>
        </div>
        <Button type="button" className="h-10 gap-2 rounded-lg bg-pink-600 text-white hover:bg-pink-700" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Form
        </Button>
      </div>

      <PurchasingListSection
        icon={DocumentTextIcon}
        title="Daftar Form"
        description="Form dengan slug kontak adalah yang tampil di /public. Alamat form lain: /public/<slug>."
      >
        {formsQuery.isLoading ? (
          <div className="py-14 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" /></div>
        ) : forms.length === 0 ? (
          <p className="py-14 text-center text-sm text-gray-500">Belum ada form.</p>
        ) : (
          <ul className="divide-y divide-gray-200/60">
            {forms.map((f) => {
              const url = f.slug === "kontak" ? "/public" : `/public/${f.slug}`;
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <Switch checked={f.is_active} onCheckedChange={(v) => updateMutation.mutate({ id: f.id, values: { is_active: Boolean(v) } })} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900">{f.name}</p>
                    <p className="text-xs text-gray-500">
                      {f.title} · {(f.fields ?? DEFAULT_FORM_FIELDS).length} field · terakhir {formatDateTime(f.last_submission_at, "—")}
                    </p>
                  </div>
                  <Badge className="border-0 bg-emerald-100 font-normal text-emerald-700">{f.submission_count} kiriman</Badge>
                  {Number(f.rejected_count) > 0 ? (
                    <Badge className="border-0 bg-amber-100 font-normal text-amber-700">
                      <ShieldAlert className="mr-1 h-3 w-3" />{f.rejected_count} ditolak
                    </Badge>
                  ) : null}
                  <Link href={url} target="_blank" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-pink-700">
                    <ExternalLink className="h-3.5 w-3.5" /> {url}
                  </Link>
                  <button type="button" className="text-xs text-gray-500 hover:text-pink-700" onClick={() => setViewing(f)}>Kiriman</button>
                  <button type="button" className="text-xs text-gray-500 hover:text-pink-700" onClick={() => setEditing(f)}>Edit</button>
                  {f.slug !== "kontak" ? (
                    <button type="button" className="text-xs text-gray-400 hover:text-red-600" onClick={() => setDeleting(f)}>Hapus</button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </PurchasingListSection>

      <Dialog open={creating || editing !== null} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          {creating || editing ? (
            <FormEditor
              key={editing?.id ?? "new"}
              initial={editing}
              onClose={() => { setCreating(false); setEditing(null); }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          {viewing ? <SubmissionsView form={viewing} /> : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Hapus form?"
        description={`"${deleting?.name ?? ""}" tidak lagi bisa diakses publik. Lead yang sudah masuk tetap tersimpan.`}
        confirmLabel="Hapus"
        variant="danger"
        onConfirm={() => { if (deleting) deleteMutation.mutate(deleting.id); setDeleting(null); }}
      />
    </div>
  );
}

function SubmissionsView({ form }: { form: FormRow }) {
  const submissionsQuery = useFormSubmissions(form.id);
  const rows = submissionsQuery.data ?? [];
  return (
    <>
      <DialogHeader><DialogTitle>Kiriman — {form.name}</DialogTitle></DialogHeader>
      {submissionsQuery.isLoading ? (
        <div className="py-10 text-center"><Loader2 className="mx-auto h-7 w-7 animate-spin text-pink-600" /></div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-500">Belum ada kiriman.</p>
      ) : (
        <ul className="divide-y divide-gray-200/60 text-sm">
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">{s.org_name ?? s.pic_name ?? "—"}</p>
                <p className="text-xs text-gray-500">
                  {formatDateTime(s.created_at, "—")}
                  {s.pic_phone ? ` · ${s.pic_phone}` : ""}
                  {s.utm?.utm_source ? ` · dari ${s.utm.utm_source}` : ""}
                  {s.reason ? ` · ${s.reason}` : ""}
                </p>
              </div>
              <Badge className={`border-0 font-normal ${s.status === "ok" ? "bg-emerald-100 text-emerald-700" : s.status === "duplicate" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>
                {s.status === "ok" ? "lead baru" : s.status === "duplicate" ? "lead lama" : "ditolak"}
              </Badge>
              {s.lead_id ? (
                <Link href={`/dashboard/sales-funnel/leads/${s.lead_id}`} className="text-xs text-pink-700 hover:underline">Buka lead</Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Options as typed keep empty entries (a trailing comma); saving drops them. */
function cleanOptions(field: PublicFieldDef): PublicFieldDef {
  return { ...field, options: field.options.filter((o, idx, all) => o !== "" && all.indexOf(o) === idx) };
}

function FormEditor({ initial, onClose }: { initial: FormRow | null; onClose: () => void }) {
  const ownersQuery = useOwners();
  const createMutation = useCreateForm();
  const updateMutation = useUpdateForm();
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [submitLabel, setSubmitLabel] = useState(initial?.submit_label ?? "Kirim");
  const [successMessage, setSuccessMessage] = useState(initial?.success_message ?? "Terima kasih! Tim kami akan menghubungi Anda.");
  const [fields, setFields] = useState<PublicFieldDef[]>(initial?.fields?.length ? initial.fields : DEFAULT_FORM_FIELDS);
  const [notifyUsers, setNotifyUsers] = useState<string[]>(initial?.notify_user_ids ?? []);
  const [notifyNumbers, setNotifyNumbers] = useState<string[]>(initial?.notify_numbers ?? []);
  const [numberToAdd, setNumberToAdd] = useState("");
  const owners = ownersQuery.data ?? [];
  const pending = createMutation.isPending || updateMutation.isPending;
  const hasContact = fields.some((f) => f.key === "pic_phone" || f.key === "pic_email");
  const canSubmit = name.trim() && title.trim() && (initial || /^[a-z0-9][a-z0-9-]{1,49}$/.test(slug)) && hasContact;

  const save = () => {
    const payload = {
      name: name.trim(), title: title.trim(), description: description.trim() || null,
      fields: fields.map(cleanOptions), submit_label: submitLabel.trim() || "Kirim", success_message: successMessage.trim(),
      redirect_url: null, default_source: toLeadSource(initial?.default_source),
      notify_user_ids: notifyUsers, notify_numbers: notifyNumbers, is_active: initial?.is_active ?? true,
    };
    if (initial) updateMutation.mutate({ id: initial.id, values: payload }, { onSuccess: onClose });
    else createMutation.mutate({ ...payload, slug: slug.trim() } as PublicFormInput, { onSuccess: onClose });
  };

  return (
    <>
      <DialogHeader><DialogTitle>{initial ? `Edit Form — ${initial.name}` : "Form Publik Baru"}</DialogTitle></DialogHeader>
      <div className="grid gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Nama internal</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="cth. Permintaan Penawaran" /></div>
          <div className="space-y-1.5">
            <Label>Slug URL</Label>
            <Input value={initial?.slug ?? slug} disabled={Boolean(initial)} className="font-mono"
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} placeholder="kontak-acara" />
            {initial ? <p className="text-xs text-gray-500">Slug tidak bisa diubah agar tautan yang sudah disebar tetap hidup.</p> : null}
          </div>
        </div>
        <div className="space-y-1.5"><Label>Judul di halaman</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Hubungi NüHabit" /></div>
        <div className="space-y-1.5"><Label>Deskripsi</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Teks tombol</Label><Input value={submitLabel} onChange={(e) => setSubmitLabel(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Pesan setelah terkirim</Label><Input value={successMessage} onChange={(e) => setSuccessMessage(e.target.value)} /></div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <Label>Field</Label>
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
              onClick={() => setFields([...fields, { key: `field_${fields.length + 1}`, label: "Field baru", type: "text", required: false, placeholder: null, help_text: null, options: [], width: 2 }])}>
              + field
            </Button>
          </div>
          {!hasContact ? (
            <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              Form wajib punya field pic_phone atau pic_email agar lead bisa dihubungi.
            </p>
          ) : null}
          <div className="space-y-2">
            {fields.map((f, i) => (
              <div key={i} className="grid grid-cols-[1fr_9rem_6rem_auto] items-center gap-2">
                <Input className="h-8 text-xs" value={f.label} placeholder="Label"
                  onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <Select value={f.type} onValueChange={(v) => setFields(fields.map((x, j) => (j === i ? { ...x, type: v as PublicFieldDef["type"] } : x)))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{PUBLIC_FIELD_TYPES.map((t) => <SelectItem key={t} value={t}>{PUBLIC_FIELD_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                </Select>
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                  <Switch checked={f.required} onCheckedChange={(v) => setFields(fields.map((x, j) => (j === i ? { ...x, required: Boolean(v) } : x)))} />
                  wajib
                </label>
                <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => setFields(fields.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4" />
                </button>
                {f.type === "select" ? (
                  <Input className="col-span-4 h-8 text-xs" value={f.options.join(", ")} placeholder="Pilihan, pisahkan dengan koma"
                    onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, options: e.target.value.split(",").map((o) => o.trim()) } : x)))} />
                ) : f.type === "checkbox" ? (
                  <Input className="col-span-4 h-8 text-xs" value={f.help_text ?? ""} placeholder="Teks di samping centang"
                    onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, help_text: e.target.value || null } : x)))} />
                ) : null}
                <p className="col-span-4 -mt-1 font-mono text-[11px] text-gray-400">
                  {f.key}
                  {LEAD_MAPPED_LABELS[f.key as keyof typeof LEAD_MAPPED_LABELS] ? " · masuk kolom lead" : " · masuk custom field"}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Notifikasi lead baru</Label>
          <div className="flex flex-wrap gap-1.5">
            {notifyUsers.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700">
                {owners.find((o) => o.id === id)?.full_name ?? "Pengguna"}
                <button type="button" onClick={() => setNotifyUsers(notifyUsers.filter((x) => x !== id))}><X className="h-3 w-3" /></button>
              </span>
            ))}
            {notifyNumbers.map((n) => (
              <span key={n} className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700">
                {n}
                <button type="button" onClick={() => setNotifyNumbers(notifyNumbers.filter((x) => x !== n))}><X className="h-3 w-3" /></button>
              </span>
            ))}
            {notifyUsers.length + notifyNumbers.length === 0 ? <span className="text-xs text-gray-500">Belum ada penerima notifikasi.</span> : null}
          </div>
          <div className="flex gap-1.5">
            <Select value="" onValueChange={(v) => { if (v && !notifyUsers.includes(v)) setNotifyUsers([...notifyUsers, v]); }}>
              <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="+ pengguna" /></SelectTrigger>
              <SelectContent>{owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>)}</SelectContent>
            </Select>
            <Input className="h-9 flex-1" value={numberToAdd} onChange={(e) => setNumberToAdd(e.target.value)} placeholder="+ nomor WA" />
            <Button type="button" size="sm" variant="outline" className="h-9"
              onClick={() => { const n = numberToAdd.trim(); if (n.length >= 8 && !notifyNumbers.includes(n)) { setNotifyNumbers([...notifyNumbers, n]); setNumberToAdd(""); } }}>
              Tambah
            </Button>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>Batal</Button>
        <Button onClick={save} disabled={!canSubmit || pending}>{pending ? "Menyimpan…" : "Simpan Form"}</Button>
      </DialogFooter>
    </>
  );
}
