package gymscheduling

import (
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
)

// Guard is the slice of platform/auth the handlers use; tests swap it.
type Guard interface {
	RequireMenuPrefix(r *http.Request, prefixes ...string) (*auth.User, error)
	RequireMember(r *http.Request) (string, error)
}

type handler struct {
	svc   *Service
	guard Guard
	log   *slog.Logger
}

// Routes lists the staff (/api/gym/**) and member portal routes.
func (h *handler) Routes() []module.Route {
	sched, checkin := iam.GymScheduling, iam.GymCheckin
	return []module.Route{
		{Pattern: "GET /api/gym/class-types", Handler: h.staff(sched, h.listClassTypes)},
		{Pattern: "POST /api/gym/class-types", Handler: h.staff(sched, h.createClassType)},
		{Pattern: "PATCH /api/gym/class-types/{id}", Handler: h.staff(sched, h.updateClassType)},
		{Pattern: "DELETE /api/gym/class-types/{id}", Handler: h.staff(sched, h.archiveClassType)},
		{Pattern: "GET /api/gym/coaches", Handler: h.staff(sched, h.listCoaches)},
		{Pattern: "POST /api/gym/coaches", Handler: h.staff(sched, h.createCoach)},
		{Pattern: "PATCH /api/gym/coaches/{id}", Handler: h.staff(sched, h.updateCoach)},
		{Pattern: "GET /api/gym/sessions", Handler: h.staff(sched, h.listSessions)},
		{Pattern: "POST /api/gym/sessions", Handler: h.staff(sched, h.createSession)},
		{Pattern: "POST /api/gym/sessions/duplicate-week", Handler: h.staff(sched, h.duplicateWeek)},
		{Pattern: "GET /api/gym/sessions/{id}", Handler: h.staff(sched, h.getSession)},
		{Pattern: "PATCH /api/gym/sessions/{id}", Handler: h.staff(sched, h.updateSession)},
		{Pattern: "POST /api/gym/sessions/{id}", Handler: h.staff(sched, h.sessionAction)},
		{Pattern: "DELETE /api/gym/sessions/{id}", Handler: h.staff(sched, h.deleteSession)},
		{Pattern: "GET /api/gym/bookings", Handler: h.staff(sched, h.listBookings)},
		{Pattern: "POST /api/gym/bookings", Handler: h.staff(sched, h.staffBook)},
		{Pattern: "GET /api/gym/bookings/members", Handler: h.staff(sched, h.searchMembers)},
		{Pattern: "POST /api/gym/bookings/{id}", Handler: h.staff(sched, h.bookingAction)},
		{Pattern: "GET /api/gym/checkin", Handler: h.staff(checkin, h.accessLog)},
		{Pattern: "POST /api/gym/checkin", Handler: h.staff(checkin, h.scan)},

		{Pattern: "GET /api/member-portal/gym/sessions", Handler: h.member("Gagal memuat jadwal kelas", h.memberSessions)},
		{Pattern: "GET /api/member-portal/gym/sessions/{id}", Handler: h.member("Gagal memuat kelas", h.memberSession)},
		{Pattern: "GET /api/member-portal/gym/bookings", Handler: h.member("Gagal memuat kelas saya", h.memberBookings)},
		{Pattern: "POST /api/member-portal/gym/bookings", Handler: h.member("Gagal booking kelas", h.memberBook)},
		{Pattern: "DELETE /api/member-portal/gym/bookings/{id}", Handler: h.member("Gagal membatalkan booking", h.memberCancel)},
		{Pattern: "POST /api/member-portal/gym/bookings/{id}", Handler: h.member("Gagal mengonfirmasi kursi", h.memberConfirmOffer)},
		{Pattern: "GET /api/member-portal/gym/coaches", Handler: h.member("Gagal memuat coach", h.memberCoaches)},
		{Pattern: "GET /api/member-portal/gym/coaches/{id}", Handler: h.member("Gagal memuat coach", h.memberCoach)},
		{Pattern: "GET /api/member-portal/app/classes/catalog", Handler: h.member("Gagal memuat katalog kelas", h.catalog)},
	}
}

type staffFunc func(w http.ResponseWriter, r *http.Request, user *auth.User) error

// staff guards a route by IAM menu prefix, like requireIamMenuPrefix inside apiHandler.
func (h *handler) staff(prefixes []string, fn staffFunc) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		user, err := h.guard.RequireMenuPrefix(r, prefixes...)
		if err != nil {
			return err
		}
		return fn(w, r, user)
	})
}

type envelope struct {
	Success bool `json:"success"`
	Data    any  `json:"data"`
}

// ok is `{ success: true, data }` (staff ok() and memberJson()).
func ok(w http.ResponseWriter, data any) error {
	return httpx.JSON(w, http.StatusOK, envelope{Success: true, Data: data})
}

// requireUUID is requireUuid: anything but a UUID is 400 "ID tidak valid".
func requireUUID(value string) (string, error) {
	if !isUUID(value) {
		return "", httpx.BadRequest("ID tidak valid")
	}
	return value, nil
}

// ── Query helpers (scheduling-route.ts) ──────────────────────────────────────

// rangeParams is [from, to) from the query string; a bare date is 00:00 WIB.
// Defaults: now, and from + defaultDays.
func rangeParams(query url.Values, now time.Time, defaultDays int) (time.Time, time.Time) {
	parse := func(key string) (time.Time, bool) {
		raw := query.Get(key)
		if raw == "" {
			return time.Time{}, false
		}
		if dateOnlyPattern.MatchString(raw) {
			return wibMidnight(raw)
		}
		return parseJSDate(raw)
	}
	from, ok := parse("from")
	if !ok {
		from = now
	}
	to, ok := parse("to")
	if !ok {
		to = from.Add(time.Duration(defaultDays) * 24 * time.Hour)
	}
	return from, to
}

func optionalUUID(query url.Values, key string) *string {
	if raw := query.Get(key); raw != "" && isUUID(raw) {
		return &raw
	}
	return nil
}

// ── Class types & coaches ───────────────────────────────────────────────────

var (
	classColors      = []string{"lime", "info", "warning", "danger", "success", "ink"}
	classTypeStatus  = []string{"active", "archived"}
	coachStatuses    = []string{"active", "inactive"}
	nullableOptional = rule{optional: true, nullable: true}
	optional         = rule{optional: true}
)

func ptr[T any](v T) *T { return &v }

// classTypeFields reads classTypeSchema; partial makes the required fields optional.
func classTypeFields(f *fields, partial bool) ClassTypePatch {
	req := rule{optional: partial}
	var p ClassTypePatch
	p.Name, _ = f.str("name", strOpts{rule: req, trim: true, min: 3, max: 80})
	p.Description, _ = f.str("description", strOpts{trim: true, max: 500, def: ptr("")})
	p.DefaultDurationMin = f.int("default_duration_min", intOpts{rule: req, min: 15, max: 240})
	p.DefaultCreditCost = f.int("default_credit_cost", intOpts{rule: req, min: 1, max: 20})
	p.DefaultCapacity = f.int("default_capacity", intOpts{rule: req, min: 1, max: 200})
	p.Color = f.enum("color", rule{}, "lime", classColors...)
	p.Status = f.enum("status", rule{}, "active", classTypeStatus...)
	return p
}

func deref[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}

func (h *handler) listClassTypes(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	rows, err := h.svc.ListClassTypes(r.Context())
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) createClassType(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	f := newFields(readBody(r))
	in := classTypeFields(f, false)
	if err := f.err(); err != nil {
		return err
	}
	id, err := h.svc.CreateClassType(r.Context(), ClassTypeInput{
		Name: *in.Name, Description: *in.Description, DefaultDurationMin: *in.DefaultDurationMin,
		DefaultCreditCost: *in.DefaultCreditCost, DefaultCapacity: *in.DefaultCapacity, Color: *in.Color, Status: *in.Status,
	})
	if err != nil {
		return err
	}
	return ok(w, object("id", id))
}

func (h *handler) updateClassType(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := requireUUID(r.PathValue("id"))
	if err != nil {
		return err
	}
	f := newFields(readBody(r))
	in := classTypeFields(f, true)
	if err := f.err(); err != nil {
		return err
	}
	if err := h.svc.UpdateClassType(r.Context(), id, in); err != nil {
		return err
	}
	return ok(w, object("id", id))
}

func (h *handler) archiveClassType(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := requireUUID(r.PathValue("id"))
	if err != nil {
		return err
	}
	if err := h.svc.ArchiveClassType(r.Context(), id); err != nil {
		return err
	}
	return ok(w, object("id", id))
}

// coachFields reads coachSchema; the bool results say whether photo_url and
// branch_id were sent.
func coachFields(f *fields, partial bool) (CoachInput, bool, bool) {
	name, _ := f.str("name", strOpts{rule: rule{optional: partial}, trim: true, min: 3, max: 80})
	bio, _ := f.str("bio", strOpts{trim: true, max: 1000, def: ptr("")})
	spec, _ := f.str("specialization", strOpts{trim: true, max: 120, def: ptr("")})
	photo, photoSent := f.str("photo_url", strOpts{rule: nullableOptional, trim: true, max: 500,
		check: func(s string) (string, string, bool) { return "invalid_format", "Invalid URL", validURL(s) }})
	userID := f.uuid("user_id", nullableOptional)
	_, branchSent := f.lookup("branch_id")
	branchID := f.uuid("branch_id", nullableOptional)
	status := f.enum("status", rule{}, "active", coachStatuses...)
	return CoachInput{
		Name: deref(name), Bio: deref(bio), Specialization: deref(spec),
		PhotoURL: photo, UserID: userID, BranchID: branchID, Status: deref(status),
	}, photoSent, branchSent
}

func (h *handler) listCoaches(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	rows, err := h.svc.ListCoaches(r.Context())
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) createCoach(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	f := newFields(readBody(r))
	in, _, _ := coachFields(f, false)
	if err := f.err(); err != nil {
		return err
	}
	id, err := h.svc.CreateCoach(r.Context(), in)
	if err != nil {
		return err
	}
	return ok(w, object("id", id))
}

func (h *handler) updateCoach(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := requireUUID(r.PathValue("id"))
	if err != nil {
		return err
	}
	f := newFields(readBody(r))
	in, photoSent, branchSent := coachFields(f, true)
	if err := f.err(); err != nil {
		return err
	}
	var name *string // absent in a partial body; when sent it has >= 3 characters
	if in.Name != "" {
		name = &in.Name
	}
	// bio, specialization and status always carry a value: zod's partial()
	// still applies their defaults, exactly as the TS route does.
	if err := h.svc.UpdateCoach(r.Context(), id, CoachPatch{
		Name: name, Bio: &in.Bio, Specialization: &in.Specialization, Status: &in.Status,
		PhotoURL: in.PhotoURL, BranchID: in.BranchID, PhotoURLSent: photoSent, BranchIDSent: branchSent,
	}); err != nil {
		return err
	}
	return ok(w, object("id", id))
}

// ── Sessions ────────────────────────────────────────────────────────────────

func (h *handler) listSessions(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	query := r.URL.Query()
	from, to := rangeParams(query, h.svc.now(), 7)
	var statuses []domain.SessionStatus
	for _, s := range strings.Split(query.Get("status"), ",") {
		if slices.Contains(domain.SessionStatuses, domain.SessionStatus(s)) {
			statuses = append(statuses, domain.SessionStatus(s))
		}
	}
	rows, err := h.svc.ListSessions(r.Context(), SessionFilter{
		From: &from, To: &to,
		ClassTypeID: optionalUUID(query, "class_type_id"),
		CoachID:     optionalUUID(query, "coach_id"),
		BranchID:    optionalUUID(query, "branch_id"),
		Statuses:    statuses,
	})
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) createSession(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	f := newFields(readBody(r))
	in := SessionInput{
		ClassTypeID: deref(f.uuid("class_type_id", rule{})),
		CoachID:     f.uuid("coach_id", nullableOptional),
		BranchID:    f.uuid("branch_id", nullableOptional),
	}
	in.Area, _ = f.str("area", strOpts{rule: nullableOptional, trim: true, max: 80})
	startsAt := f.datetime("starts_at", rule{})
	in.DurationMin = f.int("duration_min", intOpts{rule: nullableOptional, min: 15, max: 240})
	in.Capacity = f.int("capacity", intOpts{rule: nullableOptional, min: 1, max: 200})
	in.CreditCost = f.int("credit_cost", intOpts{rule: nullableOptional, min: 1, max: 20})
	in.Notes, _ = f.str("notes", strOpts{rule: nullableOptional, trim: true, max: 500})
	in.Publish = f.boolean("publish", true)
	if err := f.err(); err != nil {
		return err
	}
	in.StartsAt = *startsAt
	id, err := h.svc.CreateSession(r.Context(), in, &user.ID)
	if err != nil {
		return err
	}
	return ok(w, object("id", id))
}

func (h *handler) duplicateWeek(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	f := newFields(readBody(r))
	week := strOpts{check: func(s string) (string, string, bool) {
		return "invalid_format", `Invalid string: must match pattern /^\d{4}-\d{2}-\d{2}$/`, dateOnlyPattern.MatchString(s)
	}}
	source, _ := f.str("source_week", week)
	target, _ := f.str("target_week", week)
	publish := f.boolean("publish", false)
	if err := f.err(); err != nil {
		return err
	}
	out, err := h.svc.DuplicateWeek(r.Context(), *source, *target, publish, &user.ID)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h *handler) getSession(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := requireUUID(r.PathValue("id"))
	if err != nil {
		return err
	}
	session, err := h.svc.GetSession(r.Context(), id, nil)
	if err != nil {
		return err
	}
	if session == nil {
		return httpx.NotFound("Sesi tidak ditemukan")
	}
	roster, err := h.svc.Roster(r.Context(), id)
	if err != nil {
		return err
	}
	return ok(w, object("session", session, "roster", roster))
}

func optionalField(f *fields, key string, value *string) Optional[string] {
	_, sent := f.lookup(key)
	return Optional[string]{Set: sent, Value: value}
}

func (h *handler) updateSession(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := requireUUID(r.PathValue("id"))
	if err != nil {
		return err
	}
	f := newFields(readBody(r))
	var patch SessionPatch
	patch.CoachID = optionalField(f, "coach_id", f.uuid("coach_id", nullableOptional))
	area, _ := f.str("area", strOpts{rule: nullableOptional, trim: true, max: 80})
	patch.Area = optionalField(f, "area", area)
	patch.StartsAt = f.datetime("starts_at", optional)
	patch.DurationMin = f.int("duration_min", intOpts{rule: optional, min: 15, max: 240})
	patch.Capacity = f.int("capacity", intOpts{rule: optional, min: 1, max: 200})
	notes, _ := f.str("notes", strOpts{rule: nullableOptional, trim: true, max: 500})
	patch.Notes = optionalField(f, "notes", notes)
	if err := f.err(); err != nil {
		return err
	}
	if err := h.svc.UpdateSession(r.Context(), id, patch); err != nil {
		return err
	}
	return ok(w, object("id", id))
}

func (h *handler) sessionAction(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := requireUUID(r.PathValue("id"))
	if err != nil {
		return err
	}
	f := newFields(readBody(r))
	action := f.enum("action", rule{}, "", "publish", "cancel", "complete")
	if err := f.err(); err != nil {
		return err
	}
	out, err := h.svc.SessionAction(r.Context(), id, *action)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h *handler) deleteSession(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := requireUUID(r.PathValue("id"))
	if err != nil {
		return err
	}
	if err := h.svc.DeleteSession(r.Context(), id); err != nil {
		return err
	}
	return ok(w, object("id", id))
}

// ── Bookings & check-in ─────────────────────────────────────────────────────

func (h *handler) listBookings(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	query := r.URL.Query()
	from, to := rangeParams(query, h.svc.now(), 14)
	filter := BookingListFilter{From: from, To: to, SessionID: optionalUUID(query, "session_id")}
	if s := query.Get("status"); slices.Contains(domain.BookingStatuses, domain.BookingStatus(s)) {
		filter.Status = &s
	}
	if q := strings.TrimSpace(query.Get("q")); q != "" {
		filter.Q = &q
	}
	rows, err := h.svc.ListBookings(r.Context(), filter)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) staffBook(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	f := newFields(readBody(r))
	sessionID := f.uuid("session_id", rule{})
	customerID := f.uuid("customer_id", rule{})
	if err := f.err(); err != nil {
		return err
	}
	out, err := h.svc.BookSession(r.Context(), *customerID, *sessionID, "admin")
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h *handler) searchMembers(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	hits, err := h.svc.SearchBookableMembers(r.Context(), strings.TrimSpace(r.URL.Query().Get("q")))
	if err != nil {
		return err
	}
	return ok(w, hits)
}

func (h *handler) bookingAction(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	id, err := requireUUID(r.PathValue("id"))
	if err != nil {
		return err
	}
	f := newFields(readBody(r))
	action := f.enum("action", rule{}, "", "cancel", "no_show", "check_in")
	if err := f.err(); err != nil {
		return err
	}
	var out any
	switch *action {
	case "cancel":
		out, err = h.svc.CancelBooking(r.Context(), id, "")
	case "no_show":
		out, err = h.svc.MarkNoShow(r.Context(), id)
	default:
		out, err = h.svc.CheckInManually(r.Context(), id, &user.ID)
	}
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h *handler) accessLog(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	out, err := h.svc.AccessLog(r.Context())
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h *handler) scan(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	f := newFields(readBody(r))
	token, _ := f.str("token", strOpts{trim: true, min: 8, max: 120})
	branchID := f.uuid("branch_id", nullableOptional)
	if err := f.err(); err != nil {
		return err
	}
	out, err := h.svc.ScanQr(r.Context(), *token, branchID, &user.ID)
	if err != nil {
		return err
	}
	return ok(w, out)
}

// ── Member portal ───────────────────────────────────────────────────────────

// errInvalidData is a zod parse failure in a member route: 400 "Data tidak valid".
var errInvalidData = errors.New("Data tidak valid")

type memberFunc func(w http.ResponseWriter, r *http.Request, customerID string) error

// member mirrors memberSchedulingRoute over withMemberSession: no session is
// 401, a business error keeps its status and message, a parse failure is 400
// "Data tidak valid", anything else is 500 with the route's own message.
func (h *handler) member(failMessage string, fn memberFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		customerID, err := h.guard.RequireMember(r)
		if err == nil {
			err = fn(w, r, customerID)
		}
		if err == nil {
			return
		}
		var appErr *httpx.Error
		switch {
		case errors.As(err, &appErr):
			_ = memberError(w, appErr.Message, appErr.Status)
		case errors.Is(err, errInvalidData):
			_ = memberError(w, "Data tidak valid", http.StatusBadRequest)
		default:
			h.log.ErrorContext(r.Context(), "[member-portal] "+failMessage, "error", err.Error(), "path", r.URL.Path)
			_ = memberError(w, failMessage, http.StatusInternalServerError)
		}
	})
}

func memberError(w http.ResponseWriter, msg string, status int) error {
	return httpx.JSON(w, status, struct {
		Success bool   `json:"success"`
		Error   string `json:"error"`
	}{false, msg})
}

// memberBody is `await request.json()` in a member route: a body that is not
// JSON throws, which withMemberSession turns into a 500.
var errBodyNotJSON = errors.New("member route: request body is not JSON")

func memberBody(r *http.Request) (map[string]any, error) {
	body, present := readBody(r)
	if !present {
		return nil, errBodyNotJSON
	}
	obj, isObj := body.(map[string]any)
	if !isObj {
		return nil, errInvalidData
	}
	return obj, nil
}

func (h *handler) memberSessions(w http.ResponseWriter, r *http.Request, customerID string) error {
	query := r.URL.Query()
	if date := query.Get("date"); date != "" {
		day, valid := wibMidnight(date)
		if !valid {
			// new Date("<bad>T00:00:00+07:00").toISOString() throws in TS.
			return errors.New("member sessions: invalid date " + date)
		}
		query.Set("from", date)
		query.Set("to", day.Add(24*time.Hour).UTC().Format("2006-01-02T15:04:05.000Z"))
	}
	from, to := rangeParams(query, h.svc.now(), 7)
	out, err := h.svc.MemberSessions(r.Context(), customerID, from, to,
		optionalUUID(query, "class_type_id"), optionalUUID(query, "coach_id"))
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h *handler) memberSession(w http.ResponseWriter, r *http.Request, customerID string) error {
	id := r.PathValue("id")
	if !isUUID(id) {
		return memberError(w, "ID kelas tidak valid", http.StatusBadRequest)
	}
	session, err := h.svc.MemberSession(r.Context(), customerID, id)
	if err != nil {
		return err
	}
	if session == nil {
		return memberError(w, "Kelas tidak ditemukan", http.StatusNotFound)
	}
	return ok(w, session)
}

func (h *handler) memberBookings(w http.ResponseWriter, r *http.Request, customerID string) error {
	rows, err := h.svc.MemberBookings(r.Context(), customerID, r.URL.Query().Get("scope") == "past")
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) memberBook(w http.ResponseWriter, r *http.Request, customerID string) error {
	body, err := memberBody(r)
	if err != nil {
		return err
	}
	sessionID, isStr := body["session_id"].(string)
	if !isStr || !isUUID(sessionID) {
		return errInvalidData
	}
	out, err := h.svc.BookSession(r.Context(), customerID, sessionID, "member")
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h *handler) memberCancel(w http.ResponseWriter, r *http.Request, customerID string) error {
	id := r.PathValue("id")
	if !isUUID(id) {
		return errInvalidData
	}
	out, err := h.svc.CancelBooking(r.Context(), id, customerID)
	if err != nil {
		return err
	}
	return ok(w, object("late", out.Late, "deadline", jsTime(out.Deadline), "penalty_credits", out.PenaltyCredits))
}

func (h *handler) memberConfirmOffer(w http.ResponseWriter, r *http.Request, customerID string) error {
	id := r.PathValue("id")
	if !isUUID(id) {
		return errInvalidData
	}
	body, err := memberBody(r)
	if err != nil {
		return err
	}
	if body["action"] != "confirm_offer" {
		return errInvalidData
	}
	if err := h.svc.ConfirmWaitlistOffer(r.Context(), id, customerID); err != nil {
		return err
	}
	return ok(w, object("id", id, "status", "confirmed"))
}

func (h *handler) memberCoaches(w http.ResponseWriter, r *http.Request, _ string) error {
	rows, err := h.svc.MemberCoaches(r.Context())
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) memberCoach(w http.ResponseWriter, r *http.Request, customerID string) error {
	id := r.PathValue("id")
	if !isUUID(id) {
		return memberError(w, "ID coach tidak valid", http.StatusBadRequest)
	}
	coach, err := h.svc.MemberCoach(r.Context(), customerID, id)
	if err != nil {
		return err
	}
	if coach == nil {
		return memberError(w, "Coach tidak ditemukan", http.StatusNotFound)
	}
	return ok(w, coach)
}

func (h *handler) catalog(w http.ResponseWriter, r *http.Request, _ string) error {
	out, err := h.svc.Catalog(r.Context())
	if err != nil {
		return err
	}
	return ok(w, out)
}
