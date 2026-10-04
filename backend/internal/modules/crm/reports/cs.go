package reports

import (
	"net/http"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/reports/domain"
)

type csSummary struct {
	TotalConversations      any      `json:"total_conversations"`
	TotalComplaints         any      `json:"total_complaints"`
	TotalResolved           any      `json:"total_resolved"`
	TotalSLABreached        any      `json:"total_sla_breached"`
	AvgFirstResponseSeconds *float64 `json:"avg_first_response_seconds"`
	AvgResolutionSeconds    *float64 `json:"avg_resolution_seconds"`
	AvgCSAT                 *float64 `json:"avg_csat"`
	CSATResponses           any      `json:"csat_responses"`
}

type csDaily struct {
	Tanggal       any `json:"tanggal"`
	Conversations any `json:"conversations"`
	Complaints    any `json:"complaints"`
	SLABreached   any `json:"sla_breached"`
}

type csCategory struct {
	Category             any      `json:"category"`
	Priority             any      `json:"priority"`
	Total                any      `json:"total"`
	Resolved             any      `json:"resolved"`
	AvgResolutionSeconds *float64 `json:"avg_resolution_seconds"`
}

type csCSAT struct {
	Score float64 `json:"score"`
	Total any     `json:"total"`
}

type csChannel struct {
	Channel                 any      `json:"channel"`
	Conversations           any      `json:"conversations"`
	Complaints              any      `json:"complaints"`
	Resolved                any      `json:"resolved"`
	AvgFirstResponseSeconds *float64 `json:"avg_first_response_seconds"`
	AvgCSAT                 *float64 `json:"avg_csat"`
}

type csReviews struct {
	Total     any      `json:"total"`
	AvgRating *float64 `json:"avg_rating"`
	Replied   any      `json:"replied"`
	LowRating any      `json:"low_rating"`
}

type csAgent struct {
	AgentName               any      `json:"agent_name"`
	Handled                 any      `json:"handled"`
	Resolved                any      `json:"resolved"`
	AvgFirstResponseSeconds *float64 `json:"avg_first_response_seconds"`
	AvgCSAT                 *float64 `json:"avg_csat"`
}

type csReport struct {
	Period           periodLabel  `json:"period"`
	Summary          csSummary    `json:"summary"`
	Daily            []csDaily    `json:"daily"`
	Categories       []csCategory `json:"categories"`
	CSATDistribution []csCSAT     `json:"csat_distribution"`
	Channels         []csChannel  `json:"channels"`
	Reviews          csReviews    `json:"reviews"`
	Agents           []csAgent    `json:"agents"`
}

// round2 is the CS report's toNum over a node-postgres value.
func round2(v any) *float64 {
	if v == nil {
		return nil
	}
	x := kit.ToNumber(v)
	return domain.Round2(&x)
}

// orZero is `value ?? 0`.
func orZero(row *kit.Row, key string) any {
	if v := get(row, key); v != nil {
		return v
	}
	return 0
}

func (h *handler) cs(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateReports); err != nil {
		return err
	}
	period, err := h.requirePeriod(r)
	if err != nil {
		return err
	}
	ctx, from, to := r.Context(), period.FromISO, period.ToISO
	summary, err := kit.QueryOne(ctx, h.db, `SELECT
         COUNT(*)::int AS total_conversations,
         COUNT(*) FILTER (WHERE is_complaint)::int AS total_complaints,
         COUNT(*) FILTER (WHERE status = 'resolved')::int AS total_resolved,
         COUNT(*) FILTER (WHERE sla_response_breached)::int AS total_sla_breached,
         AVG(first_response_seconds) FILTER (WHERE first_response_seconds IS NOT NULL) AS avg_first_response_seconds,
         AVG(resolution_seconds) FILTER (WHERE resolution_seconds IS NOT NULL) AS avg_resolution_seconds,
         AVG(csat_score) FILTER (WHERE csat_score IS NOT NULL) AS avg_csat,
         COUNT(*) FILTER (WHERE csat_score IS NOT NULL)::int AS csat_responses
       FROM crm.wa_conversations
      WHERE created_at >= $1 AND created_at < $2`, from, to)
	if err != nil {
		return err
	}
	daily, err := kit.Query(ctx, h.db, `SELECT (created_at AT TIME ZONE 'Asia/Jakarta')::date AS tanggal,
              COUNT(*)::int AS conversations,
              COUNT(*) FILTER (WHERE is_complaint)::int AS complaints,
              COUNT(*) FILTER (WHERE sla_response_breached)::int AS sla_breached
         FROM crm.wa_conversations
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY 1 ORDER BY 1`, from, to)
	if err != nil {
		return err
	}
	categories, err := kit.Query(ctx, h.db, `SELECT COALESCE(category, 'belum_dikategorikan') AS category,
              priority,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
              AVG(resolution_seconds) FILTER (WHERE resolution_seconds IS NOT NULL) AS avg_resolution_seconds
         FROM crm.wa_conversations
        WHERE is_complaint AND created_at >= $1 AND created_at < $2
        GROUP BY 1, 2 ORDER BY total DESC`, from, to)
	if err != nil {
		return err
	}
	csat, err := kit.Query(ctx, h.db, `SELECT csat_score AS score, COUNT(*)::int AS total
         FROM crm.wa_conversations
        WHERE csat_score IS NOT NULL AND created_at >= $1 AND created_at < $2
        GROUP BY 1 ORDER BY 1`, from, to)
	if err != nil {
		return err
	}
	agents, err := kit.Query(ctx, h.db, `SELECT u.full_name AS agent_name,
              COUNT(*)::int AS handled,
              COUNT(*) FILTER (WHERE v.status = 'resolved')::int AS resolved,
              AVG(v.first_response_seconds) FILTER (WHERE v.first_response_seconds IS NOT NULL) AS avg_first_response_seconds,
              AVG(v.csat_score) FILTER (WHERE v.csat_score IS NOT NULL) AS avg_csat
         FROM crm.wa_conversations v
         JOIN configuration.users u ON u.id = v.assigned_user_id
        WHERE v.created_at >= $1 AND v.created_at < $2
        GROUP BY u.full_name ORDER BY handled DESC LIMIT 20`, from, to)
	if err != nil {
		return err
	}
	channels, err := kit.Query(ctx, h.db, `SELECT channel,
              COUNT(*)::int AS conversations,
              COUNT(*) FILTER (WHERE is_complaint)::int AS complaints,
              COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
              AVG(first_response_seconds) FILTER (WHERE first_response_seconds IS NOT NULL) AS avg_first_response_seconds,
              AVG(csat_score) FILTER (WHERE csat_score IS NOT NULL) AS avg_csat
         FROM crm.wa_conversations
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY channel ORDER BY conversations DESC`, from, to)
	if err != nil {
		return err
	}
	reviews, err := kit.QueryOne(ctx, h.db, `SELECT COUNT(*)::int AS total_reviews,
              AVG(star_rating)::numeric(3,2) AS avg_rating,
              COUNT(*) FILTER (WHERE reply_comment IS NOT NULL)::int AS replied,
              COUNT(*) FILTER (WHERE star_rating <= 2)::int AS low_rating
         FROM crm.google_reviews
        WHERE review_created_at >= $1 AND review_created_at < $2`, from, to)
	if err != nil {
		return err
	}

	out := csReport{
		Period: periodLabel{From: period.FromISO, To: period.ToISO},
		Summary: csSummary{
			TotalConversations: orZero(summary, "total_conversations"), TotalComplaints: orZero(summary, "total_complaints"),
			TotalResolved: orZero(summary, "total_resolved"), TotalSLABreached: orZero(summary, "total_sla_breached"),
			AvgFirstResponseSeconds: round2(get(summary, "avg_first_response_seconds")),
			AvgResolutionSeconds:    round2(get(summary, "avg_resolution_seconds")),
			AvgCSAT:                 round2(get(summary, "avg_csat")),
			CSATResponses:           orZero(summary, "csat_responses"),
		},
		Daily: []csDaily{}, Categories: []csCategory{}, CSATDistribution: []csCSAT{}, Channels: []csChannel{}, Agents: []csAgent{},
		Reviews: csReviews{
			Total: orZero(reviews, "total_reviews"), AvgRating: round2(get(reviews, "avg_rating")),
			Replied: orZero(reviews, "replied"), LowRating: orZero(reviews, "low_rating"),
		},
	}
	for _, row := range daily {
		out.Daily = append(out.Daily, csDaily{row.Get("tanggal"), row.Get("conversations"), row.Get("complaints"), row.Get("sla_breached")})
	}
	for _, row := range categories {
		out.Categories = append(out.Categories, csCategory{row.Get("category"), row.Get("priority"), row.Get("total"), row.Get("resolved"), round2(row.Get("avg_resolution_seconds"))})
	}
	for _, row := range csat {
		out.CSATDistribution = append(out.CSATDistribution, csCSAT{row.Num("score"), row.Get("total")})
	}
	for _, row := range channels {
		out.Channels = append(out.Channels, csChannel{row.Get("channel"), row.Get("conversations"), row.Get("complaints"), row.Get("resolved"),
			round2(row.Get("avg_first_response_seconds")), round2(row.Get("avg_csat"))})
	}
	for _, row := range agents {
		out.Agents = append(out.Agents, csAgent{row.Get("agent_name"), row.Get("handled"), row.Get("resolved"),
			round2(row.Get("avg_first_response_seconds")), round2(row.Get("avg_csat"))})
	}
	return kit.OK(w, out)
}
