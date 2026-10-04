"use client";

import { VendorPOListPage } from "@/features/purchasing/po/components/vendor-po/vendor-po-list-page";
import { PRODUCT_ROUTES } from "@/lib/purchasing/item-routes";
import { useProductPurchaseOrderList } from "../queries";

export function ProductPOListPage() {
  return (
    <VendorPOListPage
      useList={useProductPurchaseOrderList}
      routes={PRODUCT_ROUTES}
      description="Kelola purchase order produk"
      sectionDescription="Lacak purchase order produk berdasarkan nomor, vendor, status, dan nilai total."
    />
  );
}
