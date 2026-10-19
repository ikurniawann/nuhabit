/**
 * Pengaturan resep (modul Go `production`, /api/production/recipe-settings):
 * toleransi scrap dan ukuran batch per produk atau bahan baku olahan.
 */

export type RecipeOwner = { productId: string } | { rawMaterialId: string };

export type RecipeSettings = {
  product_id: string | null;
  raw_material_id: string | null;
  /** Null: resep memakai toleransi default. */
  scrap_tolerance_pct: number | null;
  /** Null: sub-order tidak dibulatkan ke kelipatan batch. */
  batch_size: number | null;
  effective_scrap_tolerance_pct: number;
  default_scrap_tolerance_pct: number;
};

export function recipeOwnerId(owner: RecipeOwner): string {
  return "productId" in owner ? owner.productId : owner.rawMaterialId;
}

export type RecipeSettingsForm = { tolerance: string; batchSize: string };

const text = (value: number | null | undefined) => (value == null ? "" : String(value));

export function initRecipeSettingsForm(settings: RecipeSettings | undefined): RecipeSettingsForm {
  return { tolerance: text(settings?.scrap_tolerance_pct), batchSize: text(settings?.batch_size) };
}

/** Galat per isian; kosong berarti pakai default (toleransi) atau tanpa pembulatan (batch). */
export function recipeSettingsErrors(form: RecipeSettingsForm): { tolerance: string | null; batchSize: string | null } {
  const tolerance = form.tolerance.trim();
  const batch = form.batchSize.trim();
  const pct = Number(tolerance);
  const size = Number(batch);
  return {
    tolerance:
      tolerance !== "" && (!Number.isFinite(pct) || pct < 0 || pct > 100) ? "Toleransi scrap harus 0 sampai 100%" : null,
    batchSize: batch !== "" && (!Number.isFinite(size) || size <= 0) ? "Ukuran batch harus lebih dari 0" : null,
  };
}

/** Payload PUT /api/production/recipe-settings. */
export function buildRecipeSettingsPayload(owner: RecipeOwner, form: RecipeSettingsForm) {
  const value = (raw: string) => (raw.trim() === "" ? null : Number(raw.trim()));
  const ownerKey = "productId" in owner ? { product_id: owner.productId } : { raw_material_id: owner.rawMaterialId };
  return { ...ownerKey, scrap_tolerance_pct: value(form.tolerance), batch_size: value(form.batchSize) };
}
