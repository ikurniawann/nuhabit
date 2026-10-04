import { Suspense } from "react";
import { redirect } from "next/navigation";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";
import { ManualAdjustmentPage } from "@/features/inventory/adjustment/components/manual-adjustment-page";

type PageProps = {
  searchParams: Promise<{ reason?: string }>;
};

export default async function Page({ searchParams }: PageProps) {
  const { reason } = await searchParams;
  if (reason === "stock_opname") {
    redirect(RM_ROUTES.inventoryOpname);
  }

  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-gray-400">Memuat...</div>}>
      <ManualAdjustmentPage />
    </Suspense>
  );
}
