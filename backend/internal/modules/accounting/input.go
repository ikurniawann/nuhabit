package accounting

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/validate"
)

// Request bodies: the zod schemas of lib/accounting/schemas.ts and the
// route-local schemas, read with platform/validate in schema order.

var (
	required    = validate.Rule{}
	optional    = validate.Rule{Optional: true}
	optNullable = validate.Rule{Optional: true, Nullable: true}
)

var dateOnlyPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// dateOnly is z.string().regex(/^\d{4}-\d{2}-\d{2}$/).
var dateOnly = validate.StrOpts{Check: func(s string) (string, string, bool) {
	return "invalid_format", `Invalid string: must match pattern /^\d{4}-\d{2}-\d{2}$/`, dateOnlyPattern.MatchString(s)
}}

func trimmed(min, max int) validate.StrOpts { return validate.StrOpts{Trim: true, Min: min, Max: max} }

var positive = validate.NumOpts{Positive: true}

// errBadJSON is request.json() throwing in validateBody: the TS route
// answers 500.
var errBadJSON = errors.New("request body is not JSON")

// readForm starts a validateBody form; a missing or malformed body is the
// TS 500.
func readForm(r *http.Request) (*validate.Form, error) {
	body, ok := validate.ReadBody(r)
	if !ok {
		return nil, errBadJSON
	}
	return validate.New(body, true), nil
}

func deref[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}

// minItems adds zod's array .min(n) issue.
func minItems(f *validate.Form, key string, items []any, n int) {
	if items != nil && len(items) < n {
		f.Fail(key, "too_small", fmt.Sprintf("Too small: expected array to have >=%d items", n))
	}
}

const noMax = 1 << 30

/* ── Journal entries ─────────────────────────────────────────────────── */

type journalInput struct {
	EntryDate   string
	Description *string
	Lines       []domain.Line
	Post        bool
}

func parseJournal(r *http.Request) (journalInput, error) {
	f, err := readForm(r)
	if err != nil {
		return journalInput{}, err
	}
	in := journalInput{EntryDate: deref(f.Str("entry_date", required, dateOnly))}
	in.Description = f.Str("description", optNullable, validate.StrOpts{Trim: true})
	items := f.List("lines", required, noMax, func(sub *validate.Form, i int, v any) {
		it := sub.Item(i, v)
		it.UUID("id", optional)
		l := domain.Line{AccountID: deref(it.UUID("account_id", required))}
		l.Side = deref(it.Enum("entry_side", required, domain.JournalSides))
		l.Amount = deref(it.Num("amount", required, positive))
		l.Memo = it.Str("memo", optNullable, validate.StrOpts{Trim: true})
		l.SortOrder = it.Int("sort_order", optional, validate.NumOpts{})
		in.Lines = append(in.Lines, l)
	})
	minItems(f, "lines", items, 2)
	in.Post = deref(f.Bool("post", optional))
	return in, f.Err("Validation failed")
}

/* ── Fiscal years ────────────────────────────────────────────────────── */

func parseFiscalYear(r *http.Request) (FiscalYearInput, error) {
	f, err := readForm(r)
	if err != nil {
		return FiscalYearInput{}, err
	}
	in := FiscalYearInput{
		Code:      strings.ToUpper(jsTrim(deref(f.Str("code", required, trimmed(1, 30))))),
		Name:      jsTrim(deref(f.Str("name", required, trimmed(1, 120)))),
		StartDate: deref(f.Str("start_date", required, dateOnly)),
		EndDate:   deref(f.Str("end_date", required, dateOnly)),
	}
	in.IsActive = f.BoolDefault("is_active", true)
	items := f.List("periods", required, 12, func(sub *validate.Form, i int, v any) {
		it := sub.Item(i, v)
		it.UUID("id", optional)
		p := domain.PeriodInput{PeriodNo: deref(it.Int("period_no", required, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(12)}))}
		p.Name = deref(it.Str("name", required, trimmed(1, 60)))
		p.StartDate = deref(it.Str("start_date", required, dateOnly))
		p.EndDate = deref(it.Str("end_date", required, dateOnly))
		p.Status = deref(it.Enum("status", required, []string{domain.PeriodOpen, domain.PeriodClosed}))
		in.Periods = append(in.Periods, p)
	})
	minItems(f, "periods", items, 1)
	return in, f.Err("Validation failed")
}

type openingInput struct {
	Lines []OpeningLineInput
	Post  bool
}

func parseOpening(r *http.Request) (openingInput, error) {
	f, err := readForm(r)
	if err != nil {
		return openingInput{}, err
	}
	var in openingInput
	f.UUID("retained_earnings_account_id", optNullable)
	items := f.List("lines", required, noMax, func(sub *validate.Form, i int, v any) {
		it := sub.Item(i, v)
		l := OpeningLineInput{AccountID: deref(it.UUID("account_id", required))}
		l.Side = deref(it.Enum("entry_side", required, domain.JournalSides))
		l.Amount = deref(it.Num("amount", required, positive))
		l.Memo = it.Str("memo", optNullable, validate.StrOpts{Trim: true})
		in.Lines = append(in.Lines, l)
	})
	minItems(f, "lines", items, 2)
	in.Post = deref(f.Bool("post", optional))
	return in, f.Err("Validation failed")
}

// parseClosePrevious is the open route's optional body: a missing or
// malformed body is {}; a bad value answers the first issue message.
func parseClosePrevious(r *http.Request) (bool, error) {
	body, ok := validate.ReadBody(r)
	if !ok {
		body = map[string]any{}
	}
	f := validate.New(body, true)
	v := f.Bool("close_previous", validate.Rule{HasDefault: true})
	if !f.Valid() {
		return false, badRequest(f.Issues()[0].Message)
	}
	if v == nil {
		return true, nil
	}
	return *v, nil
}

/* ── Chart of accounts, account types, mappings ──────────────────────── */

func parseAccount(r *http.Request) (AccountInput, error) {
	f, err := readForm(r)
	if err != nil {
		return AccountInput{}, err
	}
	in := AccountInput{
		Code:          deref(f.Str("code", required, trimmed(1, 20))),
		Name:          deref(f.Str("name", required, trimmed(1, 200))),
		ParentID:      f.UUID("parent_id", optNullable),
		AccountTypeID: deref(f.UUID("account_type_id", required)),
	}
	in.IsContra = deref(f.Bool("is_contra", optional))
	in.IsCashBank = deref(f.Bool("is_cash_bank", optional))
	in.CashFlowCategory = f.Enum("cash_flow_category", optNullable, domain.CashFlowCategories)
	in.Description = f.Str("description", optNullable, validate.StrOpts{Trim: true})
	in.IsActive = f.BoolDefault("is_active", true)
	return in, f.Err("Validation failed")
}

func parseAccountType(r *http.Request) (AccountTypeInput, error) {
	f, err := readForm(r)
	if err != nil {
		return AccountTypeInput{}, err
	}
	in := AccountTypeInput{
		Code:          deref(f.Str("code", required, trimmed(1, 30))),
		Name:          deref(f.Str("name", required, trimmed(1, 100))),
		NormalBalance: deref(f.Enum("normal_balance", required, domain.JournalSides)),
		SortOrder:     deref(f.Int("sort_order", optional, validate.NumOpts{})),
	}
	in.IsActive = f.BoolDefault("is_active", true)
	return in, f.Err("Validation failed")
}

type mappingBody struct {
	EventCode   string
	Name        string
	Description *string
	Module      string
	IsActive    bool
	Lines       []MappingLineInput
}

func parseMapping(r *http.Request) (mappingBody, error) {
	f, err := readForm(r)
	if err != nil {
		return mappingBody{}, err
	}
	in := mappingBody{
		EventCode:   deref(f.Str("event_code", required, trimmed(1, 60))),
		Name:        deref(f.Str("name", required, trimmed(1, 200))),
		Description: f.Str("description", optNullable, validate.StrOpts{Trim: true}),
		Module:      deref(f.Enum("module", required, domain.JournalModules)),
	}
	in.IsActive = f.BoolDefault("is_active", true)
	items := f.List("lines", required, noMax, func(sub *validate.Form, i int, v any) {
		it := sub.Item(i, v)
		it.UUID("id", optional)
		l := MappingLineInput{EntrySide: deref(it.Enum("entry_side", required, domain.JournalSides))}
		l.LineRole = deref(it.Str("line_role", required, trimmed(1, 40)))
		l.AccountID = it.UUID("account_id", optNullable)
		l.AmountSource = deref(it.Enum("amount_source", required, domain.JournalAmountSources))
		l.SortOrder = it.Int("sort_order", optional, validate.NumOpts{})
		l.IsRequired = it.Bool("is_required", optional)
		in.Lines = append(in.Lines, l)
	})
	minItems(f, "lines", items, 1)
	return in, f.Err("Validation failed")
}

/* ── Cash & bank, AP, AR ─────────────────────────────────────────────── */

type cashBody struct {
	EntryDate         string
	Amount            float64
	FromID, ToID      string
	Description, Memo *string
}

// parseCash reads the cash in/out (cash_account_id, offset_account_id) or
// transfer (from_account_id, to_account_id) schema.
func parseCash(r *http.Request, fromKey, toKey string) (cashBody, error) {
	f, err := readForm(r)
	if err != nil {
		return cashBody{}, err
	}
	in := cashBody{EntryDate: deref(f.Str("entry_date", required, dateOnly))}
	in.Amount = deref(f.Num("amount", required, positive))
	in.FromID = deref(f.UUID(fromKey, required))
	in.ToID = deref(f.UUID(toKey, required))
	in.Description = f.Str("description", optNullable, trimmed(0, 300))
	in.Memo = f.Str("memo", optNullable, trimmed(0, 200))
	return in, f.Err("Validation failed")
}

var (
	apMethods = []string{"cash", "bank_transfer", "giro", "qris", "other"}
	arMethods = []string{"cash", "transfer", "qris", "edc", "lainnya"}
)

type settlementBody struct {
	InvoiceID       string
	Amount          float64
	Date, Method    *string
	ReferenceNumber *string
	Notes           *string
}

// parseSettlement reads the AP payment (payment_date) or AR receipt
// (receipt_date) schema.
func parseSettlement(r *http.Request, dateKey string, methods []string) (settlementBody, error) {
	f, err := readForm(r)
	if err != nil {
		return settlementBody{}, err
	}
	in := settlementBody{InvoiceID: deref(f.UUID("invoice_id", required))}
	in.Amount = deref(f.Num("amount", required, positive))
	in.Date = f.Str(dateKey, optional, dateOnly)
	in.Method = f.Enum("method", optional, methods)
	in.ReferenceNumber = f.Str("reference_number", optNullable, validate.StrOpts{Max: 120})
	in.Notes = f.Str("notes", optNullable, validate.StrOpts{Max: 500})
	return in, f.Err("Validation failed")
}

func parseVoidReason(r *http.Request) (string, error) {
	f, err := readForm(r)
	if err != nil {
		return "", err
	}
	reason := f.Str("reason", required, validate.StrOpts{Check: func(s string) (string, string, bool) {
		return "too_big", "Alasan void maksimal 500 karakter", validate.UTF16Len(s) <= 500
	}})
	return deref(reason), f.Err("Validation failed")
}

/* ── Finance ─────────────────────────────────────────────────────────── */

// validCalendarDate is isValidCalendarDate.
func validCalendarDate(s string) bool {
	t, err := time.Parse("2006-01-02", s)
	return err == nil && t.Format("2006-01-02") == s
}

type reviseBody struct {
	Label   string
	Amount  float64
	DueDate *string
	Note    *string
}

func parseRevise(r *http.Request) (reviseBody, error) {
	f, err := readForm(r)
	if err != nil {
		return reviseBody{}, err
	}
	in := reviseBody{Label: deref(f.Str("label", required, trimmed(1, 150)))}
	in.Amount = deref(f.Num("amount", required, validate.NumOpts{Positive: true, Max: validate.Bound(999_999_999_999)}))
	// z.string().regex().refine().optional().nullable().or(z.literal("")).
	if v, _, done := f.Take("due_date", "string", optNullable); !done {
		s, isStr := v.(string)
		switch {
		case isStr && s == "":
			in.DueDate = &s
		case isStr && dateOnlyPattern.MatchString(s) && validCalendarDate(s):
			in.DueDate = &s
		default:
			f.Fail("due_date", "invalid_union", "Invalid input")
		}
	}
	in.Note = f.Str("note", optNullable, trimmed(0, 300))
	return in, f.Err("Validation failed")
}
