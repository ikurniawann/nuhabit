package gymcredits

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// This file reproduces the zod schemas of the TS routes closely enough that
// the first issue message (what the routes return as "error") is identical,
// and "details" carries zod-shaped issues.

// zodUUID is the pattern of z.string().uuid() in zod 4.
var zodUUID = regexp.MustCompile(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$`)

func isUUID(s string) bool { return zodUUID.MatchString(s) }

type issue struct {
	Expected  string   `json:"expected,omitempty"`
	Origin    string   `json:"origin,omitempty"`
	Code      string   `json:"code"`
	Format    string   `json:"format,omitempty"`
	Values    []string `json:"values,omitempty"`
	Minimum   *float64 `json:"minimum,omitempty"`
	Maximum   *float64 `json:"maximum,omitempty"`
	Inclusive bool     `json:"inclusive,omitempty"`
	Path      []any    `json:"path"`
	Message   string   `json:"message"`
}

// undefined marks a missing value (JS undefined) as opposed to JSON null.
type undefinedT struct{}

var undefined any = undefinedT{}

// readJSON reads the body like request.json(); a missing or malformed body
// yields fallback (undefined, or {} where the TS used `.catch(() => ({}))`).
func readJSON(r *http.Request, fallback any) (any, []byte) {
	if r.Body == nil {
		return fallback, nil
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return fallback, nil
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return fallback, nil
	}
	return v, raw
}

func received(v any) string {
	switch v.(type) {
	case undefinedT:
		return "undefined"
	case nil:
		return "null"
	case string:
		return "string"
	case float64:
		return "number"
	case bool:
		return "boolean"
	case []any:
		return "array"
	default:
		return "object"
	}
}

func typeIssue(path []any, expected string, v any, msg string) issue {
	if msg == "" {
		msg = fmt.Sprintf("Invalid input: expected %s, received %s", expected, received(v))
	}
	return issue{Expected: expected, Code: "invalid_type", Path: path, Message: msg}
}

func jsNum(n float64) string { return strconv.FormatFloat(n, 'f', -1, 64) }

func utf16Len(s string) int { return len(utf16.Encode([]rune(s))) }

// form validates one JSON object in schema order, collecting zod-like issues.
type form struct {
	obj    map[string]any
	issues []issue
}

func newForm(body any) *form {
	obj, ok := body.(map[string]any)
	if !ok {
		return &form{issues: []issue{typeIssue([]any{}, "object", body, "")}}
	}
	return &form{obj: obj}
}

func (f *form) get(key string) any {
	if v, ok := f.obj[key]; ok {
		return v
	}
	return undefined
}

func (f *form) add(i issue) { f.issues = append(f.issues, i) }

// skip reports whether the field must not be validated: the body was not an
// object, or the value is an accepted absence.
func (f *form) skip(v any, optional, nullable bool) bool {
	if f.obj == nil {
		return true
	}
	if _, isUndef := v.(undefinedT); isUndef {
		return optional
	}
	return v == nil && nullable
}

type strRule struct {
	trim               bool
	min, max           int
	minMsg             string
	uuid               bool
	uuidMsg            string
	optional, nullable bool
}

// str returns the (trimmed) string and whether it is set.
func (f *form) str(key string, rule strRule) (string, bool) {
	v := f.get(key)
	if f.skip(v, rule.optional, rule.nullable) {
		return "", false
	}
	path := []any{key}
	s, ok := v.(string)
	if !ok {
		f.add(typeIssue(path, "string", v, ""))
		return "", false
	}
	if rule.trim {
		s = strings.TrimSpace(s)
	}
	if n := utf16Len(s); rule.min > 0 && n < rule.min {
		msg := rule.minMsg
		if msg == "" {
			msg = fmt.Sprintf("Too small: expected string to have >=%d characters", rule.min)
		}
		lo := float64(rule.min)
		f.add(issue{Origin: "string", Code: "too_small", Minimum: &lo, Inclusive: true, Path: path, Message: msg})
		return "", false
	} else if rule.max > 0 && n > rule.max {
		hi := float64(rule.max)
		f.add(issue{Origin: "string", Code: "too_big", Maximum: &hi, Inclusive: true, Path: path,
			Message: fmt.Sprintf("Too big: expected string to have <=%d characters", rule.max)})
		return "", false
	}
	if rule.uuid && !isUUID(s) {
		f.add(uuidIssue(path, rule.uuidMsg))
		return "", false
	}
	return s, true
}

func uuidIssue(path []any, msg string) issue {
	if msg == "" {
		msg = "Invalid UUID"
	}
	return issue{Origin: "string", Code: "invalid_format", Format: "uuid", Path: path, Message: msg}
}

type numRule struct {
	integer            bool
	intMsg             string
	min, max           *float64
	minMsg             string
	optional, nullable bool
}

func bound(n float64) *float64 { return &n }

// num returns the number and whether it is set.
func (f *form) num(key string, rule numRule) (float64, bool) {
	v := f.get(key)
	if f.skip(v, rule.optional, rule.nullable) {
		return 0, false
	}
	path := []any{key}
	n, ok := v.(float64)
	if !ok {
		f.add(typeIssue(path, "number", v, ""))
		return 0, false
	}
	if rule.integer && (n != math.Trunc(n) || math.Abs(n) > 1<<53-1) {
		msg := rule.intMsg
		if msg == "" {
			msg = "Invalid input: expected int, received number"
		}
		f.add(issue{Expected: "int", Code: "invalid_type", Format: "safeint", Path: path, Message: msg})
		return 0, false
	}
	if rule.min != nil && n < *rule.min {
		msg := rule.minMsg
		if msg == "" {
			msg = "Too small: expected number to be >=" + jsNum(*rule.min)
		}
		f.add(issue{Origin: "number", Code: "too_small", Minimum: rule.min, Inclusive: true, Path: path, Message: msg})
		return 0, false
	}
	if rule.max != nil && n > *rule.max {
		f.add(issue{Origin: "number", Code: "too_big", Maximum: rule.max, Inclusive: true, Path: path,
			Message: "Too big: expected number to be <=" + jsNum(*rule.max)})
		return 0, false
	}
	return n, true
}

// enum returns the value when it is one of values.
func (f *form) enum(key string, values []string) string {
	v := f.get(key)
	if f.obj == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		for _, allowed := range values {
			if s == allowed {
				return s
			}
		}
	}
	quoted := make([]string, len(values))
	for i, val := range values {
		quoted[i] = strconv.Quote(val)
	}
	f.add(issue{Code: "invalid_value", Values: values, Path: []any{key},
		Message: "Invalid option: expected one of " + strings.Join(quoted, "|")})
	return ""
}

// uuidList validates z.array(z.string().uuid()).min(1).nullable().default(null).
func (f *form) uuidList(key string) []string {
	v := f.get(key)
	if f.skip(v, true, true) {
		return nil
	}
	path := []any{key}
	arr, ok := v.([]any)
	if !ok {
		f.add(typeIssue(path, "array", v, ""))
		return nil
	}
	out := make([]string, 0, len(arr))
	before := len(f.issues)
	for i, el := range arr {
		s, ok := el.(string)
		switch {
		case !ok:
			f.add(typeIssue([]any{key, i}, "string", el, ""))
		case !isUUID(s):
			f.add(uuidIssue([]any{key, i}, ""))
		default:
			out = append(out, s)
		}
	}
	if len(arr) < 1 {
		f.add(issue{Origin: "array", Code: "too_small", Minimum: bound(1), Inclusive: true, Path: path,
			Message: "Too small: expected array to have >=1 items"})
	}
	if len(f.issues) > before {
		return nil
	}
	return out
}

// staffErr is parseInput(..., "issue"): 400 with the first message and all issues.
func (f *form) staffErr() error {
	if len(f.issues) == 0 {
		return nil
	}
	return httpx.BadRequest(f.issues[0].Message, f.issues)
}

// memberErr is the member portal form: 400 with the first message only.
func (f *form) memberErr() error {
	if len(f.issues) == 0 {
		return nil
	}
	return httpx.BadRequest(f.issues[0].Message)
}

func optString(s string, ok bool) *string {
	if !ok {
		return nil
	}
	return &s
}

/* ── Route schemas ───────────────────────────────────────────────────── */

var frontDeskMethods = []string{"cash", "card", "transfer", "qris", "ark_coin", "complimentary"}

type adjustBody struct {
	Amount int
	Reason string
}

func parseAdjust(body any) (adjustBody, error) {
	f := newForm(body)
	amount, _ := f.num("amount", numRule{integer: true, intMsg: "Jumlah harus bilangan bulat"})
	reason, _ := f.str("reason", strRule{trim: true, min: 3, minMsg: "Alasan penyesuaian wajib diisi", max: 500})
	return adjustBody{Amount: int(amount), Reason: reason}, f.staffErr()
}

type sellBody struct {
	PackageID     string
	PaymentMethod string
	DiscountIdr   float64
	BranchID      *string
	Note          *string
}

func parseSell(body any) (sellBody, error) {
	f := newForm(body)
	var b sellBody
	b.PackageID, _ = f.str("package_id", strRule{uuid: true, uuidMsg: "Pilih paket"})
	b.PaymentMethod = f.enum("payment_method", frontDeskMethods)
	b.DiscountIdr, _ = f.num("discount_idr", numRule{min: bound(0), optional: true})
	b.BranchID = optString(f.str("branch_id", strRule{uuid: true, optional: true, nullable: true}))
	b.Note = optString(f.str("note", strRule{trim: true, max: 300, optional: true, nullable: true}))
	return b, f.staffErr()
}

type reasonBody struct {
	EntryID string
	Reason  string
}

func parseReverse(body any) (reasonBody, error) {
	f := newForm(body)
	var b reasonBody
	b.EntryID, _ = f.str("entry_id", strRule{uuid: true, uuidMsg: "Entri tidak valid"})
	b.Reason, _ = f.str("reason", strRule{trim: true, min: 3, minMsg: "Alasan pembatalan wajib diisi", max: 500})
	return b, f.staffErr()
}

func parseRefund(body any) (string, error) {
	f := newForm(body)
	reason, _ := f.str("reason", strRule{trim: true, min: 3, minMsg: "Alasan refund wajib diisi", max: 500})
	return reason, f.staffErr()
}

func parsePackageStatus(body any) (string, error) {
	f := newForm(body)
	status := f.enum("status", []string{"active", "archived"})
	return status, f.staffErr()
}

var packageKinds = []string{KindCredits, KindPass}

func parsePackage(body any) (PackageInput, error) {
	f := newForm(body)
	var p PackageInput
	p.ID = optString(f.str("id", strRule{uuid: true, optional: true}))
	p.Name, _ = f.str("name", strRule{trim: true, min: 2, minMsg: "Nama paket minimal 2 huruf", max: 120})
	p.Description, _ = f.str("description", strRule{max: 1000, optional: true})
	p.Kind = KindCredits
	if f.get("kind") != undefined {
		p.Kind = f.enum("kind", packageKinds)
	}
	// A pass carries no credits; a credit pack needs at least one.
	minCredits := 1.0
	if p.Kind == KindPass {
		minCredits = 0
	}
	credits, _ := f.num("credits", numRule{integer: true, min: bound(minCredits), minMsg: "Kredit minimal 1", max: bound(1000), optional: p.Kind == KindPass})
	if p.Kind != KindPass {
		p.Credits = int(credits)
	}
	p.PriceIdr, _ = f.num("price_idr", numRule{min: bound(0), max: bound(1_000_000_000)})
	validity, _ := f.num("validity_days", numRule{integer: true, min: bound(1), minMsg: "Masa berlaku minimal 1 hari", max: bound(3650)})
	p.ValidityDays = int(validity)
	if limit, ok := f.num("purchase_limit_per_member", numRule{integer: true, min: bound(1), max: bound(1000), optional: true, nullable: true}); ok {
		n := int(limit)
		p.PurchaseLimitPerMember = &n
	}
	p.ApplicableClassTypeIDs = f.uuidList("applicable_class_type_ids")
	p.BranchID = optString(f.str("branch_id", strRule{uuid: true, optional: true, nullable: true}))
	p.IsPublic = true
	if v := f.get("is_public"); v != undefined {
		b, ok := v.(bool)
		if !ok {
			f.add(typeIssue([]any{"is_public"}, "boolean", v, ""))
		}
		p.IsPublic = ok && b
	}
	p.Badge = optString(f.str("badge", strRule{trim: true, max: 40, optional: true, nullable: true}))
	if p.Badge != nil && *p.Badge == "" {
		p.Badge = nil
	}
	p.BranchPrices = f.branchPrices("branch_prices")
	sortOrder, _ := f.num("sort_order", numRule{integer: true, min: bound(0), max: bound(10_000), optional: true})
	p.SortOrder = int(sortOrder)
	return p, f.staffErr()
}

// branchPrices validates z.array({branch_id: uuid, price_idr: number >= 0}).optional().
func (f *form) branchPrices(key string) []BranchPrice {
	v := f.get(key)
	if f.skip(v, true, true) {
		return nil
	}
	arr, ok := v.([]any)
	if !ok {
		f.add(typeIssue([]any{key}, "array", v, ""))
		return nil
	}
	out := make([]BranchPrice, 0, len(arr))
	before := len(f.issues)
	for i, el := range arr {
		obj, ok := el.(map[string]any)
		if !ok {
			f.add(typeIssue([]any{key, i}, "object", el, ""))
			continue
		}
		item := &form{obj: obj}
		branchID, _ := item.str("branch_id", strRule{uuid: true})
		price, _ := item.num("price_idr", numRule{min: bound(0), max: bound(1_000_000_000)})
		for _, is := range item.issues {
			is.Path = append([]any{key, i}, is.Path...)
			f.add(is)
		}
		out = append(out, BranchPrice{BranchID: branchID, PriceIdr: price})
	}
	if len(f.issues) > before {
		return nil
	}
	return out
}

type rulesBody struct {
	BranchID *string
	Rules    []domain.KV
}

// parseRulesPut validates { branch_id, rules: record } and keeps the rule
// keys in input order (unknown keys are reported in that order).
func parseRulesPut(body any, raw []byte) (rulesBody, error) {
	f := newForm(body)
	var b rulesBody
	b.BranchID = optString(f.str("branch_id", strRule{uuid: true, optional: true, nullable: true}))
	if f.obj != nil {
		v := f.get("rules")
		if _, ok := v.(map[string]any); !ok {
			f.add(typeIssue([]any{"rules"}, "record", v, ""))
		}
	}
	if err := f.staffErr(); err != nil {
		return b, err
	}
	var envelope struct {
		Rules json.RawMessage `json:"rules"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return b, err
	}
	kv, err := orderedObject(envelope.Rules)
	b.Rules = kv
	return b, err
}

// orderedObject decodes a JSON object keeping key order; a repeated key keeps
// its first position and the last value, like JSON.parse.
func orderedObject(raw []byte) ([]domain.KV, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if _, err := dec.Token(); err != nil {
		return nil, err
	}
	var out []domain.KV
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		key, _ := tok.(string)
		var v any
		if err := dec.Decode(&v); err != nil {
			return nil, err
		}
		replaced := false
		for i := range out {
			if out[i].Key == key {
				out[i].Value, replaced = v, true
			}
		}
		if !replaced {
			out = append(out, domain.KV{Key: key, Value: v})
		}
	}
	return out, nil
}

type memberPurchaseBody struct {
	PackageID string
	Method    string
	BranchID  *string
}

func parseMemberPurchase(body any) (memberPurchaseBody, error) {
	f := newForm(body)
	var b memberPurchaseBody
	b.PackageID, _ = f.str("package_id", strRule{uuid: true, uuidMsg: "Pilih paket"})
	b.Method = f.enum("method", []string{"qris", "ark_coin", "invoice"})
	b.BranchID = optString(f.str("branch_id", strRule{uuid: true, uuidMsg: "Cabang tidak valid", optional: true, nullable: true}))
	return b, f.memberErr()
}
