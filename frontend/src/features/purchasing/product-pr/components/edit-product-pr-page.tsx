"use client";

import { use, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ProductPRForm } from "@/features/purchasing/product-pr/components/product-pr-form";
import { PRDetailToast } from "@/features/purchasing/components/shared/pr-detail-toast";
import { PurchasingFormHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PRODUCT_ROUTES } from "@/lib/purchasing/item-routes";
import { useProductPRFormData, useProductPurchaseRequest } from "../queries";
import { useUpdateProductPurchaseRequest } from "../mutations";
import type { ProductPRFormInput } from "../types";

type EditProductPRPageProps = {
  params: Promise<{ id: string }>;
};

export function EditProductPRPage({ params }: EditProductPRPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { data: pr, isLoading: prLoading, error: prError } = useProductPurchaseRequest(id);
  const { data: formData, isLoading: formLoading } = useProductPRFormData();
  const updateMutation = useUpdateProductPurchaseRequest();

  useEffect(() => {
    if (!pr) return;
    if (!pr.permissions.canEdit) {
      router.replace(PRODUCT_ROUTES.purchasingPrDetail(id));
    }
  }, [pr, id, router]);

  const initialData = useMemo<ProductPRFormInput | undefined>(() => {
    if (!pr) return undefined;
    return {
      department_id: pr.department_id,
      priority: pr.priority as ProductPRFormInput["priority"],
      required_date: pr.required_date || "",
      notes: pr.notes || "",
      items: (pr.items || []).map((item) => ({
        product_id: item.product_id || "",
        satuan_id: item.satuan_id || "",
        description: item.description || "",
        qty: item.qty || 1,
        unit: item.unit || "",
        estimated_price: item.estimated_price || 0,
      })),
    };
  }, [pr]);

  async function handleUpdatePR(data: ProductPRFormInput, action: "draft" | "submit") {
    try {
      await updateMutation.mutateAsync({ id, payload: { ...data, action } });
      toast.success(
        action === "submit" ? "Purchase request submitted" : "Purchase request changes saved"
      );
      router.push(`${PRODUCT_ROUTES.purchasingPrDetail(id)}?updated=${action}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save purchase request");
    }
  }

  if (prLoading || formLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-500">
        Loading purchase request...
      </div>
    );
  }

  if (prError || !pr || !formData || !initialData) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {prError instanceof Error ? prError.message : "Purchase request not found"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PRDetailToast />
      <PurchasingFormHeader
        backHref={PRODUCT_ROUTES.purchasingPrDetail(id)}
        title="Edit Purchase Request"
        description="Changes are only allowed while the purchase request is still a draft"
      />
      <ProductPRForm
        departments={formData.departments}
        products={formData.products}
        units={formData.units}
        initialData={initialData}
        mode="edit"
        onSubmit={handleUpdatePR}
        isLoading={updateMutation.isPending}
        cancelHref={PRODUCT_ROUTES.purchasingPrDetail(id)}
      />
    </div>
  );
}
