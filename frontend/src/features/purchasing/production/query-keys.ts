export const productionQueryKeys = {
  all: ["purchasing", "production"] as const,
  dashboard: (context: "product" | "raw_material") =>
    ["purchasing", "production", "dashboard", context] as const,
  cogs: (context: "product" | "raw_material", itemId: string) =>
    ["purchasing", "production", "cogs", context, itemId] as const,
  recipeItems: (context: "product" | "raw_material") =>
    ["purchasing", "production", "recipe-items", context] as const,
  rmBomEditorData: (id: string) =>
    ["purchasing", "production", "rm-bom-editor", id] as const,
  order: (id: string) => ["purchasing", "production", "order", id] as const,
  additionalCosts: (referenceType: string) =>
    ["purchasing", "production", "additional-costs", referenceType] as const,
  flow: (orderId: string) => ["purchasing", "production", "flow", orderId] as const,
  wip: (context: "product" | "raw_material", search: string) =>
    ["purchasing", "production", "wip", context, search] as const,
  batches: (context: "product" | "raw_material", search: string) =>
    ["purchasing", "production", "batches", context, search] as const,
  batch: (id: string) => ["purchasing", "production", "batch", id] as const,
  recipeSettings: (ownerId: string) => ["purchasing", "production", "recipe-settings", ownerId] as const,
};
