package gymtraining

import (
	"net/http"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

/* ── Member: HYROX results ───────────────────────────────────────────── */

func (h handlers) myResults(w http.ResponseWriter, r *http.Request, customerID string) error {
	out, err := h.svc.MyResults(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) resultDetail(w http.ResponseWriter, r *http.Request, customerID string) error {
	id, err := memberID(r, "id")
	if err != nil {
		return err
	}
	out, err := h.svc.ResultDetail(r.Context(), customerID, id)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) createResult(w http.ResponseWriter, r *http.Request, customerID string) error {
	in, err := parseResult(r)
	if err != nil {
		return err
	}
	out, err := h.svc.CreateResult(r.Context(), customerID, in)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) updateResult(w http.ResponseWriter, r *http.Request, customerID string) error {
	id, err := memberID(r, "id")
	if err != nil {
		return err
	}
	in, err := parseResultUpdate(r)
	if err != nil {
		return err
	}
	if err := h.svc.UpdateResult(r.Context(), customerID, id, in); err != nil {
		return err
	}
	return ok(w, map[string]string{"id": id})
}

func (h handlers) memberLeaderboard(w http.ResponseWriter, r *http.Request, customerID string) error {
	q, err := parseBoardQuery(r.URL.Query())
	if err != nil {
		return err
	}
	out, err := h.svc.Leaderboard(r.Context(), customerID, q)
	if err != nil {
		return err
	}
	return ok(w, out)
}

/* ── Staff: results, verification, leaderboard ───────────────────────── */

func (h handlers) listResults(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	q := r.URL.Query()
	var raceID *string
	if raw := q.Get("race_id"); raw != "" {
		if !validate.IsUUID(raw) {
			return httpx.BadRequest("ID race tidak valid")
		}
		raceID = &raw
	}
	var verified *bool
	switch q.Get("verified") {
	case "":
	case "true":
		verified = ptrTo(true)
	case "false":
		verified = ptrTo(false)
	default:
		return httpx.BadRequest("Filter verifikasi tidak valid")
	}
	out, err := h.svc.ResultsAdmin(r.Context(), raceID, verified)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) verifyResult(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	verified := f.Bool("verified", required)
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	if err := h.svc.VerifyResult(r.Context(), u.ID, id, *verified); err != nil {
		return err
	}
	return ok(w, map[string]any{"id": id, "verified": *verified})
}

func (h handlers) staffLeaderboard(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	q, err := parseBoardQuery(r.URL.Query())
	if err != nil {
		return err
	}
	out, err := h.svc.Leaderboard(r.Context(), "", q)
	if err != nil {
		return err
	}
	return ok(w, out)
}
