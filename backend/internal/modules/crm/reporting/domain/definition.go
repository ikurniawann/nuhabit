package domain

import (
	"bytes"
	"encoding/json"
)

// OptStr is a z.string().optional().nullable() output: Set is false when
// the key was absent (zod omits it), Val is nil for an explicit null.
type OptStr struct {
	Set bool
	Val *string
}

// Str returns the value, "" when absent or null.
func (o OptStr) Str() string {
	if o.Val == nil {
		return ""
	}
	return *o.Val
}

// Filter is one reportFilterSchema output. Value and Value2 are z.unknown():
// HasValue is false when the key was absent.
type Filter struct {
	Field     string
	Op        string
	Value     any
	HasValue  bool
	Value2    any
	HasValue2 bool
}

// Aggregate is one reportAggregateSchema output.
type Aggregate struct {
	Fn    string
	Field OptStr
	Label OptStr
}

// Definition is the reportDefinitionSchema output.
type Definition struct {
	Dataset    string
	Columns    []string
	Filters    []Filter
	DateField  OptStr
	DatePreset string
	DateFrom   OptStr
	DateTo     OptStr
	GroupBy    []string
	DateBucket string
	Aggregates []Aggregate
	SortField  OptStr
	SortDir    string
	Limit      int
	ChartType  string
}

// DefaultDefinition is reportDefinitionSchema.parse({ dataset }).
func DefaultDefinition(dataset string) Definition {
	return Definition{
		Dataset: dataset, Columns: []string{}, Filters: []Filter{}, DatePreset: "all_time",
		GroupBy: []string{}, DateBucket: "month", Aggregates: []Aggregate{}, SortDir: "desc",
		Limit: 500, ChartType: "table",
	}
}

// object writes a JSON object in insertion order, the way JSON.stringify
// writes a zod output (absent optional keys omitted).
type object struct{ buf bytes.Buffer }

func (o *object) put(key string, v any) {
	if o.buf.Len() == 0 {
		o.buf.WriteByte('{')
	} else {
		o.buf.WriteByte(',')
	}
	k, _ := marshal(key)
	o.buf.Write(k)
	o.buf.WriteByte(':')
	b, _ := marshal(v)
	o.buf.Write(b)
}

func (o *object) opt(key string, v OptStr) {
	if v.Set {
		o.put(key, v.Val)
	}
}

func (o *object) bytes() []byte {
	if o.buf.Len() == 0 {
		return []byte("{}")
	}
	o.buf.WriteByte('}')
	return o.buf.Bytes()
}

// marshal is json.Marshal without HTML escaping (JSON.stringify).
func marshal(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// MarshalJSON writes the filter in schema order.
func (f Filter) MarshalJSON() ([]byte, error) {
	var o object
	o.put("field", f.Field)
	o.put("op", f.Op)
	if f.HasValue {
		o.put("value", f.Value)
	}
	if f.HasValue2 {
		o.put("value2", f.Value2)
	}
	return o.bytes(), nil
}

// MarshalJSON writes the aggregate in schema order.
func (a Aggregate) MarshalJSON() ([]byte, error) {
	var o object
	o.put("fn", a.Fn)
	o.opt("field", a.Field)
	o.opt("label", a.Label)
	return o.bytes(), nil
}

// MarshalJSON writes the definition in schema order.
func (d Definition) MarshalJSON() ([]byte, error) {
	var o object
	o.put("dataset", d.Dataset)
	o.put("columns", d.Columns)
	o.put("filters", d.Filters)
	o.opt("date_field", d.DateField)
	o.put("date_preset", d.DatePreset)
	o.opt("date_from", d.DateFrom)
	o.opt("date_to", d.DateTo)
	o.put("group_by", d.GroupBy)
	o.put("date_bucket", d.DateBucket)
	o.put("aggregates", d.Aggregates)
	o.opt("sort_field", d.SortField)
	o.put("sort_dir", d.SortDir)
	o.put("limit", d.Limit)
	o.put("chart_type", d.ChartType)
	return o.bytes(), nil
}
