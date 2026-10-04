"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Combobox } from "@/components/ui/combobox";
import { FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormFieldLabel, formComboboxClassName, formInputClassName } from "@/components/layout/form-field";
import { useActivityLogger } from "@/hooks/useActivityLogger";
import type { Unit, UnitFormData } from "@/types/purchasing";
import { useCreateUnit, useUpdateUnit } from "../mutations";

const UNIT_TYPE_OPTIONS = [
  { value: "BESAR", label: "Satuan Besar" },
  { value: "KECIL", label: "Satuan Kecil" },
  { value: "KONVERSI", label: "Satuan Konversi" },
];

function normalizeUnitFormData(formData: UnitFormData): UnitFormData {
  return {
    kode: formData.kode.trim().toUpperCase(),
    nama: formData.nama.trim(),
    tipe: formData.tipe,
    deskripsi: formData.deskripsi?.trim() || undefined,
  };
}

function formFromUnit(unit: Unit | null): UnitFormData {
  return unit
    ? { kode: unit.kode, nama: unit.nama, tipe: unit.tipe, deskripsi: unit.deskripsi || "" }
    : { kode: "", nama: "", tipe: "BESAR", deskripsi: "" };
}

interface UnitFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = tambah satuan baru. */
  editingUnit: Unit | null;
}

/** Dialog tambah/ubah satuan; state form diisi ulang lewat `key` dari induk. */
export function UnitFormDialog({ open, onOpenChange, editingUnit }: UnitFormDialogProps) {
  const logger = useActivityLogger();
  const [formData, setFormData] = useState<UnitFormData>(() => formFromUnit(editingUnit));
  const createMutation = useCreateUnit();
  const updateMutation = useUpdateUnit();
  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const payload = normalizeUnitFormData(formData);
    if (!payload.kode) {
      toast.error("Kode satuan wajib diisi");
      return;
    }
    if (!payload.nama) {
      toast.error("Nama satuan wajib diisi");
      return;
    }
    if (!payload.tipe) {
      toast.error("Tipe satuan wajib diisi");
      return;
    }

    try {
      if (editingUnit) {
        await updateMutation.mutateAsync({ id: editingUnit.id, payload });
        logger.updateRawMaterial("Unit Updated", payload.kode || "N/A", `Updated ${payload.nama}`);
        toast.success("Satuan berhasil diperbarui");
      } else {
        await createMutation.mutateAsync(payload);
        logger.createRawMaterial("Unit Created", payload.kode || "N/A", {
          nama: payload.nama,
          tipe: payload.tipe,
        });
        toast.success("Satuan berhasil ditambahkan");
      }
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan satuan");
    }
  };

  return (
  <FormModal
    open={open}
    onOpenChange={onOpenChange}
    title={editingUnit ? "Ubah Satuan" : "Tambah Satuan"}
    description={
      editingUnit
        ? "Perbarui data satuan yang dipilih"
        : "Tambah satuan pengukuran baru untuk bahan baku"
    }
    onSubmit={handleSubmit}
    loading={isSubmitting}
    submitLabel={editingUnit ? "Simpan Perubahan" : "Simpan"}
    cancelLabel="Batal"
    loadingLabel="Menyimpan..."
  >
    <div>
      <FormFieldLabel htmlFor="kode" required>
        Kode Satuan
      </FormFieldLabel>
      <Input
        id="kode"
        value={formData.kode}
        onChange={(e) => setFormData({ ...formData, kode: e.target.value })}
        placeholder="Contoh: KG"
        maxLength={10}
        required
        className={formInputClassName}
      />
    </div>
    <div>
      <FormFieldLabel htmlFor="nama" required>
        Nama Satuan
      </FormFieldLabel>
      <Input
        id="nama"
        value={formData.nama}
        onChange={(e) => setFormData({ ...formData, nama: e.target.value })}
        placeholder="Contoh: Kilogram"
        maxLength={50}
        required
        className={formInputClassName}
      />
    </div>
    <div>
      <FormFieldLabel htmlFor="tipe" required>
        Tipe Satuan
      </FormFieldLabel>
      <Combobox
        options={UNIT_TYPE_OPTIONS}
        value={formData.tipe}
        onChange={(value) =>
          setFormData({ ...formData, tipe: value as "BESAR" | "KECIL" | "KONVERSI" })
        }
        placeholder="Pilih tipe satuan..."
        searchPlaceholder="Cari tipe satuan..."
        emptyMessage="Tipe satuan tidak ditemukan"
        className={formComboboxClassName}
      />
    </div>
    <div>
      <FormFieldLabel htmlFor="deskripsi">Deskripsi</FormFieldLabel>
      <Textarea
        id="deskripsi"
        value={formData.deskripsi}
        onChange={(e) => setFormData({ ...formData, deskripsi: e.target.value })}
        placeholder="Deskripsi opsional"
        rows={3}
        className="min-h-24 resize-none bg-white text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
      />
    </div>
  </FormModal>
  );
}
