package domain

import (
	"strings"
)

// ScoringFields, ScoringOperators and ScoringEventTypes are the enums of
// scoringRuleSchema.
var (
	ScoringFields     = []string{"source", "org_type", "temperature", "status", "city", "pic_email", "pic_title", "account_type", "industry"}
	ScoringOperators  = []string{"eq", "neq", "in", "contains", "not_empty", "gt", "lt"}
	ScoringEventTypes = []string{"task_done", "wa_inbound", "deal_created", "quotation_sent"}
)

// ScoringRule is one active crm_scoring_rules row.
type ScoringRule struct {
	ID, Name, Kind  string
	Field, Operator *string
	Value           any
	EventType       *string
	WindowDays      *int
	MaxCount        int
	Points          int
}

// ScoreItem is one entry of crm_sales_leads.score_breakdown.
type ScoreItem struct {
	RuleID string `json:"rule_id"`
	Name   string `json:"name"`
	Points int    `json:"points"`
	Count  *int   `json:"count,omitempty"`
}

func normalize(v any) string {
	if IsNullish(v) {
		return ""
	}
	return strings.ToLower(JSTrim(JSString(v)))
}

// MatchFieldRule evaluates a field rule against the lead snapshot (missing
// or NULL fields are nil).
func MatchFieldRule(r ScoringRule, snapshot map[string]*string) bool {
	if r.Field == nil || *r.Field == "" || r.Operator == nil || *r.Operator == "" {
		return false
	}
	var raw any
	if p := snapshot[*r.Field]; p != nil {
		raw = *p
	}
	actual := normalize(raw)
	switch *r.Operator {
	case "not_empty":
		return len(actual) > 0
	case "eq":
		return actual == normalize(r.Value)
	case "neq":
		return actual != normalize(r.Value)
	case "in":
		items, ok := r.Value.([]any)
		if !ok {
			return false
		}
		for _, it := range items {
			if normalize(it) == actual {
				return true
			}
		}
		return false
	case "contains":
		v := normalize(r.Value)
		return len(v) > 0 && strings.Contains(actual, v)
	case "gt":
		return JSNumber(raw) > JSNumber(r.Value)
	case "lt":
		return JSNumber(raw) < JSNumber(r.Value)
	}
	return false
}

// EventCountKey is "<event_type>" or "<event_type>:<sub-type>" when the
// rule value is a non-blank string.
func EventCountKey(eventType string, value any) string {
	if s, ok := value.(string); ok && JSTrim(s) != "" {
		return eventType + ":" + strings.ToLower(JSTrim(s))
	}
	return eventType
}

// ComputeLeadScore sums the points of matching field rules and of event
// rules times their (max_count capped) occurrences.
func ComputeLeadScore(rules []ScoringRule, snapshot map[string]*string, counts map[string]int) (int, []ScoreItem) {
	breakdown := []ScoreItem{}
	for _, r := range rules {
		if r.Kind == "field" {
			if MatchFieldRule(r, snapshot) {
				breakdown = append(breakdown, ScoreItem{RuleID: r.ID, Name: r.Name, Points: r.Points})
			}
			continue
		}
		if r.EventType == nil || *r.EventType == "" {
			continue
		}
		count := min(counts[EventCountKey(*r.EventType, r.Value)], max(1, r.MaxCount))
		if count > 0 {
			breakdown = append(breakdown, ScoreItem{RuleID: r.ID, Name: r.Name, Points: r.Points * count, Count: &count})
		}
	}
	score := 0
	for _, b := range breakdown {
		score += b.Points
	}
	return score, breakdown
}

// MaxWindow is the widest window_days among the event rules of eventType,
// or nil when any of them has no window (count everything).
func MaxWindow(rules []ScoringRule, eventType string) *int {
	var widest *int
	for _, r := range rules {
		if r.Kind != "event" || r.EventType == nil || *r.EventType != eventType {
			continue
		}
		if r.WindowDays == nil || *r.WindowDays == 0 {
			return nil
		}
		if widest == nil || *r.WindowDays > *widest {
			w := *r.WindowDays
			widest = &w
		}
	}
	return widest
}
