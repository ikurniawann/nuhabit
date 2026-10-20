package gymcoaching

import (
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/gymcoaching/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
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
}

// Menu actions. read_own on gym.pt is the coach grant: only the sessions
// and availability of the coach linked to the caller.
const (
	actRead    = "read"
	actReadOwn = "read_own"
	actCreate  = "create"
	actUpdate  = "update"
	actDelete  = "delete"
)

func can(action string, groups ...[]string) iam.Grant {
	return iam.Grant{Action: action, Prefixes: slices.Concat(groups...)}
}

var (
	ptRead   = can(actRead, iam.GymPt)
	ptOwn    = can(actReadOwn, iam.GymPt)
	ptCreate = can(actCreate, iam.GymPt)
	ptUpdate = can(actUpdate, iam.GymPt)
	// ptAny is anyone working with PT: the desk, coaches and managers.
	ptAny = []iam.Grant{ptRead, ptOwn, ptCreate}
)

// Routes lists the staff (/api/gym/**) and member portal routes.
func (h *handler) Routes() []module.Route {
	assess := iam.GymAssessments
	return []module.Route{
		{Pattern: "GET /api/gym/pt/class-types", Handler: h.staff(h.classTypes, ptAny...)},
		{Pattern: "GET /api/gym/pt/class-type-flags", Handler: h.staff(h.classTypeFlags, can(actUpdate, iam.GymClassTypes))},
		{Pattern: "PATCH /api/gym/pt/class-type-flags/{id}", Handler: h.staff(h.setPersonal, can(actUpdate, iam.GymClassTypes))},
		{Pattern: "GET /api/gym/pt/coaches", Handler: h.scoped(h.coaches, ptAny...)},
		{Pattern: "GET /api/gym/pt/members", Handler: h.staff(h.searchMembers, ptRead, ptOwn, ptCreate, can(actRead, assess), can(actCreate, assess))},
		{Pattern: "GET /api/gym/pt/availability/{coachId}", Handler: h.scoped(h.availability, ptAny...)},
		{Pattern: "PUT /api/gym/pt/availability/{coachId}", Handler: h.scoped(h.setWeekly, ptUpdate)},
		{Pattern: "POST /api/gym/pt/availability/{coachId}/exceptions", Handler: h.scoped(h.addException, ptUpdate)},
		{Pattern: "DELETE /api/gym/pt/availability/exceptions/{id}", Handler: h.scoped(h.deleteException, ptUpdate)},
		{Pattern: "GET /api/gym/pt/slots", Handler: h.scoped(h.staffSlots, ptAny...)},
		{Pattern: "GET /api/gym/pt/appointments", Handler: h.scoped(h.listAppointments, ptRead, ptOwn)},
		{Pattern: "POST /api/gym/pt/appointments", Handler: h.scoped(h.book, ptCreate, ptUpdate)},
		{Pattern: "GET /api/gym/pt/appointments/{id}", Handler: h.scoped(h.getAppointment, ptRead, ptOwn)},
		{Pattern: "POST /api/gym/pt/appointments/{id}", Handler: h.scoped(h.appointmentAction, ptUpdate)},
		{Pattern: "POST /api/gym/pt/participants/{id}", Handler: h.scoped(h.participantAction, ptUpdate)},

		{Pattern: "GET /api/gym/assessments", Handler: h.staff(h.listAssessments, can(actRead, assess))},
		{Pattern: "POST /api/gym/assessments", Handler: h.staff(h.createAssessment, can(actCreate, assess))},
		{Pattern: "GET /api/gym/assessments/{id}", Handler: h.staff(h.getAssessment, can(actRead, assess))},
		{Pattern: "PUT /api/gym/assessments/{id}", Handler: h.staff(h.updateAssessment, can(actUpdate, assess))},
		{Pattern: "DELETE /api/gym/assessments/{id}", Handler: h.staff(h.deleteAssessment, can(actDelete, assess))},

		{Pattern: "GET /api/member-portal/gym/pt/options", Handler: h.member(h.memberOptions)},
		{Pattern: "GET /api/member-portal/gym/pt/slots", Handler: h.member(h.memberSlots)},
		{Pattern: "GET /api/member-portal/gym/pt/appointments", Handler: h.member(h.memberSessions)},
		{Pattern: "POST /api/member-portal/gym/pt/appointments", Handler: h.member(h.memberRequest)},
		{Pattern: "DELETE /api/member-portal/gym/pt/appointments/{id}", Handler: h.member(h.memberCancel)},
		{Pattern: "GET /api/member-portal/gym/assessments", Handler: h.member(h.memberAssessments)},
	}
}

type staffFunc func(w http.ResponseWriter, r *http.Request, user *auth.User) error

// staff passes the caller holding any of grants.
func (h *handler) staff(fn staffFunc, grants ...iam.Grant) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		user, _, err := h.guard.RequireAnyGrant(r, grants...)
		if err != nil {
			return err
		}
		return fn(w, r, user)
	})
}

// scope is the caller of a PT route. A coach (read_own without read on
// gym.pt) is limited to Coach, the coach linked to their account.
type scope struct {
	user  *auth.User
	coach *string
}

// allows reports whether the caller may act on coachID's sessions.
func (sc scope) allows(coachID string) bool { return sc.coach == nil || *sc.coach == coachID }

func (sc scope) require(coachID string) error {
	if sc.allows(coachID) {
		return nil
	}
	return httpx.NotFound("Sesi PT tidak ditemukan")
}

type scopedFunc func(w http.ResponseWriter, r *http.Request, sc scope) error

// scoped is staff for PT routes. Unless read on gym.pt let the caller in,
// a second check tells a full grant (read) from a coach (read_own): the
// coach is limited to their own sessions and availability.
func (h *handler) scoped(fn scopedFunc, grants ...iam.Grant) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		user, matched, err := h.guard.RequireAnyGrant(r, grants...)
		if err != nil {
			return err
		}
		sc := scope{user: user}
		if grants[matched].Action == actRead {
			return fn(w, r, sc)
		}
		_, view, err := h.guard.RequireAnyGrant(r, ptRead, ptOwn)
		if err != nil {
			return err
		}
		if view == 1 {
			coachID, err := h.svc.CoachForUser(r.Context(), user.ID)
			if err != nil {
				return err
			}
			if coachID == "" {
				return httpx.Forbidden("Akun ini belum terhubung ke coach")
			}
			sc.coach = &coachID
		}
		return fn(w, r, sc)
	})
}

type memberFunc func(w http.ResponseWriter, r *http.Request, customerID string) error

func (h *handler) member(fn memberFunc) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		customerID, err := h.guard.RequireMember(r)
		if err != nil {
			return err
		}
		return fn(w, r, customerID)
	})
}

func ok(w http.ResponseWriter, data any) error { return httpx.Data(w, http.StatusOK, data) }

func created(w http.ResponseWriter, id string) error {
	return httpx.Data(w, http.StatusCreated, map[string]string{"id": id})
}

func pathUUID(r *http.Request, key string) (string, error) {
	id := r.PathValue(key)
	if !validate.IsUUID(id) {
		return "", httpx.BadRequest("ID tidak valid")
	}
	return id, nil
}

func queryUUID(q url.Values, key string) (string, error) {
	v := q.Get(key)
	if v != "" && !validate.IsUUID(v) {
		return "", httpx.BadRequest("ID tidak valid")
	}
	return v, nil
}

func parseInstant(raw string) (time.Time, error) {
	t, ok := validate.ParseJSDate(raw)
	if !ok {
		return t, httpx.BadRequest("Waktu tidak valid")
	}
	return t, nil
}

// ── Class types, coaches, members ───────────────────────────────────────────

func (h *handler) classTypes(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	list, err := h.svc.PersonalTypes(r.Context())
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *handler) classTypeFlags(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	list, err := h.svc.ClassTypeFlags(r.Context())
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *handler) setPersonal(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	var body struct {
		IsPersonal *bool `json:"is_personal"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	if body.IsPersonal == nil {
		return httpx.BadRequest("is_personal wajib diisi")
	}
	if err := h.svc.SetPersonal(r.Context(), id, *body.IsPersonal); err != nil {
		return err
	}
	return ok(w, map[string]bool{"is_personal": *body.IsPersonal})
}

// coaches lists PT coaches; a coach sees only themself. all=1 lists every
// active coach, for the availability editor of a coach without hours yet.
func (h *handler) coaches(w http.ResponseWriter, r *http.Request, sc scope) error {
	list, err := h.svc.PTCoaches(r.Context(), r.URL.Query().Get("all") == "1")
	if err != nil {
		return err
	}
	if sc.coach != nil {
		list = slices.DeleteFunc(list, func(c PTCoach) bool { return c.ID != *sc.coach })
	}
	return ok(w, list)
}

func (h *handler) searchMembers(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	q := r.URL.Query()
	term := strings.TrimSpace(q.Get("q"))
	if len([]rune(term)) < 2 {
		return ok(w, []MemberHit{})
	}
	classType, err := queryUUID(q, "class_type_id")
	if err != nil {
		return err
	}
	hits, err := h.svc.SearchMembers(r.Context(), term, classType)
	if err != nil {
		return err
	}
	return ok(w, hits)
}

// ── Availability ────────────────────────────────────────────────────────────

func (h *handler) coachParam(r *http.Request, sc scope) (string, error) {
	id, err := pathUUID(r, "coachId")
	if err == nil && !sc.allows(id) {
		err = httpx.NotFound("Coach tidak ditemukan")
	}
	return id, err
}

func (h *handler) availability(w http.ResponseWriter, r *http.Request, sc scope) error {
	coachID, err := h.coachParam(r, sc)
	if err != nil {
		return err
	}
	a, err := h.svc.Availability(r.Context(), coachID)
	if err != nil {
		return err
	}
	return ok(w, a)
}

func (h *handler) setWeekly(w http.ResponseWriter, r *http.Request, sc scope) error {
	coachID, err := h.coachParam(r, sc)
	if err != nil {
		return err
	}
	var body struct {
		Weekly []Window `json:"weekly"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	if len(body.Weekly) > 50 {
		return httpx.BadRequest("Terlalu banyak jendela waktu")
	}
	if err := h.svc.SetWeekly(r.Context(), coachID, body.Weekly); err != nil {
		return err
	}
	a, err := h.svc.Availability(r.Context(), coachID)
	if err != nil {
		return err
	}
	return ok(w, a)
}

func (h *handler) addException(w http.ResponseWriter, r *http.Request, sc scope) error {
	coachID, err := h.coachParam(r, sc)
	if err != nil {
		return err
	}
	var body struct {
		Date      string  `json:"date"`
		Kind      string  `json:"kind"`
		StartTime *string `json:"start_time"`
		EndTime   *string `json:"end_time"`
		Note      string  `json:"note"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	if len([]rune(body.Note)) > 200 {
		return httpx.BadRequest("Catatan terlalu panjang")
	}
	deref := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	id, err := h.svc.AddException(r.Context(), coachID, sc.user.ID, NewException{
		Date: body.Date, Kind: domain.ExceptionKind(body.Kind),
		StartTime: deref(body.StartTime), EndTime: deref(body.EndTime), Note: strings.TrimSpace(body.Note),
	})
	if err != nil {
		return err
	}
	return created(w, id)
}

func (h *handler) deleteException(w http.ResponseWriter, r *http.Request, sc scope) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	coachID, err := h.svc.ExceptionCoach(r.Context(), id)
	if err != nil {
		return err
	}
	if coachID == "" || !sc.allows(coachID) {
		return httpx.NotFound("Pengecualian tidak ditemukan")
	}
	if err := h.svc.DeleteException(r.Context(), id); err != nil {
		return err
	}
	return ok(w, map[string]string{"id": id})
}

// slots lists free slots for the query coach_id, class_type_id, from
// (YYYY-MM-DD, default today WIB) and days, starting no earlier than earliest.
func (h *handler) slots(w http.ResponseWriter, r *http.Request, earliest time.Time, allows func(string) bool) error {
	q := r.URL.Query()
	coachID, err := queryUUID(q, "coach_id")
	if err != nil {
		return err
	}
	classType, err := queryUUID(q, "class_type_id")
	if err != nil {
		return err
	}
	if coachID == "" || classType == "" {
		return httpx.BadRequest("coach_id dan class_type_id wajib diisi")
	}
	if !allows(coachID) {
		return httpx.NotFound("Coach tidak ditemukan")
	}
	from := q.Get("from")
	if from == "" {
		from = h.svc.todayWib()
	}
	days, err := strconv.Atoi(q.Get("days"))
	if err != nil {
		days = 7
	}
	list, err := h.svc.Slots(r.Context(), coachID, classType, from, days, earliest)
	if err != nil {
		return err
	}
	return ok(w, list)
}

// staffSlots lists free slots from now: staff book inside the free
// cancellation window too.
func (h *handler) staffSlots(w http.ResponseWriter, r *http.Request, sc scope) error {
	return h.slots(w, r, h.svc.now(), sc.allows)
}

// ── Appointments ────────────────────────────────────────────────────────────

const maxListDays = 62

func (h *handler) listAppointments(w http.ResponseWriter, r *http.Request, sc scope) error {
	q := r.URL.Query()
	from, to := h.svc.now().Add(-24*time.Hour), time.Time{}
	var err error
	if raw := q.Get("from"); raw != "" {
		if from, err = parseInstant(raw); err != nil {
			return err
		}
	}
	if raw := q.Get("to"); raw != "" {
		if to, err = parseInstant(raw); err != nil {
			return err
		}
	} else {
		to = from.AddDate(0, 0, 14)
	}
	if !to.After(from) || to.Sub(from) > maxListDays*24*time.Hour {
		return httpx.BadRequest("Rentang tanggal tidak valid")
	}
	f := Filter{From: from, To: to, Status: domain.Status(q.Get("status"))}
	if f.CoachID, err = queryUUID(q, "coach_id"); err != nil {
		return err
	}
	if f.CustomerID, err = queryUUID(q, "customer_id"); err != nil {
		return err
	}
	if sc.coach != nil {
		f.CoachID = *sc.coach
	}
	list, err := h.svc.Appointments(r.Context(), f)
	if err != nil {
		return err
	}
	return ok(w, list)
}

// scopedAppointment reads an appointment the caller may see.
func (h *handler) scopedAppointment(r *http.Request, sc scope, id string) (*Appointment, error) {
	a, err := h.svc.Appointment(r.Context(), id)
	if err != nil {
		return nil, err
	}
	if a == nil {
		return nil, httpx.NotFound("Sesi PT tidak ditemukan")
	}
	return a, sc.require(a.CoachID)
}

func (h *handler) getAppointment(w http.ResponseWriter, r *http.Request, sc scope) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	a, err := h.scopedAppointment(r, sc, id)
	if err != nil {
		return err
	}
	return ok(w, a)
}

func (h *handler) book(w http.ResponseWriter, r *http.Request, sc scope) error {
	var body struct {
		CoachID     string   `json:"coach_id"`
		ClassTypeID string   `json:"class_type_id"`
		BranchID    *string  `json:"branch_id"`
		StartsAt    string   `json:"starts_at"`
		Capacity    int      `json:"capacity"`
		CustomerIDs []string `json:"customer_ids"`
		Notes       string   `json:"notes"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	ids := append([]string{body.CoachID, body.ClassTypeID}, body.CustomerIDs...)
	if body.BranchID != nil {
		ids = append(ids, *body.BranchID)
	}
	if slices.ContainsFunc(ids, func(s string) bool { return !validate.IsUUID(s) }) {
		return httpx.BadRequest("ID tidak valid")
	}
	if err := sc.require(body.CoachID); err != nil {
		return err
	}
	start, err := parseInstant(body.StartsAt)
	if err != nil {
		return err
	}
	if len([]rune(body.Notes)) > 500 {
		return httpx.BadRequest("Catatan terlalu panjang")
	}
	id, err := h.svc.Book(r.Context(), BookInput{
		CoachID: body.CoachID, ClassTypeID: body.ClassTypeID, BranchID: body.BranchID, StartsAt: start,
		Capacity: body.Capacity, CustomerIDs: body.CustomerIDs, Notes: strings.TrimSpace(body.Notes), ActorID: sc.user.ID,
	})
	if err != nil {
		return err
	}
	return created(w, id)
}

func (h *handler) appointmentAction(w http.ResponseWriter, r *http.Request, sc scope) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	var body struct {
		Action     string `json:"action"`
		Reason     string `json:"reason"`
		CustomerID string `json:"customer_id"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	if _, err := h.scopedAppointment(r, sc, id); err != nil {
		return err
	}
	ctx := r.Context()
	switch body.Action {
	case "confirm":
		err = h.svc.Confirm(ctx, id)
	case "cancel":
		if len([]rune(body.Reason)) > 300 {
			return httpx.BadRequest("Alasan terlalu panjang")
		}
		err = h.svc.CancelAppointment(ctx, id, strings.TrimSpace(body.Reason))
	case "complete":
		err = h.svc.Complete(ctx, id)
	case "add_member":
		if !validate.IsUUID(body.CustomerID) {
			return httpx.BadRequest("Member tidak valid")
		}
		err = h.svc.AddMember(ctx, id, body.CustomerID)
	default:
		return httpx.BadRequest("Aksi tidak dikenal")
	}
	if err != nil {
		return err
	}
	a, err := h.svc.Appointment(ctx, id)
	if err != nil {
		return err
	}
	return ok(w, a)
}

func (h *handler) participantAction(w http.ResponseWriter, r *http.Request, sc scope) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	var body struct {
		Action string `json:"action"`
		Waive  bool   `json:"waive"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	appointmentID, _, err := h.svc.ParticipantAppointment(r.Context(), id)
	if err != nil {
		return err
	}
	if appointmentID == "" {
		return httpx.NotFound("Peserta PT tidak ditemukan")
	}
	if _, err := h.scopedAppointment(r, sc, appointmentID); err != nil {
		return err
	}
	switch body.Action {
	case "cancel":
		res, err := h.svc.CancelParticipant(r.Context(), appointmentID, id, false, body.Waive)
		if err != nil {
			return err
		}
		return ok(w, res)
	case "no_show":
		penalty, err := h.svc.NoShow(r.Context(), appointmentID, id, body.Waive)
		if err != nil {
			return err
		}
		return ok(w, CancelResult{Penalty: penalty})
	}
	return httpx.BadRequest("Aksi tidak dikenal")
}

// ── Assessments ─────────────────────────────────────────────────────────────

func (h *handler) listAssessments(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	q := r.URL.Query()
	customerID, err := queryUUID(q, "customer_id")
	if err != nil {
		return err
	}
	var list []AssessmentRow
	if customerID != "" {
		list, err = h.svc.MemberAssessments(r.Context(), customerID)
	} else {
		list, err = h.svc.RecentAssessments(r.Context(), strings.TrimSpace(q.Get("q")))
	}
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *handler) getAssessment(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	a, err := h.svc.GetAssessment(r.Context(), id)
	if err != nil {
		return err
	}
	if a == nil {
		return httpx.NotFound("Asesmen tidak ditemukan")
	}
	return ok(w, a)
}

// assessmentBody is the JSON of an assessment form.
type assessmentBody struct {
	CustomerID         string   `json:"customer_id"`
	CoachID            *string  `json:"coach_id"`
	AssessedOn         string   `json:"assessed_on"`
	WeightKg           *float64 `json:"weight_kg"`
	BodyFatPct         *float64 `json:"body_fat_pct"`
	MuscleMassKg       *float64 `json:"muscle_mass_kg"`
	RestingHR          *int     `json:"resting_hr"`
	Run1kmSec          *int     `json:"run_1km_sec"`
	Ski1kmSec          *int     `json:"ski_1km_sec"`
	Row1kmSec          *int     `json:"row_1km_sec"`
	WallBallsMaxReps   *int     `json:"wall_balls_max_reps"`
	SledPushSec        *int     `json:"sled_push_sec"`
	SledPullSec        *int     `json:"sled_pull_sec"`
	BurpeeBroadJumpSec *int     `json:"burpee_broad_jump_sec"`
	Notes              string   `json:"notes"`
	Goals              string   `json:"goals"`
}

func readAssessment(r *http.Request) (AssessmentInput, error) {
	var b assessmentBody
	if err := httpx.DecodeJSON(r, &b); err != nil {
		return AssessmentInput{}, err
	}
	if b.CoachID != nil && !validate.IsUUID(*b.CoachID) {
		return AssessmentInput{}, httpx.BadRequest("Coach tidak valid")
	}
	return AssessmentInput{
		CustomerID: b.CustomerID,
		CoachID:    b.CoachID,
		Assessment: domain.Assessment{
			AssessedOn: b.AssessedOn, WeightKg: b.WeightKg, BodyFatPct: b.BodyFatPct, MuscleMassKg: b.MuscleMassKg,
			RestingHR: b.RestingHR, Run1kmSec: b.Run1kmSec, Ski1kmSec: b.Ski1kmSec, Row1kmSec: b.Row1kmSec,
			WallBallsMaxReps: b.WallBallsMaxReps, SledPushSec: b.SledPushSec, SledPullSec: b.SledPullSec,
			BurpeeBroadJumpSec: b.BurpeeBroadJumpSec, Notes: strings.TrimSpace(b.Notes), Goals: strings.TrimSpace(b.Goals),
		},
	}, nil
}

// createAssessment defaults the coach to the one linked to the caller.
func (h *handler) createAssessment(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	in, err := readAssessment(r)
	if err != nil {
		return err
	}
	if !validate.IsUUID(in.CustomerID) {
		return httpx.BadRequest("Member tidak valid")
	}
	if in.CoachID == nil {
		coachID, err := h.svc.CoachForUser(r.Context(), user.ID)
		if err != nil {
			return err
		}
		in.CoachID = nullable(coachID)
	}
	id, err := h.svc.CreateAssessment(r.Context(), in, user.ID, user.FullName)
	if err != nil {
		return err
	}
	return created(w, id)
}

func (h *handler) updateAssessment(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	in, err := readAssessment(r)
	if err != nil {
		return err
	}
	if err := h.svc.UpdateAssessment(r.Context(), id, in); err != nil {
		return err
	}
	a, err := h.svc.GetAssessment(r.Context(), id)
	if err != nil {
		return err
	}
	return ok(w, a)
}

func (h *handler) deleteAssessment(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteAssessment(r.Context(), id); err != nil {
		return err
	}
	return ok(w, map[string]string{"id": id})
}

// ── Member portal ───────────────────────────────────────────────────────────

func (h *handler) memberOptions(w http.ResponseWriter, r *http.Request, customerID string) error {
	o, err := h.svc.Options(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, o)
}

// memberSlots lists slots a member may request: from the earliest request
// time on.
func (h *handler) memberSlots(w http.ResponseWriter, r *http.Request, _ string) error {
	rules, err := h.svc.ports.Rules.ForBranch(r.Context(), h.svc.db, nil)
	if err != nil {
		return err
	}
	return h.slots(w, r, domain.EarliestRequest(h.svc.now(), rules), func(string) bool { return true })
}

func (h *handler) memberSessions(w http.ResponseWriter, r *http.Request, customerID string) error {
	list, err := h.svc.MemberSessions(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, list)
}

func (h *handler) memberRequest(w http.ResponseWriter, r *http.Request, customerID string) error {
	var body struct {
		CoachID     string `json:"coach_id"`
		ClassTypeID string `json:"class_type_id"`
		StartsAt    string `json:"starts_at"`
		Notes       string `json:"notes"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	if !validate.IsUUID(body.CoachID) || !validate.IsUUID(body.ClassTypeID) {
		return httpx.BadRequest("ID tidak valid")
	}
	start, err := parseInstant(body.StartsAt)
	if err != nil {
		return err
	}
	if len([]rune(body.Notes)) > 500 {
		return httpx.BadRequest("Catatan terlalu panjang")
	}
	id, err := h.svc.Request(r.Context(), RequestInput{
		CustomerID: customerID, CoachID: body.CoachID, ClassTypeID: body.ClassTypeID, StartsAt: start,
		Notes: strings.TrimSpace(body.Notes),
	})
	if err != nil {
		return err
	}
	return created(w, id)
}

func (h *handler) memberCancel(w http.ResponseWriter, r *http.Request, customerID string) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	res, err := h.svc.MemberCancel(r.Context(), customerID, id)
	if err != nil {
		return err
	}
	return ok(w, res)
}

func (h *handler) memberAssessments(w http.ResponseWriter, r *http.Request, customerID string) error {
	list, err := h.svc.MemberAssessments(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, list)
}
