package gymtraining

import (
	"net/http"
	"slices"

	"nuhabit/backend/internal/modules/gymtraining/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

type handlers struct {
	svc   *Service
	auth  *auth.Service
	guard auth.Granter
}

func ok(w http.ResponseWriter, data any) error { return httpx.Data(w, http.StatusOK, data) }

const (
	actRead   = "read"
	actCreate = "create"
	actUpdate = "update"
	actDelete = "delete"
)

// upsert wraps a save route that creates without an id and edits with one.
// The caller needs create or update to reach fn, and fn passes the parsed id
// to require before saving, which checks the action the body asks for.
func (h handlers) upsert(prefixes []string, fn func(w http.ResponseWriter, r *http.Request, u *auth.User, require func(id *string) error) error) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		u, _, err := h.guard.RequireAnyGrant(r, iam.Grant{Action: actCreate, Prefixes: prefixes}, iam.Grant{Action: actUpdate, Prefixes: prefixes})
		if err != nil {
			return err
		}
		return fn(w, r, u, func(id *string) error {
			action := actCreate
			if id != nil {
				action = actUpdate
			}
			_, _, err := h.guard.RequireAnyGrant(r, iam.Grant{Action: action, Prefixes: prefixes})
			return err
		})
	})
}

// member wraps a member portal route: withMemberSession(failMessage, ...).
func (h handlers) member(failMessage string, fn func(w http.ResponseWriter, r *http.Request, customerID string) error) http.Handler {
	return h.auth.MemberHandler(failMessage, fn)
}

// memberID validates the {id} path segment of a member route.
func memberID(r *http.Request, name string) (string, error) {
	id := r.PathValue(name)
	if !validate.IsUUID(id) {
		return "", httpx.BadRequest("ID tidak valid")
	}
	return id, nil
}

/* ── Staff: exercises ────────────────────────────────────────────────── */

func (h handlers) listExercises(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	out, err := h.svc.ExerciseAdmin(r.Context())
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) saveExercise(w http.ResponseWriter, r *http.Request, _ *auth.User, require func(id *string) error) error {
	in, err := parseExercise(r)
	if err != nil {
		return err
	}
	if err := require(in.ID); err != nil {
		return err
	}
	out, err := h.svc.SaveExercise(r.Context(), in)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) deleteExercise(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := requireUUID(r.URL.Query().Get("id"), "ID tidak valid")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteExercise(r.Context(), id); err != nil {
		return err
	}
	return ok(w, map[string]string{"id": id})
}

func (h handlers) saveSubstitution(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	in, err := parseSubstitution(r)
	if err != nil {
		return err
	}
	out, err := h.svc.SaveSubstitution(r.Context(), in)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) deleteSubstitution(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := requireUUID(r.URL.Query().Get("id"), "ID tidak valid")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteSubstitution(r.Context(), id); err != nil {
		return err
	}
	return ok(w, map[string]string{"id": id})
}

/* ── Staff: races ────────────────────────────────────────────────────── */

func (h handlers) listRaces(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	out, err := h.svc.RaceEventsAdmin(r.Context())
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) saveRace(w http.ResponseWriter, r *http.Request, _ *auth.User, require func(id *string) error) error {
	in, err := parseRace(r)
	if err != nil {
		return err
	}
	if err := require(in.ID); err != nil {
		return err
	}
	out, err := h.svc.SaveRaceEvent(r.Context(), in)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) deleteRace(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := requireUUID(r.URL.Query().Get("id"), "ID tidak valid")
	if err != nil {
		return err
	}
	outcome, err := h.svc.DeleteRaceEvent(r.Context(), id)
	if err != nil {
		return err
	}
	return ok(w, map[string]string{"id": id, "outcome": outcome})
}

func (h handlers) raceEntrants(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := requireUUID(r.PathValue("id"), "ID tidak valid")
	if err != nil {
		return err
	}
	out, err := h.svc.RaceEntrants(r.Context(), id)
	if err != nil {
		return err
	}
	return ok(w, out)
}

/* ── Staff: incentives ───────────────────────────────────────────────── */

func (h handlers) schemeForm(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	out, err := h.svc.SchemeForm(r.Context())
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) saveScheme(w http.ResponseWriter, r *http.Request, u *auth.User, require func(id *string) error) error {
	in, err := parseScheme(r)
	if err != nil {
		return err
	}
	if err := require(in.ID); err != nil {
		return err
	}
	out, err := h.svc.SaveScheme(r.Context(), in, u.ID)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) deleteScheme(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := requireUUID(r.URL.Query().Get("id"), "ID tidak valid")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteScheme(r.Context(), id); err != nil {
		return err
	}
	return ok(w, map[string]string{"id": id})
}

const badMonth = "Bulan harus berformat YYYY-MM"

func (h handlers) statements(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	q := r.URL.Query()
	month := q.Get("month")
	if !domain.IsPeriodMonth(month) {
		return httpx.BadRequest(badMonth)
	}
	var coachID *string
	if raw := q.Get("coach_id"); raw != "" {
		id, err := requireUUID(raw, "ID coach tidak valid")
		if err != nil {
			return err
		}
		coachID = &id
	}
	out, err := h.svc.Statements(r.Context(), month, coachID)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) listPayouts(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	q := r.URL.Query()
	var month *string
	if q.Has("month") {
		// "?month=" passes the check like the TS (an empty string is falsy)
		// and reaches the query.
		m := q.Get("month")
		if m != "" && !domain.IsPeriodMonth(m) {
			return httpx.BadRequest(badMonth)
		}
		month = &m
	}
	out, err := h.svc.Payouts(r.Context(), month, nil)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) createPayout(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	in, err := parsePayoutCreate(r)
	if err != nil {
		return err
	}
	out, err := h.svc.CreatePayout(r.Context(), u.ID, in.CoachID, in.Month)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) getPayout(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := requireUUID(r.PathValue("id"), "ID tidak valid")
	if err != nil {
		return err
	}
	out, err := h.svc.Payout(r.Context(), id)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) actOnPayout(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := requireUUID(r.PathValue("id"), "ID tidak valid")
	if err != nil {
		return err
	}
	in, err := parsePayoutAction(r)
	if err != nil {
		return err
	}
	if err := h.svc.ActOnPayout(r.Context(), u.ID, id, in); err != nil {
		return err
	}
	return ok(w, map[string]string{"id": id})
}

/* ── Staff: coach portal ─────────────────────────────────────────────── */

func (h handlers) myIncentives(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	month := r.URL.Query().Get("month")
	if month == "" {
		month = domain.PeriodMonthOf(h.svc.now())
	}
	if !domain.IsPeriodMonth(month) {
		return httpx.BadRequest(badMonth)
	}
	out, err := h.svc.MyIncentives(r.Context(), u.ID, month)
	if err != nil {
		return err
	}
	return ok(w, out)
}

/* ── Member: workouts ────────────────────────────────────────────────── */

func (h handlers) workoutsPage(w http.ResponseWriter, r *http.Request, customerID string) error {
	out, err := h.svc.WorkoutsPage(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) generateWorkout(w http.ResponseWriter, r *http.Request, customerID string) error {
	in, valid := parseGenerate(r)
	if !valid {
		return httpx.BadRequest("Pilihan workout tidak valid")
	}
	out, err := h.svc.GenerateWorkout(r.Context(), customerID, in)
	if err != nil {
		return err
	}
	return ok(w, out)
}

// workoutAction serves POST /workouts/{a}/{b}: Next routes the static
// "sessions" segment first (sessions/[id]), everything else to [id]/start.
// One pattern avoids a ServeMux conflict between the two.
func (h handlers) workoutAction() http.Handler {
	start := h.member("Gagal memulai workout", h.startWorkout)
	session := h.member("Gagal memperbarui sesi workout", h.actOnSession)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.PathValue("a") == "sessions":
			r.SetPathValue("id", r.PathValue("b"))
			session.ServeHTTP(w, r)
		case r.PathValue("b") == "start":
			r.SetPathValue("id", r.PathValue("a"))
			start.ServeHTTP(w, r)
		default:
			http.NotFound(w, r)
		}
	})
}

func (h handlers) startWorkout(w http.ResponseWriter, r *http.Request, customerID string) error {
	id, err := memberID(r, "id")
	if err != nil {
		return err
	}
	out, err := h.svc.StartSession(r.Context(), customerID, id)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) getSession(w http.ResponseWriter, r *http.Request, customerID string) error {
	id, err := memberID(r, "id")
	if err != nil {
		return err
	}
	out, err := h.svc.Session(r.Context(), customerID, id)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) actOnSession(w http.ResponseWriter, r *http.Request, customerID string) error {
	id, err := memberID(r, "id")
	if err != nil {
		return err
	}
	in, valid := parseSessionAction(r)
	if !valid {
		return httpx.BadRequest("Aksi sesi tidak valid")
	}
	out, err := h.svc.ActOnSession(r.Context(), customerID, id, in)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) exerciseLibrary(w http.ResponseWriter, r *http.Request, _ string) error {
	out, err := h.svc.Library(r.Context())
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) getWorkout(w http.ResponseWriter, r *http.Request, customerID string) error {
	id, err := memberID(r, "id")
	if err != nil {
		return err
	}
	out, err := h.svc.MemberWorkout(r.Context(), customerID, id)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) replaceBlock(w http.ResponseWriter, r *http.Request, customerID string) error {
	id, err := memberID(r, "id")
	if err != nil {
		return err
	}
	in, valid := parseReplace(r)
	if !valid {
		return httpx.BadRequest("Pilihan latihan tidak valid")
	}
	out, err := h.svc.ReplaceBlock(r.Context(), customerID, id, in)
	if err != nil {
		return err
	}
	return ok(w, out)
}

/* ── Member: races ───────────────────────────────────────────────────── */

func (h handlers) raceOverview(w http.ResponseWriter, r *http.Request, customerID string) error {
	out, err := h.svc.RaceOverview(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) registerRace(w http.ResponseWriter, r *http.Request, customerID string) error {
	in, valid := parseRegister(r)
	if !valid {
		return httpx.BadRequest("Data race tidak valid")
	}
	id, err := h.svc.RegisterForRace(r.Context(), customerID, in)
	if err != nil {
		return err
	}
	return ok(w, map[string]string{"id": id})
}

func (h handlers) updateRace(w http.ResponseWriter, r *http.Request, customerID string) error {
	id, err := memberID(r, "id")
	if err != nil {
		return err
	}
	u, valid := parseRaceUpdate(r)
	if !valid {
		return httpx.BadRequest("Data race tidak valid")
	}
	if err := h.svc.UpdateMemberRace(r.Context(), customerID, id, u); err != nil {
		return err
	}
	return ok(w, map[string]string{"id": id})
}

func (h handlers) raceCalendar(w http.ResponseWriter, r *http.Request, customerID string) error {
	q := r.URL.Query()
	scope := "upcoming"
	if q.Has("scope") {
		scope = q.Get("scope")
	}
	var region *string
	if v := q.Get("region"); v != "" {
		region = &v
	}
	if (scope != "upcoming" && scope != "results") || (region != nil && !slices.Contains(domain.RaceRegions, *region)) {
		return httpx.BadRequest("Filter race tidak valid")
	}
	out, err := h.svc.RaceCalendar(r.Context(), customerID, scope == "results", region)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) myRaces(w http.ResponseWriter, r *http.Request, customerID string) error {
	out, err := h.svc.MyRaces(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h handlers) raceDetail(w http.ResponseWriter, r *http.Request, customerID string) error {
	id, err := memberID(r, "id")
	if err != nil {
		return err
	}
	out, err := h.svc.RaceDetail(r.Context(), customerID, id)
	if err != nil {
		return err
	}
	return ok(w, out)
}

// Routes lists the module's routes.
func (h handlers) Routes() []module.Route {
	ex, races, inc := iam.GymExercises, iam.GymRaces, iam.GymIncentives
	return []module.Route{
		{Pattern: "GET /api/gym/exercises", Handler: auth.Staff(h.guard, h.listExercises, iam.Can(actRead, ex))},
		{Pattern: "POST /api/gym/exercises", Handler: h.upsert(ex, h.saveExercise)},
		{Pattern: "DELETE /api/gym/exercises", Handler: auth.Staff(h.guard, h.deleteExercise, iam.Can(actDelete, ex))},
		{Pattern: "POST /api/gym/exercises/substitutions", Handler: auth.Staff(h.guard, h.saveSubstitution, iam.Can(actCreate, ex))},
		{Pattern: "DELETE /api/gym/exercises/substitutions", Handler: auth.Staff(h.guard, h.deleteSubstitution, iam.Can(actDelete, ex))},

		{Pattern: "GET /api/gym/races", Handler: auth.Staff(h.guard, h.listRaces, iam.Can(actRead, races))},
		{Pattern: "POST /api/gym/races", Handler: h.upsert(races, h.saveRace)},
		{Pattern: "DELETE /api/gym/races", Handler: auth.Staff(h.guard, h.deleteRace, iam.Can(actDelete, races))},
		{Pattern: "GET /api/gym/races/{id}/entrants", Handler: auth.Staff(h.guard, h.raceEntrants, iam.Can(actRead, races))},
		{Pattern: "GET /api/gym/races/results", Handler: auth.Staff(h.guard, h.listResults, iam.Can(actRead, races))},
		{Pattern: "POST /api/gym/races/results/{id}/verify", Handler: auth.Staff(h.guard, h.verifyResult, iam.Can(actUpdate, races))},
		{Pattern: "GET /api/gym/races/leaderboard", Handler: auth.Staff(h.guard, h.staffLeaderboard, iam.Can(actRead, races))},

		{Pattern: "GET /api/gym/incentives/schemes", Handler: auth.Staff(h.guard, h.schemeForm, iam.Can(actRead, inc))},
		{Pattern: "POST /api/gym/incentives/schemes", Handler: h.upsert(inc, h.saveScheme)},
		{Pattern: "DELETE /api/gym/incentives/schemes", Handler: auth.Staff(h.guard, h.deleteScheme, iam.Can(actDelete, inc))},
		{Pattern: "GET /api/gym/incentives/statements", Handler: auth.Staff(h.guard, h.statements, iam.Can(actRead, inc))},
		{Pattern: "GET /api/gym/incentives/payouts", Handler: auth.Staff(h.guard, h.listPayouts, iam.Can(actRead, inc))},
		{Pattern: "POST /api/gym/incentives/payouts", Handler: auth.Staff(h.guard, h.createPayout, iam.Can(actCreate, inc))},
		{Pattern: "GET /api/gym/incentives/payouts/{id}", Handler: auth.Staff(h.guard, h.getPayout, iam.Can(actRead, inc))},
		{Pattern: "POST /api/gym/incentives/payouts/{id}", Handler: auth.Staff(h.guard, h.actOnPayout, iam.Can(actUpdate, inc))},

		{Pattern: "GET /api/gym/my-classes/incentives", Handler: auth.Staff(h.guard, h.myIncentives, iam.Can(actRead, iam.GymMyClasses))},

		{Pattern: "GET /api/member-portal/gym/workouts", Handler: h.member("Gagal memuat workout", h.workoutsPage)},
		{Pattern: "POST /api/member-portal/gym/workouts", Handler: h.member("Gagal menyusun workout", h.generateWorkout)},
		{Pattern: "POST /api/member-portal/gym/workouts/{a}/{b}", Handler: h.workoutAction()},
		{Pattern: "GET /api/member-portal/gym/workouts/sessions/{id}", Handler: h.member("Gagal memuat sesi workout", h.getSession)},
		{Pattern: "GET /api/member-portal/gym/races", Handler: h.member("Gagal memuat race", h.raceOverview)},
		{Pattern: "POST /api/member-portal/gym/races", Handler: h.member("Gagal mendaftar race", h.registerRace)},
		{Pattern: "PATCH /api/member-portal/gym/races/{id}", Handler: h.member("Gagal memperbarui race", h.updateRace)},
		{Pattern: "POST /api/member-portal/gym/results", Handler: h.member("Gagal menyimpan hasil", h.createResult)},
		{Pattern: "PUT /api/member-portal/gym/results/{id}", Handler: h.member("Gagal memperbarui hasil", h.updateResult)},

		{Pattern: "GET /api/member-portal/app/workout/exercises", Handler: h.member("Gagal memuat pustaka latihan", h.exerciseLibrary)},
		{Pattern: "GET /api/member-portal/app/workout/races", Handler: h.member("Gagal memuat race", h.raceCalendar)},
		{Pattern: "GET /api/member-portal/app/workout/races/mine", Handler: h.member("Gagal memuat race saya", h.myRaces)},
		{Pattern: "GET /api/member-portal/app/workout/races/{id}", Handler: h.member("Gagal memuat race", h.raceDetail)},
		{Pattern: "GET /api/member-portal/app/workout/results", Handler: h.member("Gagal memuat hasil", h.myResults)},
		{Pattern: "GET /api/member-portal/app/workout/results/{id}", Handler: h.member("Gagal memuat hasil", h.resultDetail)},
		{Pattern: "GET /api/member-portal/app/workout/leaderboard", Handler: h.member("Gagal memuat leaderboard", h.memberLeaderboard)},
		{Pattern: "GET /api/member-portal/app/workout/workouts/{id}", Handler: h.member("Gagal memuat workout", h.getWorkout)},
		{Pattern: "PATCH /api/member-portal/app/workout/workouts/{id}", Handler: h.member("Gagal mengganti latihan", h.replaceBlock)},
	}
}
