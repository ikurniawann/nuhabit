export const recipeBuilderQueryKeys = {
  all: ["pos", "recipe-builder"] as const,
  catalog: () => ["pos", "recipe-builder", "catalog"] as const,
  bom: (productId: string) => ["pos", "recipe-builder", "bom", productId] as const,
};
