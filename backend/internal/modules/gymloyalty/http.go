package gymloyalty

import (
	"net/http"

	"nuhabit/backend/internal/platform/audit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// Guard is the slice of platform/auth the handlers use; tests swap it.
type Guard interface {
	auth.Granter
	RequireMember(r *http.Request) (string, error)
}

type handler struct {
	svc   *Service
	guard Guard
}

var (
	loyaltyRead   = iam.Can("read", iam.GymLoyalty)
	loyaltyCreate = iam.Can("create", iam.GymLoyalty)
	loyaltyUpdate = iam.Can("update", iam.GymLoyalty)
	loyaltyDelete = iam.Can("delete", iam.GymLoyalty)
	membersRead   = iam.Can("read", iam.GymMembers)
)

// Routes lists the staff routes (Gym → Membership & Progres, member 360)
// and the member app routes.
func (h *handler) Routes() []module.Route {
	staff := func(pattern string, fn auth.StaffFunc, grants ...iam.Grant) module.Route {
		return module.Route{Pattern: pattern, Handler: auth.Staff(h.guard, fn, grants...)}
	}
	member := func(pattern string, fn func(w http.ResponseWriter, r *http.Request, customerID string) error) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			customerID, err := h.guard.RequireMember(r)
			if err != nil {
				return err
			}
			return fn(w, r, customerID)
		})}
	}
	return []module.Route{
		staff("GET /api/gym/loyalty/tiers", h.tiers, loyaltyRead),
		staff("POST /api/gym/loyalty/tiers", h.createTier, loyaltyCreate),
		staff("PATCH /api/gym/loyalty/tiers/{id}", h.updateTier, loyaltyUpdate),
		staff("DELETE /api/gym/loyalty/tiers/{id}", h.deleteTier, loyaltyDelete),
		staff("PUT /api/gym/loyalty/settings", h.saveSettings, loyaltyUpdate),
		staff("POST /api/gym/loyalty/recompute", h.recompute, loyaltyUpdate),
		staff("GET /api/gym/loyalty/members", h.statusList, loyaltyRead),
		staff("GET /api/gym/loyalty/leaderboard", h.staffLeaderboard, loyaltyRead),
		staff("GET /api/gym/members/{id}/loyalty", h.memberLoyalty, membersRead, loyaltyRead),
		staff("PUT /api/gym/members/{id}/status", h.setStatus, loyaltyUpdate),

		member("GET /api/member-portal/app/membership", h.myMembership),
		member("GET /api/member-portal/app/progress", h.myProgress),
		member("GET /api/member-portal/app/leaderboard", h.myLeaderboard),
	}
}

func actor(r *http.Request, u *auth.User) Actor {
	name := u.FullName
	return Actor{ID: u.ID, Name: &name, Entry: audit.Entry{}.WithRequest(r)}
}

func (h *handler) tiers(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	view, err := h.svc.Tiers(r.Context())
	if err != nil {
		return err
	}
	return httpx.OK(w, view)
}

func (h *handler) createTier(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	return h.saveTier(w, r, u, "")
}

func (h *handler) updateTier(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	return h.saveTier(w, r, u, id)
}

func (h *handler) saveTier(w http.ResponseWriter, r *http.Request, u *auth.User, id string) error {
	var in TierInput
	if err := httpx.DecodeJSON(r, &in); err != nil {
		return err
	}
	tier, err := h.svc.SaveTier(r.Context(), id, in, actor(r, u))
	if err != nil {
		return err
	}
	status := http.StatusOK
	if id == "" {
		status = http.StatusCreated
	}
	return httpx.Data(w, status, tier)
}

func (h *handler) deleteTier(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteTier(r.Context(), id, actor(r, u)); err != nil {
		return err
	}
	return httpx.OK(w, map[string]string{"id": id})
}

func (h *handler) saveSettings(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var in SettingsInput
	if err := httpx.DecodeJSON(r, &in); err != nil {
		return err
	}
	for _, o := range in.OffPeak {
		if !validate.IsUUID(o.BranchID) {
			return httpx.BadRequest("Cabang tidak ditemukan")
		}
	}
	view, err := h.svc.SaveSettings(r.Context(), in, actor(r, u))
	if err != nil {
		return err
	}
	return httpx.OK(w, view)
}

// POST /api/gym/loyalty/recompute: evaluate every member now, after the
// ladder or the hold changed.
func (h *handler) recompute(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	changed, err := h.svc.RecomputeAll(r.Context(), true)
	if err != nil {
		return err
	}
	return httpx.OK(w, map[string]int{"changed": changed})
}

// GET /api/gym/loyalty/members?q=: search, or the suspended and banned.
func (h *handler) statusList(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	rows, err := h.svc.StatusList(r.Context(), r.URL.Query().Get("q"))
	if err != nil {
		return err
	}
	return httpx.OK(w, rows)
}

func leaderboardQuery(r *http.Request) (branchID, month string, err error) {
	q := r.URL.Query()
	branchID, month = q.Get("branch_id"), q.Get("month")
	if branchID != "" && !validate.IsUUID(branchID) {
		return "", "", httpx.BadRequest("Cabang tidak ditemukan")
	}
	return branchID, month, nil
}

func (h *handler) staffLeaderboard(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	branchID, month, err := leaderboardQuery(r)
	if err != nil {
		return err
	}
	view, err := h.svc.Leaderboard(r.Context(), branchID, "", month)
	if err != nil {
		return err
	}
	return httpx.OK(w, view)
}

func (h *handler) memberLoyalty(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	view, err := h.svc.MemberLoyalty(r.Context(), id)
	if err != nil {
		return err
	}
	return httpx.OK(w, view)
}

func (h *handler) setStatus(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	var in StatusInput
	if err := httpx.DecodeJSON(r, &in); err != nil {
		return err
	}
	standing, err := h.svc.SetStatus(r.Context(), id, in, actor(r, u))
	if err != nil {
		return err
	}
	return httpx.OK(w, standing)
}

func (h *handler) myMembership(w http.ResponseWriter, r *http.Request, customerID string) error {
	view, err := h.svc.Membership(r.Context(), customerID)
	if err != nil {
		return err
	}
	return httpx.OK(w, view)
}

func (h *handler) myProgress(w http.ResponseWriter, r *http.Request, customerID string) error {
	view, err := h.svc.Progress(r.Context(), customerID)
	if err != nil {
		return err
	}
	return httpx.OK(w, view)
}

func (h *handler) myLeaderboard(w http.ResponseWriter, r *http.Request, customerID string) error {
	branchID, month, err := leaderboardQuery(r)
	if err != nil {
		return err
	}
	view, err := h.svc.Leaderboard(r.Context(), branchID, customerID, month)
	if err != nil {
		return err
	}
	return httpx.OK(w, view)
}
