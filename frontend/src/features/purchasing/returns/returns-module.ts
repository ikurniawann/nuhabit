import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { PRODUCT_ROUTES, RM_ROUTES } from "@/lib/purchasing/item-routes";

export function getReturnsModuleConfig(moduleType: PurchasingModuleType = "raw_material") {
  const isProduct = moduleType === "product";
  const routes = isProduct ? PRODUCT_ROUTES : RM_ROUTES;

  return {
    isProduct,
    routes,
    partyLabel: isProduct ? "Vendor" : "Supplier",
    listRoute: routes.purchasingReturns,
    insertRoute: routes.purchasingReturnsInsert,
    detailRoute: (id: string) => routes.purchasingReturnsDetail(id),
    editRoute: (id: string) => routes.purchasingReturnsEdit(id),
    receiveDetailRoute: (id: string) =>
      isProduct ? PRODUCT_ROUTES.purchasingReceiveDetail(id) : RM_ROUTES.purchasingGrnDetail(id),
    itemName: (item: {
      product_nama?: string;
      raw_material_nama?: string;
      product_kode?: string;
      raw_material_kode?: string;
    }) => ({
      nama: item.product_nama || item.raw_material_nama || "-",
      kode: item.product_kode || item.raw_material_kode || "-",
    }),
    partyNameFromReturn: (ret: {
      supplier?: { nama_supplier?: string | null };
      vendor?: { name?: string | null };
    }) =>
      (isProduct ? ret.vendor?.name : ret.supplier?.nama_supplier) || "-",
    partyNameFromGrn: (grn: {
      supplier?: { nama_supplier?: string | null } | null;
      vendor?: { name?: string | null } | null;
    }) =>
      (isProduct ? grn.vendor?.name : grn.supplier?.nama_supplier) || "-",
  };
}
