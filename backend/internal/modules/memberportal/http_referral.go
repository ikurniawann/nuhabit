package memberportal

import (
	"net/http"
	"slices"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/memberportal/referral"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
)

// StaffGuard is the slice of platform/auth the staff referral routes use;
// tests swap it.
type StaffGuard interface {
	RequireAnyGrant(r *http.Request, grants ...iam.Grant) (*auth.User, int, error)
}

// deviceHeader carries the member app's device id (localStorage) for the
// same-device referral guard.
const deviceHeader = "X-Device-Id"

func (h *Handler) referralRoutes() []module.Route {
	return []module.Route{
		{Pattern: "GET " + prefix + "/app/referral", Handler: h.member("Gagal memuat referral", h.memberReferral)},
		{Pattern: "GET " + prefix + "/referral/{code}", Handler: h.public("Gagal memeriksa kode referral", h.referralLookup)},

		{Pattern: "GET /api/gym/referrals/settings", Handler: h.staff("read", h.referralSettings)},
		{Pattern: "PUT /api/gym/referrals/settings", Handler: h.staff("update", h.saveReferralSettings)},
		{Pattern: "GET /api/gym/referrals", Handler: h.staff("read", h.referralList)},
		{Pattern: "GET /api/gym/referrals/leaderboard", Handler: h.staff("read", h.referralLeaderboard)},
	}
}

// staff guards a dashboard route with action on Gym → Referral.
func (h *Handler) staff(action string, fn func(w http.ResponseWriter, r *http.Request, u *auth.User) error) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		u, _, err := h.guard.RequireAnyGrant(r, iam.Grant{Action: action, Prefixes: iam.GymReferrals})
		if err != nil {
			return err
		}
		return fn(w, r, u)
	})
}

// GET /app/referral: the member's code, the program and their friends.
func (h *Handler) memberReferral(w http.ResponseWriter, r *http.Request, customerID string) error {
	view, err := h.referrals.MemberView(r.Context(), customerID, r.Header.Get(deviceHeader))
	if err != nil {
		return err
	}
	return httpx.OK(w, view)
}

// GET /referral/{code}: who invited and what the friend gets.
func (h *Handler) referralLookup(w http.ResponseWriter, r *http.Request) error {
	invite, err := h.referrals.Lookup(r.Context(), clientIP(r.Header), r.PathValue("code"))
	if err != nil {
		return err
	}
	return httpx.OK(w, invite)
}

func (h *Handler) referralSettings(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	view, err := h.referrals.Settings(r.Context())
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, view)
}

func (h *Handler) saveReferralSettings(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var in referral.Settings
	if err := httpx.DecodeJSON(r, &in); err != nil {
		return err
	}
	if in.RefereeCampaignID != nil && !isUUID(*in.RefereeCampaignID) {
		in.RefereeCampaignID = nil
	}
	view, err := h.referrals.SaveSettings(r.Context(), in, u.ID)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, view)
}

// GET /api/gym/referrals?status=&q=&limit=&offset=
func (h *Handler) referralList(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	q := r.URL.Query()
	status := q.Get("status")
	if status != "" && !slices.Contains(referral.Statuses, status) {
		return httpx.BadRequest("Status tidak valid")
	}
	view, err := h.referrals.List(r.Context(), referral.ListFilter{
		Status: status, Search: strings.TrimSpace(q.Get("q")),
		Limit: clampInt(q.Get("limit"), 50, 1, 200), Offset: clampInt(q.Get("offset"), 0, 0, 100_000),
	})
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, view)
}

// GET /api/gym/referrals/leaderboard?month=2026-10 (default: this WIB month)
func (h *Handler) referralLeaderboard(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	from, to := referral.MonthBounds(h.svc.now())
	if month := r.URL.Query().Get("month"); month != "" {
		var valid bool
		if from, to, valid = referral.ParseMonth(month); !valid {
			return httpx.BadRequest("Bulan tidak valid (format YYYY-MM)")
		}
	}
	rows, err := h.referrals.Leaderboard(r.Context(), from, to)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, rows)
}

// clampInt parses a query number, def when missing or invalid, within [lo, hi].
func clampInt(raw string, def, lo, hi int) int {
	n, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	return min(max(n, lo), hi)
}
