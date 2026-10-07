"use client";

import { use, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GeneralPRForm } from "@/features/purchasing/general-pr/components/general-pr-form";
import { PRDetailToast } from "@/features/purchasing/components/shared/pr-detail-toast";
import { PurchasingFormHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { GENERAL_ROUTES } from "@/lib/purchasing/item-routes";
import { useGeneralPRFormData, useGeneralPurchaseRequest } from "../queries";
import { useUpdateGeneralPurchaseRequest } from "../mutations";
import type { GeneralPRFormInput } from "../types";

type EditGeneralPRPageProps = {
  params: Promise<{ id: string }>;
};

export function EditGeneralPRPage({ params }: EditGeneralPRPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { data: pr, isLoading: prLoading, error: prError } = useGeneralPurchaseRequest(id);
  const { data: formData, isLoading: formLoading } = useGeneralPRFormData();
  const updateMutation = useUpdateGeneralPurchaseRequest();

  useEffect(() => {
    if (!pr) return;
    if (!pr.permissions.canEdit) {
      router.replace(GENERAL_ROUTES.purchasingPrDetail(id));
    }
  }, [pr, id, router]);

  const initialData = useMemo<GeneralPRFormInput | undefined>(() => {
    if (!pr) return undefined;
    return {
      department_id: pr.department_id,
      priority: pr.priority as GeneralPRFormInput["priority"],
      required_date: pr.required_date || "",
      notes: pr.notes || "",
      items: (pr.items || []).map((item) => ({
        supply_item_id: item.supply_item_id || "",
        satuan_id: item.satuan_id || "",
        description: item.description || "",
        qty: item.qty || 1,
        unit: item.unit || "",
        estimated_price: item.estimated_price || 0,
      })),
    };
  }, [pr]);

  async function handleUpdatePR(data: GeneralPRFormInput, action: "draft" | "submit") {
    try {
      await updateMutation.mutateAsync({ id, payload: { ...data, action } });
      toast.success(
        action === "submit" ? "Permintaan barang diajukan" : "Perubahan permintaan barang disimpan"
      );
      router.push(`${GENERAL_ROUTES.purchasingPrDetail(id)}?updated=${action}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan permintaan barang");
    }
  }

  if (prLoading || formLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-500">
        Memuat permintaan barang...
      </div>
    );
  }

  if (prError || !pr || !formData || !initialData) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {prError instanceof Error ? prError.message : "Permintaan barang tidak ditemukan"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PRDetailToast />
      <PurchasingFormHeader
        backHref={GENERAL_ROUTES.purchasingPrDetail(id)}
        title="Ubah Permintaan Barang"
        description="Perubahan hanya bisa dilakukan selama permintaan masih berstatus draft"
      />
      <GeneralPRForm
        departments={formData.departments}
        supplies={formData.supplies}
        units={formData.units}
        initialData={initialData}
        mode="edit"
        onSubmit={handleUpdatePR}
        isLoading={updateMutation.isPending}
        cancelHref={GENERAL_ROUTES.purchasingPrDetail(id)}
      />
    </div>
  );
}
