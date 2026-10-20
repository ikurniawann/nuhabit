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
	"nuhabit/backend/internal/platform/ratelimit"
	"nuhabit/backend/internal/platform/validate"
)

// Guard is the slice of platform/auth the handlers use; tests swap it.
type Guard interface {
	RequireAnyGrant(r *http.Request, grants ...iam.Grant) (*auth.User, int, error)
	RequireMember(r *http.Request) (string, error)
}

type handler struct {
	svc   *Service
	guard Guard
	log   *slog.Logger
	// limiter caps the requests of each gate device.
	limiter *ratelimit.Limiter
}

// Menu actions. read_own on gym.sessions is the coach grant: only the
// sessions the caller coaches, with their roster and no-shows.
const (
	actRead    = "read"
	actReadOwn = "read_own"
	actCreate  = "create"
	actUpdate  = "update"
	actDelete  = "delete"
)

// can is one grant: action on a menu under any of the prefix groups.
func can(action string, groups ...[]string) iam.Grant {
	return iam.Grant{Action: action, Prefixes: slices.Concat(groups...)}
}

var (
	// planners manage sessions from the weekly calendar or the session list.
	planners = slices.Concat(iam.GymSchedule, iam.GymSessions)
	// desk staff book members in and check them in; GymCheckin covers gym.sessions too.
	desk     = slices.Concat(iam.GymBookings, iam.GymCheckin)
	ownClass = can(actReadOwn, iam.GymSessions)
)

// bookingActionGrants is what each roster action needs on top of seeing the booking.
var bookingActionGrants = map[string][]iam.Grant{
	"cancel":   {can(actUpdate, iam.GymBookings, iam.GymSessions)},
	"no_show":  {can(actUpdate, iam.GymBookings, iam.GymSessions), ownClass, myClassesAttendance},
	"check_in": {can(actCreate, iam.GymCheckin), can(actUpdate, iam.GymBookings), ownClass, myClassesAttendance},
	// Corrections refund credits, so coaches (read_own) cannot make them.
	string(domain.UndoCheckIn): {can(actUpdate, iam.GymBookings, iam.GymSessions)},
	string(domain.UndoNoShow):  {can(actUpdate, iam.GymBookings, iam.GymSessions)},
}

// Routes lists the staff (/api/gym/**) and member portal routes.
func (h *handler) Routes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/gym/branches", Handler: h.staff(h.branches, can(actRead, iam.Gym))},
		{Pattern: "GET /api/gym/class-types", Handler: h.staff(h.listClassTypes, can(actRead, iam.GymClassTypes, planners), ownClass)},
		{Pattern: "POST /api/gym/class-types", Handler: h.staff(h.createClassType, can(actCreate, iam.GymClassTypes))},
		{Pattern: "PATCH /api/gym/class-types/{id}", Handler: h.staff(h.updateClassType, can(actUpdate, iam.GymClassTypes))},
		{Pattern: "DELETE /api/gym/class-types/{id}", Handler: h.staff(h.archiveClassType, can(actDelete, iam.GymClassTypes))},
		{Pattern: "GET /api/gym/coaches", Handler: h.staff(h.listCoaches, can(actRead, iam.GymCoaches, planners))},
		{Pattern: "GET /api/gym/coaches/staff", Handler: h.staff(h.staffUsers, can(actCreate, iam.GymCoaches), can(actUpdate, iam.GymCoaches))},
		{Pattern: "POST /api/gym/coaches", Handler: h.staff(h.createCoach, can(actCreate, iam.GymCoaches))},
		{Pattern: "PATCH /api/gym/coaches/{id}", Handler: h.staff(h.updateCoach, can(actUpdate, iam.GymCoaches))},
		{Pattern: "POST /api/gym/coaches/photo", Handler: h.staff(h.uploadCoachPhoto, can(actCreate, iam.GymCoaches), can(actUpdate, iam.GymCoaches))},
		{Pattern: "GET /api/gym/coaches/{id}/schedule", Handler: h.staff(h.coachSchedule, can(actRead, iam.GymCoaches, planners))},
		{Pattern: "GET /api/gym/my-classes", Handler: h.staff(h.myClasses, myClassesRead, ownClass)},
		{Pattern: "GET /api/gym/my-classes/sessions/{id}", Handler: h.staff(h.mySession, myClassesRead, ownClass)},
		{Pattern: "GET /api/gym/sessions", Handler: h.scoped(h.listSessions, can(actRead, planners), ownClass)},
		{Pattern: "POST /api/gym/sessions", Handler: h.staff(h.createSession, can(actCreate, planners))},
		{Pattern: "POST /api/gym/sessions/duplicate-week", Handler: h.staff(h.duplicateWeek, can(actCreate, iam.GymSchedule))},
		{Pattern: "GET /api/gym/sessions/{id}", Handler: h.scoped(h.getSession, can(actRead, planners), ownClass)},
		{Pattern: "PATCH /api/gym/sessions/{id}", Handler: h.staff(h.updateSession, can(actUpdate, planners))},
		{Pattern: "POST /api/gym/sessions/{id}", Handler: h.staff(h.sessionAction, can(actUpdate, planners))},
		{Pattern: "DELETE /api/gym/sessions/{id}", Handler: h.staff(h.deleteSession, can(actDelete, planners))},
		{Pattern: "GET /api/gym/session-templates", Handler: h.staff(h.listTemplates, can(actRead, iam.GymSchedule))},
		{Pattern: "POST /api/gym/session-templates", Handler: h.staff(h.createTemplate, can(actCreate, iam.GymSchedule))},
		{Pattern: "POST /api/gym/session-templates/generate", Handler: h.staff(h.generateTemplates, can(actCreate, iam.GymSchedule))},
		{Pattern: "PATCH /api/gym/session-templates/{id}", Handler: h.staff(h.updateTemplate, can(actUpdate, iam.GymSchedule))},
		{Pattern: "DELETE /api/gym/session-templates/{id}", Handler: h.staff(h.deleteTemplate, can(actDelete, iam.GymSchedule))},
		{Pattern: "GET /api/gym/bookings", Handler: h.staff(h.listBookings, can(actRead, iam.GymBookings, iam.GymSessions))},
		{Pattern: "POST /api/gym/bookings", Handler: h.staff(h.staffBook, can(actCreate, desk))},
		{Pattern: "GET /api/gym/bookings/members", Handler: h.staff(h.searchMembers, can(actRead, desk))},
		{Pattern: "POST /api/gym/bookings/{id}", Handler: h.staff(h.bookingAction, can(actRead, desk), ownClass, myClassesAttendance)},
		{Pattern: "GET /api/gym/checkin", Handler: h.staff(h.accessLog, can(actRead, iam.GymCheckin))},
		{Pattern: "POST /api/gym/checkin", Handler: h.staff(h.scan, can(actCreate, iam.GymCheckin))},
		{Pattern: "GET /api/gym/checkin/members", Handler: h.staff(h.deskMembers, can(actRead, desk))},
		{Pattern: "POST /api/gym/checkin/members/{id}/waiver", Handler: h.staff(h.recordWaiver, can(actCreate, iam.GymCheckin), can(actUpdate, iam.GymMembers))},
		{Pattern: "GET /api/gym/open-gym-hours", Handler: h.staff(h.openGymHours, can(actRead, iam.GymRules, iam.GymCheckin))},
		{Pattern: "PUT /api/gym/open-gym-hours", Handler: h.staff(h.saveOpenGymHours, can(actUpdate, iam.GymRules))},
		{Pattern: "GET /api/gym/gate-devices", Handler: h.staff(h.listGateDevices, can(actRead, iam.GymGateDevices))},
		{Pattern: "POST /api/gym/gate-devices", Handler: h.staff(h.createGateDevice, can(actCreate, iam.GymGateDevices))},
		{Pattern: "POST /api/gym/gate-devices/{id}/rotate", Handler: h.staff(h.rotateGateDevice, can(actUpdate, iam.GymGateDevices))},
		{Pattern: "POST /api/gym/gate-devices/{id}/revoke", Handler: h.staff(h.revokeGateDevice, can(actDelete, iam.GymGateDevices))},

		// Gate devices authenticate with their key header, not a staff session.
		{Pattern: "POST /api/gym/gate/devices/scan", Handler: h.device(deviceScanLimit, h.deviceScan)},
		{Pattern: "POST /api/gym/gate/devices/heartbeat", Handler: h.device(deviceHeartbeatLimit, h.deviceHeartbeat)},

		{Pattern: "GET /api/member-portal/gym/sessions", Handler: h.member("Gagal memuat jadwal kelas", h.memberSessions)},
		{Pattern: "GET /api/member-portal/gym/sessions/{id}", Handler: h.member("Gagal memuat kelas", h.memberSession)},
		{Pattern: "GET /api/member-portal/gym/bookings", Handler: h.member("Gagal memuat kelas saya", h.memberBookings)},
		{Pattern: "POST /api/member-portal/gym/bookings", Handler: h.member("Gagal booking kelas", h.memberBook)},
		{Pattern: "DELETE /api/member-portal/gym/bookings/{id}", Handler: h.member("Gagal membatalkan booking", h.memberCancel)},
		{Pattern: "POST /api/member-portal/gym/bookings/{id}", Handler: h.member("Gagal mengonfirmasi kursi", h.memberConfirmOffer)},
		{Pattern: "GET /api/member-portal/gym/coaches", Handler: h.member("Gagal memuat coach", h.memberCoaches)},
		{Pattern: "GET /api/member-portal/gym/coaches/{id}", Handler: h.member("Gagal memuat coach", h.memberCoach)},
		{Pattern: "GET /api/member-portal/app/classes/catalog", Handler: h.member("Gagal memuat katalog kelas", h.catalog)},

		{Pattern: "GET /api/public/site/sessions", Handler: httpx.Handle(h.publicSessions)},
		{Pattern: "GET /api/public/site/coaches", Handler: httpx.Handle(h.publicCoaches)},
	}
}

type staffFunc func(w http.ResponseWriter, r *http.Request, user *auth.User) error

// staff guards a route by IAM menu action: any one of the grants passes.
func (h *handler) staff(fn staffFunc, grants ...iam.Grant) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		user, _, err := h.guard.RequireAnyGrant(r, grants...)
		if err != nil {
			return err
		}
		return fn(w, r, user)
	})
}

// scopedFunc gets the coach the caller is limited to; nil means every session.
type scopedFunc func(w http.ResponseWriter, r *http.Request, user *auth.User, coachID *string) error

// scoped is staff for the session reads: when only the read_own grant let
// the caller in, fn sees the sessions of the coach linked to the caller.
func (h *handler) scoped(fn scopedFunc, grants ...iam.Grant) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		user, matched, err := h.guard.RequireAnyGrant(r, grants...)
		if err != nil {
			return err
		}
		if grants[matched].Action != actReadOwn {
			return fn(w, r, user, nil)
		}
		coachID, err := h.svc.CoachForUser(r.Context(), user.ID)
		if err != nil {
			return err
		}
		return fn(w, r, user, &coachID)
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
	if !validate.IsUUID(value) {
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
		return validate.ParseJSDate(raw)
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
	if raw := query.Get(key); raw != "" && validate.IsUUID(raw) {
		return &raw
	}
	return nil
}

// ── Class types & coaches ───────────────────────────────────────────────────

var (
	classColors      = []string{"lime", "info", "warning", "danger", "success", "ink"}
	classTypeStatus  = []string{"active", "archived"}
	coachStatuses    = []string{"active", "inactive"}
	nullableOptional = validate.Rule{Optional: true, Nullable: true}
	optional         = validate.Rule{Optional: true}
)

func ptr[T any](v T) *T { return &v }

// Body validation is parseInput in staff-route.ts over the zod schemas of
// scheduling-schemas.ts: fields in schema order, and the first failing
// field names the 400 ("Data tidak valid: <field>").

func form(r *http.Request) *validate.Form { return validate.New(validate.ReadBody(r)) }

func invalid(f *validate.Form) error { return f.ErrAtPath("Data tidak valid") }

// sent reports whether the body carried key (null included).
func sent(f *validate.Form, key string) bool {
	_, ok := f.Fields()[key]
	return ok
}

// between is z.number().int().min(lo).max(hi).
func between(lo, hi float64) validate.NumOpts {
	return validate.NumOpts{Min: validate.Bound(lo), Max: validate.Bound(hi)}
}

// enumDefault is z.enum(options).default(def).
func enumDefault(f *validate.Form, key, def string, options []string) *string {
	if v := f.Enum(key, validate.Rule{HasDefault: true}, options); v != nil {
		return v
	}
	return &def
}

// datetime is z.string().datetime({ offset: true }) read as an instant.
func datetime(f *validate.Form, key string, r validate.Rule) *time.Time {
	s := f.Str(key, r, validate.StrOpts{Check: validate.DatetimeCheck})
	if s == nil {
		return nil
	}
	if _, _, ok := validate.DatetimeCheck(*s); !ok {
		return nil
	}
	t, ok := validate.ParseJSDate(*s)
	if !ok {
		return nil
	}
	return &t
}

// classTypeFields reads classTypeSchema; partial makes the required fields optional.
func classTypeFields(f *validate.Form, partial bool) ClassTypePatch {
	req := validate.Rule{Optional: partial}
	var p ClassTypePatch
	p.Name = f.Str("name", req, validate.StrOpts{Trim: true, Min: 3, Max: 80})
	p.Description = ptr(f.StrDefault("description", "", validate.StrOpts{Trim: true, Max: 500}))
	p.DefaultDurationMin = f.Int("default_duration_min", req, between(15, 240))
	p.DefaultCreditCost = f.Int("default_credit_cost", req, between(1, 20))
	p.DefaultCapacity = f.Int("default_capacity", req, between(1, 200))
	p.Color = enumDefault(f, "color", "lime", classColors)
	p.Status = enumDefault(f, "status", "active", classTypeStatus)
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
	f := form(r)
	in := classTypeFields(f, false)
	if err := invalid(f); err != nil {
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
	f := form(r)
	in := classTypeFields(f, true)
	if err := invalid(f); err != nil {
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
func coachFields(f *validate.Form, partial bool) (CoachInput, bool, bool) {
	name := f.Str("name", validate.Rule{Optional: partial}, validate.StrOpts{Trim: true, Min: 3, Max: 80})
	bio := f.StrDefault("bio", "", validate.StrOpts{Trim: true, Max: 1000})
	spec := f.StrDefault("specialization", "", validate.StrOpts{Trim: true, Max: 120})
	photo := f.Str("photo_url", nullableOptional, validate.StrOpts{Trim: true, Max: 500, Check: photoURLCheck})
	userID := f.UUID("user_id", nullableOptional)
	branchID := f.UUID("branch_id", nullableOptional)
	status := enumDefault(f, "status", "active", coachStatuses)
	return CoachInput{
		Name: deref(name), Bio: bio, Specialization: spec,
		PhotoURL: photo, UserID: userID, BranchID: branchID, Status: *status,
	}, sent(f, "photo_url"), sent(f, "branch_id")
}

func (h *handler) listCoaches(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	rows, err := h.svc.ListCoaches(r.Context())
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) createCoach(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	f := form(r)
	in, _, _ := coachFields(f, false)
	if err := invalid(f); err != nil {
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
	f := form(r)
	in, photoSent, branchSent := coachFields(f, true)
	if err := invalid(f); err != nil {
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
		UserID: in.UserID, UserIDSent: sent(f, "user_id"),
	}); err != nil {
		return err
	}
	return ok(w, object("id", id))
}

// ── Sessions ────────────────────────────────────────────────────────────────

func (h *handler) listSessions(w http.ResponseWriter, r *http.Request, _ *auth.User, ownCoach *string) error {
	query := r.URL.Query()
	from, to := rangeParams(query, h.svc.now(), 7)
	var statuses []domain.SessionStatus
	for _, s := range strings.Split(query.Get("status"), ",") {
		if slices.Contains(domain.SessionStatuses, domain.SessionStatus(s)) {
			statuses = append(statuses, domain.SessionStatus(s))
		}
	}
	coachID := optionalUUID(query, "coach_id")
	if ownCoach != nil {
		if *ownCoach == "" {
			return ok(w, []any{})
		}
		coachID = ownCoach
	}
	rows, err := h.svc.ListSessions(r.Context(), SessionFilter{
		From: &from, To: &to,
		ClassTypeID: optionalUUID(query, "class_type_id"),
		CoachID:     coachID,
		BranchID:    optionalUUID(query, "branch_id"),
		Statuses:    statuses,
	})
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) createSession(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	f := form(r)
	in := SessionInput{
		ClassTypeID: deref(f.UUID("class_type_id", validate.Rule{})),
		CoachID:     f.UUID("coach_id", nullableOptional),
		BranchID:    f.UUID("branch_id", nullableOptional),
	}
	in.Area = f.Str("area", nullableOptional, validate.StrOpts{Trim: true, Max: 80})
	startsAt := datetime(f, "starts_at", validate.Rule{})
	in.DurationMin = f.Int("duration_min", nullableOptional, between(15, 240))
	in.Capacity = f.Int("capacity", nullableOptional, between(1, 200))
	in.CreditCost = f.Int("credit_cost", nullableOptional, between(1, 20))
	in.Notes = f.Str("notes", nullableOptional, validate.StrOpts{Trim: true, Max: 500})
	in.Publish = f.BoolDefault("publish", true)
	if err := invalid(f); err != nil {
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
	f := form(r)
	week := validate.StrOpts{Check: func(s string) (string, string, bool) {
		return "invalid_format", `Invalid string: must match pattern /^\d{4}-\d{2}-\d{2}$/`, dateOnlyPattern.MatchString(s)
	}}
	source := f.Str("source_week", validate.Rule{}, week)
	target := f.Str("target_week", validate.Rule{}, week)
	publish := f.BoolDefault("publish", false)
	if err := invalid(f); err != nil {
		return err
	}
	out, err := h.svc.DuplicateWeek(r.Context(), *source, *target, publish, &user.ID)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h *handler) getSession(w http.ResponseWriter, r *http.Request, _ *auth.User, ownCoach *string) error {
	id, err := requireUUID(r.PathValue("id"))
	if err != nil {
		return err
	}
	session, err := h.svc.GetSession(r.Context(), id, nil)
	if err != nil {
		return err
	}
	if session == nil || (ownCoach != nil && (*ownCoach == "" || session.Str("coach_id") != *ownCoach)) {
		return httpx.NotFound("Sesi tidak ditemukan")
	}
	roster, err := h.svc.Roster(r.Context(), id)
	if err != nil {
		return err
	}
	return ok(w, object("session", session, "roster", roster))
}

func optionalField(f *validate.Form, key string, value *string) Optional[string] {
	return Optional[string]{Set: sent(f, key), Value: value}
}

func (h *handler) updateSession(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := requireUUID(r.PathValue("id"))
	if err != nil {
		return err
	}
	f := form(r)
	var patch SessionPatch
	patch.ClassTypeID = f.UUID("class_type_id", optional)
	patch.CoachID = optionalField(f, "coach_id", f.UUID("coach_id", nullableOptional))
	patch.Area = optionalField(f, "area", f.Str("area", nullableOptional, validate.StrOpts{Trim: true, Max: 80}))
	patch.StartsAt = datetime(f, "starts_at", optional)
	patch.DurationMin = f.Int("duration_min", optional, between(15, 240))
	patch.Capacity = f.Int("capacity", optional, between(1, 200))
	patch.CreditCost = f.Int("credit_cost", optional, between(1, 20))
	patch.Notes = optionalField(f, "notes", f.Str("notes", nullableOptional, validate.StrOpts{Trim: true, Max: 500}))
	if err := invalid(f); err != nil {
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
	f := form(r)
	action := f.Enum("action", validate.Rule{}, []string{"publish", "cancel", "complete"})
	if err := invalid(f); err != nil {
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
	f := form(r)
	sessionID := f.UUID("session_id", validate.Rule{})
	customerID := f.UUID("customer_id", validate.Rule{})
	// override_window books a walk-in or late arrival outside the booking window.
	overrideWindow := f.BoolDefault("override_window", false)
	if err := invalid(f); err != nil {
		return err
	}
	out, err := h.svc.StaffBookSession(r.Context(), *customerID, *sessionID, overrideWindow)
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
	f := form(r)
	action := f.Enum("action", validate.Rule{}, []string{"cancel", "no_show", "check_in", string(domain.UndoCheckIn), string(domain.UndoNoShow)})
	waivePenalty := f.BoolDefault("waive_penalty", false)
	// reason is required for the corrections (undo_check_in, undo_no_show).
	reason := f.Str("reason", nullableOptional, validate.StrOpts{Trim: true, Max: 500})
	if err := invalid(f); err != nil {
		return err
	}
	correction := domain.Correction(*action)
	correcting := correction == domain.UndoCheckIn || correction == domain.UndoNoShow
	if correcting && (reason == nil || len([]rune(*reason)) < 3) {
		return httpx.BadRequest("Alasan koreksi wajib diisi (minimal 3 karakter)")
	}
	grants := bookingActionGrants[*action]
	_, matched, err := h.guard.RequireAnyGrant(r, grants...)
	if err != nil {
		return err
	}
	if ownOnly(grants[matched]) {
		if err := h.svc.RequireOwnBooking(r.Context(), id, user.ID); err != nil {
			return err
		}
	}
	var out any
	switch *action {
	case "cancel":
		out, err = h.svc.CancelBooking(r.Context(), id, "", waivePenalty)
	case "no_show":
		out, err = h.svc.MarkNoShow(r.Context(), id)
	case string(domain.UndoCheckIn), string(domain.UndoNoShow):
		out, err = h.svc.CorrectBooking(r.Context(), id, correction, *reason, user, r)
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
	f := form(r)
	token := f.Str("token", validate.Rule{}, validate.StrOpts{Trim: true, Min: 8, Max: 120})
	branchID := f.UUID("branch_id", nullableOptional)
	if err := invalid(f); err != nil {
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
			code, _ := appErr.Details.(errorCode)
			_ = writeMemberError(w, appErr.Message, appErr.Status, code)
		case errors.Is(err, errInvalidData):
			_ = memberError(w, "Data tidak valid", http.StatusBadRequest)
		default:
			h.log.ErrorContext(r.Context(), "[member-portal] "+failMessage, "error", err.Error(), "path", r.URL.Path)
			_ = memberError(w, failMessage, http.StatusInternalServerError)
		}
	})
}

func memberError(w http.ResponseWriter, msg string, status int) error {
	return writeMemberError(w, msg, status, "")
}

// writeMemberError adds code when the failure has one the app reacts to
// (waiver_required links to the waiver screen).
func writeMemberError(w http.ResponseWriter, msg string, status int, code errorCode) error {
	return httpx.JSON(w, status, struct {
		Success bool      `json:"success"`
		Error   string    `json:"error"`
		Code    errorCode `json:"code,omitempty"`
	}{false, msg, code})
}

// memberBody is `await request.json()` in a member route: a body that is not
// JSON throws, which withMemberSession turns into a 500.
var errBodyNotJSON = errors.New("member route: request body is not JSON")

func memberBody(r *http.Request) (map[string]any, error) {
	body, present := validate.ReadBody(r)
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
	if !validate.IsUUID(id) {
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
	if !isStr || !validate.IsUUID(sessionID) {
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
	if !validate.IsUUID(id) {
		return errInvalidData
	}
	out, err := h.svc.CancelBooking(r.Context(), id, customerID, false)
	if err != nil {
		return err
	}
	return ok(w, object("late", out.Late, "deadline", jsTime(out.Deadline), "penalty_credits", out.PenaltyCredits, "pass_strike", out.PassStrike))
}

func (h *handler) memberConfirmOffer(w http.ResponseWriter, r *http.Request, customerID string) error {
	id := r.PathValue("id")
	if !validate.IsUUID(id) {
		return errInvalidData
	}
	body, err := memberBody(r)
	if err != nil {
		return err
	}
	switch body["action"] {
	case "confirm_offer":
		if err := h.svc.ConfirmWaitlistOffer(r.Context(), id, customerID); err != nil {
			return err
		}
		return ok(w, object("id", id, "status", "confirmed"))
	case "decline_offer":
		if err := h.svc.DeclineWaitlistOffer(r.Context(), id, customerID); err != nil {
			return err
		}
		return ok(w, object("id", id, "status", "cancelled"))
	}
	return errInvalidData
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
	if !validate.IsUUID(id) {
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
