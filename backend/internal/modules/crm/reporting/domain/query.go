package domain

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Range is a [From, To) date range ("YYYY-MM-DD", To exclusive).
type Range struct{ From, To string }

// ResolveDateRange mirrors resolveDateRange; today carries the calendar
// date in the server zone.
func ResolveDateRange(preset string, from, to *string, today time.Time) *Range {
	d := func(y, m, day int) string { return fmt.Sprintf("%d-%02d-%02d", y, m, day) }
	y, mon, day := today.Date()
	m := int(mon)
	plusDays := func(n int) string {
		x := time.Date(y, mon, day+n, 0, 0, 0, 0, time.UTC)
		return d(x.Year(), int(x.Month()), x.Day())
	}
	nextMonth := func(y, m int) string {
		if m == 12 {
			return d(y+1, 1, 1)
		}
		return d(y, m+1, 1)
	}
	switch preset {
	case "today":
		return &Range{d(y, m, day), plusDays(1)}
	case "yesterday":
		return &Range{plusDays(-1), d(y, m, day)}
	case "last_7_days":
		return &Range{plusDays(-6), plusDays(1)}
	case "last_30_days":
		return &Range{plusDays(-29), plusDays(1)}
	case "this_month":
		return &Range{d(y, m, 1), nextMonth(y, m)}
	case "last_month":
		if m == 1 {
			return &Range{d(y-1, 12, 1), d(y, m, 1)}
		}
		return &Range{d(y, m-1, 1), d(y, m, 1)}
	case "this_quarter":
		start := (m-1)/3*3 + 1
		return &Range{d(y, start, 1), nextMonth(y, start+2)}
	case "this_year":
		return &Range{d(y, 1, 1), d(y+1, 1, 1)}
	case "last_year":
		return &Range{d(y-1, 1, 1), d(y, 1, 1)}
	case "custom":
		if from == nil || *from == "" || to == nil || *to == "" {
			return nil
		}
		return &Range{*from, *to}
	}
	return nil // all_time
}

// BuildContext is BuildReportContext.
type BuildContext struct {
	CompanyID *string
	// RestrictOwnerUserID limits rows to records this user owns (sales role).
	RestrictOwnerUserID *string
	Today               time.Time
}

// Column is one result column, in SELECT order.
type Column struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Type        string `json:"type"`
	IsAggregate bool   `json:"isAggregate"`
}

// Built is BuiltReport. Params hold JS values (string, float64, bool, nil,
// []any); NodeParam renders them the way node-postgres sends them.
type Built struct {
	SQL     string
	Params  []any
	Columns []Column
	Grouped bool
}

// AggregateKey mirrors aggregateKey: sum(value) is "sum_value".
func AggregateKey(a Aggregate) string {
	if a.Fn == "count" {
		return "count"
	}
	return a.Fn + "_" + a.Field.Str()
}

// AggregateLabel mirrors aggregateLabel, e.g. "Total Nilai Deal".
func AggregateLabel(dataset string, a Aggregate) string {
	if a.Label.Str() != "" {
		return a.Label.Str()
	}
	if a.Fn == "count" {
		return "Jumlah"
	}
	target := a.Field.Str()
	if f := FieldDef(dataset, a.Field.Str()); f != nil {
		target = f.Label
	}
	return strings.TrimSpace(LabelOf(Aggregations, a.Fn) + " " + target)
}

func castValue(typ string, v any) any {
	switch typ {
	case "number", "currency":
		n := JSNumber(v)
		if math.IsNaN(n) || math.IsInf(n, 0) {
			return 0.0
		}
		return n
	case "boolean":
		if b, ok := v.(bool); ok {
			return b
		}
		if s, ok := v.(string); ok {
			return s == "true" || s == "1"
		}
		n, ok := v.(float64)
		return ok && n == 1
	}
	if v == nil {
		return nil
	}
	return JSString(v)
}

func isEmptyValue(v any) bool { return v == nil || v == "" }

var compareOps = map[string]string{"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}

func filterSQL(dataset string, f Filter, params *[]any) string {
	def := FieldDef(dataset, f.Field)
	if def == nil {
		return ""
	}
	col := def.SQL
	push := func(v any) string {
		*params = append(*params, v)
		return "$" + strconv.Itoa(len(*params))
	}
	switch f.Op {
	case "is_empty":
		if def.Type == "text" {
			return "(" + col + " IS NULL OR " + col + " = '')"
		}
		return "(" + col + " IS NULL)"
	case "not_empty":
		if def.Type == "text" {
			return "(" + col + " IS NOT NULL AND " + col + " <> '')"
		}
		return "(" + col + " IS NOT NULL)"
	case "contains":
		s := ""
		if f.Value != nil {
			s = JSString(f.Value)
		}
		return col + " ILIKE " + push("%"+s+"%")
	case "in", "not_in":
		values, ok := f.Value.([]any)
		if !ok {
			values = []any{f.Value}
		}
		arr := []any{}
		for _, v := range values {
			if !isEmptyValue(v) {
				arr = append(arr, castValue(def.Type, v))
			}
		}
		if len(arr) == 0 {
			return ""
		}
		not := ""
		if f.Op == "not_in" {
			not = " NOT"
		}
		return col + not + " = ANY(" + push(arr) + ")"
	case "between":
		if f.Value == nil || f.Value2 == nil {
			return ""
		}
		a := push(castValue(def.Type, f.Value))
		return col + " BETWEEN " + a + " AND " + push(castValue(def.Type, f.Value2))
	}
	if isEmptyValue(f.Value) {
		switch f.Op {
		case "eq":
			return col + " IS NULL"
		case "neq":
			return col + " IS NOT NULL"
		}
		return ""
	}
	return col + " " + compareOps[f.Op] + " " + push(castValue(def.Type, f.Value))
}

func aggSQL(dataset string, a Aggregate) string {
	if a.Fn == "count" {
		return "COUNT(*)::numeric"
	}
	def := FieldDef(dataset, a.Field.Str())
	if def == nil {
		return ""
	}
	switch {
	case a.Fn == "count_distinct":
		return "COUNT(DISTINCT " + def.SQL + ")::numeric"
	case !def.Aggregatable && (a.Fn == "sum" || a.Fn == "avg"):
		return ""
	case a.Fn == "avg":
		return "ROUND(AVG(" + def.SQL + ")::numeric, 2)"
	}
	return strings.ToUpper(a.Fn) + "(" + def.SQL + ")::numeric"
}

func direction(d Definition) string {
	if d.SortDir == "asc" {
		return "ASC"
	}
	return "DESC"
}

// BuildReportQuery mirrors buildReportQuery: table mode without group_by,
// aggregate mode with it. Identifiers come from the registry only.
func BuildReportQuery(def Definition, ctx BuildContext) Built {
	ds := DatasetDef(def.Dataset)
	params := []any{}
	where := []string{ds.BaseWhere}
	if ctx.CompanyID != nil && *ctx.CompanyID != "" {
		params = append(params, *ctx.CompanyID)
		where = append(where, fmt.Sprintf("%s = $%d", ds.CompanyExpr, len(params)))
	}
	if ctx.RestrictOwnerUserID != nil && *ctx.RestrictOwnerUserID != "" && ds.OwnerExpr != "" {
		params = append(params, *ctx.RestrictOwnerUserID)
		where = append(where, fmt.Sprintf("%s = $%d", ds.OwnerExpr, len(params)))
	}

	dateKey := ds.DateField
	if k := def.DateField.Str(); k != "" && ds.Field(k) != nil {
		dateKey = k
	}
	dateCol := ds.Field(dateKey)
	if r := ResolveDateRange(def.DatePreset, def.DateFrom.Val, def.DateTo.Val, ctx.Today); r != nil && dateCol != nil {
		params = append(params, r.From)
		where = append(where, fmt.Sprintf("%s >= $%d::date", dateCol.SQL, len(params)))
		params = append(params, r.To)
		where = append(where, fmt.Sprintf("%s < $%d::date", dateCol.SQL, len(params)))
	}
	for _, f := range def.Filters {
		if s := filterSQL(def.Dataset, f, &params); s != "" {
			where = append(where, s)
		}
	}

	columns := []Column{}
	var sel []string
	if len(def.GroupBy) > 0 {
		var groupExprs []string
		for _, key := range def.GroupBy {
			fd := ds.Field(key)
			if fd == nil {
				continue
			}
			isDate := fd.Type == "date" || fd.Type == "datetime"
			expr, label, typ := fd.SQL, fd.Label, fd.Type
			if isDate {
				expr = "date_trunc('" + def.DateBucket + "', " + fd.SQL + ")::date"
				label = fd.Label + " (" + LabelOf(DateBuckets, def.DateBucket) + ")"
				typ = "date"
			}
			groupExprs = append(groupExprs, expr)
			sel = append(sel, expr+` AS "`+key+`"`)
			columns = append(columns, Column{Key: key, Label: label, Type: typ})
		}
		aggs := def.Aggregates
		if len(aggs) == 0 {
			aggs = []Aggregate{{Fn: "count"}}
		}
		for _, a := range aggs {
			s := aggSQL(def.Dataset, a)
			if s == "" {
				continue
			}
			key := AggregateKey(a)
			sel = append(sel, s+` AS "`+key+`"`)
			typ := "number"
			if a.Fn != "count" && a.Fn != "count_distinct" {
				if target := ds.Field(a.Field.Str()); a.Field.Str() != "" && target != nil {
					typ = target.Type
				}
			}
			columns = append(columns, Column{Key: key, Label: AggregateLabel(def.Dataset, a), Type: typ, IsAggregate: true})
		}
		if len(groupExprs) == 0 || len(columns) == 0 {
			// An invalid group_by falls back to table mode.
			def.GroupBy = []string{}
			return BuildReportQuery(def, ctx)
		}
		sortCol := ""
		if k := def.SortField.Str(); k != "" && slices.ContainsFunc(columns, func(c Column) bool { return c.Key == k }) {
			sortCol = k
		} else {
			sortCol = columns[0].Key
			if i := slices.IndexFunc(columns, func(c Column) bool { return c.IsAggregate }); i >= 0 {
				sortCol = columns[i].Key
			}
		}
		sql := fmt.Sprintf(`SELECT %s
      FROM %s
      WHERE %s
      GROUP BY %s
      ORDER BY "%s" %s NULLS LAST
      LIMIT %d`, strings.Join(sel, ", "), ds.From, strings.Join(where, " AND "), strings.Join(groupExprs, ", "), sortCol, direction(def), def.Limit)
		return Built{SQL: sql, Params: params, Columns: columns, Grouped: true}
	}

	cols := def.Columns
	if len(cols) == 0 {
		cols = ds.DefaultColumns
	}
	for _, key := range cols {
		if fd := ds.Field(key); fd != nil {
			sel = append(sel, fd.SQL+` AS "`+key+`"`)
			columns = append(columns, Column{Key: key, Label: fd.Label, Type: fd.Type})
		}
	}
	if len(sel) == 0 {
		fd := ds.Field(ds.DefaultColumns[0])
		sel = append(sel, fd.SQL+` AS "`+fd.Key+`"`)
		columns = append(columns, Column{Key: fd.Key, Label: fd.Label, Type: fd.Type})
	}
	sortExpr := strings.Split(sel[0], " AS ")[0]
	if fd := ds.Field(def.SortField.Str()); def.SortField.Str() != "" && fd != nil {
		sortExpr = fd.SQL
	} else if dateCol != nil {
		sortExpr = dateCol.SQL
	}
	sql := fmt.Sprintf(`SELECT %s
    FROM %s
    WHERE %s
    ORDER BY %s %s NULLS LAST
    LIMIT %d`, strings.Join(sel, ", "), ds.From, strings.Join(where, " AND "), sortExpr, direction(def), def.Limit)
	return Built{SQL: sql, Params: params, Columns: columns}
}

/* ── JS value semantics ─────────────────────────────────────────────── */

var jsDecimal = regexp.MustCompile(`^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$`)

// JSNumber is Number(v) for decoded JSON values (NaN when not numeric).
func JSNumber(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case float64:
		return x
	case bool:
		if x {
			return 1
		}
		return 0
	case string:
		s := strings.TrimFunc(x, isJSSpace)
		switch {
		case s == "":
			return 0
		case s == "Infinity" || s == "+Infinity":
			return math.Inf(1)
		case s == "-Infinity":
			return math.Inf(-1)
		case len(s) > 2 && s[0] == '0' && strings.ContainsRune("xXoObB", rune(s[1])):
			base := map[byte]int{'x': 16, 'X': 16, 'o': 8, 'O': 8, 'b': 2, 'B': 2}[s[1]]
			n, err := strconv.ParseUint(s[2:], base, 64)
			if err != nil {
				return math.NaN()
			}
			return float64(n)
		case jsDecimal.MatchString(s):
			f, _ := strconv.ParseFloat(s, 64)
			return f
		}
		return math.NaN()
	case []any:
		return JSNumber(JSString(x))
	}
	return math.NaN()
}

func isJSSpace(r rune) bool {
	return r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '\v' || r == '\f' ||
		r == 0xA0 || r == 0xFEFF || r == 0x1680 || (r >= 0x2000 && r <= 0x200A) ||
		r == 0x2028 || r == 0x2029 || r == 0x202F || r == 0x205F || r == 0x3000
}

// JSString is String(v) for decoded JSON values.
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
	case []any:
		parts := make([]string, len(x))
		for i, it := range x {
			if it != nil {
				parts[i] = JSString(it)
			}
		}
		return strings.Join(parts, ",")
	case map[string]any:
		return "[object Object]"
	}
	return fmt.Sprint(v)
}

// JSNumberString is Number.prototype.toString().
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
	if abs := math.Abs(f); abs >= 1e21 || abs < 1e-6 {
		s := strconv.FormatFloat(f, 'e', -1, 64)
		mant, exp, _ := strings.Cut(s, "e")
		if exp[0] == '+' {
			return mant + "e+" + strings.TrimLeft(exp[1:], "0")
		}
		return mant + "e-" + strings.TrimLeft(exp[1:], "0")
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

// NodeParam renders a parameter the way node-postgres prepareValue sends it
// (text, untyped): arrays become array literals with quoted elements.
func NodeParam(v any) any {
	switch x := v.(type) {
	case nil:
		return nil
	case []any:
		var b strings.Builder
		b.WriteByte('{')
		for i, it := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			if it == nil {
				b.WriteString("NULL")
				continue
			}
			s := NodeParam(it).(string)
			if _, nested := it.([]any); nested {
				b.WriteString(s)
				continue
			}
			b.WriteString(`"` + strings.ReplaceAll(strings.ReplaceAll(s, `\`, `\\`), `"`, `\"`) + `"`)
		}
		b.WriteByte('}')
		return b.String()
	}
	return JSString(v)
}
