package gymcomplaints

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Complaint report: tickets raised in a period (local date of creation in
// Jakarta, inclusive), grouped by category, coach, source and branch, with
// the median and p90 resolution time and the reopened rate.

// Metrics are the figures of one group.
type Metrics struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Total int    `json:"total"`
	Open  int    `json:"open"`
	// Resolved counts tickets resolved or confirmed now.
	Resolved  int `json:"resolved"`
	Confirmed int `json:"confirmed"`
	Reopened  int `json:"reopened"`
	Escalated int `json:"escalated"`
	// ReopenedRate is reopened tickets over tickets that were ever resolved.
	ReopenedRate *float64 `json:"reopened_rate"`
	// Hours from creation to the first response and to the latest resolution.
	RespondMedianH *float64 `json:"respond_median_h"`
	ResolveMedianH *float64 `json:"resolve_median_h"`
	ResolveP90H    *float64 `json:"resolve_p90_h"`
}

// CoachMetrics adds the coach's attendees and complaints per 100 of them,
// the KPI coach_complaint_rate.
type CoachMetrics struct {
	Metrics
	Attendees  int      `json:"attendees"`
	RatePer100 *float64 `json:"rate_per_100"`
}

// Report is the whole page.
type Report struct {
	From       string         `json:"from"`
	To         string         `json:"to"`
	Summary    Metrics        `json:"summary"`
	ByCategory []Metrics      `json:"by_category"`
	BySource   []Metrics      `json:"by_source"`
	ByBranch   []Metrics      `json:"by_branch"`
	ByCoach    []CoachMetrics `json:"by_coach"`
}

const metricsSQL = `count(*)::int AS total,
  count(*) FILTER (WHERE k.status IN ('received', 'in_progress', 'reopened'))::int AS open_n,
  count(*) FILTER (WHERE k.status IN ('resolved', 'confirmed'))::int AS resolved_n,
  count(*) FILTER (WHERE k.status = 'confirmed')::int AS confirmed_n,
  count(*) FILTER (WHERE k.reopen_count > 0)::int AS reopened_n,
  count(*) FILTER (WHERE k.respond_escalated_at IS NOT NULL OR k.resolve_escalated_at IS NOT NULL)::int AS escalated_n,
  round((count(*) FILTER (WHERE k.reopen_count > 0)::numeric
    / NULLIF(count(*) FILTER (WHERE k.reopen_count > 0 OR k.resolved_at IS NOT NULL), 0)), 4)::float8 AS reopened_rate,
  round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM k.first_response_at - k.created_at) / 3600))::numeric, 1)::float8 AS respond_median_h,
  round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM k.resolved_at - k.created_at) / 3600))::numeric, 1)::float8 AS resolve_median_h,
  round((percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM k.resolved_at - k.created_at) / 3600))::numeric, 1)::float8 AS resolve_p90_h`

// periodSQL is the period and branch filter; $1 from, $2 to, $3 branch or NULL.
const periodSQL = `(k.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date
  AND ($3::uuid IS NULL OR k.branch_id = $3::uuid)`

func scanMetrics(r pgx.Row, m *Metrics, extra ...any) error {
	dest := append([]any{&m.Key, &m.Label, &m.Total, &m.Open, &m.Resolved, &m.Confirmed, &m.Reopened, &m.Escalated,
		&m.ReopenedRate, &m.RespondMedianH, &m.ResolveMedianH, &m.ResolveP90H}, extra...)
	return r.Scan(dest...)
}

// Report builds the complaint report of from..to (YYYY-MM-DD), of one
// branch when branchID is set.
func (s *Service) Report(ctx context.Context, from, to string, branchID *string) (Report, error) {
	out := Report{From: from, To: to}
	args := []any{from, to, branchID}
	if err := scanMetrics(s.db.QueryRow(ctx, `SELECT '', '', `+metricsSQL+` FROM gym.complaints k WHERE `+periodSQL, args...), &out.Summary); err != nil {
		return out, err
	}
	group := func(key, label, join string) ([]Metrics, error) {
		rows, err := s.db.Query(ctx, fmt.Sprintf(`SELECT COALESCE(%[1]s, ''), COALESCE(%[2]s, 'Tanpa cabang'), %[3]s
		  FROM gym.complaints k %[4]s WHERE %[5]s GROUP BY 1, 2 ORDER BY 3 DESC, 2`, key, label, metricsSQL, join, periodSQL), args...)
		if err != nil {
			return nil, err
		}
		return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Metrics, error) {
			var m Metrics
			return m, scanMetrics(r, &m)
		})
	}
	var err error
	if out.ByCategory, err = group("k.category", "cat.label", "JOIN gym.complaint_categories cat ON cat.code = k.category"); err != nil {
		return out, err
	}
	if out.BySource, err = group("k.source", "k.source", ""); err != nil {
		return out, err
	}
	if out.ByBranch, err = group("k.branch_id::text", "br.name", "LEFT JOIN configuration.branches br ON br.id = k.branch_id"); err != nil {
		return out, err
	}

	// Every coach with attendees or linked tickets in the period, so a coach
	// without complaints shows a zero rate.
	rows, err := s.db.Query(ctx, `WITH att AS (
	    SELECT s.coach_id, count(*)::int AS attendees
	      FROM gym.bookings b JOIN gym.class_sessions s ON s.id = b.session_id
	     WHERE b.status IN ('checked_in', 'completed') AND s.coach_id IS NOT NULL
	       AND (s.starts_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date
	       AND ($3::uuid IS NULL OR s.branch_id = $3::uuid)
	     GROUP BY s.coach_id
	  ), kel AS (
	    SELECT k.coach_id, `+metricsSQL+`
	      FROM gym.complaints k WHERE k.coach_id IS NOT NULL AND `+periodSQL+`
	     GROUP BY k.coach_id
	  )
	  SELECT co.id::text, co.name, COALESCE(kel.total, 0), COALESCE(kel.open_n, 0), COALESCE(kel.resolved_n, 0),
	         COALESCE(kel.confirmed_n, 0), COALESCE(kel.reopened_n, 0), COALESCE(kel.escalated_n, 0),
	         kel.reopened_rate, kel.respond_median_h, kel.resolve_median_h, kel.resolve_p90_h,
	         COALESCE(att.attendees, 0),
	         CASE WHEN COALESCE(att.attendees, 0) > 0 THEN round(COALESCE(kel.total, 0) * 100.0 / att.attendees, 2)::float8 END
	    FROM gym.coaches co
	    LEFT JOIN att ON att.coach_id = co.id
	    LEFT JOIN kel ON kel.coach_id = co.id
	   WHERE att.coach_id IS NOT NULL OR kel.coach_id IS NOT NULL
	   ORDER BY 3 DESC, 14 DESC NULLS LAST, co.name`, args...)
	if err != nil {
		return out, err
	}
	out.ByCoach, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (CoachMetrics, error) {
		var m CoachMetrics
		return m, scanMetrics(r, &m.Metrics, &m.Attendees, &m.RatePer100)
	})
	return out, err
}
