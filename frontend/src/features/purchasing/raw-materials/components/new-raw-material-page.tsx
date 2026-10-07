"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PurchasingFormHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { ITEMS_RAW_MATERIALS_PATH } from "@/lib/purchasing/item-routes";
import {
  EMPTY_RAW_MATERIAL_FORM,
  buildRawMaterialPayload,
  type RawMaterialFormState,
} from "@/lib/purchasing/raw-material-ui-form";
import { useCreateRawMaterial } from "../mutations";
import { RawMaterialForm } from "./raw-material-form";

export function NewRawMaterialPage() {
  const router = useRouter();
  const createMutation = useCreateRawMaterial();

  const handleSubmit = async (form: RawMaterialFormState) => {
    if (!form.nama || !form.satuan_besar_id || !form.kategori) {
      toast.error("Nama bahan, kategori, dan satuan besar wajib diisi");
      return;
    }
    try {
      await createMutation.mutateAsync(buildRawMaterialPayload(form));
      toast.success("Bahan baku berhasil ditambahkan");
      router.push(ITEMS_RAW_MATERIALS_PATH);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menambahkan bahan baku");
    }
  };

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={ITEMS_RAW_MATERIALS_PATH}
        title="Tambah Bahan Baku"
        description="Isi detail untuk data bahan baku baru"
      />
      <RawMaterialForm
        mode="create"
        formId="new-raw-material-form"
        initial={EMPTY_RAW_MATERIAL_FORM}
        submitLabel="Simpan Bahan Baku"
        submitting={createMutation.isPending}
        onSubmit={handleSubmit}
        onCancel={() => router.back()}
      />
    </div>
  );
}
