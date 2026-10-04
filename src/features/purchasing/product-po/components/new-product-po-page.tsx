"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { PurchasingFormHeader } from "@/features/purchasing/components/shared/purchasing-page-header";
import { PRODUCT_ROUTES } from "@/lib/purchasing/item-routes";
import { useCreateProductPurchaseOrder } from "../mutations";
import { useApprovedProductPRsForPO, useProductPOFormData } from "../queries";
import { ProductPOForm } from "./product-po-form";

export function NewProductPOPage() {
  const router = useRouter();
  const initialPRId = useSearchParams().get("pr_id") || undefined;
  const formQuery = useProductPOFormData();
  const prsQuery = useApprovedProductPRsForPO();
  const createMutation = useCreateProductPurchaseOrder();

  // Tunggu daftar PR bila ?pr_id= ada, supaya item PR terisi saat form pertama kali dibuat.
  if (formQuery.isLoading || (initialPRId && prsQuery.isLoading)) {
    return <div className="py-20 text-center text-sm text-gray-500">Memuat form purchase order...</div>;
  }

  if (formQuery.isError || !formQuery.data) {
    return <div className="py-12 text-center text-sm text-red-600">Gagal memuat data form purchase order.</div>;
  }

  return (
    <div className="space-y-6">
      <PurchasingFormHeader
        backHref={PRODUCT_ROUTES.purchasingPo}
        title="Buat Purchase Order"
        description="Buat purchase order produk ke vendor"
      />
      <ProductPOForm
        lookups={formQuery.data}
        approvedPRs={prsQuery.data ?? []}
        initialPRId={initialPRId}
        isLoading={createMutation.isPending}
        cancelHref={PRODUCT_ROUTES.purchasingPo}
        onSubmit={async (payload) => {
          try {
            const result = await createMutation.mutateAsync(payload);
            toast.success("Purchase order berhasil dibuat.");
            router.push(PRODUCT_ROUTES.purchasingPoDetail(result.data.id));
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Gagal membuat purchase order.");
          }
        }}
      />
    </div>
  );
}
