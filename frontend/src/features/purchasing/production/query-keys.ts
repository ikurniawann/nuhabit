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
};
