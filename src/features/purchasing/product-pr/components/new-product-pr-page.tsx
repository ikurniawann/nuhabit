"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ProductPRForm } from "@/features/purchasing/product-pr/components/product-pr-form";
import { PurchasingFormHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PRODUCT_ROUTES } from "@/lib/purchasing/item-routes";
import { useProductPRFormData } from "../queries";
import { useCreateProductPurchaseRequest } from "../mutations";
import type { ProductPRFormInput } from "../types";

export function NewProductPRPage() {
  const router = useRouter();
  const { data: formData, isLoading, error, isError } = useProductPRFormData();
  const createMutation = useCreateProductPurchaseRequest();

  useEffect(() => {
    if (isError && error instanceof Error && error.message.includes("403")) {
      router.replace(PRODUCT_ROUTES.purchasingPr);
    }
  }, [isError, error, router]);

  async function handleCreatePR(data: ProductPRFormInput, action: "draft" | "submit") {
    try {
      await createMutation.mutateAsync({ ...data, action });
      toast.success(
        action === "draft" ? "Draft purchase request saved" : "Purchase request submitted"
      );
      router.push(PRODUCT_ROUTES.purchasingPr);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save purchase request");
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-500">
        Loading purchase request form...
      </div>
    );
  }

  if (isError || !formData) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error instanceof Error ? error.message : "Failed to load purchase request form data"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={PRODUCT_ROUTES.purchasingPr}
        title="Create Purchase Request"
        description="Enter product purchasing needs before creating a purchase order"
      />
      <ProductPRForm
        departments={formData.departments}
        products={formData.products}
        units={formData.units}
        onSubmit={handleCreatePR}
        isLoading={createMutation.isPending}
        cancelHref={PRODUCT_ROUTES.purchasingPr}
      />
    </div>
  );
}
