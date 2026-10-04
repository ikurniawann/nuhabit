"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { poLinesFromGrnItems } from "@/lib/purchasing/grn-ui-lines";
import { PRODUCT_ROUTES, RM_ROUTES } from "@/lib/purchasing/item-routes";
import type { PurchasingModuleType } from "../api";
import { useGrn, useGrnPoLines } from "../queries";
import type { GrnDetail } from "../types";
import { ContinueGrnForm } from "./continue-grn-form";

function Loading() {
  return (
    <div className="flex min-h-56 items-center justify-center text-sm text-gray-500">
      <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
      Memuat data GRN...
    </div>
  );
}

export function ContinueGrnPage({ moduleType = "raw_material" }: { moduleType?: PurchasingModuleType }) {
  const isProduct = moduleType === "product";
  const listRoute = isProduct ? PRODUCT_ROUTES.purchasingReceive : RM_ROUTES.purchasingGrn;
  const router = useRouter();
  const grnId = useParams().id as string;

  const grnQuery = useGrn<GrnDetail>(grnId);
  const grn = grnQuery.data;
  const poId = grn?.purchase_order_id || grn?.po_id || "";
  // Satu pengiriman = satu GRN. Sisa PO tidak dilanjutkan di GRN yang sudah selesai.
  const finished = Boolean(grn?.status && grn.status !== "pending");
  const items = grn?.items ?? [];
  const poLinesQuery = useGrnPoLines(!finished && items.length > 0 ? poId : null, moduleType);

  useEffect(() => {
    if (!finished) return;
    toast.error("GRN ini sudah selesai diterima. Untuk sisa qty, buat Kirim Ulang lalu GRN baru.", {
      id: "grn-continue-finished",
    });
    if (!poId) router.replace(listRoute);
    else router.replace(isProduct ? `${PRODUCT_ROUTES.purchasingDeliveryInsert}?po_id=${poId}` : `${RM_ROUTES.purchasingDelivery}/insert?po_id=${poId}`);
  }, [finished, poId, isProduct, listRoute, router]);

  useEffect(() => {
    if (grnQuery.isError) {
      toast.error(grnQuery.error instanceof Error ? grnQuery.error.message : "Gagal memuat data GRN.");
    }
  }, [grnQuery.isError, grnQuery.error]);

  if (grnQuery.isLoading || finished || poLinesQuery.isLoading) return <Loading />;
  if (!grn) {
    return <div className="py-12 text-center text-sm text-red-600">GRN tidak ditemukan.</div>;
  }

  const fetchedPoLines = poLinesQuery.data ?? [];
  const poLines = fetchedPoLines.length > 0 ? fetchedPoLines : poLinesFromGrnItems(items);

  return (
    <ContinueGrnForm
      key={grn.id}
      grn={{ ...grn, po_id: poId }}
      poLines={poLines}
      listRoute={listRoute}
      supplierLabel={isProduct ? "Vendor" : "Supplier"}
    />
  );
}
