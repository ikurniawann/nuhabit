"use client";

import { VendorPOListPage } from "@/features/purchasing/po/components/vendor-po/vendor-po-list-page";
import { GENERAL_ROUTES } from "@/lib/purchasing/item-routes";
import { useGeneralPurchaseOrderList } from "../queries";

export function GeneralPOListPage() {
  return (
    <VendorPOListPage
      useList={useGeneralPurchaseOrderList}
      routes={GENERAL_ROUTES}
      description="Kelola purchase order barang operasional"
      sectionDescription="Lacak purchase order barang operasional berdasarkan nomor, vendor, status, dan nilai total."
    />
  );
}
