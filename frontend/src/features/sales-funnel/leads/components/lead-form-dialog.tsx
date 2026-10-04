"use client";

import { useEffect, useState } from "react";
import { UserCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateLead, usePicLookup, useUpdateLead } from "../queries";
import { CustomFieldsSection } from "@/features/crm/custom-fields";

import {
  EMPTY_LEAD_FORM,
  ORG_TYPE_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  TEMPERATURE_LABELS,
  normalizePhoneClient,
  type LeadFormValues,
  type SalesLead,
} from "../types";

interface LeadFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = mode tambah; terisi = mode edit */
  lead: SalesLead | null;
}

function leadToForm(lead: SalesLead): LeadFormValues {
  return {
    org_name: lead.org_name,
    org_type: lead.org_type,
    pic_name: lead.pic_name,
    pic_title: lead.pic_title ?? "",
    pic_phone: lead.pic_phone,
    pic_email: lead.pic_email ?? "",
    city: lead.city ?? "",
    source: lead.source,
    temperature: lead.temperature,
    status: lead.status,
    notes: lead.notes ?? "",
    custom: lead.custom ?? {},
  };
}

export function LeadFormDialog({ open, onOpenChange, lead }: LeadFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <LeadFormBody key={lead?.id ?? "new"} lead={lead} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Isi form; di-mount ulang per lead (key) sehingga state awal dari props. */
function LeadFormBody({ lead, onClose }: { lead: SalesLead | null; onClose: () => void }) {
  const [form, setForm] = useState<LeadFormValues>(() => (lead ? leadToForm(lead) : EMPTY_LEAD_FORM));
  const [phoneQuery, setPhoneQuery] = useState("");
  const isEdit = lead !== null;

  // Debounce lookup PIC by nomor — satu PIC bisa membawa banyak leads
  useEffect(() => {
    const timeout = window.setTimeout(() => setPhoneQuery(form.pic_phone.trim()), 400);
    return () => window.clearTimeout(timeout);
  }, [form.pic_phone]);

  // Banding pada bentuk kanonik 62… — nomor tersimpan sudah dinormalisasi,
  // input user bisa 0812/812/+62 untuk nomor yang sama
  const lookupEnabled =
    !isEdit || normalizePhoneClient(phoneQuery) !== normalizePhoneClient(lead.pic_phone);
  const picLookup = usePicLookup(phoneQuery, lookupEnabled);
  const existingPic = picLookup.data ?? null;

  const createMutation = useCreateLead(onClose);
  const updateMutation = useUpdateLead(onClose);
  const isPending = createMutation.isPending || updateMutation.isPending;

  const set = <K extends keyof LeadFormValues>(key: K, value: LeadFormValues[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const canSubmit =
    form.org_name.trim() && form.pic_name.trim() && form.pic_phone.trim().length >= 8;

  const handleSubmit = () => {
    if (!canSubmit || isPending) return;
    if (lead) {
      updateMutation.mutate({ id: lead.id, values: form });
    } else {
      createMutation.mutate(form);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit Lead" : "Tambah Lead"}</DialogTitle>
      </DialogHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="org_name">Nama Instansi *</Label>
          <Input
            id="org_name"
            value={form.org_name}
            onChange={(e) => set("org_name", e.target.value)}
            placeholder="PT / Sekolah / Komunitas / Nama pribadi"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Jenis Instansi</Label>
          <Select
            value={form.org_type}
            onValueChange={(v) => set("org_type", v as LeadFormValues["org_type"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ORG_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="city">Kota</Label>
          <Input
            id="city"
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            placeholder="Bandung"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pic_name">Nama PIC *</Label>
          <Input
            id="pic_name"
            value={form.pic_name}
            onChange={(e) => set("pic_name", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pic_title">Jabatan PIC</Label>
          <Input
            id="pic_title"
            value={form.pic_title}
            onChange={(e) => set("pic_title", e.target.value)}
            placeholder="HR Manager / Kepala Sekolah"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pic_phone">No. WA PIC *</Label>
          <Input
            id="pic_phone"
            value={form.pic_phone}
            onChange={(e) => set("pic_phone", e.target.value)}
            placeholder="0812xxxxxxx"
          />
        </div>

        {existingPic ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm sm:col-span-2">
            <p className="font-medium text-emerald-900">
              <UserCheck className="mr-1 inline h-4 w-4 align-text-bottom" />
              PIC sudah terdaftar: {existingPic.pic.name}
              {existingPic.pic.title ? ` (${existingPic.pic.title})` : ""}
            </p>
            <p className="mt-0.5 text-xs text-emerald-700">
              Membawa {existingPic.leads.length} lead:{" "}
              {existingPic.leads.map((l) => l.org_name).join(", ")}
            </p>
            <button
              type="button"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  pic_name: existingPic.pic.name,
                  pic_title: existingPic.pic.title ?? "",
                  pic_email: existingPic.pic.email ?? "",
                }))
              }
              className="mt-1.5 text-xs font-semibold text-emerald-700 underline hover:text-emerald-900"
            >
              Gunakan Data PIC Ini
            </button>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="pic_email">Email PIC</Label>
          <Input
            id="pic_email"
            type="email"
            value={form.pic_email}
            onChange={(e) => set("pic_email", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Sumber</Label>
          <Select
            value={form.source}
            onValueChange={(v) => set("source", v as LeadFormValues["source"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Suhu</Label>
          <Select
            value={form.temperature}
            onValueChange={(v) => set("temperature", v as LeadFormValues["temperature"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TEMPERATURE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isEdit && (
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select
              value={form.status}
              onValueChange={(v) => set("status", v as LeadFormValues["status"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <CustomFieldsSection object="lead" values={form.custom ?? {}} onChange={(next) => set("custom", next)} />
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="notes">Catatan</Label>
          <Textarea
            id="notes"
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Kebutuhan acara, estimasi pax, dsb."
            rows={3}
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isPending}>
          Batal
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit || isPending}>
          {isPending ? "Menyimpan…" : isEdit ? "Simpan Perubahan" : "Tambah Lead"}
        </Button>
      </DialogFooter>
    </>
  );
}
