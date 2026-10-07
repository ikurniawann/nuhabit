package gymtraining

import (
	"net/http"
	"regexp"

	"nuhabit/backend/internal/modules/gymtraining/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Request bodies, one parser per zod schema of the TS routes.

var (
	required = validate.Rule{}
	optional = validate.Rule{Optional: true}
	nullable = validate.Rule{Nullable: true}
	// nullDefault is .nullable().default(null): absent and null both mean nil.
	nullDefault = validate.Rule{Nullable: true, HasDefault: true}
	// optionalNull is .nullable().optional().
	optionalNull = validate.Rule{Nullable: true, Optional: true}
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
	f := validate.New(validate.ReadBody(r))
	in := exerciseInput{ID: f.UUID("id", optional)}
	in.Code = deref(f.Str("code", required, validate.StrOpts{Trim: true, Check: patternCheck(exerciseCodePattern)}))
	in.Name = deref(f.Str("name", required, validate.StrOpts{Trim: true, Min: 2, Max: 80}))
	in.Description = f.StrDefault("description", "", validate.StrOpts{Max: 1000})
	in.Category = deref(f.Enum("category", required, domain.ExerciseCategories))
	in.Equipment = f.Strings("equipment", validate.Rule{HasDefault: true}, 10, validate.StrOpts{Trim: true, Check: patternCheck(equipmentPattern)})
	if in.Equipment == nil {
		in.Equipment = []string{}
	}
	in.HyroxStationOrder = f.Int("hyrox_station_order", nullDefault, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(8)})
	in.Difficulty = deref(f.Int("difficulty", required, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(3)}))
	spec := f.Child("default_spec")
	in.DefaultSpec.DistanceM = spec.Int("distanceM", nullable, validate.NumOpts{Positive: true, Max: validate.Bound(42_195)})
	in.DefaultSpec.Reps = spec.Int("reps", nullable, validate.NumOpts{Positive: true, Max: validate.Bound(1_000)})
	in.VideoURL = f.Str("video_url", nullDefault, validate.StrOpts{Trim: true, Max: 500, Check: validate.URLCheck})
	in.IsActive = f.BoolDefault("is_active", true)
	return in, f.ErrAtPath("Data tidak valid")
}

type substitutionInput struct {
	OriginalExerciseID    string
	AlternativeExerciseID string
	Similarity            float64
	VolumeFactor          float64
	ConversionNote        string
}

func parseSubstitution(r *http.Request) (substitutionInput, error) {
	f := validate.New(validate.ReadBody(r))
	in := substitutionInput{
		OriginalExerciseID:    deref(f.UUID("original_exercise_id", required)),
		AlternativeExerciseID: deref(f.UUID("alternative_exercise_id", required)),
		Similarity:            deref(f.Num("similarity", required, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(1)})),
		VolumeFactor:          1,
	}
	if v := f.Num("volume_factor", validate.Rule{HasDefault: true}, validate.NumOpts{Positive: true, Max: validate.Bound(10)}); v != nil {
		in.VolumeFactor = *v
	}
	in.ConversionNote = f.StrDefault("conversion_note", "", validate.StrOpts{Trim: true, Max: 300})
	if f.Valid() && in.OriginalExerciseID == in.AlternativeExerciseID {
		f.Fail("alternative_exercise_id", "custom", "Latihan pengganti harus berbeda")
	}
	return in, f.ErrAtPath("Data tidak valid")
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
	f := validate.New(validate.ReadBody(r))
	in := raceInput{ID: f.UUID("id", optional)}
	in.Name = deref(f.Str("name", required, validate.StrOpts{Trim: true, Min: 3, Max: 120}))
	in.Country = deref(f.Str("country", required, validate.StrOpts{Trim: true, Min: 2, Max: 80}))
	in.Region = deref(f.Enum("region", required, domain.RaceRegions))
	in.City = deref(f.Str("city", required, validate.StrOpts{Trim: true, Min: 2, Max: 80}))
	in.Venue = f.StrDefault("venue", "", validate.StrOpts{Trim: true, Max: 160})
	in.StartsAt = deref(f.Str("starts_at", required, validate.StrOpts{Check: validate.DatetimeCheck}))
	in.EndsAt = deref(f.Str("ends_at", required, validate.StrOpts{Check: validate.DatetimeCheck}))
	in.RegistrationURL = f.StrDefault("registration_url", "", validate.StrOpts{Trim: true, Max: 500})
	in.ImageURL = f.Str("image_url", nullDefault, validate.StrOpts{Trim: true, Max: 500, Check: validate.URLCheck})
	in.Status = deref(f.Enum("status", required, domain.RaceStatuses))
	if f.Valid() {
		starts, _ := validate.ParseJSDate(in.StartsAt)
		ends, _ := validate.ParseJSDate(in.EndsAt)
		if ends.UnixMilli() < starts.UnixMilli() {
			f.Fail("ends_at", "custom", "Selesai harus setelah mulai")
		}
	}
	return in, f.ErrAtPath("Data tidak valid")
}

/* ── Staff: incentives ───────────────────────────────────────────────── */

var idr = validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(100_000_000)}

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
	f := validate.New(validate.ReadBody(r))
	in := schemeInput{ID: f.UUID("id", optional)}
	in.Name = deref(f.Str("name", required, validate.StrOpts{Trim: true, Min: 2, Max: 80}))
	in.CoachID = f.UUID("coach_id", nullable)
	in.SessionFeeIDR = deref(f.Num("session_fee_idr", required, idr))
	in.PerAttendeeIDR = deref(f.Num("per_attendee_idr", required, idr))
	in.FullClassBonusIDR = deref(f.Num("full_class_bonus_idr", required, idr))
	in.FullClassThresholdPercent = deref(f.Int("full_class_threshold_percent", required, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(100)}))
	in.NoShowPenaltyIDR = deref(f.Num("no_show_penalty_idr", required, idr))
	in.IsActive = f.BoolDefault("is_active", true)
	in.Rates = []rateInput{}
	f.List("rates", validate.Rule{HasDefault: true}, 50, func(items *validate.Form, i int, v any) {
		item := items.Item(i, v)
		in.Rates = append(in.Rates, rateInput{
			ClassTypeID:    deref(item.UUID("class_type_id", required)),
			SessionFeeIDR:  deref(item.Num("session_fee_idr", required, idr)),
			PerAttendeeIDR: deref(item.Num("per_attendee_idr", required, idr)),
		})
	})
	if f.Valid() {
		seen := map[string]bool{}
		for _, rate := range in.Rates {
			seen[rate.ClassTypeID] = true
		}
		if len(seen) != len(in.Rates) {
			f.Fail("rates", "custom", "Satu tarif per jenis kelas")
		}
	}
	return in, f.ErrAtPath("Data tidak valid")
}

type payoutCreateInput struct{ CoachID, Month string }

func parsePayoutCreate(r *http.Request) (payoutCreateInput, error) {
	f := validate.New(validate.ReadBody(r))
	in := payoutCreateInput{
		CoachID: deref(f.UUID("coach_id", required)),
		Month: deref(f.Str("month", required, validate.StrOpts{Check: func(s string) (string, string, bool) {
			return "custom", "Bulan harus berformat YYYY-MM", domain.IsPeriodMonth(s)
		}})),
	}
	return in, f.ErrAtPath("Data tidak valid")
}

type payoutActionInput struct {
	Action           string
	PaymentReference *string
	Note             *string
}

func parsePayoutAction(r *http.Request) (payoutActionInput, error) {
	f := validate.New(validate.ReadBody(r))
	in := payoutActionInput{
		Action:           deref(f.Enum("action", required, domain.PayoutActions)),
		PaymentReference: f.Str("payment_reference", optionalNull, validate.StrOpts{Max: 120}),
		Note:             f.Str("note", optionalNull, validate.StrOpts{Max: 500}),
	}
	return in, f.ErrAtPath("Data tidak valid")
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
	f := validate.New(validate.ReadBody(r))
	in := generateInput{
		Type:                deref(f.Enum("type", required, domain.WorkoutTypes)),
		Division:            deref(f.Enum("division", required, domain.Divisions)),
		StationOrders:       f.Ints("station_orders", validate.Rule{HasDefault: true}, 8, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(8)}),
		ExcludedExerciseIDs: f.Strings("excluded_exercise_ids", validate.Rule{HasDefault: true}, 20, validate.StrOpts{Check: validate.UUIDCheck}),
		AvailableEquipment:  f.Strings("available_equipment", nullDefault, 30, validate.StrOpts{Max: 30}),
	}
	if in.StationOrders == nil {
		in.StationOrders = []int{}
	}
	if in.ExcludedExerciseIDs == nil {
		in.ExcludedExerciseIDs = []string{}
	}
	return in, f.Valid()
}

type replaceInput struct {
	Order      int
	ExerciseID string
}

func parseReplace(r *http.Request) (replaceInput, bool) {
	f := validate.New(validate.ReadBody(r))
	in := replaceInput{
		Order:      deref(f.Int("order", required, validate.NumOpts{Min: validate.Bound(1)})),
		ExerciseID: deref(f.UUID("exercise_id", required)),
	}
	return in, f.Valid()
}

// sessionAction is the discriminated union of the session route.
type sessionAction struct {
	Action       string // pause | resume | record | complete
	Block        domain.BlockResult
	BlockResults []domain.BlockResult
	Partial      bool
}

var blockDuration = validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(24 * 3600)}

func parseSessionAction(r *http.Request) (sessionAction, bool) {
	f := validate.New(validate.ReadBody(r))
	in := sessionAction{Action: deref(f.Enum("action", required, []string{"pause", "resume", "record", "complete"}))}
	if !f.Valid() {
		return in, false
	}
	switch in.Action {
	case "record":
		in.Block = domain.BlockResult{
			Order:       deref(f.Int("order", required, validate.NumOpts{Min: validate.Bound(1)})),
			DurationSec: deref(f.Num("duration_sec", required, blockDuration)),
		}
	case "complete":
		in.BlockResults = []domain.BlockResult{}
		f.List("block_results", validate.Rule{HasDefault: true}, 64, func(items *validate.Form, i int, v any) {
			item := items.Item(i, v)
			in.BlockResults = append(in.BlockResults, domain.BlockResult{
				Order:       deref(item.Int("order", required, validate.NumOpts{Min: validate.Bound(1)})),
				DurationSec: deref(item.Num("duration_sec", required, blockDuration)),
			})
		})
		in.Partial = f.BoolDefault("partial", false)
	}
	return in, f.Valid()
}

/* ── Member: races ───────────────────────────────────────────────────── */

var raceSeconds = validate.NumOpts{Positive: true, Max: validate.Bound(6 * 3600)}

type registerInput struct {
	RaceEventID string
	Division    string
	GoalSec     *int
}

func parseRegister(r *http.Request) (registerInput, bool) {
	f := validate.New(validate.ReadBody(r))
	in := registerInput{
		RaceEventID: deref(f.UUID("race_event_id", required)),
		Division:    deref(f.Enum("division", required, domain.Divisions)),
		GoalSec:     f.Int("goal_sec", nullDefault, raceSeconds),
	}
	return in, f.Valid()
}

func parseRaceUpdate(r *http.Request) (domain.MemberRaceUpdate, bool) {
	f := validate.New(validate.ReadBody(r))
	var u domain.MemberRaceUpdate
	u.Division = f.Enum("division", optional, domain.Divisions)
	if f.Fields() != nil {
		_, u.GoalSet = f.Fields()["goal_sec"]
	}
	u.GoalSec = f.Int("goal_sec", optionalNull, raceSeconds)
	if result := f.Int("result_sec", optional, raceSeconds); result != nil {
		u.ResultSec = ptrTo(float64(*result))
	}
	u.Cancel = deref(f.Bool("cancel", optional))
	return u, f.Valid()
}

/* ── query and path parameters ───────────────────────────────────────── */

// requireUUID mirrors requireUuid in staff-route.ts.
func requireUUID(value, message string) (string, error) {
	if value == "" || !validate.IsUUID(value) {
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
