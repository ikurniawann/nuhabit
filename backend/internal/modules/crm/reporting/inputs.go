package reporting

import (
	"encoding/json"
	"regexp"
	"slices"

	"nuhabit/backend/internal/modules/crm/reporting/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Request schemas, read in zod schema order. A PATCH schema is the create
// schema through patchSchemaOf: every top-level field optional, no
// top-level defaults and no object refine (nested defaults still apply).

var (
	required = validate.Rule{}
	optional = validate.Rule{Optional: true}
	nullable = validate.Rule{Optional: true, Nullable: true}
	defaults = validate.Rule{HasDefault: true}
)

// orOptional is the rule of a field the PATCH schema made optional.
func orOptional(patch bool, r validate.Rule) validate.Rule {
	if patch {
		return optional
	}
	return r
}

func has(f *validate.Form, key string) bool {
	_, ok := f.Fields()[key]
	return ok
}

func optStr(f *validate.Form, key string, o validate.StrOpts) domain.OptStr {
	return domain.OptStr{Set: has(f, key), Val: f.Str(key, nullable, o)}
}

// jsValue turns decoded JSON numbers into float64 (the JS value z.unknown()
// passes through).
func jsValue(v any) any {
	switch x := v.(type) {
	case json.Number:
		if f, err := x.Float64(); err == nil {
			return f
		}
		return x.String()
	case []any:
		out := make([]any, len(x))
		for i, it := range x {
			out[i] = jsValue(it)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, it := range x {
			out[k] = jsValue(it)
		}
		return out
	}
	return v
}

var (
	key60   = validate.StrOpts{Trim: true, Min: 1, Max: 60}
	max60   = validate.StrOpts{Trim: true, Max: 60}
	isoDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	dateFmt = validate.StrOpts{Check: func(s string) (string, string, bool) {
		return "invalid_format", "Invalid string: must match pattern /" + isoDate.String() + "/", isoDate.MatchString(s)
	}}
)

// parseDefinition is reportDefinitionSchema.
func parseDefinition(f *validate.Form) domain.Definition {
	d := domain.DefaultDefinition("")
	if s := f.Enum("dataset", required, domain.Datasets); s != nil {
		d.Dataset = *s
	}
	if v := f.Strings("columns", defaults, 30, key60); v != nil {
		d.Columns = v
	}
	f.List("filters", defaults, 20, func(items *validate.Form, i int, v any) {
		it := items.Item(i, v)
		var flt domain.Filter
		if s := it.Str("field", required, key60); s != nil {
			flt.Field = *s
		}
		if s := it.Enum("op", required, domain.Keys(domain.FilterOps)); s != nil {
			flt.Op = *s
		}
		obj := it.Fields()
		flt.Value, flt.HasValue = obj["value"]
		flt.Value2, flt.HasValue2 = obj["value2"]
		flt.Value, flt.Value2 = jsValue(flt.Value), jsValue(flt.Value2)
		d.Filters = append(d.Filters, flt)
	})
	d.DateField = optStr(f, "date_field", max60)
	d.DatePreset = f.StrDefault("date_preset", d.DatePreset, validate.StrOpts{Check: validate.EnumCheck(domain.Keys(domain.DatePresets))})
	d.DateFrom = optStr(f, "date_from", dateFmt)
	d.DateTo = optStr(f, "date_to", dateFmt)
	if v := f.Strings("group_by", defaults, 3, key60); v != nil {
		d.GroupBy = v
	}
	d.DateBucket = f.StrDefault("date_bucket", d.DateBucket, validate.StrOpts{Check: validate.EnumCheck(domain.Keys(domain.DateBuckets))})
	f.List("aggregates", defaults, 6, func(items *validate.Form, i int, v any) {
		it := items.Item(i, v)
		var a domain.Aggregate
		if s := it.Enum("fn", required, domain.Keys(domain.Aggregations)); s != nil {
			a.Fn = *s
		}
		a.Field = optStr(it, "field", max60)
		a.Label = optStr(it, "label", validate.StrOpts{Trim: true, Max: 80})
		d.Aggregates = append(d.Aggregates, a)
	})
	d.SortField = optStr(f, "sort_field", max60)
	d.SortDir = f.StrDefault("sort_dir", d.SortDir, validate.StrOpts{Check: validate.EnumCheck([]string{"asc", "desc"})})
	if n := f.Int("limit", defaults, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(5000)}); n != nil {
		d.Limit = *n
	}
	d.ChartType = f.StrDefault("chart_type", d.ChartType, validate.StrOpts{Check: validate.EnumCheck(domain.Keys(domain.ChartTypes))})
	return d
}

// reportInput is reportSchema (or its PATCH form: nil pointers are absent).
type reportInput struct {
	Name        *string
	Description domain.OptStr
	Definition  *domain.Definition
	IsShared    *bool
}

func parseReport(f *validate.Form, patch bool) reportInput {
	var in reportInput
	in.Name = f.Str("name", orOptional(patch, required), validate.StrOpts{Trim: true, Min: 1, Max: 120})
	in.Description = optStr(f, "description", validate.StrOpts{Trim: true, Max: 500})
	if !patch || has(f, "definition") {
		d := parseDefinition(f.Child("definition"))
		in.Definition = &d
	}
	if patch {
		in.IsShared = f.Bool("is_shared", optional)
	} else {
		b := f.BoolDefault("is_shared", true)
		in.IsShared = &b
	}
	return in
}

type dashboardInput struct {
	Name        *string
	Description domain.OptStr
	IsDefault   *bool
	Widgets     []widgetInput // nil when absent
}

type widgetInput struct {
	ReportID   string
	Title      *string
	WidgetType string
	Width      int
}

var dashboardName = validate.StrOpts{Trim: true, Min: 1, Max: 120}

// parseCreateDashboard is createDashboardSchema.
func parseCreateDashboard(f *validate.Form) dashboardInput {
	in := dashboardInput{Name: f.Str("name", required, dashboardName)}
	in.Description = optStr(f, "description", validate.StrOpts{Trim: true, Max: 500})
	b := f.BoolDefault("is_default", false)
	in.IsDefault = &b
	return in
}

// parsePatchDashboard is patchDashboardSchema.
func parsePatchDashboard(f *validate.Form) dashboardInput {
	in := dashboardInput{Name: f.Str("name", optional, dashboardName)}
	in.Description = optStr(f, "description", validate.StrOpts{Trim: true, Max: 500})
	in.IsDefault = f.Bool("is_default", optional)
	items := f.List("widgets", optional, 24, func(items *validate.Form, i int, v any) {
		it := items.Item(i, v)
		var w widgetInput
		if s := it.UUID("report_id", required); s != nil {
			w.ReportID = *s
		}
		w.Title = it.Str("title", nullable, validate.StrOpts{Trim: true, Max: 120})
		w.WidgetType = it.StrDefault("widget_type", "chart", validate.StrOpts{Check: validate.EnumCheck([]string{"chart", "kpi", "table"})})
		w.Width = 1
		if n := it.Int("width", defaults, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(3)}); n != nil {
			w.Width = *n
		}
		in.Widgets = append(in.Widgets, w)
	})
	if items != nil && in.Widgets == nil {
		in.Widgets = []widgetInput{}
	}
	return in
}

// recipient is one recipientSchema output.
type recipient struct {
	Type   string `json:"type"`
	UserID string `json:"user_id,omitempty"`
	Number string `json:"number,omitempty"`
}

// scheduleInput is reportScheduleSchema (or its PATCH form).
type scheduleInput struct {
	ReportID   *string
	Name       *string
	Frequency  *string
	Hour       *int
	DayOfWeek  *int
	HasDOW     bool
	DayOfMonth *int
	HasDOM     bool
	Channel    *string
	Recipients []recipient // nil when absent
	IsActive   *bool
}

// unionIssue is zod's invalid_union issue: every option's issues.
type unionIssue struct {
	Code    string             `json:"code"`
	Errors  [][]validate.Issue `json:"errors"`
	Path    []any              `json:"path"`
	Message string             `json:"message"`
}

// scheduleForm collects the schedule issues; unions maps an issue index to
// the option errors of an invalid_union recorded there.
type scheduleForm struct {
	*validate.Form
	unions map[int][][]validate.Issue
}

// aborting reports whether an issue stops zod from running refinements
// (type and value errors; failed checks such as min/max do not).
func aborting(is validate.Issue) bool {
	return is.Code == "invalid_type" || is.Code == "invalid_value" || is.Code == "invalid_union"
}

// recipientOption validates one union option on f (rooted at the item).
func recipientOption(f *validate.Form, option string) recipient {
	r := recipient{Type: option}
	v, sent := f.Fields()["type"]
	if f.Fields() != nil && (!sent || v != option) {
		f.Fail("type", "invalid_value", `Invalid input: expected "`+option+`"`)
	}
	if option == "user" {
		if s := f.UUID("user_id", required); s != nil {
			r.UserID = *s
		}
	} else if s := f.Str("number", required, validate.StrOpts{Trim: true, Min: 8, Max: 20}); s != nil {
		r.Number = *s
	}
	return r
}

// parseRecipient is the recipientSchema union: the first option without
// issues wins; when exactly one option failed only on checks, its issues
// are reported; otherwise one invalid_union issue.
func (sf *scheduleForm) parseRecipient(items *validate.Form, i int, v any) recipient {
	options := []string{"user", "number"}
	var errs [][]validate.Issue
	var nonAborted []string
	for _, opt := range options {
		probe := validate.New(v, true)
		r := recipientOption(probe, opt)
		if probe.Valid() {
			return r
		}
		errs = append(errs, probe.Issues())
		if !slices.ContainsFunc(probe.Issues(), aborting) {
			nonAborted = append(nonAborted, opt)
		}
	}
	if len(nonAborted) == 1 {
		return recipientOption(items.Item(i, v), nonAborted[0])
	}
	items.Fail(i, "invalid_union", "Invalid input")
	sf.unions[len(sf.Issues())-1] = errs
	return recipient{}
}

// parseSchedule is reportScheduleSchema; patch drops defaults and refines.
func parseSchedule(f *validate.Form, patch bool) (scheduleInput, error) {
	sf := &scheduleForm{Form: f, unions: map[int][][]validate.Issue{}}
	var in scheduleInput
	in.ReportID = f.UUID("report_id", orOptional(patch, required))
	in.Name = f.Str("name", orOptional(patch, required), validate.StrOpts{Trim: true, Min: 1, Max: 120})
	enum := func(key, def string, options []string) *string {
		s := f.Str(key, orOptional(patch, defaults), validate.StrOpts{Check: validate.EnumCheck(options)})
		if s == nil && !patch {
			s = &def
		}
		return s
	}
	in.Frequency = enum("frequency", "weekly", domain.ScheduleFrequencies)
	in.Hour = f.Int("hour", orOptional(patch, defaults), validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(23)})
	if in.Hour == nil && !patch {
		h := 8
		in.Hour = &h
	}
	in.HasDOW = has(f, "day_of_week")
	in.DayOfWeek = f.Int("day_of_week", nullable, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(6)})
	in.HasDOM = has(f, "day_of_month")
	in.DayOfMonth = f.Int("day_of_month", nullable, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(28)})
	in.Channel = enum("channel", "wa", domain.ScheduleChannels)
	items := f.List("recipients", orOptional(patch, required), 20, func(items *validate.Form, i int, v any) {
		in.Recipients = append(in.Recipients, sf.parseRecipient(items, i, v))
	})
	if items != nil {
		if len(items) < 1 {
			f.Fail("recipients", "too_small", "Too small: expected array to have >=1 items")
		}
		if in.Recipients == nil {
			in.Recipients = []recipient{}
		}
	}
	if patch {
		in.IsActive = f.Bool("is_active", optional)
	} else {
		b := f.BoolDefault("is_active", true)
		in.IsActive = &b
		if !slices.ContainsFunc(f.Issues(), aborting) {
			if *in.Frequency == "weekly" && in.DayOfWeek == nil {
				f.Fail("day_of_week", "custom", "Jadwal mingguan wajib memilih hari")
			}
			if *in.Frequency == "monthly" && in.DayOfMonth == nil {
				f.Fail("day_of_month", "custom", "Jadwal bulanan wajib memilih tanggal")
			}
		}
	}
	return in, sf.err()
}

// err is validateBody's 400 with invalid_union issues expanded.
func (sf *scheduleForm) err() error {
	if sf.Valid() {
		return nil
	}
	details := make([]any, len(sf.Issues()))
	for i, is := range sf.Issues() {
		details[i] = is
		if errs, ok := sf.unions[i]; ok {
			details[i] = unionIssue{Code: is.Code, Errors: errs, Path: is.Path, Message: is.Message}
		}
	}
	return httpx.BadRequest("Validation failed", details)
}
