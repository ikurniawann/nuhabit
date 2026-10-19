/**
 * Pengaturan resep (modul Go `production`, /api/production/recipe-settings):
 * toleransi scrap per produk atau bahan baku olahan.
 */

export type RecipeOwner = { productId: string } | { rawMaterialId: string };

export type RecipeSettings = {
  product_id: string | null;
  raw_material_id: string | null;
  /** Null: resep memakai toleransi default. */
  scrap_tolerance_pct: number | null;
  effective_scrap_tolerance_pct: number;
  default_scrap_tolerance_pct: number;
};

export function recipeOwnerId(owner: RecipeOwner): string {
  return "productId" in owner ? owner.productId : owner.rawMaterialId;
}

export type RecipeSettingsForm = { tolerance: string };

export function initRecipeSettingsForm(settings: RecipeSettings | undefined): RecipeSettingsForm {
  return { tolerance: settings?.scrap_tolerance_pct == null ? "" : String(settings.scrap_tolerance_pct) };
}

/** Pesan galat isian, atau null bila valid. Kosong berarti pakai default. */
export function recipeSettingsError(form: RecipeSettingsForm): string | null {
  const raw = form.tolerance.trim();
  if (raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) return "Toleransi scrap harus 0 sampai 100%";
  return null;
}

/** Payload PUT /api/production/recipe-settings. */
export function buildRecipeSettingsPayload(owner: RecipeOwner, form: RecipeSettingsForm) {
  const raw = form.tolerance.trim();
  const ownerKey = "productId" in owner ? { product_id: owner.productId } : { raw_material_id: owner.rawMaterialId };
  return { ...ownerKey, scrap_tolerance_pct: raw === "" ? null : Number(raw) };
}
