"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PurchasingFormHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { ITEMS_RAW_MATERIALS_PATH } from "@/lib/purchasing/item-routes";
import {
  buildRawMaterialPayload,
  initialPurchasePackId,
  rawMaterialFormFromMaterial,
  type RawMaterialFormState,
} from "@/lib/purchasing/raw-material-ui-form";
import type { RawMaterialWithStock } from "@/types/purchasing";
import { useUpdateRawMaterial } from "../mutations";
import { useRawMaterial } from "../queries";
import { RawMaterialForm } from "./raw-material-form";

export function EditRawMaterialPage() {
  const params = useParams();
  const materialId = params.id as string;
  const materialQuery = useRawMaterial(materialId);

  if (materialQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-pink-600" />
        Memuat bahan baku...
      </div>
    );
  }

  if (!materialQuery.data) {
    return <div className="py-16 text-center text-sm text-red-600">Gagal memuat bahan baku</div>;
  }

  // key: form diinisialisasi ulang bila bahan baku lain dibuka.
  return <EditRawMaterialForm key={materialQuery.data.id} material={materialQuery.data} />;
}

function EditRawMaterialForm({ material }: { material: RawMaterialWithStock }) {
  const router = useRouter();
  const updateMutation = useUpdateRawMaterial();
  const [purchasePackId, setPurchasePackId] = useState(() => initialPurchasePackId(material));
  const detailHref = `${ITEMS_RAW_MATERIALS_PATH}/${material.id}`;

  const handleSubmit = async (form: RawMaterialFormState) => {
    if (!form.nama || !form.kategori) {
      toast.error("Nama bahan dan kategori wajib diisi");
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: material.id,
        payload: buildRawMaterialPayload(form, purchasePackId),
      });
      toast.success("Bahan baku berhasil diperbarui");
      router.push(detailHref);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui bahan baku");
    }
  };

  return (
    <div className="space-y-6">
      <PurchasingFormHeader backHref={detailHref} title="Ubah Bahan Baku" description="Perbarui detail bahan baku" />
      <RawMaterialForm
        mode="edit"
        formId="edit-raw-material-form"
        initial={rawMaterialFormFromMaterial(material)}
        submitLabel="Simpan Perubahan"
        submitting={updateMutation.isPending}
        onSubmit={handleSubmit}
        onCancel={() => router.back()}
        purchasePackId={purchasePackId}
        onPurchasePackChange={setPurchasePackId}
      />
    </div>
  );
}
