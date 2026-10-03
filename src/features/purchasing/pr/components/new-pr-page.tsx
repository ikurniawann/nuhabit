"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { PRForm } from "@/components/purchasing/pr-form";
import { PurchasingFormHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { usePRFormData } from "../queries";
import { useCreatePurchaseRequest } from "../mutations";
import type { PRFormData, PRFormInput } from "../types";
import { defaultPurchasePackFor, wholePacksFor } from "@/lib/purchasing/packs";

/**
 * Prefill dari laporan stok rendah (?material_id=&qty=, qty dalam satuan
 * dasar): satu baris dengan pack beli bawaan, dibulatkan ke pack utuh.
 */
function reorderInitialData(
  formData: PRFormData | undefined,
  materialId: string | null,
  baseQty: number
): PRFormInput | undefined {
  const material = formData?.materials.find((m) => m.id === materialId);
  if (!formData || !material || !(baseQty > 0)) return undefined;
  const pack = defaultPurchasePackFor(material);
  const unitName =
    formData.units.find((unit) => unit.id === pack?.satuan_id)?.nama || material.satuan_besar_nama || "";
  return {
    department_id: "",
    priority: "high",
    notes: `Saran pemesanan ulang dari laporan stok rendah (${baseQty} satuan dasar)`,
    items: [
      {
        raw_material_id: material.id,
        satuan_id: pack?.satuan_id ?? material.satuan_besar_id ?? "",
        description: material.nama,
        qty: Math.max(1, wholePacksFor(baseQty, pack?.qty_in_base_unit ?? 1)),
        unit: unitName,
        estimated_price: 0,
      },
    ],
  };
}

export function NewPRPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: formData, isLoading, error, isError } = usePRFormData();
  const initialData = useMemo(
    () => reorderInitialData(formData, searchParams.get("material_id"), Number(searchParams.get("qty")) || 0),
    [formData, searchParams]
  );
  const createMutation = useCreatePurchaseRequest();

  useEffect(() => {
    if (isError && error instanceof Error && error.message.includes("403")) {
      router.replace("/dashboard/purchasing");
    }
  }, [isError, error, router]);

  async function handleCreatePR(data: PRFormInput, action: "draft" | "submit") {
    try {
      await createMutation.mutateAsync({ ...data, action });
      toast.success(
        action === "draft"
          ? "Draf purchase request berhasil disimpan"
          : "Purchase request berhasil diajukan"
      );
      router.push("/dashboard/purchasing/pr");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan purchase request");
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-500">
        Memuat formulir purchase request...
      </div>
    );
  }

  if (isError || !formData) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error instanceof Error ? error.message : "Gagal memuat data formulir purchase request"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref="/dashboard/purchasing/pr"
        title="Tambah Purchase Request"
        description="Masukkan kebutuhan pembelian sebelum membuat purchase order"
      />

      <PRForm
        departments={formData.departments}
        materials={formData.materials}
        units={formData.units}
        initialData={initialData}
        onSubmit={handleCreatePR}
        isLoading={createMutation.isPending}
        cancelHref="/dashboard/purchasing/pr"
        hideItemPricing
      />
    </div>
  );
}
