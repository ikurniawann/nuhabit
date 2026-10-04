"use client";

import { VendorPODetailPage } from "@/features/purchasing/po/components/vendor-po/vendor-po-detail-page";
import { PRODUCT_ROUTES } from "@/lib/purchasing/item-routes";
import {
  useApproveProductPurchaseOrder,
  useCancelProductPurchaseOrder,
  useSendProductPurchaseOrder,
} from "../mutations";
import { useProductPurchaseOrder } from "../queries";

export function ProductPODetailPage() {
  return (
    <VendorPODetailPage
      useDetail={useProductPurchaseOrder}
      useApprove={useApproveProductPurchaseOrder}
      useSend={useSendProductPurchaseOrder}
      useCancel={useCancelProductPurchaseOrder}
      routes={PRODUCT_ROUTES}
      itemLabel="Produk"
      renderItem={(item) => (
        <>
          <div className="font-medium">{item.product?.nama || "-"}</div>
          <div className="text-xs text-gray-500">{item.product?.kode}</div>
        </>
      )}
    />
  );
}
