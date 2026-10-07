package marketing

import (
	"encoding/json"
	"regexp"
	"strconv"

	contractsales "nuhabit/backend/internal/contracts/salesfunnel"
	"nuhabit/backend/internal/modules/crm/marketing/domain"
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

// has reports whether the body sent key (null included).
func has(f *validate.Form, key string) bool {
	_, ok := f.Fields()[key]
	return ok
}

// orOptional is the rule of a field the PATCH schema made optional.
func orOptional(patch bool, r validate.Rule) validate.Rule {
	if patch {
		r.Optional = true
		r.HasDefault = false
	}
	return r
}

// minItems is z.array(...).min(n), checked after the items like zod.
func minItems(f *validate.Form, key string, items []any, n int) {
	if items != nil && len(items) < n {
		f.Fail(key, "too_small", "Too small: expected array to have >="+strconv.Itoa(n)+" items")
	}
}

// regexCheck is z.string().regex(re[, message]).
func regexCheck(re *regexp.Regexp, msg string) func(string) (string, string, bool) {
	if msg == "" {
		msg = "Invalid string: must match pattern /" + re.String() + "/"
	}
	return func(s string) (string, string, bool) { return "invalid_format", msg, re.MatchString(s) }
}

// jsValue turns decoded JSON numbers into float64 so z.unknown() values
// re-serialize the way JSON.stringify writes them.
func jsValue(v any) any {
	switch x := v.(type) {
	case json.Number:
		if f, err := x.Float64(); err == nil {
			return f
		}
		return x
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

/* ── segments ─────────────────────────────────────────────────────────── */

func parseRange(f *validate.Form) domain.Range {
	r := domain.FullRange
	o := validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(5)}
	if n := f.Int("min", defaults, o); n != nil {
		r.Min = *n
	}
	if n := f.Int("max", defaults, o); n != nil {
		r.Max = *n
	}
	return r
}

// parseDefinition is segmentDefinitionSchema.
func parseDefinition(f *validate.Form) domain.Definition {
	d := domain.DefaultDefinition("")
	if s := f.Enum("source", required, domain.SegmentSources); s != nil {
		d.Source = *s
	}
	f.List("filters", defaults, 20, func(items *validate.Form, i int, v any) {
		it := items.Item(i, v)
		var flt domain.Filter
		if s := it.Str("field", required, validate.StrOpts{Trim: true, Min: 1, Max: 60}); s != nil {
			flt.Field = *s
		}
		if s := it.Enum("op", required, domain.FilterOps); s != nil {
			flt.Op = *s
		}
		obj := it.Fields()
		flt.Value, flt.HasValue = obj["value"]
		flt.Value2, flt.HasValue2 = obj["value2"]
		flt.Value, flt.Value2 = jsValue(flt.Value), jsValue(flt.Value2)
		d.Filters = append(d.Filters, flt)
	})
	if has(f, "rfm") {
		c := f.Child("rfm")
		if b := c.Bool("enabled", defaults); b != nil {
			d.Rfm.Enabled = *b
		}
		for _, dim := range []struct {
			key string
			dst *domain.Range
		}{{"recency", &d.Rfm.Recency}, {"frequency", &d.Rfm.Frequency}, {"monetary", &d.Rfm.Monetary}} {
			if has(c, dim.key) {
				*dim.dst = parseRange(c.Child(dim.key))
			}
		}
	}
	d.RequireWaConsent = f.BoolDefault("require_wa_consent", false)
	if n := f.Int("limit", defaults, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(50_000)}); n != nil {
		d.Limit = *n
	}
	return d
}

// parseStoredSegment mirrors parseStoredSegment: the stored definition with
// the row's source; a broken row falls back to the defaults.
func parseStoredSegment(source string, raw any) domain.Definition {
	obj := map[string]any{}
	if m, ok := raw.(map[string]any); ok {
		for k, v := range m {
			obj[k] = v
		}
	}
	obj["source"] = source
	f := validate.New(obj, true)
	d := parseDefinition(f)
	if !f.Valid() {
		return domain.DefaultDefinition(source)
	}
	return d
}

type segmentInput struct {
	Name           *string
	Description    *string
	HasDescription bool
	Definition     *domain.Definition
	IsActive       *bool
}

// parseSegment is segmentSchema (patch: patchSchemaOf(segmentSchema)).
func parseSegment(f *validate.Form, patch bool) segmentInput {
	var in segmentInput
	in.Name = f.Str("name", orOptional(patch, required), validate.StrOpts{Trim: true, Min: 1, Max: 120})
	in.HasDescription = has(f, "description")
	in.Description = f.Str("description", nullable, validate.StrOpts{Trim: true, Max: 500})
	if !patch || has(f, "definition") {
		d := parseDefinition(f.Child("definition"))
		in.Definition = &d
	}
	if patch {
		in.IsActive = f.Bool("is_active", optional)
	} else {
		b := f.BoolDefault("is_active", true)
		in.IsActive = &b
	}
	return in
}

/* ── public forms ─────────────────────────────────────────────────────── */

var (
	fieldKeyCheck = regexCheck(regexp.MustCompile(`^[a-z][a-z0-9_]{1,39}$`), "key: huruf kecil, angka, underscore; diawali huruf")
	slugCheck     = regexCheck(regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,49}$`), "slug: huruf kecil, angka, tanda hubung")
	// redirectURLCheck is z.string().url(): zod checks the trimmed value.
	redirectURLCheck = func(s string) (string, string, bool) {
		return "invalid_format", "Invalid URL", validate.ValidURL(validate.JSTrim(s))
	}
)

func optionalText(f *validate.Form, key string, max int) domain.OptionalText {
	return domain.OptionalText{Set: has(f, key), Value: f.Str(key, nullable, validate.StrOpts{Trim: true, Max: max})}
}

// parseField is publicFieldSchema.
func parseField(f *validate.Form) domain.PublicField {
	var fd domain.PublicField
	str := func(p *string, key string, o validate.StrOpts) {
		if s := f.Str(key, required, o); s != nil {
			*p = *s
		}
	}
	str(&fd.Key, "key", validate.StrOpts{Trim: true, Check: fieldKeyCheck})
	str(&fd.Label, "label", validate.StrOpts{Trim: true, Min: 1, Max: 120})
	str(&fd.Type, "type", validate.StrOpts{Check: validate.EnumCheck(domain.PublicFieldTypes)})
	fd.Required = f.BoolDefault("required", false)
	fd.Placeholder = optionalText(f, "placeholder", 120)
	fd.HelpText = optionalText(f, "help_text", 200)
	fd.Options = f.Strings("options", defaults, 50, validate.StrOpts{Trim: true, Min: 1, Max: 100})
	fd.Width = 2
	if n := f.Int("width", defaults, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(2)}); n != nil {
		fd.Width = *n
	}
	return fd
}

// formFields mirrors formFields: the stored definition, or the default
// fields when it is empty or no entry parses.
func formFields(raw any) []domain.PublicField {
	items, _ := raw.([]any)
	var out []domain.PublicField
	for _, it := range items {
		f := validate.New(it, true)
		if fd := parseField(f); f.Valid() {
			out = append(out, fd)
		}
	}
	if len(out) == 0 {
		return domain.DefaultFormFields
	}
	return out
}

type formInput struct {
	Slug           *string
	Name           *string
	Title          *string
	Description    domain.OptionalText
	Fields         []domain.PublicField
	SubmitLabel    *string
	SuccessMessage *string
	RedirectURL    domain.OptionalText
	DefaultSource  *string
	NotifyUserIDs  []string
	NotifyNumbers  []string
	IsActive       *bool
}

// parseForm is publicFormSchema (patch: patchSchemaOf(publicFormSchema,
// ["slug"])).
func parseForm(f *validate.Form, patch bool) formInput {
	var in formInput
	strDefault := func(key, def string, o validate.StrOpts) *string {
		if patch {
			return f.Str(key, optional, o)
		}
		s := f.StrDefault(key, def, o)
		return &s
	}
	if !patch {
		in.Slug = f.Str("slug", required, validate.StrOpts{Trim: true, Check: slugCheck})
	}
	in.Name = f.Str("name", orOptional(patch, required), validate.StrOpts{Trim: true, Min: 1, Max: 120})
	in.Title = f.Str("title", orOptional(patch, required), validate.StrOpts{Trim: true, Min: 1, Max: 150})
	in.Description = optionalText(f, "description", 600)
	var keys []string
	items := f.List("fields", orOptional(patch, required), 25, func(list *validate.Form, i int, v any) {
		fd := parseField(list.Item(i, v))
		keys = append(keys, fd.Key)
		in.Fields = append(in.Fields, fd)
	})
	minItems(f, "fields", items, 1)
	if items != nil && in.Fields == nil {
		in.Fields = []domain.PublicField{}
	}
	in.SubmitLabel = strDefault("submit_label", "Kirim", validate.StrOpts{Trim: true, Min: 1, Max: 40})
	in.SuccessMessage = strDefault("success_message", "Terima kasih! Tim kami akan menghubungi Anda.", validate.StrOpts{Trim: true, Min: 1, Max: 500})
	in.RedirectURL = domain.OptionalText{Set: has(f, "redirect_url"), Value: f.Str("redirect_url", nullable, validate.StrOpts{Max: 500, Check: redirectURLCheck})}
	if in.RedirectURL.Value != nil {
		trimmed := validate.JSTrim(*in.RedirectURL.Value)
		in.RedirectURL.Value = &trimmed
	}
	// z.enum(LEAD_SOURCES).default("lainnya"): forms may only default to a
	// source crm_sales_leads_source_check accepts.
	switch {
	case patch:
		in.DefaultSource = f.Enum("default_source", optional, contractsales.LeadSources)
	default:
		in.DefaultSource = f.Enum("default_source", validate.Rule{HasDefault: true}, contractsales.LeadSources)
		if in.DefaultSource == nil {
			lainnya := "lainnya"
			in.DefaultSource = &lainnya
		}
	}
	in.NotifyUserIDs = f.Strings("notify_user_ids", orOptional(patch, defaults), 20, validate.StrOpts{Check: validate.UUIDCheck})
	in.NotifyNumbers = f.Strings("notify_numbers", orOptional(patch, defaults), 10, validate.StrOpts{Trim: true, Min: 8, Max: 20})
	if patch {
		in.IsActive = f.Bool("is_active", optional)
		return in
	}
	if in.NotifyUserIDs == nil {
		in.NotifyUserIDs = []string{}
	}
	if in.NotifyNumbers == nil {
		in.NotifyNumbers = []string{}
	}
	active := f.BoolDefault("is_active", true)
	in.IsActive = &active
	// The object refine runs only when no issue aborted the parse (zod skips
	// refinements after type errors, not after length or format checks).
	if !aborted(f) && !domain.HasContactField(keys) {
		f.Fail("fields", "custom", domain.ContactFieldMessage)
	}
	return in
}

func aborted(f *validate.Form) bool {
	for _, is := range f.Issues() {
		if is.Code == "invalid_type" || is.Code == "invalid_value" {
			return true
		}
	}
	return false
}

/* ── campaigns ────────────────────────────────────────────────────────── */

var (
	voucherPrefixCheck = regexCheck(regexp.MustCompile(`^[A-Za-z0-9]{2,12}$`), "")
	linkURLCheck       = func(s string) (string, string, bool) { return "custom", "Tautan tidak valid", domain.IsSafeLink(s) }
	campaignActions    = []string{"start", "schedule", "pause", "resume", "cancel"}
)

type campaignInput struct {
	Action          *string
	ScheduledAt     *string
	Name            *string
	MessageTemplate *string
	Segment         any
	HasSegment      bool
	SegmentID       *string
	HasSegmentID    bool
	PromoCampaignID *string
	PromoMode       *string
	VoucherPrefix   *string
	DailyCap        *int
	HasDailyCap     bool
	Channels        []string
	InappTitle      *string
	HasInappTitle   bool
	ImageURL        *string
	HasImageURL     bool
	LinkURL         *string
	HasLinkURL      bool
}

// parseCampaign is createCampaignSchema, or patchCampaignSchema with patch.
func parseCampaign(f *validate.Form, patch bool) campaignInput {
	var in campaignInput
	if patch {
		in.Action = f.Enum("action", optional, campaignActions)
		in.ScheduledAt = f.Str("scheduled_at", optional, validate.StrOpts{Check: validate.DatetimeCheck})
	}
	in.Name = f.Str("name", orOptional(patch, required), validate.StrOpts{Trim: true, Min: 2, Max: 120})
	in.MessageTemplate = f.Str("message_template", orOptional(patch, required), validate.StrOpts{Trim: true, Min: 10, Max: 2000})
	in.HasSegment = has(f, "segment")
	in.Segment = jsValue(f.Fields()["segment"])
	if !patch && !in.HasSegment && f.Fields() != nil {
		// z.unknown() inside z.object is still a required key in zod 4.
		f.Fail("segment", "invalid_type", "Invalid input: expected nonoptional, received undefined")
	}
	in.HasSegmentID = has(f, "segment_id")
	in.SegmentID = f.UUID("segment_id", nullable)
	if !patch {
		in.PromoCampaignID = f.UUID("promo_campaign_id", nullable)
		in.PromoMode = f.Enum("promo_mode", nullable, []string{"public", "batch"})
		in.VoucherPrefix = f.Str("voucher_prefix", nullable, validate.StrOpts{Trim: true, Check: voucherPrefixCheck})
	}
	in.HasDailyCap = has(f, "daily_cap")
	in.DailyCap = f.Int("daily_cap", nullable, validate.NumOpts{Positive: true, Max: validate.Bound(2000)})
	items := f.List("channels", optional, 1<<30, func(list *validate.Form, i int, v any) {
		s, _ := list.CheckString(i, v, validate.StrOpts{Check: validate.EnumCheck(domain.CampaignChannels)})
		in.Channels = append(in.Channels, s)
	})
	minItems(f, "channels", items, 1)
	in.HasInappTitle = has(f, "inapp_title")
	in.InappTitle = f.Str("inapp_title", nullable, validate.StrOpts{Trim: true, Max: 120})
	in.HasImageURL = has(f, "image_url")
	in.ImageURL = f.Str("image_url", nullable, validate.StrOpts{Trim: true, Max: 500, Check: validate.URLCheck})
	in.HasLinkURL = has(f, "link_url")
	in.LinkURL = f.Str("link_url", nullable, validate.StrOpts{Trim: true, Max: 500, Check: linkURLCheck})
	if !patch {
		in.ScheduledAt = f.Str("scheduled_at", nullable, validate.StrOpts{Check: validate.DatetimeCheck})
	}
	return in
}

type configInput struct {
	Enabled  *bool
	DailyCap *int
}

// parseConfig is the campaign-config putSchema.
func parseConfig(f *validate.Form) configInput {
	return configInput{
		Enabled:  f.Bool("enabled", optional),
		DailyCap: f.Int("daily_cap", optional, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(2000)}),
	}
}

// parseOptout is the campaign-optouts createSchema.
func parseOptout(f *validate.Form) (phone string, note *string) {
	if s := f.Str("phone", required, validate.StrOpts{Trim: true, Min: 8, Max: 25}); s != nil {
		phone = *s
	}
	return phone, f.Str("note", optional, validate.StrOpts{Trim: true, Max: 300})
}

// emptyToNil is `value || null` for an optional string.
func emptyToNil(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}
