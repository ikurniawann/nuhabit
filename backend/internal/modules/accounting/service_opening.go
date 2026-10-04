package accounting

import (
	"bytes"
	"context"
	"encoding/json"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Beginning balances: the OPENING journal of a fiscal year, suggested from
// the prior year's closing balance sheet (beginning-balance-store.ts).

func marshalJSON(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// OpeningLine is BeginningBalanceLine.
type OpeningLine struct {
	AccountID       string  `json:"account_id"`
	AccountCode     string  `json:"account_code"`
	AccountName     string  `json:"account_name"`
	AccountTypeCode string  `json:"account_type_code"`
	NormalBalance   string  `json:"normal_balance"`
	IsContra        bool    `json:"is_contra"`
	SuggestedAmount float64 `json:"suggested_amount"`
	Amount          float64 `json:"amount"`
	EntrySide       string  `json:"entry_side"`
	Source          string  `json:"source"`
}

// PriorYear is the previous fiscal year in a suggestion.
type PriorYear struct {
	ID            string `json:"id"`
	Code          string `json:"code"`
	Name          string `json:"name"`
	EndDate       string `json:"end_date"`
	IsFullyClosed bool   `json:"is_fully_closed"`
}

// AccountRef is an account id, display code and name.
type AccountRef struct {
	ID   string `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}

// OpeningSuggestion is BeginningBalanceSuggestion.
type OpeningSuggestion struct {
	FiscalYearID            string        `json:"fiscal_year_id"`
	FiscalYearCode          string        `json:"fiscal_year_code"`
	FiscalYearName          string        `json:"fiscal_year_name"`
	StartDate               string        `json:"start_date"`
	PeriodID                *string       `json:"period_id"`
	PeriodName              *string       `json:"period_name"`
	PriorFiscalYear         *PriorYear    `json:"prior_fiscal_year"`
	RetainedEarningsAccount *AccountRef   `json:"retained_earnings_account"`
	Lines                   []OpeningLine `json:"lines"`
	TotalDebit              float64       `json:"total_debit"`
	TotalCredit             float64       `json:"total_credit"`
	ExistingEntryID         *string       `json:"existing_entry_id"`
	ExistingStatus          *string       `json:"existing_status"`
	CanEdit                 bool          `json:"can_edit"`
	IsFirstYear             bool          `json:"is_first_year"`
	Message                 *string       `json:"message"`
}

type openingYear struct {
	ID        string
	CompanyID *string
	Code      string
	Name      string
	StartDate string
	EndDate   string
	IsActive  bool
}

const openingYearSQL = `
SELECT id::text, company_id::text, code, name, start_date::text, end_date::text, is_active
  FROM accounting.fiscal_years
 WHERE id = $1 AND deleted_at IS NULL`

func openingTotals(lines []OpeningLine) (float64, float64) {
	var d, c float64
	for _, l := range lines {
		if l.EntrySide == domain.Debit {
			d += l.Amount
		} else if l.EntrySide == domain.Credit {
			c += l.Amount
		}
	}
	return domain.Round2(d), domain.Round2(c)
}

func strp(s string) *string { return &s }

// OpeningSuggestion is getBeginningBalanceSuggestion.
func (s *Service) OpeningSuggestion(ctx context.Context, yearID string) (*OpeningSuggestion, error) {
	year, err := one[openingYear](ctx, s.db, openingYearSQL, yearID)
	if err != nil {
		return nil, err
	}
	if year == nil {
		return nil, httpx.NotFound("Fiscal year tidak ditemukan")
	}
	period1, err := one[struct{ ID, Name, Status string }](ctx, s.db, `
SELECT id::text, name, status FROM accounting.fiscal_periods WHERE fiscal_year_id = $1 ORDER BY period_no ASC LIMIT 1`, yearID)
	if err != nil {
		return nil, err
	}
	existing, err := one[struct{ ID, Status string }](ctx, s.db, `
SELECT id::text, status FROM accounting.journal_entries
 WHERE entry_type = 'OPENING' AND source_fiscal_year_id = $1 AND deleted_at IS NULL LIMIT 1`, yearID)
	if err != nil {
		return nil, err
	}
	re, err := one[AccountRef](ctx, s.db, `
SELECT coa.id::text, coa.code, coa.name
  FROM accounting.chart_of_accounts coa
  JOIN accounting.account_types t ON t.id = coa.account_type_id
 WHERE coa.deleted_at IS NULL AND coa.is_postable = true AND coa.is_active = true AND t.code = 'EQUITY'
   AND `+companyMatch("coa.company_id", "$1")+`
   AND (coa.name ILIKE '%retained%earn%' OR coa.name ILIKE '%laba%ditahan%' OR coa.name ILIKE '%laba ditahan%'
        OR coa.code LIKE '32%' OR coa.code LIKE '3102%')
 ORDER BY coa.code ASC
 LIMIT 1`, year.CompanyID)
	if err != nil {
		return nil, err
	}
	prior, err := one[struct{ ID, Code, Name, EndDate, OpenCount string }](ctx, s.db, `
SELECT y.id::text, y.code, y.name, y.end_date::text AS end_date,
       COALESCE((SELECT COUNT(*)::text FROM accounting.fiscal_periods p WHERE p.fiscal_year_id = y.id AND p.status = 'OPEN'), '0') AS open_count
  FROM accounting.fiscal_years y
 WHERE y.deleted_at IS NULL AND y.end_date < $1::date AND `+companyMatch("y.company_id", "$2")+`
 ORDER BY y.end_date DESC
 LIMIT 1`, year.StartDate, year.CompanyID)
	if err != nil {
		return nil, err
	}

	out := &OpeningSuggestion{
		FiscalYearID: year.ID, FiscalYearCode: year.Code, FiscalYearName: year.Name, StartDate: year.StartDate,
		IsFirstYear: prior == nil, CanEdit: true,
	}
	if period1 != nil {
		out.PeriodID, out.PeriodName = &period1.ID, &period1.Name
	}
	if prior != nil {
		out.PriorFiscalYear = &PriorYear{ID: prior.ID, Code: prior.Code, Name: prior.Name, EndDate: prior.EndDate,
			IsFullyClosed: domain.ParseNumber(prior.OpenCount) == 0}
	}
	if re != nil {
		out.RetainedEarningsAccount = &AccountRef{ID: re.ID, Code: domain.FormatAccountCodeDisplay(re.Code), Name: re.Name}
	}

	if existing != nil {
		rows, err := collect[struct {
			AccountID, AccountCode, AccountName, TypeCode, Normal string
			IsContra                                              bool
			Side, Amount                                          string
		}](ctx, s.db, `
SELECT l.account_id::text, coa.code, coa.name, t.code, t.normal_balance, coa.is_contra, l.entry_side, l.amount::text
  FROM accounting.journal_entry_lines l
  JOIN accounting.chart_of_accounts coa ON coa.id = l.account_id
  JOIN accounting.account_types t ON t.id = coa.account_type_id
 WHERE l.entry_id = $1
 ORDER BY l.sort_order ASC`, existing.ID)
		if err != nil {
			return nil, err
		}
		out.Lines = make([]OpeningLine, len(rows))
		for i, l := range rows {
			source := "MANUAL"
			if re != nil && l.AccountID == re.ID {
				source = "RETAINED_EARNINGS"
			}
			amount := domain.ToNumber(l.Amount)
			out.Lines[i] = OpeningLine{AccountID: l.AccountID, AccountCode: domain.FormatAccountCodeDisplay(l.AccountCode),
				AccountName: l.AccountName, AccountTypeCode: l.TypeCode, NormalBalance: l.Normal, IsContra: l.IsContra,
				SuggestedAmount: amount, Amount: amount, EntrySide: l.Side, Source: source}
		}
		out.TotalDebit, out.TotalCredit = openingTotals(out.Lines)
		out.ExistingEntryID, out.ExistingStatus = &existing.ID, &existing.Status
		out.CanEdit = existing.Status == domain.StatusDraft
		if existing.Status == domain.StatusPosted {
			out.Message = strp("Beginning balance sudah POSTED dan terkunci.")
		} else {
			out.Message = strp("Beginning balance draft — bisa diedit.")
		}
		return out, nil
	}

	lines := []OpeningLine{}
	message := ""
	if prior == nil {
		message = "Fiscal " + year.Code + " adalah fiscal year pertama. Tidak ada FY sebelumnya untuk di-suggest — isi saldo awal Kas & Bank secara manual, lalu simpan/post."
	} else if domain.ParseNumber(prior.OpenCount) > 0 {
		message = "Fiscal " + prior.Code + " belum fully CLOSED (" + prior.OpenCount + " period OPEN). Suggest saldo akhir belum final — sebaiknya closing dulu."
	}
	if prior != nil {
		aggs, err := collect[struct {
			AccountID, Code, Name, TypeCode, Normal string
			IsContra                                bool
			Debit, Credit                           string
		}](ctx, s.db, `
SELECT coa.id::text, coa.code, coa.name, t.code, t.normal_balance, coa.is_contra,
       COALESCE(SUM(CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text AS debit,
       COALESCE(SUM(CASE WHEN l.entry_side = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text AS credit
  FROM accounting.journal_entry_lines l
  JOIN accounting.journal_entries e ON e.id = l.entry_id AND e.deleted_at IS NULL AND e.status = 'POSTED'
  JOIN accounting.fiscal_periods p ON p.id = e.fiscal_period_id
  JOIN accounting.chart_of_accounts coa ON coa.id = l.account_id AND coa.deleted_at IS NULL AND coa.is_postable = true
  JOIN accounting.account_types t ON t.id = coa.account_type_id
 WHERE p.fiscal_year_id = $1
 GROUP BY coa.id, coa.code, coa.name, t.code, t.normal_balance, coa.is_contra
HAVING COALESCE(SUM(CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE 0 END), 0)
    <> COALESCE(SUM(CASE WHEN l.entry_side = 'CREDIT' THEN l.amount ELSE 0 END), 0)
 ORDER BY coa.code ASC`, prior.ID)
		if err != nil {
			return nil, err
		}
		plNetCredit := 0.0
		for _, row := range aggs {
			debit, credit := domain.ToNumber(row.Debit), domain.ToNumber(row.Credit)
			if domain.IsProfitLossType(row.TypeCode) {
				plNetCredit += float64(credit - debit)
				continue
			}
			side, amount, ok := domain.OpeningLine(debit, credit)
			if !ok {
				continue
			}
			lines = append(lines, OpeningLine{AccountID: row.AccountID, AccountCode: domain.FormatAccountCodeDisplay(row.Code),
				AccountName: row.Name, AccountTypeCode: row.TypeCode, NormalBalance: row.Normal, IsContra: row.IsContra,
				SuggestedAmount: amount, Amount: amount, EntrySide: side, Source: "PRIOR_BS"})
		}
		reNet := domain.Round2(plNetCredit)
		switch {
		case reNet != 0 && re != nil:
			side := domain.Debit
			if reNet > 0 {
				side = domain.Credit
			}
			abs := reNet
			if abs < 0 {
				abs = -abs
			}
			lines = append(lines, OpeningLine{AccountID: re.ID, AccountCode: domain.FormatAccountCodeDisplay(re.Code), AccountName: re.Name,
				AccountTypeCode: "EQUITY", NormalBalance: domain.Credit, SuggestedAmount: abs, Amount: abs, EntrySide: side, Source: "RETAINED_EARNINGS"})
		case reNet != 0:
			if message != "" {
				message += " "
			}
			message += "Laba/rugi bersih " + domain.FormatNumber(reNet) + " perlu akun Retained Earnings (Equity) — buat/pilih akun Laba Ditahan di COA."
		}
		if message == "" {
			message = "Suggest dari saldo akhir " + prior.Code + " (POSTED). Angka bisa diedit sebelum simpan."
		}
	}
	sort.SliceStable(lines, func(i, j int) bool {
		oi, oj := domain.BalanceTypeOrder(lines[i].AccountTypeCode), domain.BalanceTypeOrder(lines[j].AccountTypeCode)
		if oi != oj {
			return oi < oj
		}
		return strings.Compare(lines[i].AccountCode, lines[j].AccountCode) < 0
	})
	out.Lines = lines
	out.TotalDebit, out.TotalCredit = openingTotals(lines)
	if message != "" {
		out.Message = &message
	}
	return out, nil
}

// OpeningLineInput is one beginningBalancePayloadSchema line.
type OpeningLineInput struct {
	AccountID string
	Side      string
	Amount    float64
	Memo      *string
}

// OpeningSaved is saveBeginningBalance's result.
type OpeningSaved struct {
	EntryID string `json:"entry_id"`
	Status  string `json:"status"`
}

// SaveOpening is saveBeginningBalance: one OPENING entry per fiscal year,
// editable while DRAFT. Period 1 is forced OPEN for the opening date.
func (s *Service) SaveOpening(ctx context.Context, yearID, userID string, input []OpeningLineInput, post bool) (*OpeningSaved, error) {
	suggestion, err := s.OpeningSuggestion(ctx, yearID)
	if err != nil {
		return nil, err
	}
	if !suggestion.CanEdit && suggestion.ExistingEntryID != nil {
		return nil, httpx.BadRequest("Beginning balance sudah POSTED dan tidak bisa diubah")
	}
	if suggestion.PeriodID == nil {
		return nil, httpx.BadRequest("Fiscal year belum punya period")
	}
	lines := []OpeningLineInput{}
	var debit, credit float64
	for _, l := range input {
		if l.Amount > 0 {
			lines = append(lines, l)
		}
	}
	if len(lines) < 2 {
		return nil, httpx.BadRequest("Minimal 2 baris saldo awal (debit & credit)")
	}
	for _, l := range lines {
		if l.Side == domain.Debit {
			debit += l.Amount
		} else {
			credit += l.Amount
		}
	}
	if domain.Round2(debit) != domain.Round2(credit) {
		return nil, httpx.BadRequest("Saldo awal tidak balance: Debit " + domain.FormatNumber(domain.Round2(debit)) + " ≠ Credit " + domain.FormatNumber(domain.Round2(credit)))
	}
	year, err := one[openingYear](ctx, s.db, openingYearSQL, yearID)
	if err != nil {
		return nil, err
	}
	if year == nil {
		return nil, httpx.NotFound("Fiscal year tidak ditemukan")
	}
	period, err := one[struct{ ID, Status string }](ctx, s.db, `SELECT id::text, status FROM accounting.fiscal_periods WHERE id = $1`, *suggestion.PeriodID)
	if err != nil {
		return nil, err
	}
	if period == nil {
		return nil, httpx.NotFound("Period 1 tidak ditemukan")
	}
	status := domain.StatusDraft
	if post {
		status = domain.StatusPosted
	}
	description := "Beginning balance " + year.Code
	var entryID string
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if period.Status != domain.PeriodOpen {
			if _, err := tx.Exec(ctx, `UPDATE accounting.fiscal_periods SET status = 'OPEN', updated_at = now() WHERE id = $1`, period.ID); err != nil {
				return err
			}
		}
		if suggestion.ExistingEntryID != nil {
			entryID = *suggestion.ExistingEntryID
			if _, err := tx.Exec(ctx, `
UPDATE accounting.journal_entries
   SET description = $1, entry_date = $2::date, fiscal_period_id = $3, status = $4::varchar,
       posted_at = CASE WHEN $4::text = 'POSTED' THEN COALESCE(posted_at, now()) ELSE NULL END,
       posted_by = CASE WHEN $4::text = 'POSTED' THEN COALESCE(posted_by, $5::uuid) ELSE NULL END,
       updated_by = $5::uuid, updated_at = now()
 WHERE id = $6::uuid AND deleted_at IS NULL AND status = 'DRAFT'`,
				description, year.StartDate, period.ID, status, userID, entryID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `DELETE FROM accounting.journal_entry_lines WHERE entry_id = $1`, entryID); err != nil {
				return err
			}
		} else {
			y := year.StartDate
			if len(y) > 4 {
				y = y[:4]
			}
			entryNo, err := nextNo(ctx, tx, "OB-"+y+"-", year.CompanyID)
			if err != nil {
				return err
			}
			if err := tx.QueryRow(ctx, `
INSERT INTO accounting.journal_entries (
  company_id, entry_no, entry_date, description, fiscal_period_id, status, is_recon, entry_type,
  source_fiscal_year_id, posted_at, posted_by, created_by, updated_by
) VALUES (
  $1,$2,$3::date,$4,$5,$6::varchar,false,'OPENING',$7,
  CASE WHEN $6::text = 'POSTED' THEN now() ELSE NULL END,
  CASE WHEN $6::text = 'POSTED' THEN $8::uuid ELSE NULL END,
  $8::uuid,$8::uuid
) RETURNING id::text`, year.CompanyID, entryNo, year.StartDate, description, period.ID, status, year.ID, userID).Scan(&entryID); err != nil {
				return err
			}
		}
		for i, l := range lines {
			if _, err := tx.Exec(ctx, `
INSERT INTO accounting.journal_entry_lines (entry_id, account_id, entry_side, amount, memo, sort_order)
VALUES ($1,$2,$3,$4,$5,$6)`, entryID, l.AccountID, l.Side, domain.Round2(l.Amount), trimOrNull(l.Memo), (i+1)*10); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &OpeningSaved{EntryID: entryID, Status: status}, nil
}
