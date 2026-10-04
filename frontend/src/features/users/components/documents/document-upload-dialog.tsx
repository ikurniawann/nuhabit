"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateEmployeeDocument } from "../../mutations";

export const DOC_TYPE_LABELS: Record<string, string> = {
  ktp: "National ID (KTP)",
  npwp: "Tax ID (NPWP)",
  ijazah: "Diploma",
  cv: "CV / Resume",
  kontrak: "Employment Contract",
  bpjs_tk: "BPJS Employment",
  bpjs_kes: "BPJS Health",
  sertifikat: "Certificate",
  other: "Other",
};

const DOC_TYPE_OPTIONS = Object.entries(DOC_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const EMPTY_DOC_FORM = {
  document_type: "ktp",
  document_name: "",
  file_url: "",
  issue_date: "",
  expiry_date: "",
  notes: "",
};

type DocForm = typeof EMPTY_DOC_FORM;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}

/** Dialog upload dokumen kepegawaian manual (URL file yang sudah ada di storage). */
export function DocumentUploadDialog({
  employeeId,
  onClose,
}: {
  employeeId: string;
  onClose: () => void;
}) {
  const createDocument = useCreateEmployeeDocument(employeeId);
  const [form, setForm] = useState<DocForm>(EMPTY_DOC_FORM);
  const setField = (patch: Partial<DocForm>) => setForm((f) => ({ ...f, ...patch }));

  async function handleSave() {
    if (!form.document_name || !form.file_url) {
      toast.error("Nama dokumen dan URL file wajib diisi");
      return;
    }
    try {
      await createDocument.mutateAsync(form);
      toast.success("Dokumen berhasil disimpan");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan dokumen");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Dokumen</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Field label="Jenis Dokumen *">
            <Combobox
              options={DOC_TYPE_OPTIONS}
              value={form.document_type}
              onChange={(value) => setField({ document_type: value })}
              placeholder="Pilih jenis dokumen"
              searchPlaceholder="Cari jenis..."
              emptyMessage="Jenis tidak ditemukan"
              className="!w-full h-9 text-sm"
            />
          </Field>
          <Field label="Nama Dokumen *">
            <Input
              value={form.document_name}
              onChange={(e) => setField({ document_name: e.target.value })}
              placeholder="cth. KTP - Budi Santoso"
            />
          </Field>
          <Field label="URL File *">
            <Input
              value={form.file_url}
              onChange={(e) => setField({ file_url: e.target.value })}
              placeholder="https://... atau path file"
            />
            <p className="text-xs text-gray-400 mt-1">
              Upload file ke storage, lalu tempel URL-nya di sini
            </p>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tanggal Terbit">
              <Input
                type="date"
                value={form.issue_date}
                onChange={(e) => setField({ issue_date: e.target.value })}
              />
            </Field>
            <Field label="Tanggal Kedaluwarsa">
              <Input
                type="date"
                value={form.expiry_date}
                onChange={(e) => setField({ expiry_date: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Catatan">
            <Input
              value={form.notes}
              onChange={(e) => setField({ notes: e.target.value })}
              placeholder="Opsional"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={handleSave} disabled={createDocument.isPending}>
            {createDocument.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
