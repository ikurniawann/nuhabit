import type { DbClient } from "@/lib/pg/types";

export type PurchasingModuleType = "raw_material" | "product" | "general";

export async function getPurchaseOrderIdsByModuleType(
  db: DbClient,
  moduleType: PurchasingModuleType
): Promise<string[]> {
  const { data, error } = await db
    .from("purchase_orders")
    .select("id")
    .eq("module_type", moduleType)
    .eq("is_active", true);

  if (error) throw error;
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

export function parsePurchasingModuleType(
  value: string | null | undefined,
  fallback: PurchasingModuleType = "raw_material"
): PurchasingModuleType {
  if (value === "product") return "product";
  if (value === "general") return "general";
  return fallback;
}
