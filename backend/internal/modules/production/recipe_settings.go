package production

import (
	"context"
	"net/http"

	"nuhabit/backend/internal/modules/production/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// Recipe settings: the scrap tolerance of a product or raw material recipe,
// edited next to its BOM lines.

// RecipeSettingsView is GET/PUT /api/production/recipe-settings.
// ScrapTolerancePct is what the recipe sets (null = the default);
// EffectiveScrapTolerancePct is what orders of the recipe use. BatchSize
// rounds sub-orders of the recipe up (null = no rounding).
type RecipeSettingsView struct {
	ProductID                  *string  `json:"product_id"`
	RawMaterialID              *string  `json:"raw_material_id"`
	ScrapTolerancePct          *float64 `json:"scrap_tolerance_pct"`
	BatchSize                  *float64 `json:"batch_size"`
	EffectiveScrapTolerancePct float64  `json:"effective_scrap_tolerance_pct"`
	DefaultScrapTolerancePct   float64  `json:"default_scrap_tolerance_pct"`
}

// checkOwner answers 404 when the recipe's item does not exist.
func (s *Service) checkOwner(ctx context.Context, owner RecipeOwner) error {
	if owner.ProductID != nil {
		p, err := s.ports.Catalog.Product(ctx, s.db, *owner.ProductID)
		if err == nil && p == nil {
			return httpx.NotFound("Produk tidak ditemukan")
		}
		return err
	}
	m, err := s.ports.Catalog.Materials(ctx, s.db, []string{*owner.RawMaterialID})
	if _, ok := m[*owner.RawMaterialID]; err == nil && !ok {
		return httpx.NotFound("Bahan baku tidak ditemukan")
	}
	return err
}

// RecipeSettings reads the settings of a recipe.
func (s *Service) RecipeSettings(ctx context.Context, owner RecipeOwner) (*RecipeSettingsView, error) {
	if err := s.checkOwner(ctx, owner); err != nil {
		return nil, err
	}
	row, err := s.repo.RecipeSettings(ctx, s.db, owner)
	if err != nil {
		return nil, err
	}
	v := &RecipeSettingsView{ProductID: owner.ProductID, RawMaterialID: owner.RawMaterialID,
		EffectiveScrapTolerancePct: domain.DefaultScrapTolerancePct, DefaultScrapTolerancePct: domain.DefaultScrapTolerancePct}
	if row != nil && row.ScrapTolerancePct != nil {
		v.ScrapTolerancePct, v.EffectiveScrapTolerancePct = row.ScrapTolerancePct, *row.ScrapTolerancePct
	}
	if row != nil {
		v.BatchSize = row.BatchSize
	}
	return v, nil
}

// SaveRecipeSettings sets (or clears, with nil) the scrap tolerance and,
// when batchSent, the batch size.
func (s *Service) SaveRecipeSettings(ctx context.Context, owner RecipeOwner, tolerancePct, batchSize *float64, batchSent bool,
	userID string) (*RecipeSettingsView, error) {
	if err := s.checkOwner(ctx, owner); err != nil {
		return nil, err
	}
	settings := RecipeSettings{ScrapTolerancePct: tolerancePct, BatchSize: batchSize}
	if !batchSent {
		current, err := s.repo.RecipeSettings(ctx, s.db, owner)
		if err != nil {
			return nil, err
		}
		if current != nil {
			settings.BatchSize = current.BatchSize
		}
	}
	if err := s.repo.SaveRecipeSettings(ctx, s.db, owner, settings, userID); err != nil {
		return nil, err
	}
	return s.RecipeSettings(ctx, owner)
}

// recipeOwner reads product_id or raw_material_id (exactly one).
func recipeOwner(productID, rawMaterialID string) (RecipeOwner, error) {
	if (productID == "") == (rawMaterialID == "") {
		return RecipeOwner{}, httpx.BadRequest("Isi salah satu: product_id atau raw_material_id")
	}
	if !validate.IsUUID(productID + rawMaterialID) {
		return RecipeOwner{}, httpx.BadRequest("ID item tidak valid")
	}
	if productID != "" {
		return RecipeOwner{ProductID: &productID}, nil
	}
	return RecipeOwner{RawMaterialID: &rawMaterialID}, nil
}

// recipeStaff guards the settings as the BOM lines are guarded: the item
// catalog menus for a product, the items menus for a raw material.
func (h *Handler) recipeStaff(r *http.Request, owner RecipeOwner) (string, error) {
	prefixes := iam.Items
	if owner.ProductID != nil {
		prefixes = iam.ItemsCatalog
	}
	u, err := h.auth.RequireMenuPrefix(r, prefixes...)
	if err != nil {
		return "", err
	}
	return u.ID, nil
}

/* GET /api/production/recipe-settings?product_id=|raw_material_id= */
func (h *Handler) recipeSettings(w http.ResponseWriter, r *http.Request) error {
	sp := r.URL.Query()
	owner, err := recipeOwner(sp.Get("product_id"), sp.Get("raw_material_id"))
	if err != nil {
		return err
	}
	if _, err := h.recipeStaff(r, owner); err != nil {
		return err
	}
	view, err := h.svc.RecipeSettings(r.Context(), owner)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, view)
}

/*
PUT /api/production/recipe-settings

	{ product_id | raw_material_id, scrap_tolerance_pct: number 0..100 | null, batch_size?: number > 0 | null }
*/
func (h *Handler) saveRecipeSettings(w http.ResponseWriter, r *http.Request) error {
	f := validate.New(validate.ReadBody(r))
	productID := f.UUID("product_id", validate.Rule{Optional: true, Nullable: true})
	rawMaterialID := f.UUID("raw_material_id", validate.Rule{Optional: true, Nullable: true})
	tolerance := f.Num("scrap_tolerance_pct", validate.Rule{Nullable: true}, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(100)})
	batchSize := f.Num("batch_size", validate.Rule{Optional: true, Nullable: true}, validate.NumOpts{Positive: true})
	_, batchSent := f.Fields()["batch_size"]
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	deref := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	owner, err := recipeOwner(deref(productID), deref(rawMaterialID))
	if err != nil {
		return err
	}
	userID, err := h.recipeStaff(r, owner)
	if err != nil {
		return err
	}
	view, err := h.svc.SaveRecipeSettings(r.Context(), owner, tolerance, batchSize, batchSent, userID)
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, http.StatusOK, view, "Pengaturan resep disimpan")
}
