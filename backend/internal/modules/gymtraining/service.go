// Package gymtraining is the gym-training bounded context: the HYROX exercise
// library and substitutions, generated workouts and their live sessions, the
// race calendar with members' race entries, and coach incentive schemes,
// monthly statements and payouts. Port of frontend/src/lib/gym/{hyrox,races,
// incentive,training-server,races-server,incentive-server,
// exercises-admin-server,race-admin-server}.ts and
// frontend/src/lib/member-app/workout-server.ts.
package gymtraining

import (
	"context"
	"errors"
	"math/rand/v2"
	"time"

	"nuhabit/backend/internal/modules/gymtraining/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

/* ── Ports ───────────────────────────────────────────────────────────── */

// CatalogEntry is a coach or a class type as the scheme form lists it.
type CatalogEntry struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

// Scheduling is what gym-training reads from gym-scheduling.
type Scheduling interface {
	// CompletedSessionsForCoachMonth: completed classes with a coach starting
	// in [start, end) (one coach when coachID is set), with booking statuses.
	CompletedSessionsForCoachMonth(ctx context.Context, start, end time.Time, coachID *string) ([]domain.StatementSession, error)
	// Coaches ordered by name; only coachID when it is set.
	Coaches(ctx context.Context, coachID *string) ([]CatalogEntry, error)
	// ClassTypes ordered by name.
	ClassTypes(ctx context.Context) ([]CatalogEntry, error)
	// AttendedClassTimes: start of each class the member checked in to or
	// completed since the given time.
	AttendedClassTimes(ctx context.Context, customerID string, since time.Time) ([]time.Time, error)
}

// Contact is a POS customer's name and phone.
type Contact struct {
	ID    string
	Name  *string
	Phone *string
}

// Customers is what gym-training reads from the POS customer directory.
type Customers interface {
	Contacts(ctx context.Context, ids []string) (map[string]Contact, error)
}

// Repository is the module's own storage (implemented by pgRepo).
type Repository interface {
	// InTx runs fn with a repository bound to one transaction.
	InTx(ctx context.Context, fn func(Repository) error) error

	Library(ctx context.Context) (library, error)
	ExerciseAdmin(ctx context.Context) (exerciseAdmin, error)
	SaveExercise(ctx context.Context, e exerciseInput) (string, error)
	DeleteExercise(ctx context.Context, id string) (bool, error)
	SaveSubstitution(ctx context.Context, s substitutionInput) (string, error)
	DeleteSubstitution(ctx context.Context, id string) (bool, error)

	InsertWorkout(ctx context.Context, customerID string, in generateInput, w domain.GeneratedWorkout) (workoutView, error)
	WorkoutHistory(ctx context.Context, customerID string) ([]workoutHistoryItem, error)
	MemberWorkout(ctx context.Context, customerID, workoutID string) (*workoutView, error)
	LockWorkoutBlocks(ctx context.Context, customerID, workoutID string) ([]domain.WorkoutBlock, bool, error)
	SaveWorkoutBlocks(ctx context.Context, workoutID string, blocks []domain.WorkoutBlock) (workoutView, error)
	StartSession(ctx context.Context, customerID, workoutID string, s domain.SessionState) (*workoutSessionView, error)
	MemberSession(ctx context.Context, customerID, sessionID string) (*workoutSessionView, error)
	LockSession(ctx context.Context, customerID, sessionID string) (*lockedSession, error)
	SaveSession(ctx context.Context, sessionID string, s domain.SessionState) (workoutSessionView, error)

	FullSimulations(ctx context.Context, customerID string) ([]simulation, error)
	FinishedWorkoutTimes(ctx context.Context, customerID string, since time.Time) ([]time.Time, error)
	MemberRaces(ctx context.Context, customerID string) ([]memberRaceView, error)
	OpenRaceEvents(ctx context.Context, customerID string, now time.Time) ([]memberEventRow, error)
	RaceCalendar(ctx context.Context, customerID string, results bool, region *string) ([]memberEventView, error)
	RaceEvent(ctx context.Context, customerID, raceEventID string) (*memberEventView, error)
	LiveMemberRace(ctx context.Context, customerID, raceEventID string) (*memberRaceEntry, error)
	RaceEventStatus(ctx context.Context, raceEventID string) (string, bool, error)
	LockLatestMemberRace(ctx context.Context, customerID, raceEventID string) (*entryState, error)
	ReviveMemberRace(ctx context.Context, entryID, division string, goalSec *int) (string, error)
	InsertMemberRace(ctx context.Context, customerID, raceEventID, division string, goalSec *int) (string, error)
	LockMemberRaceStatus(ctx context.Context, customerID, entryID string) (string, bool, error)
	ApplyMemberRacePatch(ctx context.Context, entryID string, p domain.MemberRacePatch) error

	RaceEventsAdmin(ctx context.Context) ([]raceAdminView, error)
	SaveRaceEvent(ctx context.Context, in raceInput) (string, error)
	DeleteRaceEvent(ctx context.Context, id string) (string, error)
	RaceEntrants(ctx context.Context, raceID string) ([]entrantView, error)

	Schemes(ctx context.Context, coachOrder []string) ([]schemeRow, error)
	SaveScheme(ctx context.Context, s schemeInput, actorID string) (string, error)
	DeleteScheme(ctx context.Context, id string) (bool, error)
	LivePayouts(ctx context.Context, periodMonth string) ([]livePayout, error)
	Payouts(ctx context.Context, month *string, coachOrder []string) ([]payoutListRow, error)
	Payout(ctx context.Context, id string) (*payoutDetail, error)
	InsertPayout(ctx context.Context, coachID, periodMonth string, statement any, totalIDR float64, userID string) (string, error)
	LockPayoutStatus(ctx context.Context, id string) (string, bool, error)
	ApplyPayoutDecision(ctx context.Context, id, userID string, d domain.PayoutDecision) error
}

// Service holds the use cases.
type Service struct {
	repo      Repository
	sched     Scheduling
	customers Customers
	now       func() time.Time
	pick      func(n int) int
}

// NewService wires the use cases. now may be nil.
func NewService(repo Repository, sched Scheduling, customers Customers, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{repo: repo, sched: sched, customers: customers, now: now, pick: randomPick}
}

func randomPick(n int) int {
	if n > 1 {
		return rand.IntN(n)
	}
	return 0
}

// clock is now with JavaScript Date precision.
func (s *Service) clock() time.Time { return s.now().UTC().Truncate(time.Millisecond) }

/* ── Exercise library (staff) ────────────────────────────────────────── */

func (s *Service) ExerciseAdmin(ctx context.Context) (exerciseAdmin, error) {
	return s.repo.ExerciseAdmin(ctx)
}

func (s *Service) SaveExercise(ctx context.Context, in exerciseInput) (map[string]string, error) {
	id, err := s.repo.SaveExercise(ctx, in)
	switch {
	case database.IsUniqueViolation(err):
		return nil, httpx.Conflict("Kode atau nomor stasiun sudah dipakai latihan lain")
	case err != nil:
		return nil, err
	case id == "":
		return nil, httpx.NotFound("Latihan tidak ditemukan")
	}
	return map[string]string{"id": id}, nil
}

func (s *Service) DeleteExercise(ctx context.Context, id string) error {
	found, err := s.repo.DeleteExercise(ctx, id)
	return notFoundUnless(found, err, "Latihan tidak ditemukan")
}

func (s *Service) SaveSubstitution(ctx context.Context, in substitutionInput) (map[string]string, error) {
	id, err := s.repo.SaveSubstitution(ctx, in)
	if err != nil {
		return nil, err
	}
	if id == "" {
		return nil, httpx.NotFound("Latihan tidak ditemukan")
	}
	return map[string]string{"id": id}, nil
}

func (s *Service) DeleteSubstitution(ctx context.Context, id string) error {
	found, err := s.repo.DeleteSubstitution(ctx, id)
	return notFoundUnless(found, err, "Substitusi tidak ditemukan")
}

// notFoundUnless turns a delete that matched nothing into a 404.
func notFoundUnless(found bool, err error, message string) error {
	if err == nil && !found {
		return httpx.NotFound(message)
	}
	return err
}

/* ── Race calendar (staff) ───────────────────────────────────────────── */

func (s *Service) RaceEventsAdmin(ctx context.Context) ([]raceAdminView, error) {
	return s.repo.RaceEventsAdmin(ctx)
}

func (s *Service) SaveRaceEvent(ctx context.Context, in raceInput) (map[string]string, error) {
	id, err := s.repo.SaveRaceEvent(ctx, in)
	if err != nil {
		return nil, err
	}
	if id == "" {
		return nil, httpx.NotFound("Race tidak ditemukan")
	}
	return map[string]string{"id": id}, nil
}

// DeleteRaceEvent deletes a race without entrants; one with entrants is
// cancelled so members keep their history.
func (s *Service) DeleteRaceEvent(ctx context.Context, id string) (string, error) {
	outcome, err := s.repo.DeleteRaceEvent(ctx, id)
	if err == nil && outcome == "" {
		return "", httpx.NotFound("Race tidak ditemukan")
	}
	return outcome, err
}

// RaceEntrants lists members targeting the race with their name and phone.
func (s *Service) RaceEntrants(ctx context.Context, raceID string) ([]entrantView, error) {
	rows, err := s.repo.RaceEntrants(ctx, raceID)
	if err != nil || len(rows) == 0 {
		return rows, err
	}
	ids := make([]string, len(rows))
	for i, row := range rows {
		ids[i] = row.CustomerID
	}
	contacts, err := s.customers.Contacts(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := rows[:0]
	for _, row := range rows {
		if c, ok := contacts[row.CustomerID]; ok {
			row.Name, row.Phone = c.Name, c.Phone
			out = append(out, row)
		}
	}
	return out, nil
}

/* ── Incentive schemes (staff) ───────────────────────────────────────── */

// schemesWithCoaches lists schemes, default first then by coach name, with
// the coach name filled in.
func (s *Service) schemesWithCoaches(ctx context.Context, coaches []CatalogEntry) ([]schemeRow, error) {
	order := make([]string, len(coaches))
	names := make(map[string]string, len(coaches))
	for i, c := range coaches {
		order[i] = c.ID
		names[c.ID] = c.Name
	}
	schemes, err := s.repo.Schemes(ctx, order)
	if err != nil {
		return nil, err
	}
	for i, sc := range schemes {
		if sc.CoachID != nil {
			if name, ok := names[*sc.CoachID]; ok {
				schemes[i].CoachName = &name
			}
		}
	}
	return schemes, nil
}

func (s *Service) SchemeForm(ctx context.Context) (schemeForm, error) {
	coaches, err := s.sched.Coaches(ctx, nil)
	if err != nil {
		return schemeForm{}, err
	}
	classTypes, err := s.sched.ClassTypes(ctx)
	if err != nil {
		return schemeForm{}, err
	}
	schemes, err := s.schemesWithCoaches(ctx, coaches)
	return schemeForm{Schemes: schemes, Coaches: coaches, ClassTypes: classTypes}, err
}

// SaveScheme creates or updates a scheme; its class-type rates are replaced.
// There is one default (no coach) and one scheme per coach.
func (s *Service) SaveScheme(ctx context.Context, in schemeInput, actorID string) (map[string]string, error) {
	var id string
	err := s.repo.InTx(ctx, func(tx Repository) error {
		var err error
		id, err = tx.SaveScheme(ctx, in, actorID)
		return err
	})
	switch {
	case database.IsUniqueViolation(err) && in.CoachID != nil:
		return nil, httpx.Conflict("Coach ini sudah punya skema sendiri")
	case database.IsUniqueViolation(err):
		return nil, httpx.Conflict("Skema default sudah ada")
	case err != nil:
		return nil, err
	case id == "":
		return nil, httpx.NotFound("Skema tidak ditemukan")
	}
	return map[string]string{"id": id}, nil
}

func (s *Service) DeleteScheme(ctx context.Context, id string) error {
	found, err := s.repo.DeleteScheme(ctx, id)
	return notFoundUnless(found, err, "Skema tidak ditemukan atau skema default (tidak bisa dihapus)")
}

/* ── Statements and payouts (staff) ──────────────────────────────────── */

// Statements computes each coach's month from completed classes and their
// bookings. Without coachID: every active coach and any coach with classes
// that month.
func (s *Service) Statements(ctx context.Context, periodMonth string, coachID *string) ([]statementView, error) {
	period, err := domain.MonthPeriod(periodMonth)
	if err != nil {
		return nil, err
	}
	schemes, err := s.repo.Schemes(ctx, nil)
	if err != nil {
		return nil, err
	}
	sessions, err := s.sched.CompletedSessionsForCoachMonth(ctx, period.Start, period.End, coachID)
	if err != nil {
		return nil, err
	}
	coaches, err := s.sched.Coaches(ctx, coachID)
	if err != nil {
		return nil, err
	}
	payouts, err := s.repo.LivePayouts(ctx, periodMonth)
	if err != nil {
		return nil, err
	}

	var defaultScheme *schemeRow
	byCoach := map[string]*schemeRow{}
	for i := range schemes {
		sc := &schemes[i]
		if sc.IsDefault && defaultScheme == nil {
			defaultScheme = sc
		}
		if sc.CoachID != nil {
			if _, seen := byCoach[*sc.CoachID]; !seen {
				byCoach[*sc.CoachID] = sc
			}
		}
	}
	if defaultScheme == nil {
		return nil, errors.New("gym-training: default incentive scheme missing (Skema insentif default belum ada)")
	}
	withClasses := map[string]bool{}
	for _, cs := range sessions {
		if cs.CoachID != nil {
			withClasses[*cs.CoachID] = true
		}
	}

	out := []statementView{}
	for _, coach := range coaches {
		if coach.Status != "active" && !withClasses[coach.ID] {
			continue
		}
		scheme := domain.ResolveScheme(*defaultScheme, byCoach[coach.ID])
		statement, err := domain.ComputeCoachStatement(coach.ID, periodMonth, scheme.IncentiveScheme, sessions)
		if err != nil {
			return nil, err
		}
		view := statementView{CoachStatement: statement, CoachName: coach.Name, SchemeName: scheme.Name}
		for _, p := range payouts {
			if p.CoachID == coach.ID {
				view.Payout = &payoutRef{ID: p.ID, Status: p.Status, TotalIDR: p.TotalIDR}
				break
			}
		}
		out = append(out, view)
	}
	return out, nil
}

// Payouts lists payouts, newest month first, with the coach name.
func (s *Service) Payouts(ctx context.Context, month *string) ([]payoutListRow, error) {
	coaches, err := s.sched.Coaches(ctx, nil)
	if err != nil {
		return nil, err
	}
	order := make([]string, len(coaches))
	names := make(map[string]string, len(coaches))
	for i, c := range coaches {
		order[i] = c.ID
		names[c.ID] = c.Name
	}
	rows, err := s.repo.Payouts(ctx, month, order)
	for i := range rows {
		rows[i].CoachName = names[rows[i].CoachID]
	}
	return rows, err
}

// Payout is one payout with its frozen statement.
func (s *Service) Payout(ctx context.Context, id string) (*payoutDetail, error) {
	p, err := s.repo.Payout(ctx, id)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, httpx.NotFound("Payout tidak ditemukan")
	}
	coaches, err := s.sched.Coaches(ctx, &p.CoachID)
	if err != nil {
		return nil, err
	}
	if len(coaches) > 0 {
		p.CoachName = coaches[0].Name
	}
	return p, nil
}

// CreatePayout freezes a coach's statement for a month as a draft payout.
func (s *Service) CreatePayout(ctx context.Context, userID, coachID, periodMonth string) (map[string]string, error) {
	statements, err := s.Statements(ctx, periodMonth, &coachID)
	if err != nil {
		return nil, err
	}
	if len(statements) == 0 {
		return nil, httpx.NotFound("Coach tidak ditemukan")
	}
	st := statements[0]
	id, err := s.repo.InsertPayout(ctx, coachID, periodMonth, st, st.Totals.TotalIDR, userID)
	if err != nil {
		return nil, err
	}
	if id == "" {
		return nil, httpx.Conflict("Coach ini sudah punya payout aktif untuk bulan tersebut")
	}
	return map[string]string{"id": id}, nil
}

// ActOnPayout approves, pays (reference required) or voids (reason required).
func (s *Service) ActOnPayout(ctx context.Context, userID, id string, in payoutActionInput) error {
	return s.repo.InTx(ctx, func(tx Repository) error {
		status, found, err := tx.LockPayoutStatus(ctx, id)
		if err != nil {
			return err
		}
		if !found {
			return httpx.NotFound("Payout tidak ditemukan")
		}
		decision, refusal := domain.DecidePayoutAction(status, in.Action, in.PaymentReference, in.Note)
		if refusal != "" {
			return httpx.Conflict(refusal)
		}
		return tx.ApplyPayoutDecision(ctx, id, userID, decision)
	})
}

/* ── Workouts (member) ───────────────────────────────────────────────── */

func (s *Service) Library(ctx context.Context) (library, error) { return s.repo.Library(ctx) }

// WorkoutsPage is the generator input (stations, equipment) and the history.
func (s *Service) WorkoutsPage(ctx context.Context, customerID string) (workoutsPage, error) {
	lib, err := s.repo.Library(ctx)
	if err != nil {
		return workoutsPage{}, err
	}
	history, err := s.repo.WorkoutHistory(ctx, customerID)
	if err != nil {
		return workoutsPage{}, err
	}
	page := workoutsPage{
		Stations:  []stationOption{},
		Exercises: make([]exerciseOption, 0, len(lib.Exercises)),
		Equipment: domain.EquipmentCatalog(lib.Exercises),
		Workouts:  history,
	}
	for _, e := range lib.Exercises {
		if e.HyroxStationOrder != nil {
			page.Stations = append(page.Stations, stationOption{ID: e.ID, Name: e.Name, Order: e.HyroxStationOrder, Equipment: e.Equipment})
		}
		page.Exercises = append(page.Exercises, exerciseOption{ID: e.ID, Name: e.Name, Equipment: e.Equipment})
	}
	return page, nil
}

// GenerateWorkout builds and stores a workout from the active library.
func (s *Service) GenerateWorkout(ctx context.Context, customerID string, in generateInput) (generatedWorkout, error) {
	lib, err := s.repo.Library(ctx)
	if err != nil {
		return generatedWorkout{}, err
	}
	w := domain.GenerateWorkout(domain.GenerateWorkoutArgs{
		Type: in.Type, Division: in.Division, StationOrders: in.StationOrders, ExcludedExerciseIDs: in.ExcludedExerciseIDs,
		AvailableEquipment: in.AvailableEquipment, Exercises: lib.Exercises, Substitutions: lib.Substitutions, Pick: s.pick,
	})
	if len(w.Blocks) == 0 {
		return generatedWorkout{}, httpx.Conflict("Belum ada stasiun untuk menyusun workout.")
	}
	row, err := s.repo.InsertWorkout(ctx, customerID, in, w)
	return generatedWorkout{Workout: row, UnresolvedExerciseIDs: w.UnresolvedExerciseIDs}, err
}

func (s *Service) MemberWorkout(ctx context.Context, customerID, workoutID string) (*workoutView, error) {
	w, err := s.repo.MemberWorkout(ctx, customerID, workoutID)
	if err == nil && w == nil {
		return nil, httpx.NotFound("Workout tidak ditemukan")
	}
	return w, err
}

// ReplaceBlock swaps one station block for a substitute of its original
// station. Run blocks cannot be swapped.
func (s *Service) ReplaceBlock(ctx context.Context, customerID, workoutID string, in replaceInput) (workoutView, error) {
	lib, err := s.repo.Library(ctx)
	if err != nil {
		return workoutView{}, err
	}
	var saved workoutView
	err = s.repo.InTx(ctx, func(tx Repository) error {
		blocks, found, err := tx.LockWorkoutBlocks(ctx, customerID, workoutID)
		if err != nil {
			return err
		}
		if !found {
			return httpx.NotFound("Workout tidak ditemukan")
		}
		index := -1
		for i, b := range blocks {
			if b.Order == in.Order {
				index = i
				break
			}
		}
		if index < 0 {
			return httpx.NotFound("Blok tidak ditemukan")
		}
		block := blocks[index]
		if block.Kind != "STATION" {
			return httpx.Conflict("Blok lari tidak bisa diganti.")
		}
		station := block.ExerciseID
		if block.OriginalExerciseID != nil {
			station = *block.OriginalExerciseID
		}
		for _, sub := range domain.ListSubstitutes(station, lib.Substitutions, lib.Exercises) {
			if sub.Exercise.ID == in.ExerciseID {
				blocks[index] = domain.ReplaceBlockExercise(block, sub.Exercise, sub.Rule)
				saved, err = tx.SaveWorkoutBlocks(ctx, workoutID, blocks)
				return err
			}
		}
		return httpx.Conflict("Latihan itu bukan pengganti stasiun ini.")
	})
	return saved, err
}

/* ── Workout sessions (member) ───────────────────────────────────────── */

// StartSession opens a new session; repeating a workout is a new session.
func (s *Service) StartSession(ctx context.Context, customerID, workoutID string) (*workoutSessionView, error) {
	row, err := s.repo.StartSession(ctx, customerID, workoutID, domain.NewSession(s.clock()))
	if err == nil && row == nil {
		return nil, httpx.NotFound("Workout tidak ditemukan")
	}
	return row, err
}

func (s *Service) Session(ctx context.Context, customerID, sessionID string) (*workoutSessionView, error) {
	row, err := s.repo.MemberSession(ctx, customerID, sessionID)
	if err == nil && row == nil {
		return nil, httpx.NotFound("Sesi tidak ditemukan")
	}
	return row, err
}

func stateOf(row workoutSessionView) domain.SessionState {
	t := func(ts *domain.Timestamp) *time.Time {
		if ts == nil {
			return nil
		}
		return &ts.Time
	}
	results := row.BlockResults
	if results == nil {
		results = []domain.BlockResult{}
	}
	return domain.SessionState{
		Status: row.Status, CurrentBlock: row.CurrentBlock, StartedAt: t(row.StartedAt), EndedAt: t(row.EndedAt),
		PausedAt: t(row.PausedAt), BlockResults: results, PauseCount: row.PauseCount, TotalPauseSec: row.TotalPauseSec,
	}
}

// ActOnSession runs one action on the member's session under a row lock.
func (s *Service) ActOnSession(ctx context.Context, customerID, sessionID string, in sessionAction) (workoutSessionView, error) {
	var saved workoutSessionView
	err := s.repo.InTx(ctx, func(tx Repository) error {
		row, err := tx.LockSession(ctx, customerID, sessionID)
		if err != nil {
			return err
		}
		if row == nil {
			return httpx.NotFound("Sesi tidak ditemukan")
		}
		now := s.clock()
		state := stateOf(row.workoutSessionView)
		var next domain.SessionState
		var refused *domain.SessionError
		switch in.Action {
		case "pause":
			next, refused = domain.PauseSession(state, now)
		case "resume":
			next, refused = domain.ResumeSession(state, now)
		case "record":
			next, refused = domain.RecordBlock(state, row.TotalBlocks, in.Block)
		case "complete":
			next, refused = domain.FinishSession(state, row.TotalBlocks, in.BlockResults, in.Partial, now)
		}
		if refused != nil {
			return httpx.Conflict(refused.Message())
		}
		saved, err = tx.SaveSession(ctx, sessionID, next)
		return err
	})
	return saved, err
}

/* ── Races (member) ──────────────────────────────────────────────────── */

// raceOverview is the member's race page: open races, their own races,
// predicted time, 28-day readiness and the analysis of logged results. It
// also returns how many full simulations the prediction rests on.
func (s *Service) raceOverview(ctx context.Context, customerID string) (raceOverview, int, error) {
	now := s.now()
	since := domain.RaceReadinessWindowStart(now)
	sims, err := s.repo.FullSimulations(ctx, customerID)
	if err != nil {
		return raceOverview{}, 0, err
	}
	workoutTimes, err := s.repo.FinishedWorkoutTimes(ctx, customerID, since)
	if err != nil {
		return raceOverview{}, 0, err
	}
	classTimes, err := s.sched.AttendedClassTimes(ctx, customerID, since)
	if err != nil {
		return raceOverview{}, 0, err
	}
	entries, err := s.repo.MemberRaces(ctx, customerID)
	if err != nil {
		return raceOverview{}, 0, err
	}
	events, err := s.repo.OpenRaceEvents(ctx, customerID, now)
	if err != nil {
		return raceOverview{}, 0, err
	}

	secs := make([]float64, len(sims))
	var best *int
	for i, sim := range sims {
		secs[i] = float64(sim.ActiveSec)
		if best == nil || sim.ActiveSec < *best {
			best = ptrTo(sim.ActiveSec)
		}
	}
	predictionBefore := func(startsAt time.Time) *int {
		var before []float64
		for _, sim := range sims {
			if sim.EndedAt == nil || sim.EndedAt.UnixMilli() < startsAt.UnixMilli() {
				before = append(before, float64(sim.ActiveSec))
			}
		}
		return domain.PredictRaceSec(before)
	}
	for i := range entries {
		e := &entries[i]
		e.DaysUntil = domain.DaysUntil(e.EventStartsAt, now)
		e.PredictionSec = predictionBefore(e.EventStartsAt)
		if e.ResultSec != nil {
			e.Analysis = ptrTo(domain.AnalyzeRace(*e.ResultSec, e.GoalSec, e.PredictionSec))
		}
	}
	activities := append(workoutTimes, classTimes...)
	return raceOverview{
		PredictionSec:     domain.PredictRaceSec(secs),
		BestSimulationSec: best,
		Readiness:         domain.RaceReadinessScore(activities, now),
		ActivitiesLast28d: len(activities),
		MyRaces:           entries,
		Events:            events,
	}, len(sims), nil
}

func (s *Service) RaceOverview(ctx context.Context, customerID string) (raceOverview, error) {
	o, _, err := s.raceOverview(ctx, customerID)
	return o, err
}

// MyRaces is the member's live races, readiness and full-simulation count.
func (s *Service) MyRaces(ctx context.Context, customerID string) (myRaces, error) {
	o, simulations, err := s.raceOverview(ctx, customerID)
	if err != nil {
		return myRaces{}, err
	}
	live := []memberRaceView{}
	for _, r := range o.MyRaces {
		if r.Status != domain.MemberRaceCancelled {
			live = append(live, r)
		}
	}
	return myRaces{MyRaces: live, Readiness: o.Readiness, SimulationCount: simulations}, nil
}

func (s *Service) RaceCalendar(ctx context.Context, customerID string, results bool, region *string) ([]memberEventView, error) {
	return s.repo.RaceCalendar(ctx, customerID, results, region)
}

// RaceDetail is one race with the member's live entry in it.
func (s *Service) RaceDetail(ctx context.Context, customerID, raceEventID string) (*raceDetail, error) {
	event, err := s.repo.RaceEvent(ctx, customerID, raceEventID)
	if err != nil {
		return nil, err
	}
	entry, err := s.repo.LiveMemberRace(ctx, customerID, raceEventID)
	if err != nil {
		return nil, err
	}
	if event == nil {
		return nil, httpx.NotFound("Race tidak ditemukan")
	}
	return &raceDetail{Event: *event, MyRace: entry}, nil
}

// RegisterForRace targets a race. A cancelled entry comes back to life
// instead of being duplicated: the unique index only guards live entries.
func (s *Service) RegisterForRace(ctx context.Context, customerID string, in registerInput) (string, error) {
	var id string
	err := s.repo.InTx(ctx, func(tx Repository) error {
		status, found, err := tx.RaceEventStatus(ctx, in.RaceEventID)
		if err != nil {
			return err
		}
		if !found {
			return httpx.NotFound("Race tidak ditemukan")
		}
		if !domain.CanTargetRace(status) {
			return httpx.Conflict("Race ini sudah selesai atau dibatalkan")
		}
		entry, err := tx.LockLatestMemberRace(ctx, customerID, in.RaceEventID)
		if err != nil {
			return err
		}
		if entry != nil && entry.Status != domain.MemberRaceCancelled {
			return httpx.Conflict("Kamu sudah menargetkan race ini")
		}
		if entry != nil {
			id, err = tx.ReviveMemberRace(ctx, entry.ID, in.Division, in.GoalSec)
		} else {
			id, err = tx.InsertMemberRace(ctx, customerID, in.RaceEventID, in.Division, in.GoalSec)
		}
		return err
	})
	return id, err
}

// UpdateMemberRace changes goal/division, logs a result (→ raced) or cancels.
func (s *Service) UpdateMemberRace(ctx context.Context, customerID, entryID string, u domain.MemberRaceUpdate) error {
	return s.repo.InTx(ctx, func(tx Repository) error {
		status, found, err := tx.LockMemberRaceStatus(ctx, customerID, entryID)
		if err != nil {
			return err
		}
		if !found {
			return httpx.NotFound("Race tidak ditemukan")
		}
		patch, refusal := domain.PlanMemberRaceUpdate(status, u)
		if refusal != "" {
			return httpx.Conflict(refusal)
		}
		return tx.ApplyMemberRacePatch(ctx, entryID, patch)
	})
}
