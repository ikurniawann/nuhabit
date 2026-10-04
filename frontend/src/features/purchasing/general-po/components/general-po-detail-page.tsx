"use client";

import { Badge } from "@/components/ui/badge";
import { VendorPODetailPage } from "@/features/purchasing/po/components/vendor-po/vendor-po-detail-page";
import { GENERAL_ROUTES } from "@/lib/purchasing/item-routes";
import {
  useApproveGeneralPurchaseOrder,
  useCancelGeneralPurchaseOrder,
  useSendGeneralPurchaseOrder,
} from "../mutations";
import { useGeneralPurchaseOrder } from "../queries";

export function GeneralPODetailPage() {
  return (
    <VendorPODetailPage
      useDetail={useGeneralPurchaseOrder}
      useApprove={useApproveGeneralPurchaseOrder}
      useSend={useSendGeneralPurchaseOrder}
      useCancel={useCancelGeneralPurchaseOrder}
      routes={GENERAL_ROUTES}
      itemLabel="Barang"
      renderItem={(item) => (
        <>
          <div className="flex items-center gap-2">
            <span className="font-medium">{item.supply_item?.nama || item.catatan || "-"}</span>
            {item.supply_item?.stockable !== undefined && (
              <Badge
                className={
                  item.supply_item.stockable ? "border-0 bg-blue-100 text-blue-700" : "border-0 bg-gray-100 text-gray-600"
                }
              >
                {item.supply_item.stockable ? "Stok" : "Expense"}
              </Badge>
            )}
          </div>
          <div className="text-xs text-gray-500">{item.supply_item?.kode}</div>
        </>
      )}
    />
  );
}
