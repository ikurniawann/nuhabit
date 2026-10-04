package promo

import (
	"fmt"
	"net/http"
	"slices"

	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/modules/storedvalue/promo/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// Every route is apiHandler + requirePromoContext, then validateBody.

type handler struct {
	kit *kit.Kit
	svc *Service
}

// idBody is the {id} payload several routes answer with.
type idBody struct {
	ID string `json:"id"`
}

// Routes lists the promo routes (frontend/src/app/api/promo/**, without
// the gift card routes).
func Routes(k *kit.Kit, svc *Service) []module.Route {
	h := &handler{kit: k, svc: svc}
	route := func(pattern string, fn func(http.ResponseWriter, *http.Request, venue, *kit.PromoContext) error) module.Route {
		return module.Route{Pattern: pattern, Handler: kit.API(func(w http.ResponseWriter, r *http.Request) error {
			ctx, err := k.PromoContext(r)
			if err != nil {
				return err
			}
			return fn(w, r, venue{companyID: ctx.CompanyID, branchID: ctx.BranchID}, ctx)
		})}
	}
	return []module.Route{
		route("GET /api/promo/campaigns", h.listCampaigns),
		route("POST /api/promo/campaigns", h.createCampaign),
		route("PATCH /api/promo/campaigns/{id}", h.updateCampaign),
		route("GET /api/promo/campaigns/{id}/codes", h.listCodes),
		route("POST /api/promo/campaigns/{id}/codes", h.createCodes),
		route("PATCH /api/promo/campaigns/{id}/codes", h.syncCodes),
		route("GET /api/promo/campaigns/{id}/redemptions", h.listRedemptions),
		route("GET /api/promo/catalog", h.catalog),
		route("PATCH /api/promo/codes/{id}", h.updateCode),
		route("DELETE /api/promo/codes/{id}", h.deleteCode),
		route("GET /api/promo/offers", h.listOffers),
		route("POST /api/promo/offers", h.createOffer),
		route("GET /api/promo/offers/{id}", h.getOffer),
		route("PATCH /api/promo/offers/{id}", h.updateOffer),
		route("DELETE /api/promo/offers/{id}", h.deleteOffer),
	}
}

func (h *handler) listCampaigns(w http.ResponseWriter, r *http.Request, v venue, _ *kit.PromoContext) error {
	rows, err := h.svc.listCampaigns(r.Context(), v)
	if err != nil {
		return err
	}
	return kit.OK(w, http.StatusOK, rows)
}

func (h *handler) createCampaign(w http.ResponseWriter, r *http.Request, v venue, ctx *kit.PromoContext) error {
	body, err := parseCampaignCreate(r)
	if err != nil {
		return err
	}
	id, err := h.svc.createCampaign(r.Context(), v, ctx.UserID, body)
	if err != nil {
		return err
	}
	return kit.OKMessage(w, http.StatusOK, idBody{id}, "Campaign promo dibuat")
}

func (h *handler) updateCampaign(w http.ResponseWriter, r *http.Request, v venue, _ *kit.PromoContext) error {
	body, err := parseCampaignPatch(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	if err := h.svc.updateCampaign(r.Context(), v, id, body); err != nil {
		return err
	}
	return kit.OKMessage(w, http.StatusOK, idBody{id}, "Campaign diperbarui")
}

func (h *handler) listCodes(w http.ResponseWriter, r *http.Request, v venue, _ *kit.PromoContext) error {
	rows, err := h.svc.listCodes(r.Context(), v, r.PathValue("id"))
	if err != nil {
		return err
	}
	return kit.OK(w, http.StatusOK, rows)
}

func (h *handler) createCodes(w http.ResponseWriter, r *http.Request, v venue, _ *kit.PromoContext) error {
	body, err := parseCodeCreate(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	if !body.Batch {
		row, err := h.svc.createSingleCode(r.Context(), v, id, body.Code, body.UsageLimit)
		if err != nil {
			return err
		}
		return kit.OKMessage(w, http.StatusOK, row, "Kode ditambahkan")
	}
	codes, err := h.svc.createVoucherBatch(r.Context(), v, id, body.Prefix, body.Count)
	if err != nil {
		return err
	}
	return kit.OKMessage(w, http.StatusOK, struct {
		Count int      `json:"count"`
		Codes []string `json:"codes"`
	}{len(codes), codes}, fmt.Sprintf("%d voucher dibuat", len(codes)))
}

func (h *handler) syncCodes(w http.ResponseWriter, r *http.Request, v venue, _ *kit.PromoContext) error {
	target, prefix, err := parseCodeSync(r)
	if err != nil {
		return err
	}
	result, msg, err := h.svc.syncVoucherCount(r.Context(), v, r.PathValue("id"), target, prefix)
	if err != nil {
		return err
	}
	return kit.OKMessage(w, http.StatusOK, result, msg)
}

func (h *handler) listRedemptions(w http.ResponseWriter, r *http.Request, v venue, _ *kit.PromoContext) error {
	rows, err := h.svc.listRedemptions(r.Context(), v, r.PathValue("id"))
	if err != nil {
		return err
	}
	return kit.OK(w, http.StatusOK, rows)
}

func (h *handler) catalog(w http.ResponseWriter, r *http.Request, _ venue, _ *kit.PromoContext) error {
	data, err := h.svc.ports.Catalog.Active(r.Context(), h.svc.db)
	if err != nil {
		return err
	}
	return kit.OK(w, http.StatusOK, data)
}

func (h *handler) updateCode(w http.ResponseWriter, r *http.Request, v venue, _ *kit.PromoContext) error {
	body, err := parseCodePatch(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	if err := h.svc.updateCode(r.Context(), v, id, body); err != nil {
		return err
	}
	return kit.OKMessage(w, http.StatusOK, idBody{id}, "Kode diperbarui")
}

func (h *handler) deleteCode(w http.ResponseWriter, r *http.Request, v venue, _ *kit.PromoContext) error {
	id := r.PathValue("id")
	if err := h.svc.deleteCode(r.Context(), v, id); err != nil {
		return err
	}
	return kit.OKMessage(w, http.StatusOK, idBody{id}, "Kode dihapus")
}

func (h *handler) listOffers(w http.ResponseWriter, r *http.Request, v venue, _ *kit.PromoContext) error {
	offerType := r.URL.Query().Get("type")
	if !slices.Contains(domain.OfferTypes, offerType) {
		return httpx.BadRequest("Query type=bundle|bxgy|volume wajib")
	}
	rows, err := h.svc.listOfferRules(r.Context(), v, offerType)
	if err != nil {
		return err
	}
	return kit.OK(w, http.StatusOK, rows)
}

func (h *handler) createOffer(w http.ResponseWriter, r *http.Request, v venue, ctx *kit.PromoContext) error {
	body, err := parseOfferRule(r, false)
	if err != nil {
		return err
	}
	created, err := h.svc.createOfferRule(r.Context(), v, ctx.UserID, body)
	if err != nil {
		return err
	}
	return kit.OKMessage(w, http.StatusCreated, created, "Aturan promo dibuat")
}

const ruleNotFound = "Aturan tidak ditemukan"

func (h *handler) getOffer(w http.ResponseWriter, r *http.Request, v venue, _ *kit.PromoContext) error {
	row, err := h.svc.getOfferRule(r.Context(), v, r.PathValue("id"))
	if err != nil {
		return err
	}
	if row == nil {
		return httpx.NotFound(ruleNotFound)
	}
	return kit.OK(w, http.StatusOK, row)
}

func (h *handler) updateOffer(w http.ResponseWriter, r *http.Request, v venue, _ *kit.PromoContext) error {
	body, err := parseOfferRule(r, true)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	existing, err := h.svc.getOfferRule(r.Context(), v, id)
	if err != nil {
		return err
	}
	if existing == nil {
		return httpx.NotFound(ruleNotFound)
	}
	updated, err := h.svc.updateOfferRule(r.Context(), v, id, body)
	if err != nil {
		return err
	}
	return kit.OKMessage(w, http.StatusOK, updated, "Aturan promo diperbarui")
}

func (h *handler) deleteOffer(w http.ResponseWriter, r *http.Request, v venue, _ *kit.PromoContext) error {
	deleted, err := h.svc.deleteOfferRule(r.Context(), v, r.PathValue("id"))
	if err != nil {
		return err
	}
	if !deleted {
		return httpx.NotFound(ruleNotFound)
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
