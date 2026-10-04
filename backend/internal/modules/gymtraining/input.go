package gymtraining

import (
	"net/http"
	"regexp"

	"nuhabit/backend/internal/modules/gymtraining/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// Request bodies, one parser per zod schema of the TS routes.

var (
	required = rule{}
	optional = rule{optional: true}
	nullable = rule{nullable: true}
	// nullDefault is .nullable().default(null): absent and null both mean nil.
	nullDefault = rule{nullable: true, hasDefault: true}
	// optionalNull is .nullable().optional().
	optionalNull = rule{nullable: true, optional: true}
)

/* ── Staff: exercises ────────────────────────────────────────────────── */

var (
	exerciseCodePattern = regexp.MustCompile(`^[a-z0-9_]{2,40}$`)
	equipmentPattern    = regexp.MustCompile(`^[a-z0-9_]{2,30}$`)
)

func patternCheck(re *regexp.Regexp) func(string) (string, string, bool) {
	return func(s string) (string, string, bool) { return "invalid_format", "Invalid string", re.MatchString(s) }
}

// exerciseSpecInput is the stored default_spec ({distanceM, reps}).
type exerciseSpecInput struct {
	DistanceM *int `json:"distanceM"`
	Reps      *int `json:"reps"`
}

type exerciseInput struct {
	ID                *string
	Code, Name        string
	Description       string
	Category          string
	Equipment         []string
	HyroxStationOrder *int
	Difficulty        int
	DefaultSpec       exerciseSpecInput
	VideoURL          *string
	IsActive          bool
}

func parseExercise(r *http.Request) (exerciseInput, error) {
	f := newForm(readBody(r))
	in := exerciseInput{ID: f.uuid("id", optional)}
	in.Code = deref(f.str("code", required, strOpts{trim: true, check: patternCheck(exerciseCodePattern)}))
	in.Name = deref(f.str("name", required, strOpts{trim: true, min: 2, max: 80}))
	in.Description = f.strDefault("description", "", strOpts{max: 1000})
	in.Category = deref(f.enum("category", required, domain.ExerciseCategories))
	in.Equipment = f.strings("equipment", rule{hasDefault: true}, 10, strOpts{trim: true, check: patternCheck(equipmentPattern)})
	if in.Equipment == nil {
		in.Equipment = []string{}
	}
	in.HyroxStationOrder = f.integer("hyrox_station_order", nullDefault, numOpts{min: bound(1), max: bound(8)})
	in.Difficulty = deref(f.integer("difficulty", required, numOpts{min: bound(1), max: bound(3)}))
	spec := f.child("default_spec")
	in.DefaultSpec.DistanceM = spec.integer("distanceM", nullable, numOpts{positive: true, max: bound(42_195)})
	in.DefaultSpec.Reps = spec.integer("reps", nullable, numOpts{positive: true, max: bound(1_000)})
	in.VideoURL = f.str("video_url", nullDefault, strOpts{trim: true, max: 500, check: urlCheck})
	in.IsActive = f.boolDefault("is_active", true)
	return in, f.err()
}

type substitutionInput struct {
	OriginalExerciseID    string
	AlternativeExerciseID string
	Similarity            float64
	VolumeFactor          float64
	ConversionNote        string
}

func parseSubstitution(r *http.Request) (substitutionInput, error) {
	f := newForm(readBody(r))
	in := substitutionInput{
		OriginalExerciseID:    deref(f.uuid("original_exercise_id", required)),
		AlternativeExerciseID: deref(f.uuid("alternative_exercise_id", required)),
		Similarity:            deref(f.num("similarity", required, numOpts{min: bound(0), max: bound(1)})),
		VolumeFactor:          1,
	}
	if v := f.num("volume_factor", rule{hasDefault: true}, numOpts{positive: true, max: bound(10)}); v != nil {
		in.VolumeFactor = *v
	}
	in.ConversionNote = f.strDefault("conversion_note", "", strOpts{trim: true, max: 300})
	if f.valid() && in.OriginalExerciseID == in.AlternativeExerciseID {
		f.fail("alternative_exercise_id", "custom", "Latihan pengganti harus berbeda")
	}
	return in, f.err()
}

/* ── Staff: races ────────────────────────────────────────────────────── */

type raceInput struct {
	ID                          *string
	Name, Country, Region, City string
	Venue                       string
	StartsAt, EndsAt            string
	RegistrationURL             string
	ImageURL                    *string
	Status                      string
}

func parseRace(r *http.Request) (raceInput, error) {
	f := newForm(readBody(r))
	in := raceInput{ID: f.uuid("id", optional)}
	in.Name = deref(f.str("name", required, strOpts{trim: true, min: 3, max: 120}))
	in.Country = deref(f.str("country", required, strOpts{trim: true, min: 2, max: 80}))
	in.Region = deref(f.enum("region", required, domain.RaceRegions))
	in.City = deref(f.str("city", required, strOpts{trim: true, min: 2, max: 80}))
	in.Venue = f.strDefault("venue", "", strOpts{trim: true, max: 160})
	in.StartsAt = deref(f.str("starts_at", required, strOpts{check: datetimeCheck}))
	in.EndsAt = deref(f.str("ends_at", required, strOpts{check: datetimeCheck}))
	in.RegistrationURL = f.strDefault("registration_url", "", strOpts{trim: true, max: 500})
	in.ImageURL = f.str("image_url", nullDefault, strOpts{trim: true, max: 500, check: urlCheck})
	in.Status = deref(f.enum("status", required, domain.RaceStatuses))
	if f.valid() {
		starts, _ := parseJSDate(in.StartsAt)
		ends, _ := parseJSDate(in.EndsAt)
		if ends.UnixMilli() < starts.UnixMilli() {
			f.fail("ends_at", "custom", "Selesai harus setelah mulai")
		}
	}
	return in, f.err()
}

/* ── Staff: incentives ───────────────────────────────────────────────── */

var idr = numOpts{min: bound(0), max: bound(100_000_000)}

type rateInput struct {
	ClassTypeID    string  `json:"class_type_id"`
	SessionFeeIDR  float64 `json:"session_fee_idr"`
	PerAttendeeIDR float64 `json:"per_attendee_idr"`
}

type schemeInput struct {
	ID                        *string
	Name                      string
	CoachID                   *string // nil = the organization default
	SessionFeeIDR             float64
	PerAttendeeIDR            float64
	FullClassBonusIDR         float64
	FullClassThresholdPercent int
	NoShowPenaltyIDR          float64
	IsActive                  bool
	Rates                     []rateInput
}

func parseScheme(r *http.Request) (schemeInput, error) {
	f := newForm(readBody(r))
	in := schemeInput{ID: f.uuid("id", optional)}
	in.Name = deref(f.str("name", required, strOpts{trim: true, min: 2, max: 80}))
	in.CoachID = f.uuid("coach_id", nullable)
	in.SessionFeeIDR = deref(f.num("session_fee_idr", required, idr))
	in.PerAttendeeIDR = deref(f.num("per_attendee_idr", required, idr))
	in.FullClassBonusIDR = deref(f.num("full_class_bonus_idr", required, idr))
	in.FullClassThresholdPercent = deref(f.integer("full_class_threshold_percent", required, numOpts{min: bound(0), max: bound(100)}))
	in.NoShowPenaltyIDR = deref(f.num("no_show_penalty_idr", required, idr))
	in.IsActive = f.boolDefault("is_active", true)
	in.Rates = []rateInput{}
	f.list("rates", rule{hasDefault: true}, 50, func(items *form, i int, v any) {
		item := items.itemForm(i, v)
		in.Rates = append(in.Rates, rateInput{
			ClassTypeID:    deref(item.uuid("class_type_id", required)),
			SessionFeeIDR:  deref(item.num("session_fee_idr", required, idr)),
			PerAttendeeIDR: deref(item.num("per_attendee_idr", required, idr)),
		})
	})
	if f.valid() {
		seen := map[string]bool{}
		for _, rate := range in.Rates {
			seen[rate.ClassTypeID] = true
		}
		if len(seen) != len(in.Rates) {
			f.fail("rates", "custom", "Satu tarif per jenis kelas")
		}
	}
	return in, f.err()
}

type payoutCreateInput struct{ CoachID, Month string }

func parsePayoutCreate(r *http.Request) (payoutCreateInput, error) {
	f := newForm(readBody(r))
	in := payoutCreateInput{
		CoachID: deref(f.uuid("coach_id", required)),
		Month: deref(f.str("month", required, strOpts{check: func(s string) (string, string, bool) {
			return "custom", "Bulan harus berformat YYYY-MM", domain.IsPeriodMonth(s)
		}})),
	}
	return in, f.err()
}

type payoutActionInput struct {
	Action           string
	PaymentReference *string
	Note             *string
}

func parsePayoutAction(r *http.Request) (payoutActionInput, error) {
	f := newForm(readBody(r))
	in := payoutActionInput{
		Action:           deref(f.enum("action", required, domain.PayoutActions)),
		PaymentReference: f.str("payment_reference", optionalNull, strOpts{max: 120}),
		Note:             f.str("note", optionalNull, strOpts{max: 500}),
	}
	return in, f.err()
}

/* ── Member: workouts ────────────────────────────────────────────────── */

type generateInput struct {
	Type                string
	Division            string
	StationOrders       []int
	ExcludedExerciseIDs []string
	// nil = every piece of equipment is available.
	AvailableEquipment []string
}

// parseGenerate returns ok=false for "Pilihan workout tidak valid".
func parseGenerate(r *http.Request) (generateInput, bool) {
	f := newForm(readBody(r))
	in := generateInput{
		Type:                deref(f.enum("type", required, domain.WorkoutTypes)),
		Division:            deref(f.enum("division", required, domain.Divisions)),
		StationOrders:       f.ints("station_orders", rule{hasDefault: true}, 8, numOpts{min: bound(1), max: bound(8)}),
		ExcludedExerciseIDs: f.strings("excluded_exercise_ids", rule{hasDefault: true}, 20, strOpts{check: uuidCheck}),
		AvailableEquipment:  f.strings("available_equipment", nullDefault, 30, strOpts{max: 30}),
	}
	if in.StationOrders == nil {
		in.StationOrders = []int{}
	}
	if in.ExcludedExerciseIDs == nil {
		in.ExcludedExerciseIDs = []string{}
	}
	return in, f.valid()
}

type replaceInput struct {
	Order      int
	ExerciseID string
}

func parseReplace(r *http.Request) (replaceInput, bool) {
	f := newForm(readBody(r))
	in := replaceInput{
		Order:      deref(f.integer("order", required, numOpts{min: bound(1)})),
		ExerciseID: deref(f.uuid("exercise_id", required)),
	}
	return in, f.valid()
}

// sessionAction is the discriminated union of the session route.
type sessionAction struct {
	Action       string // pause | resume | record | complete
	Block        domain.BlockResult
	BlockResults []domain.BlockResult
	Partial      bool
}

var blockDuration = numOpts{min: bound(0), max: bound(24 * 3600)}

func parseSessionAction(r *http.Request) (sessionAction, bool) {
	f := newForm(readBody(r))
	in := sessionAction{Action: deref(f.enum("action", required, []string{"pause", "resume", "record", "complete"}))}
	if !f.valid() {
		return in, false
	}
	switch in.Action {
	case "record":
		in.Block = domain.BlockResult{
			Order:       deref(f.integer("order", required, numOpts{min: bound(1)})),
			DurationSec: deref(f.num("duration_sec", required, blockDuration)),
		}
	case "complete":
		in.BlockResults = []domain.BlockResult{}
		f.list("block_results", rule{hasDefault: true}, 64, func(items *form, i int, v any) {
			item := items.itemForm(i, v)
			in.BlockResults = append(in.BlockResults, domain.BlockResult{
				Order:       deref(item.integer("order", required, numOpts{min: bound(1)})),
				DurationSec: deref(item.num("duration_sec", required, blockDuration)),
			})
		})
		in.Partial = f.boolDefault("partial", false)
	}
	return in, f.valid()
}

/* ── Member: races ───────────────────────────────────────────────────── */

var raceSeconds = numOpts{positive: true, max: bound(6 * 3600)}

type registerInput struct {
	RaceEventID string
	Division    string
	GoalSec     *int
}

func parseRegister(r *http.Request) (registerInput, bool) {
	f := newForm(readBody(r))
	in := registerInput{
		RaceEventID: deref(f.uuid("race_event_id", required)),
		Division:    deref(f.enum("division", required, domain.Divisions)),
		GoalSec:     f.integer("goal_sec", nullDefault, raceSeconds),
	}
	return in, f.valid()
}

func parseRaceUpdate(r *http.Request) (domain.MemberRaceUpdate, bool) {
	f := newForm(readBody(r))
	var u domain.MemberRaceUpdate
	u.Division = f.enum("division", optional, domain.Divisions)
	if f.obj != nil {
		_, u.GoalSet = f.obj["goal_sec"]
	}
	u.GoalSec = f.integer("goal_sec", optionalNull, raceSeconds)
	if result := f.integer("result_sec", optional, raceSeconds); result != nil {
		u.ResultSec = ptrTo(float64(*result))
	}
	u.Cancel = deref(f.boolean("cancel", optional))
	return u, f.valid()
}

/* ── query and path parameters ───────────────────────────────────────── */

// requireUUID mirrors requireUuid in staff-route.ts.
func requireUUID(value, message string) (string, error) {
	if value == "" || !isUUID(value) {
		return "", httpx.BadRequest(message)
	}
	return value, nil
}

func deref[T any](p *T) T {
	if p == nil {
		var zero T
		return zero
	}
	return *p
}

func ptrTo[T any](v T) *T { return &v }
