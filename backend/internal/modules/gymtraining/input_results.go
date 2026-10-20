package gymtraining

import (
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strconv"

	"nuhabit/backend/internal/modules/gymtraining/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

/* ── Member: HYROX results ───────────────────────────────────────────── */

// A split is at most two hours, Roxzone the same, a total at most six.
var (
	splitSeconds   = validate.NumOpts{Integer: true, Positive: true, Max: validate.Bound(2 * 3600)}
	roxzoneSeconds = validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(2 * 3600)}
)

// resultFields are what a member enters and may later edit.
type resultFields struct {
	Division         string
	AgeGroup         *string
	Splits           domain.Splits
	OfficialTotalSec *int
}

// resultInput is a new result: the fields plus what it is a result of.
type resultInput struct {
	resultFields
	Source           string
	RaceEventID      *string
	WorkoutSessionID *string
}

const badResult = "Data hasil tidak valid"

// splitList reads an optional array of 8 split seconds; null items are
// splits the member left empty.
func splitList(f *validate.Form, key string) [domain.SplitCount]*int {
	var out [domain.SplitCount]*int
	items := f.List(key, validate.Rule{Optional: true}, domain.SplitCount, func(sub *validate.Form, i int, v any) {
		if v == nil || i >= domain.SplitCount {
			return
		}
		if x, ok := sub.CheckNumber(i, v, splitSeconds); ok {
			out[i] = ptrTo(int(x))
		}
	})
	if items != nil && len(items) != domain.SplitCount {
		f.Fail(key, "custom", fmt.Sprintf("Isi %d split", domain.SplitCount))
	}
	return out
}

func parseResultFields(f *validate.Form) resultFields {
	in := resultFields{
		Division: deref(f.Enum("division", required, domain.ResultDivisions)),
		AgeGroup: f.Enum("age_group", optionalNull, domain.AgeGroups),
	}
	in.Splits.Runs = splitList(f, "run_sec")
	in.Splits.Stations = splitList(f, "station_sec")
	in.Splits.Roxzone = f.Int("roxzone_sec", optionalNull, roxzoneSeconds)
	in.OfficialTotalSec = f.Int("official_total_sec", optionalNull, raceSeconds)
	return in
}

func parseResult(r *http.Request) (resultInput, error) {
	f := validate.New(validate.ReadBody(r))
	in := resultInput{
		Source:           deref(f.Enum("source", required, domain.ResultSources)),
		RaceEventID:      f.UUID("race_event_id", optionalNull),
		WorkoutSessionID: f.UUID("workout_session_id", optionalNull),
	}
	in.resultFields = parseResultFields(f)
	if f.Valid() {
		switch {
		case in.Source == "race" && (in.RaceEventID == nil || in.WorkoutSessionID != nil):
			f.Fail("race_event_id", "custom", "Pilih race dari kalender")
		case in.Source == "simulation" && (in.WorkoutSessionID == nil || in.RaceEventID != nil):
			f.Fail("workout_session_id", "custom", "Pilih simulasi yang sudah selesai")
		}
	}
	return in, f.ErrAtPath(badResult)
}

func parseResultUpdate(r *http.Request) (resultFields, error) {
	f := validate.New(validate.ReadBody(r))
	in := parseResultFields(f)
	return in, f.ErrAtPath(badResult)
}

/* ── Leaderboard query ───────────────────────────────────────────────── */

// boardQuery is a leaderboard request: the filter and the station (0 for
// the total).
type boardQuery struct {
	Filter  domain.BoardFilter
	Station int
}

const badBoard = "Filter leaderboard tidak valid"

func optionalParam(q url.Values, key string) *string {
	if v := q.Get(key); v != "" {
		return &v
	}
	return nil
}

// parseBoardQuery reads race_id, source, division, age_group, year,
// include_unverified and station.
func parseBoardQuery(q url.Values) (boardQuery, error) {
	var b boardQuery
	f := &b.Filter
	f.RaceEventID = optionalParam(q, "race_id")
	f.Source = optionalParam(q, "source")
	f.Division = optionalParam(q, "division")
	f.AgeGroup = optionalParam(q, "age_group")
	f.IncludeUnverified = q.Get("include_unverified") == "true"
	if f.RaceEventID != nil && !validate.IsUUID(*f.RaceEventID) ||
		f.Source != nil && !slices.Contains(domain.ResultSources, *f.Source) ||
		f.Division != nil && !slices.Contains(domain.ResultDivisions, *f.Division) ||
		f.AgeGroup != nil && !slices.Contains(domain.AgeGroups, *f.AgeGroup) {
		return b, httpx.BadRequest(badBoard)
	}
	if raw := q.Get("year"); raw != "" {
		year, err := strconv.Atoi(raw)
		if err != nil || year < 2000 || year > 2100 {
			return b, httpx.BadRequest(badBoard)
		}
		f.Year = &year
	}
	if raw := q.Get("station"); raw != "" {
		station, err := strconv.Atoi(raw)
		if err != nil || station < 1 || station > domain.SplitCount {
			return b, httpx.BadRequest(badBoard)
		}
		b.Station = station
	}
	return b, nil
}
