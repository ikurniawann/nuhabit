package engagement

import (
	"net/http"
	"sort"
	"time"

	"nuhabit/backend/internal/modules/crm/engagement/domain"
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

var (
	required = validate.Rule{}
	optional = validate.Rule{Optional: true}
	nullOpt  = validate.Rule{Optional: true, Nullable: true}
	withDef  = validate.Rule{HasDefault: true}
)

func bounds(lo, hi float64) validate.NumOpts {
	return validate.NumOpts{Min: validate.Bound(lo), Max: validate.Bound(hi)}
}

func datetime(f *validate.Form, key string) *string {
	return f.Str(key, required, validate.StrOpts{Check: validate.DatetimeCheck})
}

// jsDate is new Date(s) for the shapes a datetime field can carry; ok is
// false where JS yields an Invalid Date.
func jsDate(s *string) (time.Time, bool) {
	if s == nil {
		return time.Time{}, false
	}
	if t, ok := validate.ParseJSDate(*s); ok {
		return t, true
	}
	t, err := time.Parse("2006-01-02", *s)
	return t, err == nil
}

// endsAfterStart is the schemas' object refine. zod v4 runs it unless an
// earlier issue aborted (a wrong type or enum value); failed checks such as
// a bad datetime format do not stop it.
func endsAfterStart(f *validate.Form, starts, ends *string) {
	if f.Fields() == nil || aborted(f.Issues()) {
		return
	}
	s, okS := jsDate(starts)
	e, okE := jsDate(ends)
	if !okS || !okE || !e.After(s) {
		f.Fail(nil, "custom", "Selesai harus setelah mulai")
	}
}

type idResult struct {
	ID string `json:"id"`
}

const challengeSelect = `SELECT c.*, c.target::float AS target, c.reward_ark_idr::float AS reward_ark_idr,
            count(j.*)::int AS participant_count,
            count(j.rewarded_at)::int AS completed_count
       FROM crm.challenges c LEFT JOIN crm.challenge_joins j ON j.challenge_id = c.id
      WHERE ($1::uuid IS NULL OR c.id = $1)
      GROUP BY c.id ORDER BY c.ends_at DESC`

// getChallenges lists every challenge, or with ?id= one challenge's
// participants by progress.
func (h *handler) getChallenges(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateEngagement); err != nil {
		return err
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		rows, err := kit.Query(r.Context(), h.db, challengeSelect, nil)
		if err != nil {
			return err
		}
		return kit.OK(w, rows)
	}
	if !validate.IsUUID(id) {
		return httpx.NotFound("Challenge tidak ditemukan")
	}
	return h.challengeParticipants(w, r, id)
}

func (h *handler) challengeParticipants(w http.ResponseWriter, r *http.Request, id string) error {
	ctx := r.Context()
	challenge, err := kit.QueryOne(ctx, h.db, challengeSelect, id)
	if err != nil {
		return err
	}
	if challenge == nil {
		return httpx.NotFound("Challenge tidak ditemukan")
	}
	people, err := kit.Query(ctx, h.db, `SELECT j.customer_id, j.joined_at, j.rewarded_at, c.name, c.phone
       FROM crm.challenge_joins j JOIN pos.pos_customers c ON c.id = j.customer_id
      WHERE j.challenge_id = $1`, id)
	if err != nil {
		return err
	}
	values := map[string]float64{}
	if len(people) > 0 {
		ids := make([]string, len(people))
		for i, p := range people {
			ids[i] = p.Str("customer_id")
		}
		// The TS binds the row's JS Dates, which carry milliseconds only.
		from, _ := challenge.Time("starts_at")
		to, _ := challenge.Time("ends_at")
		values, err = h.orders.ChallengeValues(ctx, h.db, challenge.Str("metric"),
			from.Truncate(time.Millisecond), to.Truncate(time.Millisecond), ids)
		if err != nil {
			return err
		}
	}
	participants := make([]*kit.Row, len(people))
	for i, p := range people {
		progress := domain.Progress(values[p.Str("customer_id")], challenge.Num("target"))
		row := p.Clone()
		row.Set("value", progress.Value)
		row.Set("target", progress.Target)
		row.Set("pct", progress.Pct)
		row.Set("completed", progress.Completed)
		participants[i] = row
	}
	sort.SliceStable(participants, func(i, j int) bool {
		return participants[i].Num("value") > participants[j].Num("value")
	})
	return kit.OK(w, struct {
		Challenge    *kit.Row   `json:"challenge"`
		Participants []*kit.Row `json:"participants"`
	}{challenge, participants})
}

// saveChallenge creates or updates a challenge.
func (h *handler) saveChallenge(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateEngagement); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	id := f.UUID("id", optional)
	title := f.Str("title", required, validate.StrOpts{Trim: true, Min: 3, Max: 120})
	description := f.StrDefault("description", "", validate.StrOpts{Max: 1000})
	metric := f.Enum("metric", required, []string{"visits", "spend"})
	target := f.Num("target", required, validate.NumOpts{Positive: true, Max: validate.Bound(1_000_000_000)})
	starts, ends := datetime(f, "starts_at"), datetime(f, "ends_at")
	rewardXP := f.Int("reward_xp", required, bounds(0, 1_000_000))
	rewardArk := f.Num("reward_ark_idr", required, bounds(0, 100_000_000))
	active := f.Bool("is_active", required)
	endsAfterStart(f, starts, ends)
	if err := kit.CrmInputErr(f); err != nil {
		return err
	}
	args := []any{*title, description, *metric, *target, *starts, *ends, *rewardXP, *rewardArk, *active}
	var out idResult
	if id != nil {
		err = h.db.QueryRow(r.Context(), `UPDATE crm.challenges SET title=$1, description=$2, metric=$3, target=$4,
                starts_at=$5::text::timestamptz, ends_at=$6::text::timestamptz,
                reward_xp=$7, reward_ark_idr=$8, is_active=$9, updated_at=now()
          WHERE id=$10 RETURNING id::text`, append(args, *id)...).Scan(&out.ID)
	} else {
		err = h.db.QueryRow(r.Context(), `INSERT INTO crm.challenges (title, description, metric, target, starts_at, ends_at, reward_xp,
                                     reward_ark_idr, is_active)
         VALUES ($1,$2,$3,$4,$5::text::timestamptz,$6::text::timestamptz,$7,$8,$9) RETURNING id::text`, args...).Scan(&out.ID)
	}
	if database.IsNoRows(err) {
		return httpx.NotFound("Challenge tidak ditemukan")
	}
	if err != nil {
		return err
	}
	return kit.OK(w, out)
}
