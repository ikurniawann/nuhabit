import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { PRODUCT_ROUTES, RM_ROUTES } from "@/lib/purchasing/item-routes";

export function getProductionModuleConfig(moduleType: PurchasingModuleType = "raw_material") {
  const isProduct = moduleType === "product";
  const routes = isProduct ? PRODUCT_ROUTES : RM_ROUTES;

  return {
    isProduct,
    routes,
    productionHubRoute: routes.productionHub,
    productionRecipesRoute: routes.productionRecipes,
    productionOrderRoute: (id: string) => routes.productionOrder(id),
    bomEditorRoute: (id: string) =>
      isProduct ? PRODUCT_ROUTES.productsBom(id) : RM_ROUTES.materialsBom(id),
    materialsInsertRoute: isProduct ? PRODUCT_ROUTES.productsInsert : RM_ROUTES.materialsInsert,
    /** Production shortages always procure raw materials (BOM components), not finished products. */
    purchasingPoInsertRoute: RM_ROUTES.purchasingPoInsert,
    stockCardRoute: (materialId: string) =>
      `/dashboard/purchasing/reports/stock-card?material_id=${materialId}`,
  };
}
