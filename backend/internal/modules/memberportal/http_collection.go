package memberportal

import (
	"errors"
	"net/http"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// collectionRoutes are badges, rewards, collectibles and wallpapers. Each
// failMessage is the route's catch-all 500 message.
func (h *Handler) collectionRoutes() []module.Route {
	return []module.Route{
		{Pattern: "GET " + prefix + "/badges", Handler: h.member("Gagal memuat badge", h.badges)},
		{Pattern: "POST " + prefix + "/badges", Handler: h.member("Gagal menyimpan", h.showcaseBadge)},
		{Pattern: "GET " + prefix + "/rewards", Handler: h.member("Gagal memuat rewards", h.rewards)},
		{Pattern: "POST " + prefix + "/rewards", Handler: h.member("Gagal mengajukan redeem", h.redeemReward)},
		{Pattern: "GET " + prefix + "/collectibles", Handler: h.member("Gagal memuat koleksi", h.collectibles)},
		{Pattern: "POST " + prefix + "/collectibles/equip", Handler: h.member("Gagal memasang artwork", h.equipCollectible)},
		{Pattern: "POST " + prefix + "/collectibles/redeem", Handler: h.member("Penukaran gagal. Coba lagi.", h.redeemCollectible(avatarKind, "avatar_id"))},
		{Pattern: "GET " + prefix + "/wallpapers", Handler: h.member("Gagal memuat wallpaper", h.wallpapers)},
		{Pattern: "POST " + prefix + "/wallpapers/redeem", Handler: h.member("Penukaran gagal. Coba lagi.", h.redeemCollectible(wallpaperKind, "wallpaper_id"))},
	}
}

// messageBody is {"success":true,"message":..[,"data":..]}.
type messageBody struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
	Data    any    `json:"data,omitempty"`
}

// looseBody mirrors `(await request.json().catch(() => ({}))) as {...}`
// before a property read: unreadable JSON reads as {}, a JSON null body
// throws (a 500 in TS) and any other non-object has no properties.
func looseBody(r *http.Request) (map[string]any, error) {
	v, parsed := readRaw(r)
	if parsed && v == nil {
		return nil, errors.New("request body is null")
	}
	obj, _ := v.(map[string]any)
	return obj, nil
}

// strictUUID mirrors `z.object({key: z.string().uuid()}).parse(await
// request.json())`: a body that is not JSON throws (a 500 in TS), a schema
// miss is valid=false.
func strictUUID(r *http.Request, key string) (id string, valid bool, err error) {
	v, parsed := readRaw(r)
	if !parsed {
		return "", false, errors.New("request body is not JSON")
	}
	obj, _ := v.(map[string]any)
	id, _ = obj[key].(string)
	return id, isUUID(id), nil
}

func (h *Handler) badges(w http.ResponseWriter, r *http.Request, customerID string) error {
	view, err := h.svc.Badges(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, view)
}

func (h *Handler) showcaseBadge(w http.ResponseWriter, r *http.Request, customerID string) error {
	obj, err := looseBody(r)
	if err != nil {
		return err
	}
	badgeID, _ := obj["badge_id"].(string)
	showcased, _ := obj["showcased"].(bool)
	if !isLooseUUID(badgeID) {
		return fail(400, "Badge tidak valid")
	}
	if err := h.svc.ShowcaseBadge(r.Context(), customerID, badgeID, showcased); err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, messageBody{Success: true})
}

func (h *Handler) rewards(w http.ResponseWriter, r *http.Request, customerID string) error {
	view, err := h.svc.Rewards(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, view)
}

func (h *Handler) redeemReward(w http.ResponseWriter, r *http.Request, customerID string) error {
	allowed, retryAfter, err := h.svc.AllowRedeemAttempt(r.Context(), customerID)
	if err != nil {
		return err
	}
	if !allowed {
		w.Header().Set("Retry-After", retryAfter)
		return fail(http.StatusTooManyRequests, "Terlalu banyak percobaan. Coba lagi sebentar lagi.")
	}
	rewardID, valid, err := strictUUID(r, "reward_id")
	if err != nil {
		return err
	}
	if !valid {
		return fail(400, "Reward tidak valid")
	}
	redemption, err := h.svc.RedeemReward(r.Context(), customerID, rewardID)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, messageBody{
		Success: true,
		Data:    redemption,
		Message: "Permintaan redeem terkirim. Tunjukkan kode ini ke kasir untuk pengambilan.",
	})
}

func (h *Handler) collectibles(w http.ResponseWriter, r *http.Request, customerID string) error {
	view, err := h.svc.Collectibles(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, view)
}

func (h *Handler) wallpapers(w http.ResponseWriter, r *http.Request, customerID string) error {
	view, err := h.svc.Wallpapers(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, view)
}

func (h *Handler) equipCollectible(w http.ResponseWriter, r *http.Request, customerID string) error {
	avatarID, valid, err := strictUUID(r, "avatar_id")
	if err != nil {
		return err
	}
	if !valid {
		return fail(400, "Artwork tidak valid")
	}
	if err := h.svc.EquipAvatar(r.Context(), customerID, avatarID); err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, messageBody{Success: true, Message: "Artwork terpasang."})
}

// redeemCollectible spends an entitlement on the asset named by key.
func (h *Handler) redeemCollectible(kind collectibleKind, key string) memberFunc {
	return func(w http.ResponseWriter, r *http.Request, customerID string) error {
		obj, err := looseBody(r)
		if err != nil {
			return err
		}
		assetID, _ := obj[key].(string)
		if !isLooseUUID(assetID) {
			return fail(400, kind.noun+" tidak valid")
		}
		entitlement, err := h.svc.RedeemCollectible(r.Context(), kind, customerID, assetID)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, messageBody{
			Success: true,
			Message: kind.noun + " berhasil ditukar!",
			Data:    map[string]EntitlementSummary{"entitlement": entitlement},
		})
	}
}
