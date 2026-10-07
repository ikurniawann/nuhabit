package domain

import "time"

// ReportPeriod is the funnel report window.
type ReportPeriod struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// ResolveReportPeriod is resolveReportPeriod: the last 90 days by default
// (UTC dates), a reversed range swapped.
func ResolveReportPeriod(from, to string, now time.Time) ReportPeriod {
	if !IsISODate(from) {
		from = now.UTC().Add(-90 * 24 * time.Hour).Format("2006-01-02")
	}
	if !IsISODate(to) {
		to = now.UTC().Format("2006-01-02")
	}
	if from > to {
		from, to = to, from
	}
	return ReportPeriod{From: from, To: to}
}

// DealScopeSQL is dealScopeSql: "AND …" with placeholders from start, or "".
func DealScopeSQL(userID, role string, s Scope, start int) (string, []any) {
	w := NewWhere(nil, start)
	ScopeConditions(w, "d", userID, role, s)
	if len(w.Conditions) == 0 {
		return "", nil
	}
	return "AND " + w.SQL(), w.Params
}

// ParseMonth is parseMonthParam's check; month "" means now (UTC).
func ParseMonth(raw *string, now time.Time) (string, bool) {
	if raw == nil {
		return now.UTC().Format("2006-01"), true
	}
	m := *raw
	ok := len(m) == 7 && m[4] == '-' && isDigits(m[:4]) && isDigits(m[5:])
	return m, ok
}

func isDigits(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return s != ""
}

// DiffChanges is diffLeadChanges: fields of after that are new or differ
// from before. before values are what PostgreSQL returned; after values the
// validated body.
func DiffChanges(before map[string]any, after *Fields) *Fields {
	changes := NewFields()
	after.Each(func(k string, v any) {
		prev, ok := before[k]
		if !ok {
			changes.Set(k, change(nil, v, false))
			return
		}
		if prev != v {
			changes.Set(k, change(prev, v, true))
		}
	})
	return changes
}

func change(from, to any, hasFrom bool) *Fields {
	f := NewFields()
	if hasFrom {
		f.Set("from", from)
	}
	f.Set("to", to)
	return f
}
