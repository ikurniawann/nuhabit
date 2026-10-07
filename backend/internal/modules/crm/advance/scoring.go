package advance

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"nuhabit/backend/internal/modules/crm/advance/domain"
	"nuhabit/backend/internal/modules/crm/internal/kit"
)

// Lead scoring of lib/crm/scoring-server.ts: load the rules, gather the
// lead's signals, write crm_sales_leads.score through the sales funnel.

func (h *handler) recalculateScores(w http.ResponseWriter, r *http.Request) error {
	_, s, err := h.guard.RequireScope(r, kit.GateSettings)
	if err != nil {
		return err
	}
	ctx := r.Context()
	var companyID *string
	if s != nil && s.CompanyID != nil && *s.CompanyID != "" {
		companyID = s.CompanyID
	}
	ids, err := h.ports.Sales.LeadIDs(ctx, h.db, companyID)
	if err != nil {
		return err
	}
	changed := 0
	for _, id := range ids {
		res, err := h.recalculateLeadScore(ctx, id)
		if err != nil {
			return err
		}
		if res != nil && res.changed {
			changed++
		}
	}
	return kit.OK(w, struct {
		Total   int `json:"total"`
		Changed int `json:"changed"`
	}{len(ids), changed}, fmt.Sprintf("%d lead dihitung ulang, %d berubah", len(ids), changed))
}

type scoreResult struct {
	previous, score int
	changed         bool
}

// recalculateLeadScore rescores one lead; nil when the lead is gone.
func (h *handler) recalculateLeadScore(ctx context.Context, leadID string) (*scoreResult, error) {
	lead, err := h.ports.Sales.ScoringLead(ctx, h.db, leadID)
	if err != nil || lead == nil {
		return nil, err
	}
	rules, err := h.loadScoringRules(ctx, lead.CompanyID)
	if err != nil {
		return nil, err
	}
	counts, err := h.eventCounts(ctx, lead, rules)
	if err != nil {
		return nil, err
	}
	score, breakdown := domain.ComputeLeadScore(rules, lead.Fields, counts)
	if err := h.ports.Records.SetLeadScore(ctx, h.db, leadID, score, jsonbText(breakdown)); err != nil {
		return nil, err
	}
	return &scoreResult{previous: lead.Score, score: score, changed: lead.Score != score}, nil
}

func (h *handler) loadScoringRules(ctx context.Context, companyID string) ([]domain.ScoringRule, error) {
	rows, err := h.db.Query(ctx, `SELECT id::text, name, kind, field, operator, value, event_type, window_days, max_count, points
     FROM crm.crm_scoring_rules
     WHERE is_active AND (company_id IS NULL OR company_id = $1)
     ORDER BY sort_order, created_at`, companyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.ScoringRule
	for rows.Next() {
		var r domain.ScoringRule
		var value []byte
		if err := rows.Scan(&r.ID, &r.Name, &r.Kind, &r.Field, &r.Operator, &value, &r.EventType, &r.WindowDays, &r.MaxCount, &r.Points); err != nil {
			return nil, err
		}
		if len(value) > 0 {
			if err := json.Unmarshal(value, &r.Value); err != nil {
				return nil, err
			}
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// eventCounts counts only the signals the event rules need (a missing key
// counts as 0).
func (h *handler) eventCounts(ctx context.Context, lead *ScoringLead, rules []domain.ScoringRule) (map[string]int, error) {
	counts := map[string]int{}
	needs := map[string]bool{}
	for _, r := range rules {
		if r.Kind == "event" && r.EventType != nil && *r.EventType != "" {
			needs[*r.EventType] = true
		}
	}
	if len(needs) == 0 {
		return counts, nil
	}
	sales := h.ports.Sales
	if needs["task_done"] {
		byType, err := sales.DoneTaskCounts(ctx, h.db, lead.ID, domain.MaxWindow(rules, "task_done"))
		if err != nil {
			return nil, err
		}
		total := 0
		for typ, n := range byType {
			counts["task_done:"+typ] = n
			total += n
		}
		counts["task_done"] = total
	}
	if needs["wa_inbound"] {
		var digits strings.Builder
		for _, c := range lead.PicPhone {
			if c >= '0' && c <= '9' {
				digits.WriteRune(c)
			}
		}
		if d := digits.String(); len(d) >= 9 {
			n, err := h.inboundWhatsApp(ctx, d[len(d)-9:], domain.MaxWindow(rules, "wa_inbound"))
			if err != nil {
				return nil, err
			}
			counts["wa_inbound"] = n
		}
	}
	if needs["deal_created"] {
		n, err := sales.DealCount(ctx, h.db, lead.ID, domain.MaxWindow(rules, "deal_created"))
		if err != nil {
			return nil, err
		}
		counts["deal_created"] = n
	}
	if needs["quotation_sent"] {
		n, err := sales.SentQuotationCount(ctx, h.db, lead.ID, domain.MaxWindow(rules, "quotation_sent"))
		if err != nil {
			return nil, err
		}
		counts["quotation_sent"] = n
	}
	return counts, nil
}

// inboundWhatsApp counts inbound CS inbox messages from a phone (matched on
// its last 9 digits).
func (h *handler) inboundWhatsApp(ctx context.Context, suffix string, windowDays *int) (int, error) {
	sql := `SELECT count(*) FROM crm.wa_messages m
       WHERE m.direction = 'inbound'
         AND right(regexp_replace(m.phone, '[^0-9]', '', 'g'), 9) = $1`
	args := []any{suffix}
	if windowDays != nil {
		sql += ` AND m.created_at >= now() - ($2::int * interval '1 day')`
		args = append(args, *windowDays)
	}
	var n int
	err := h.db.QueryRow(ctx, sql, args...).Scan(&n)
	return n, err
}
