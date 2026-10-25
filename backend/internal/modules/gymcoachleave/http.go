package gymcoachleave

import (
	"context"
	"net/http"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/gymcoachleave/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// Guard is the slice of platform/auth the handlers use; tests swap it.
type Guard interface {
	auth.Granter
	GrantedMenuCodes(ctx context.Context, userID, role string) ([]string, error)
}

type handler struct {
	svc   *Service
	guard Guard
}

var (
	leaveRead    = iam.Can("read", iam.GymCoachLeave)
	leaveUpdate  = iam.Can("update", iam.GymCoachLeave)
	portalRead   = iam.Can("read", iam.GymMyClasses)
	portalUpdate = iam.Can("update", iam.GymMyClasses)
)

// Routes lists the Program Director (/api/gym/coach-leave) and coach portal
// (/api/gym/my-classes/leave) routes. Deciding a leave goes through
// POST /api/hris/leaves/approve, which calls back into Hooks.
func (h *handler) Routes() []module.Route {
	staff := func(fn auth.StaffFunc, g iam.Grant) http.Handler { return auth.Staff(h.guard, fn, g) }
	return []module.Route{
		{Pattern: "GET /api/gym/coach-leave/queue", Handler: staff(h.queue, leaveRead)},
		{Pattern: "GET /api/gym/coach-leave/covers/{id}/candidates", Handler: staff(h.directorCandidates, leaveUpdate)},
		{Pattern: "POST /api/gym/coach-leave/covers/{id}/assign", Handler: staff(h.assign, leaveUpdate)},
		{Pattern: "POST /api/gym/coach-leave/covers/{id}/cancel-session", Handler: staff(h.cancelSession, leaveUpdate)},
		{Pattern: "GET /api/gym/coach-leave/settings", Handler: staff(h.settings, leaveRead)},
		{Pattern: "PUT /api/gym/coach-leave/settings", Handler: staff(h.saveSettings, leaveUpdate)},
		{Pattern: "GET /api/gym/coach-leave/blackouts", Handler: staff(h.blackouts, leaveRead)},
		{Pattern: "POST /api/gym/coach-leave/blackouts", Handler: staff(h.addBlackout, leaveUpdate)},
		{Pattern: "DELETE /api/gym/coach-leave/blackouts/{id}", Handler: staff(h.deleteBlackout, leaveUpdate)},
		{Pattern: "GET /api/gym/coach-leave/incidents", Handler: staff(h.incidents, leaveRead)},
		{Pattern: "POST /api/gym/coach-leave/incidents", Handler: staff(h.recordIncident, leaveUpdate)},
		{Pattern: "POST /api/gym/coach-leave/incidents/{id}/void", Handler: staff(h.voidIncident, leaveUpdate)},
		{Pattern: "GET /api/gym/coach-leave/warnings", Handler: staff(h.warnings, leaveRead)},
		{Pattern: "POST /api/gym/coach-leave/warnings/{id}", Handler: staff(h.decideWarning, leaveUpdate)},
		{Pattern: "GET /api/gym/coach-leave/changes", Handler: staff(h.changes, leaveRead)},

		{Pattern: "GET /api/gym/my-classes/landing", Handler: staff(h.landing, portalRead)},
		{Pattern: "GET /api/gym/my-classes/leave", Handler: staff(h.portal, portalRead)},
		{Pattern: "GET /api/gym/my-classes/leave/impact", Handler: staff(h.impact, portalRead)},
		{Pattern: "GET /api/gym/my-classes/leave/covers/{id}/candidates", Handler: staff(h.coachCandidates, portalRead)},
		{Pattern: "POST /api/gym/my-classes/leave/covers/{id}/request", Handler: staff(h.requestSubstitute, portalUpdate)},
		{Pattern: "POST /api/gym/my-classes/leave/covers/{id}/respond", Handler: staff(h.respond, portalUpdate)},
	}
}

// ── Program Director ────────────────────────────────────────────────────────

func branchParam(r *http.Request) (string, error) {
	v := r.URL.Query().Get("branch_id")
	if v != "" && !validate.IsUUID(v) {
		return "", httpx.BadRequest("Cabang tidak valid")
	}
	return v, nil
}

func (h *handler) queue(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	branch, err := branchParam(r)
	if err != nil {
		return err
	}
	list, err := h.svc.Queue(r.Context(), u.ID, branch)
	if err != nil {
		return err
	}
	return httpx.OK(w, list)
}

func (h *handler) directorCandidates(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	list, err := h.svc.Candidates(r.Context(), id, nil)
	if err != nil {
		return err
	}
	return httpx.OK(w, list)
}

type coachBody struct {
	CoachID string `json:"coach_id"`
}

func readCoach(r *http.Request) (string, error) {
	var body coachBody
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return "", err
	}
	if !validate.IsUUID(body.CoachID) {
		return "", httpx.BadRequest("Pilih coach pengganti")
	}
	return body.CoachID, nil
}

func (h *handler) assign(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	coachID, err := readCoach(r)
	if err != nil {
		return err
	}
	c, err := h.svc.AssignSubstitute(r.Context(), id, u.ID, coachID)
	if err != nil {
		return err
	}
	return httpx.OK(w, c)
}

func (h *handler) cancelSession(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	reason := strings.TrimSpace(body.Reason)
	if len([]rune(reason)) < 5 {
		return httpx.BadRequest("Alasan pembatalan minimal 5 karakter")
	}
	c, err := h.svc.CancelSession(r.Context(), id, u.ID, reason)
	if err != nil {
		return err
	}
	return httpx.OK(w, c)
}

func (h *handler) settings(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	st, err := h.svc.Settings(r.Context())
	if err != nil {
		return err
	}
	users, err := h.svc.StaffUsers(r.Context())
	if err != nil {
		return err
	}
	return httpx.OK(w, map[string]any{"settings": st, "users": users, "leave_type_labels": domain.LeaveTypeLabel,
		"incident_labels": domain.IncidentLabel})
}

func (h *handler) saveSettings(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var in Settings
	if err := httpx.DecodeJSON(r, &in); err != nil {
		return err
	}
	if in.BackupApproverUserID != nil && *in.BackupApproverUserID != "" && !validate.IsUUID(*in.BackupApproverUserID) {
		return httpx.BadRequest("Approver cadangan tidak valid")
	}
	st, err := h.svc.SaveSettings(r.Context(), u.ID, in)
	if err != nil {
		return err
	}
	return httpx.OK(w, st)
}

func (h *handler) blackouts(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	list, err := h.svc.Blackouts(r.Context())
	if err != nil {
		return err
	}
	return httpx.OK(w, list)
}

func (h *handler) addBlackout(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var in domain.Blackout
	if err := httpx.DecodeJSON(r, &in); err != nil {
		return err
	}
	if in.BranchID != nil && *in.BranchID == "" {
		in.BranchID = nil
	}
	if in.BranchID != nil && !validate.IsUUID(*in.BranchID) {
		return httpx.BadRequest("Cabang tidak valid")
	}
	id, err := h.svc.AddBlackout(r.Context(), u.ID, in)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, map[string]string{"id": id})
}

func (h *handler) deleteBlackout(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteBlackout(r.Context(), id); err != nil {
		return err
	}
	return httpx.OK(w, map[string]string{"id": id})
}

func (h *handler) incidents(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	q := r.URL.Query()
	f := IncidentFilter{CoachID: q.Get("coach_id"), From: q.Get("from"), To: q.Get("to")}
	if (f.CoachID != "" && !validate.IsUUID(f.CoachID)) || (f.From != "" && !domain.ValidDate(f.From)) || (f.To != "" && !domain.ValidDate(f.To)) {
		return httpx.BadRequest("Filter tidak valid")
	}
	list, err := h.svc.Incidents(r.Context(), f)
	if err != nil {
		return err
	}
	return httpx.OK(w, list)
}

func (h *handler) recordIncident(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var in NewIncident
	if err := httpx.DecodeJSON(r, &in); err != nil {
		return err
	}
	if !validate.IsUUID(in.CoachID) || (in.SessionID != nil && !validate.IsUUID(*in.SessionID)) {
		return httpx.BadRequest("Coach atau sesi tidak valid")
	}
	inc, err := h.svc.RecordIncident(r.Context(), u.ID, in)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, inc)
}

type reasonBody struct {
	Reason string `json:"reason"`
}

func (h *handler) voidIncident(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	var body reasonBody
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	inc, err := h.svc.VoidIncident(r.Context(), id, u.ID, body.Reason)
	if err != nil {
		return err
	}
	return httpx.OK(w, inc)
}

func (h *handler) warnings(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	list, err := h.svc.Warnings(r.Context())
	if err != nil {
		return err
	}
	return httpx.OK(w, list)
}

func (h *handler) decideWarning(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	var body struct {
		Action string `json:"action"`
		Note   string `json:"note"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	if body.Action != "issue" && body.Action != "dismiss" {
		return httpx.BadRequest("Aksi harus issue atau dismiss")
	}
	if err := h.svc.DecideWarning(r.Context(), id, u.ID, body.Action == "issue", body.Note); err != nil {
		return err
	}
	return httpx.OK(w, map[string]string{"id": id, "action": body.Action})
}

// changes reads ?from and ?to as days in Jakarta (default the last 30 days).
func (h *handler) changes(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	q := r.URL.Query()
	branch, err := branchParam(r)
	if err != nil {
		return err
	}
	today := localtime.DayKey(h.svc.now(), localtime.Jakarta)
	fromDay, toDay := q.Get("from"), q.Get("to")
	if fromDay == "" {
		fromDay = domain.AddDays(today, -30)
	}
	if toDay == "" {
		toDay = today
	}
	from, errFrom := localtime.ParseDay(fromDay, localtime.Jakarta)
	to, errTo := localtime.ParseDay(toDay, localtime.Jakarta)
	if errFrom != nil || errTo != nil || to.Before(from) || to.Sub(from) > 366*24*time.Hour {
		return httpx.BadRequest("Rentang tanggal tidak valid")
	}
	out, err := h.svc.Changes(r.Context(), from, to.AddDate(0, 0, 1), branch)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

// ── Coach portal ────────────────────────────────────────────────────────────

func (h *handler) landing(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	coach, err := h.svc.CoachForUser(r.Context(), u.ID)
	if err != nil {
		return err
	}
	menus, err := h.guard.GrantedMenuCodes(r.Context(), u.ID, u.Role)
	if err != nil {
		return err
	}
	return httpx.OK(w, map[string]bool{"coach": coach != nil, "coach_only": CoachOnly(coach != nil, menus)})
}

func (h *handler) portal(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	out, err := h.svc.Portal(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

// myCoach is the coach linked to the caller, or 403.
func (h *handler) myCoach(r *http.Request, u *auth.User) (*Coach, error) {
	c, err := h.svc.CoachForUser(r.Context(), u.ID)
	if err == nil && c == nil {
		err = httpx.Forbidden("Akun ini belum terhubung ke coach")
	}
	return c, err
}

func (h *handler) impact(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	coach, err := h.myCoach(r, u)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	out, err := h.svc.Impact(r.Context(), coach, q.Get("from"), q.Get("to"), q.Get("leave_type"))
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) coachCandidates(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	coach, err := h.myCoach(r, u)
	if err != nil {
		return err
	}
	list, err := h.svc.Candidates(r.Context(), id, &coach.ID)
	if err != nil {
		return err
	}
	return httpx.OK(w, list)
}

func (h *handler) requestSubstitute(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	coach, err := h.myCoach(r, u)
	if err != nil {
		return err
	}
	substitute, err := readCoach(r)
	if err != nil {
		return err
	}
	c, err := h.svc.RequestSubstitute(r.Context(), id, coach.ID, substitute)
	if err != nil {
		return err
	}
	return httpx.OK(w, c)
}

func (h *handler) respond(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	coach, err := h.myCoach(r, u)
	if err != nil {
		return err
	}
	var body struct {
		Accept *bool `json:"accept"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	if body.Accept == nil {
		return httpx.BadRequest("accept wajib diisi")
	}
	c, err := h.svc.RespondToRequest(r.Context(), id, coach.ID, *body.Accept)
	if err != nil {
		return err
	}
	return httpx.OK(w, c)
}
