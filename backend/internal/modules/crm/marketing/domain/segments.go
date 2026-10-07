// Package domain holds the pure marketing rules: the dynamic segment query
// builder with RFM scoring (lib/crm/segments.ts), the WA campaign rules
// (lib/crm/campaigns.ts) and the public form field definitions
// (lib/crm/public-forms.ts).
//
// Every SQL expression comes from the registry in this file; callers only
// pick field keys, and values always travel as parameters ($n).
package domain

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// SegmentSources are the segment sources in schema order.
var SegmentSources = []string{"member", "lead", "contact"}

// FilterOps are FILTER_OPS in lib/crm/report-builder.ts.
var FilterOps = []string{"eq", "neq", "in", "not_in", "contains", "gt", "gte", "lt", "lte", "between", "is_empty", "not_empty"}

// FieldDef is one filterable field of a source.
type FieldDef struct {
	Type string // text, number, currency, date, boolean, enum
	SQL  string
}

// SourceDef describes one segment source.
type SourceDef struct {
	From        string
	BaseWhere   string
	IDExpr      string
	NameExpr    string
	PhoneExpr   string
	CompanyExpr string // "" when the table has no company_id
	SupportsRfm bool
	Fields      map[string]FieldDef
}

// Sources is SEGMENT_SOURCE_DEFS.
var Sources = map[string]SourceDef{
	"member": {
		From: "pos.pos_customers t", BaseWhere: "t.is_active", IDExpr: "t.id",
		NameExpr: "COALESCE(t.name, 'Tanpa nama')", PhoneExpr: "t.phone", SupportsRfm: true,
		Fields: map[string]FieldDef{
			"name":             {"text", "t.name"},
			"phone":            {"text", "t.phone"},
			"email":            {"text", "t.email"},
			"city":             {"text", "t.city"},
			"gender":           {"enum", "t.gender"},
			"membership_tier":  {"text", "t.membership_tier"},
			"member_type":      {"text", "t.member_type"},
			"total_spent":      {"currency", "COALESCE(t.total_spent, 0)"},
			"visit_count":      {"number", "COALESCE(t.visit_count, 0)"},
			"ark_coin_balance": {"currency", "COALESCE(t.ark_coin_balance, 0)"},
			"total_xp":         {"number", "COALESCE(t.total_xp, 0)"},
			"recency_days":     {"number", "GREATEST(0, (CURRENT_DATE - t.last_visit::date))"},
			"last_visit":       {"date", "t.last_visit"},
			"wa_consent":       {"boolean", "COALESCE(t.wa_consent, false)"},
			"created_at":       {"date", "t.created_at"},
		},
	},
	"lead": {
		From: "crm.crm_sales_leads t", BaseWhere: "t.deleted_at IS NULL", IDExpr: "t.id",
		NameExpr: "t.org_name", PhoneExpr: "t.pic_phone", CompanyExpr: "t.company_id",
		Fields: map[string]FieldDef{
			"org_name":     {"text", "t.org_name"},
			"pic_name":     {"text", "t.pic_name"},
			"city":         {"text", "t.city"},
			"org_type":     {"enum", "t.org_type"},
			"source":       {"enum", "t.source"},
			"temperature":  {"enum", "t.temperature"},
			"status":       {"enum", "t.status"},
			"score":        {"number", "COALESCE(t.score, 0)"},
			"utm_source":   {"text", "t.utm_source"},
			"utm_campaign": {"text", "t.utm_campaign"},
			"created_at":   {"date", "t.created_at"},
		},
	},
	"contact": {
		From:      "crm.crm_contacts t LEFT JOIN crm.crm_accounts ac ON ac.id = t.account_id",
		BaseWhere: "t.deleted_at IS NULL", IDExpr: "t.id", NameExpr: "t.name", PhoneExpr: "t.phone",
		CompanyExpr: "t.company_id",
		Fields: map[string]FieldDef{
			"name":         {"text", "t.name"},
			"title":        {"text", "t.title"},
			"account_name": {"text", "ac.name"},
			"account_type": {"enum", "ac.account_type"},
			"city":         {"text", "ac.city"},
			"is_primary":   {"boolean", "t.is_primary"},
			"created_at":   {"date", "t.created_at"},
		},
	},
}

// Range is one RFM dimension filter (scores 1 to 5).
type Range struct {
	Min int `json:"min"`
	Max int `json:"max"`
}

// FullRange is the default {min: 1, max: 5}.
var FullRange = Range{1, 5}

// Rfm is rfmSchema.
type Rfm struct {
	Enabled   bool  `json:"enabled"`
	Recency   Range `json:"recency"`
	Frequency Range `json:"frequency"`
	Monetary  Range `json:"monetary"`
}

// Filter is one segmentFilterSchema entry. Value and Value2 are z.unknown():
// they keep whatever JSON was sent, and the Has flags keep absent apart from
// null so the stored definition matches zod's output.
type Filter struct {
	Field     string
	Op        string
	Value     any
	Value2    any
	HasValue  bool
	HasValue2 bool
}

// MarshalJSON writes field, op, then value/value2 only when they were sent.
func (f Filter) MarshalJSON() ([]byte, error) {
	var b strings.Builder
	field, _ := marshal(f.Field)
	op, _ := marshal(f.Op)
	b.WriteString(`{"field":` + string(field) + `,"op":` + string(op))
	for _, kv := range []struct {
		key string
		has bool
		v   any
	}{{"value", f.HasValue, f.Value}, {"value2", f.HasValue2, f.Value2}} {
		if !kv.has {
			continue
		}
		raw, err := marshal(kv.v)
		if err != nil {
			return nil, err
		}
		b.WriteString(`,"` + kv.key + `":` + string(raw))
	}
	b.WriteByte('}')
	return []byte(b.String()), nil
}

// Definition is segmentDefinitionSchema's output (defaults applied).
type Definition struct {
	Source           string   `json:"source"`
	Filters          []Filter `json:"filters"`
	Rfm              Rfm      `json:"rfm"`
	RequireWaConsent bool     `json:"require_wa_consent"`
	Limit            int      `json:"limit"`
}

// DefaultDefinition is segmentDefinitionSchema.parse({ source }).
func DefaultDefinition(source string) Definition {
	return Definition{
		Source:  source,
		Filters: []Filter{},
		Rfm:     Rfm{Recency: FullRange, Frequency: FullRange, Monetary: FullRange},
		Limit:   5000,
	}
}

// BuiltSegment is a ready query and its parameters.
type BuiltSegment struct {
	SQL     string
	Params  []any
	WithRfm bool
}

// BuildSegmentQuery mirrors buildSegmentQuery: a plain query without RFM;
// with RFM, scores come from NTILE(5) over the filtered population.
func BuildSegmentQuery(def Definition, companyID *string, countOnly bool) BuiltSegment {
	src := Sources[def.Source]
	params := []any{}
	where := []string{src.BaseWhere}

	if companyID != nil && *companyID != "" && src.CompanyExpr != "" {
		params = append(params, *companyID)
		where = append(where, fmt.Sprintf("%s = $%d", src.CompanyExpr, len(params)))
	}
	if consent, ok := src.Fields["wa_consent"]; ok && def.RequireWaConsent {
		where = append(where, consent.SQL)
	}
	for _, f := range def.Filters {
		if sql, ok := filterSQL(src, f, &params); ok {
			where = append(where, sql)
		}
	}
	if src.PhoneExpr != "" {
		// Recipients without a number are useless for a WA campaign.
		where = append(where, fmt.Sprintf("%s IS NOT NULL AND %s <> ''", src.PhoneExpr, src.PhoneExpr))
	}

	baseSelect := fmt.Sprintf("SELECT %s AS id, %s AS name, %s AS phone", src.IDExpr, src.NameExpr, src.PhoneExpr)
	if !def.Rfm.Enabled || !src.SupportsRfm {
		inner := baseSelect + "\n      FROM " + src.From + "\n      WHERE " + strings.Join(where, " AND ")
		if countOnly {
			return BuiltSegment{SQL: fmt.Sprintf("SELECT COUNT(*)::int AS total FROM (%s LIMIT %d) q", inner, def.Limit), Params: params}
		}
		return BuiltSegment{SQL: fmt.Sprintf("%s ORDER BY name LIMIT %d", inner, def.Limit), Params: params}
	}

	// NTILE(5) ascending so that 5 is the best score on every dimension.
	f := src.Fields
	inner := fmt.Sprintf(`
    WITH base AS (
      %s,
             %s AS last_visit,
             %s AS visit_count,
             %s AS total_spent
      FROM %s
      WHERE %s
    ), scored AS (
      SELECT b.*,
             NTILE(5) OVER (ORDER BY b.last_visit ASC NULLS FIRST) AS r_score,
             NTILE(5) OVER (ORDER BY b.visit_count ASC) AS f_score,
             NTILE(5) OVER (ORDER BY b.total_spent ASC) AS m_score
      FROM base b
    )
    SELECT id, name, phone, last_visit, visit_count, total_spent, r_score, f_score, m_score
    FROM scored
    WHERE r_score BETWEEN %d AND %d
      AND f_score BETWEEN %d AND %d
      AND m_score BETWEEN %d AND %d`,
		baseSelect, f["last_visit"].SQL, f["visit_count"].SQL, f["total_spent"].SQL, src.From, strings.Join(where, " AND "),
		clamp(def.Rfm.Recency.Min), clamp(def.Rfm.Recency.Max),
		clamp(def.Rfm.Frequency.Min), clamp(def.Rfm.Frequency.Max),
		clamp(def.Rfm.Monetary.Min), clamp(def.Rfm.Monetary.Max))
	if countOnly {
		return BuiltSegment{SQL: fmt.Sprintf("SELECT COUNT(*)::int AS total FROM (%s LIMIT %d) q", inner, def.Limit), Params: params, WithRfm: true}
	}
	return BuiltSegment{SQL: fmt.Sprintf("%s ORDER BY m_score DESC, f_score DESC, r_score DESC, name LIMIT %d", inner, def.Limit), Params: params, WithRfm: true}
}

// clamp keeps a score inside 1..5 so a stored out-of-range value never
// reaches the SQL text as is.
func clamp(n int) int { return min(5, max(1, n)) }

var opSQL = map[string]string{"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}

func filterSQL(src SourceDef, f Filter, params *[]any) (string, bool) {
	def, ok := src.Fields[f.Field]
	if !ok {
		return "", false
	}
	col := def.SQL
	push := func(v any) string {
		*params = append(*params, v)
		return fmt.Sprintf("$%d", len(*params))
	}
	switch f.Op {
	case "is_empty":
		if def.Type == "text" {
			return fmt.Sprintf("(%s IS NULL OR %s = '')", col, col), true
		}
		return fmt.Sprintf("(%s IS NULL)", col), true
	case "not_empty":
		if def.Type == "text" {
			return fmt.Sprintf("(%s IS NOT NULL AND %s <> '')", col, col), true
		}
		return fmt.Sprintf("(%s IS NOT NULL)", col), true
	case "contains":
		v := ""
		if f.Value != nil {
			v = JSString(f.Value)
		}
		return fmt.Sprintf("%s ILIKE %s", col, push("%"+v+"%")), true
	case "in", "not_in":
		items, isList := f.Value.([]any)
		if !isList {
			items = []any{f.Value}
		}
		arr := castList(def.Type, items)
		if arr == nil {
			return "", false
		}
		if f.Op == "not_in" {
			return fmt.Sprintf("%s <> ALL(%s)", col, push(arr)), true
		}
		return fmt.Sprintf("%s = ANY(%s)", col, push(arr)), true
	case "between":
		if f.Value == nil || f.Value2 == nil {
			return "", false
		}
		return fmt.Sprintf("%s BETWEEN %s AND %s", col, push(castValue(def.Type, f.Value)), push(castValue(def.Type, f.Value2))), true
	}
	if f.Value == nil || f.Value == "" {
		switch f.Op {
		case "eq":
			return col + " IS NULL", true
		case "neq":
			return col + " IS NOT NULL", true
		}
		return "", false
	}
	return fmt.Sprintf("%s %s %s", col, opSQL[f.Op], push(castValue(def.Type, f.Value))), true
}

// castValue mirrors castValue: numbers via Number() (non-finite = 0),
// booleans from true/"true"/1/"1", everything else String().
func castValue(typ string, v any) any {
	switch typ {
	case "number", "currency":
		return JSNumber(v)
	case "boolean":
		return isTruthyFlag(v)
	}
	if v == nil {
		return nil
	}
	return JSString(v)
}

// castList casts the non-empty items of an in/not_in filter into a typed
// slice (a PostgreSQL array parameter); nil when nothing is left.
func castList(typ string, items []any) any {
	var nums []float64
	var bools []bool
	var strs []string
	for _, v := range items {
		if v == nil || v == "" {
			continue
		}
		switch c := castValue(typ, v).(type) {
		case float64:
			nums = append(nums, c)
		case bool:
			bools = append(bools, c)
		case string:
			strs = append(strs, c)
		}
	}
	switch {
	case nums != nil:
		return nums
	case bools != nil:
		return bools
	case strs != nil:
		return strs
	}
	return nil
}

func isTruthyFlag(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		return x == "true" || x == "1"
	case float64:
		return x == 1
	case json.Number:
		f, err := x.Float64()
		return err == nil && f == 1
	}
	return false
}

var paramRef = regexp.MustCompile(`\$(\d+)`)
var tableAlias = regexp.MustCompile(`\bt\.`)
var orderByTail = regexp.MustCompile(`\s+ORDER BY[\s\S]*$`)
var limitTail = regexp.MustCompile(`\s+LIMIT \d+\s*$`)

// BuildSegmentWhere mirrors buildSegmentWhere: a WHERE fragment for another
// query whose main table has alias and that already uses $1..$(startIndex-1).
// With RFM (window functions cannot sit in WHERE) the fragment is
// `alias.id IN (scored subquery)`.
func BuildSegmentWhere(def Definition, alias string, startIndex int, companyID *string) (string, []any) {
	built := BuildSegmentQuery(def, companyID, false)
	shifted := paramRef.ReplaceAllStringFunc(built.SQL, func(m string) string {
		n, _ := strconv.Atoi(m[1:])
		return fmt.Sprintf("$%d", n+startIndex-1)
	})
	if !built.WithRfm {
		inner := shifted[strings.Index(shifted, " WHERE ")+7:]
		inner = limitTail.ReplaceAllString(orderByTail.ReplaceAllString(inner, ""), "")
		if alias != "t" {
			// Only the main table alias moves; joins (ac.) stay, since the
			// fragment without RFM is only used for sources without joins.
			inner = tableAlias.ReplaceAllString(inner, alias+".")
		}
		return "(" + inner + ")", built.Params
	}
	sub := orderByTail.ReplaceAllString(shifted, "")
	return alias + ".id IN (SELECT id FROM (" + sub + ") seg)", built.Params
}

// JSNumber is Number(v) with non-finite results as 0.
func JSNumber(v any) float64 {
	var f float64
	switch x := v.(type) {
	case nil:
		return 0
	case bool:
		if x {
			return 1
		}
		return 0
	case float64:
		f = x
	case json.Number:
		f = parseJSNumber(string(x))
	case string:
		f = parseJSNumber(x)
	case []any:
		switch len(x) {
		case 0:
			return 0
		case 1:
			return JSNumber(JSString(x[0]))
		}
		return 0
	default:
		return 0
	}
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0
	}
	return f
}

// parseJSNumber is Number(string): trimmed, "" is 0, 0x/0o/0b integers,
// otherwise a decimal literal (NaN when malformed).
func parseJSNumber(s string) float64 {
	s = strings.TrimFunc(s, IsJSSpace)
	if s == "" {
		return 0
	}
	if len(s) > 2 && s[0] == '0' {
		base := map[byte]int{'x': 16, 'X': 16, 'o': 8, 'O': 8, 'b': 2, 'B': 2}[s[1]]
		if base != 0 {
			n, err := strconv.ParseUint(s[2:], base, 64)
			if err != nil {
				return math.NaN()
			}
			return float64(n)
		}
	}
	switch s {
	case "Infinity", "+Infinity", "-Infinity":
		return math.Inf(1)
	}
	if strings.ContainsAny(s, "_xXpPnN") || strings.EqualFold(s, "inf") {
		return math.NaN()
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return math.NaN()
	}
	return f
}

// JSString is String(v) for JSON values.
func JSString(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case string:
		return x
	case bool:
		return strconv.FormatBool(x)
	case float64:
		return JSNumberString(x)
	case json.Number:
		return JSNumberString(JSNumber(x))
	case []any:
		parts := make([]string, len(x))
		for i, it := range x {
			if it != nil {
				parts[i] = JSString(it)
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

// JSNumberString formats a float64 like Number.prototype.toString.
func JSNumberString(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	case f == 0:
		return "0"
	}
	abs := math.Abs(f)
	if abs >= 1e21 || abs < 1e-6 {
		s := strconv.FormatFloat(f, 'e', -1, 64)
		mant, exp, _ := strings.Cut(s, "e")
		if exp[0] == '+' {
			return mant + "e+" + strings.TrimLeft(exp[1:], "0")
		}
		return mant + "e-" + strings.TrimLeft(exp[1:], "0")
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

// marshal is json.Marshal without HTML escaping, like JSON.stringify.
func marshal(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// IsJSSpace reports whether r is whitespace for JS trim() and \s.
func IsJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', '\u00a0', '\u1680', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff':
		return true
	}
	return r >= '\u2000' && r <= '\u200a'
}
