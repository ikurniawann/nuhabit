package promo

import (
	"errors"
	"math"
	"net/http"
	"regexp"
	"time"

	"nuhabit/backend/internal/modules/storedvalue/promo/domain"
	"nuhabit/backend/internal/platform/validate"
)

// Request bodies, read the way validateBody parses the zod schemas in
// lib/promo/campaign-schema.ts and offer-schema.ts.

// errMalformedBody is `await request.json()` throwing inside validateBody:
// apiHandler answers it with a 500.
var errMalformedBody = errors.New("request body is not valid JSON")

func bodyForm(r *http.Request) (*validate.Form, error) {
	body, present := validate.ReadBody(r)
	if !present {
		return nil, errMalformedBody
	}
	return validate.New(body, true), nil
}

// sent reports whether key is in the body (zod keeps only sent keys).
func sent(f *validate.Form, key string) bool {
	_, ok := f.Fields()[key]
	return ok
}

// refinable mirrors zod v4: object refinements run unless a
// non-continuable issue (wrong type, bad enum, no union match) occurred.
func refinable(f *validate.Form) bool {
	for _, i := range f.Issues() {
		switch i.Code {
		case "invalid_type", "invalid_value", "invalid_union":
			return false
		}
	}
	return true
}

func regexCheck(re *regexp.Regexp, msg string) func(string) (string, string, bool) {
	return func(s string) (string, string, bool) { return "invalid_format", msg, re.MatchString(s) }
}

var (
	codeOpts   = validate.StrOpts{Trim: true, Check: regexCheck(regexp.MustCompile(`^[A-Za-z0-9-]{3,40}$`), "Kode: huruf/angka/strip, 3-40 karakter")}
	prefixOpts = validate.StrOpts{Trim: true, Check: regexCheck(regexp.MustCompile(`^[A-Za-z0-9]{2,12}$`), "Prefix: huruf/angka, 2-12 karakter")}
	dateOpts   = validate.StrOpts{Check: func(s string) (string, string, bool) {
		return "custom", "Tanggal tidak valid", isCalendarDate(s)
	}}
	nameOpts  = validate.StrOpts{Trim: true, Min: 2, Max: 120}
	descOpts  = validate.StrOpts{Trim: true, Max: 1000}
	uuidOpts  = validate.StrOpts{Check: validate.UUIDCheck}
	moneyOpts = validate.NumOpts{Positive: true, Max: validate.Bound(1_000_000_000)}
	limitOpts = validate.NumOpts{Positive: true, Max: validate.Bound(1_000_000)}

	optional         = validate.Rule{Optional: true}
	optionalNullable = validate.Rule{Optional: true, Nullable: true}

	discountTypes = []string{"percent", "fixed"}
	scopes        = []string{"ticketing_online", "ticketing_loket", "pos", "semua"}
	eligibilities = []string{domain.EligibilityAll, domain.EligibilityMember, domain.EligibilityNewMember}
)

var calendarDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// isCalendarDate is isValidCalendarDate in lib/ticketing/pricing. Date.UTC
// maps years 0-99 to 1900-1999, so the TS rejects them.
func isCalendarDate(s string) bool {
	if !calendarDate.MatchString(s) {
		return false
	}
	t, err := time.Parse(time.DateOnly, s)
	return err == nil && t.Year() >= 100
}

// targetFields reads campaignTargetFields.
func targetFields(f *validate.Form) (products, categories domain.Field[[]string], eligibility domain.Field[string], days domain.Field[*int]) {
	products = domain.Field[[]string]{Set: sent(f, "target_product_ids"), Value: f.Strings("target_product_ids", optional, 200, uuidOpts)}
	categories = domain.Field[[]string]{Set: sent(f, "target_category_ids"), Value: f.Strings("target_category_ids", optional, 100, uuidOpts)}
	e := f.Enum("eligibility", optional, eligibilities)
	eligibility = domain.Field[string]{Set: e != nil, Value: deref(e)}
	days = domain.Field[*int]{Set: sent(f, "new_member_days"),
		Value: f.Int("new_member_days", optionalNullable, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(3650)})}
	return products, categories, eligibility, days
}

func parseCampaignCreate(r *http.Request) (campaignCreate, error) {
	f, err := bodyForm(r)
	if err != nil {
		return campaignCreate{}, err
	}
	var b campaignCreate
	b.Name = deref(f.Str("name", validate.Rule{}, nameOpts))
	b.Description = f.Str("description", optionalNullable, descOpts)
	b.DiscountType = deref(f.Enum("discount_type", validate.Rule{}, discountTypes))
	b.Value = deref(f.Num("value", validate.Rule{}, moneyOpts))
	b.MaxDiscount = f.Num("max_discount", optionalNullable, moneyOpts)
	if v := f.Num("min_purchase", validate.Rule{HasDefault: true}, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(1_000_000_000)}); v != nil {
		b.MinPurchase = *v
	}
	b.ValidFrom = f.Str("valid_from", optionalNullable, dateOpts)
	b.ValidUntil = f.Str("valid_until", optionalNullable, dateOpts)
	b.UsageLimit = f.Int("usage_limit", optionalNullable, limitOpts)
	b.PerPhoneLimit = f.Int("per_phone_limit", validate.Rule{Nullable: true, HasDefault: true},
		validate.NumOpts{Positive: true, Max: validate.Bound(100)})
	if !sent(f, "per_phone_limit") {
		one := 1
		b.PerPhoneLimit = &one
	}
	b.Scope = f.StrDefault("scope", "ticketing_online", validate.StrOpts{Check: validate.EnumCheck(scopes)})
	products, categories, eligibility, days := targetFields(f)
	b.TargetProductIDs, b.TargetCategoryIDs = products.Value, categories.Value
	b.Eligibility, b.NewMemberDays = eligibility.Value, days.Value
	b.PublicCode = deref(f.Str("public_code", optional, codeOpts))
	if refinable(f) {
		if b.DiscountType == "percent" && b.Value > 100 {
			f.Fail("value", "custom", "Diskon persen maksimal 100")
		}
		if deref(b.ValidFrom) != "" && deref(b.ValidUntil) != "" && *b.ValidUntil < *b.ValidFrom {
			f.Fail("valid_until", "custom", "Tanggal akhir sebelum tanggal mulai")
		}
	}
	return b, f.Err("Validation failed")
}

func parseCampaignPatch(r *http.Request) (domain.CampaignPatch, error) {
	f, err := bodyForm(r)
	if err != nil {
		return domain.CampaignPatch{}, err
	}
	var b domain.CampaignPatch
	if v := f.Str("name", optional, nameOpts); v != nil {
		b.Name = domain.Field[string]{Set: true, Value: *v}
	}
	b.Description = domain.Field[*string]{Set: sent(f, "description"), Value: f.Str("description", optionalNullable, descOpts)}
	if v := f.Enum("discount_type", optional, discountTypes); v != nil {
		b.DiscountType = domain.Field[string]{Set: true, Value: *v}
	}
	if v := f.Num("value", optional, moneyOpts); v != nil {
		b.Value = domain.Field[float64]{Set: true, Value: *v}
	}
	b.MaxDiscount = domain.Field[*float64]{Set: sent(f, "max_discount"), Value: f.Num("max_discount", optionalNullable, moneyOpts)}
	if v := f.Num("min_purchase", optional, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(1_000_000_000)}); v != nil {
		b.MinPurchase = domain.Field[float64]{Set: true, Value: *v}
	}
	b.ValidFrom = domain.Field[*string]{Set: sent(f, "valid_from"), Value: f.Str("valid_from", optionalNullable, dateOpts)}
	b.ValidUntil = domain.Field[*string]{Set: sent(f, "valid_until"), Value: f.Str("valid_until", optionalNullable, dateOpts)}
	b.UsageLimit = domain.Field[*int]{Set: sent(f, "usage_limit"), Value: f.Int("usage_limit", optionalNullable, limitOpts)}
	b.PerPhoneLimit = domain.Field[*int]{Set: sent(f, "per_phone_limit"),
		Value: f.Int("per_phone_limit", optionalNullable, validate.NumOpts{Positive: true, Max: validate.Bound(100)})}
	if v := f.Enum("scope", optional, scopes); v != nil {
		b.Scope = domain.Field[string]{Set: true, Value: *v}
	}
	if v := f.Bool("is_active", optional); v != nil {
		b.IsActive = domain.Field[bool]{Set: true, Value: *v}
	}
	if v := f.Bool("show_in_member_portal", optional); v != nil {
		b.ShowInMemberPortal = domain.Field[bool]{Set: true, Value: *v}
	}
	b.TargetProductIDs, b.TargetCategoryIDs, b.Eligibility, b.NewMemberDays = targetFields(f)
	return b, f.Err("Validation failed")
}

// codeCreate is codeCreateSchema: a single public code or a voucher batch.
type codeCreate struct {
	Batch      bool
	Code       string
	UsageLimit *int
	Prefix     string
	Count      int
}

func parseCodeCreate(r *http.Request) (codeCreate, error) {
	f, err := bodyForm(r)
	if err != nil {
		return codeCreate{}, err
	}
	var b codeCreate
	if f.Fields() != nil {
		switch mode, _ := f.Fields()["mode"].(string); mode {
		case "single":
			b.Code = deref(f.Str("code", validate.Rule{}, codeOpts))
			b.UsageLimit = f.Int("usage_limit", validate.Rule{Nullable: true, HasDefault: true}, limitOpts)
		case "batch":
			b.Batch = true
			b.Prefix = deref(f.Str("prefix", validate.Rule{}, prefixOpts))
			b.Count = deref(f.Int("count", validate.Rule{}, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(1000)}))
		default:
			f.Fail("mode", "invalid_union", "Invalid discriminator value. Expected 'single' | 'batch'")
		}
	}
	return b, f.Err("Validation failed")
}

func parseCodeSync(r *http.Request) (target int, prefix *string, err error) {
	f, err := bodyForm(r)
	if err != nil {
		return 0, nil, err
	}
	target = deref(f.Int("target_count", validate.Rule{}, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(1000)}))
	prefix = f.Str("prefix", optional, prefixOpts)
	return target, prefix, f.Err("Validation failed")
}

func parseCodePatch(r *http.Request) (codePatch, error) {
	f, err := bodyForm(r)
	if err != nil {
		return codePatch{}, err
	}
	var b codePatch
	b.IsActive = f.Bool("is_active", optional)
	b.Code = f.Str("code", optional, codeOpts)
	b.UsageLimit = domain.Field[*int]{Set: sent(f, "usage_limit"), Value: f.Int("usage_limit", optionalNullable, limitOpts)}
	return b, f.Err("Validation failed")
}

var itemRoles = []string{"component", "buy", "get", "eligible"}

// parseOfferRule reads offerRuleBodySchema; on PATCH offer_type is
// optional (.partial({ offer_type: true })).
func parseOfferRule(r *http.Request, typeOptional bool) (domain.OfferRuleInput, error) {
	f, err := bodyForm(r)
	if err != nil {
		return domain.OfferRuleInput{}, err
	}
	var p domain.OfferRuleInput
	p.OfferType = deref(f.Enum("offer_type", validate.Rule{Optional: typeOptional}, domain.OfferTypes))
	p.Name = deref(f.Str("name", validate.Rule{}, validate.StrOpts{Min: 1, Max: 160}))
	p.Description = f.Str("description", optionalNullable, validate.StrOpts{})
	p.ValidFrom = f.Str("valid_from", optionalNullable, validate.StrOpts{})
	p.ValidUntil = f.Str("valid_until", optionalNullable, validate.StrOpts{})
	p.IsActive = f.Bool("is_active", optional)
	p.BundlePrice = f.Num("bundle_price", optionalNullable, validate.NumOpts{})
	p.BuyQty = f.Int("buy_qty", optionalNullable, validate.NumOpts{})
	p.GetQty = f.Int("get_qty", optionalNullable, validate.NumOpts{})
	p.GetMode = f.Enum("get_mode", optionalNullable, []string{"same_as_buy", "specific_products"})
	p.VolumeBasis = f.Enum("volume_basis", optionalNullable, []string{"qty", "spend"})
	p.VolumeMin = f.Num("volume_min", optionalNullable, validate.NumOpts{})
	p.DiscountType = f.Enum("discount_type", optionalNullable, discountTypes)
	p.DiscountValue = f.Num("discount_value", optionalNullable, validate.NumOpts{})
	p.SalesChannels = f.Strings("sales_channels", optionalNullable, math.MaxInt, validate.StrOpts{Check: validate.EnumCheck(domain.SalesChannelCodes)})
	p.MaxUses = f.Int("max_uses", optionalNullable, validate.NumOpts{Positive: true})
	p.MaxUsesPerMember = f.Int("max_uses_per_member", optionalNullable, validate.NumOpts{Positive: true})
	p.IsExclusive = f.Bool("is_exclusive", optional)
	p.Priority = f.Int("priority", optional, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(1000)})
	p.UnlockCode = f.Str("unlock_code", optionalNullable, validate.StrOpts{Trim: true, Max: 40})
	p.Items = []domain.OfferRuleItemInput{}
	f.List("items", validate.Rule{HasDefault: true}, math.MaxInt, func(sub *validate.Form, i int, v any) {
		it := sub.Item(i, v)
		p.Items = append(p.Items, domain.OfferRuleItemInput{
			Role:       deref(it.Enum("role", validate.Rule{}, itemRoles)),
			ProductID:  it.Str("product_id", optionalNullable, uuidOpts),
			CategoryID: it.Str("category_id", optionalNullable, uuidOpts),
			Qty:        it.Num("qty", optional, validate.NumOpts{Positive: true}),
			SortOrder:  it.Int("sort_order", optional, validate.NumOpts{}),
		})
	})
	return p, f.Err("Validation failed")
}

func deref[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}
