"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GeneralPRForm } from "@/features/purchasing/general-pr/components/general-pr-form";
import { PurchasingFormHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { GENERAL_ROUTES } from "@/lib/purchasing/item-routes";
import { useGeneralPRFormData } from "../queries";
import { useCreateGeneralPurchaseRequest } from "../mutations";
import type { GeneralPRFormInput } from "../types";

export function NewGeneralPRPage() {
  const router = useRouter();
  const { data: formData, isLoading, error, isError } = useGeneralPRFormData();
  const createMutation = useCreateGeneralPurchaseRequest();

  useEffect(() => {
    if (isError && error instanceof Error && error.message.includes("403")) {
      router.replace(GENERAL_ROUTES.purchasingPr);
    }
  }, [isError, error, router]);

  async function handleCreatePR(data: GeneralPRFormInput, action: "draft" | "submit") {
    try {
      await createMutation.mutateAsync({ ...data, action });
      toast.success(
        action === "draft" ? "Draft permintaan barang disimpan" : "Permintaan barang diajukan"
      );
      router.push(GENERAL_ROUTES.purchasingPr);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan permintaan barang");
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-500">
        Memuat form permintaan barang...
      </div>
    );
  }

  if (isError || !formData) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error instanceof Error ? error.message : "Gagal memuat data form permintaan barang"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={GENERAL_ROUTES.purchasingPr}
        title="Buat Permintaan Barang"
        description="Masukkan kebutuhan barang operasional sebelum membuat purchase order"
      />
      <GeneralPRForm
        departments={formData.departments}
        supplies={formData.supplies}
        units={formData.units}
        onSubmit={handleCreatePR}
        isLoading={createMutation.isPending}
        cancelHref={GENERAL_ROUTES.purchasingPr}
      />
    </div>
  );
}
