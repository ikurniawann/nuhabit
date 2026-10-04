"use client";

import { useParams, usePathname } from "next/navigation";
import { NAV_FROM_APPROVAL_PO } from "@/lib/iam/nav-context";
import { useNavFrom } from "@/lib/iam/use-nav-from";
import { RM_ROUTES } from "@/lib/purchasing/item-routes";
import { poDetailFigures } from "@/lib/purchasing/po-ui-detail";
import { usePurchaseOrder } from "../queries";
import { BackLink, PODetailHeader } from "./detail/po-detail-header";
import { PODetailOverview } from "./detail/po-detail-overview";
import { POItemsCard } from "./detail/po-items-card";
import { POPaymentCard } from "./detail/po-payment-card";

/** Kembali ke Account Payable, antrean persetujuan, atau daftar PO sesuai asal navigasi. */
function useBackTarget() {
  const pathname = usePathname();
  const navFrom = useNavFrom();
  const fromInvoice = pathname.includes("/invoice/po/") || pathname.includes("/accounts-payable/po/");
  if (fromInvoice) return { fromInvoice, href: RM_ROUTES.purchasingInvoice, label: "Kembali ke Account Payable" };
  if (navFrom === NAV_FROM_APPROVAL_PO) return { fromInvoice, href: RM_ROUTES.approvalPo, label: "Kembali ke Persetujuan" };
  return { fromInvoice, href: RM_ROUTES.purchasingPo, label: "Kembali" };
}

export function PODetailPage() {
  const params = useParams();
  const poId = params.id as string;
  const back = useBackTarget();
  const detailQuery = usePurchaseOrder(poId);
  const po = detailQuery.data;

  if (detailQuery.isLoading) {
    return (
      <div className="container mx-auto py-6">
        <div className="py-12 text-center">Memuat purchase order...</div>
      </div>
    );
  }

  if (!po) {
    return (
      <div className="space-y-4">
        <BackLink href={back.href} label={back.label} />
        <div className="py-12 text-center text-red-500">
          {detailQuery.isError ? "Gagal memuat purchase order" : "Purchase order tidak ditemukan"}
        </div>
      </div>
    );
  }

  const status = po.status.toLowerCase();
  const figures = poDetailFigures(po);

  return (
    <div className="space-y-6">
      <PODetailHeader po={po} backHref={back.href} backLabel={back.label} />
      <PODetailOverview po={po} figures={figures} />
      {/* Pembayaran hanya dikelola dari konteks Account Payable. */}
      {back.fromInvoice && <POPaymentCard po={po} figures={figures} />}
      <POItemsCard items={po.items ?? []} showReceived={status !== "draft" && status !== "cancelled"} />
    </div>
  );
}
