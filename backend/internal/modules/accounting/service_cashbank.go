package accounting

import (
	"context"
	"strings"

	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// Cash & bank: balances, account ledgers, cash in/out and transfers posted
// as MANUAL POSTED journals (cash-bank-store.ts).

// CashBankAccount is one is_cash_bank account with its posted balance.
type CashBankAccount struct {
	ID              string  `json:"id"`
	Code            string  `json:"code"`
	CodeDisplay     string  `json:"code_display"`
	Name            string  `json:"name"`
	AccountTypeCode *string `json:"account_type_code"`
	NormalBalance   string  `json:"normal_balance"`
	Balance         float64 `json:"balance"`
	MovementCount   float64 `json:"movement_count"`
}

// ListCashBankAccounts is listCashBankAccounts.
func (s *Service) ListCashBankAccounts(ctx context.Context, companyID string) ([]CashBankAccount, error) {
	rows, err := collect[struct {
		ID, Code, Name               string
		TypeCode                     *string
		Normal, Debit, Credit, Count string
	}](ctx, s.db, `
SELECT coa.id::text, coa.code, coa.name, t.code AS account_type_code, t.normal_balance,
       COALESCE(SUM(mov.debit), 0)::text AS debit,
       COALESCE(SUM(mov.credit), 0)::text AS credit,
       COALESCE(COUNT(mov.line_id), 0)::text AS movement_count
  FROM accounting.chart_of_accounts coa
  JOIN accounting.account_types t ON t.id = coa.account_type_id
  LEFT JOIN (
    SELECT l.account_id, l.id AS line_id,
           CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE 0 END AS debit,
           CASE WHEN l.entry_side = 'CREDIT' THEN l.amount ELSE 0 END AS credit
      FROM accounting.journal_entry_lines l
      JOIN accounting.journal_entries e
        ON e.id = l.entry_id AND e.deleted_at IS NULL AND e.status = 'POSTED' AND e.company_id = $1::uuid
  ) mov ON mov.account_id = coa.id
 WHERE coa.deleted_at IS NULL AND coa.is_active = true AND coa.is_cash_bank = true AND coa.company_id = $1::uuid
 GROUP BY coa.id, coa.code, coa.name, t.code, t.normal_balance
 ORDER BY coa.code ASC`, companyID)
	if err != nil {
		return nil, err
	}
	out := make([]CashBankAccount, len(rows))
	for i, r := range rows {
		normal := domain.AsNormal(r.Normal)
		out[i] = CashBankAccount{ID: r.ID, Code: r.Code, CodeDisplay: domain.FormatAccountCodeDisplay(r.Code), Name: r.Name,
			AccountTypeCode: r.TypeCode, NormalBalance: normal,
			Balance:       domain.Balance(domain.ParseNumber(r.Debit), domain.ParseNumber(r.Credit), normal, false),
			MovementCount: domain.ParseNumber(r.Count)}
	}
	return out, nil
}

// LedgerAccount is the account header of a ledger.
type LedgerAccount struct {
	ID              string `json:"id"`
	Code            string `json:"code"`
	CodeDisplay     string `json:"code_display"`
	Name            string `json:"name"`
	AccountTypeCode string `json:"account_type_code,omitempty"`
	NormalBalance   string `json:"normal_balance"`
}

// LedgerLine is a cash-bank or general ledger line.
type LedgerLine struct {
	LineID         string  `json:"line_id"`
	EntryID        string  `json:"entry_id"`
	EntryNo        string  `json:"entry_no"`
	EntryDate      string  `json:"entry_date"`
	EntryType      string  `json:"entry_type"`
	Description    *string `json:"description"`
	Memo           *string `json:"memo"`
	EntrySide      string  `json:"entry_side"`
	Debit          float64 `json:"debit"`
	Credit         float64 `json:"credit"`
	RunningBalance float64 `json:"running_balance"`
}

// Ledger is CashBankLedger / GeneralLedgerReport.
type Ledger struct {
	Account        LedgerAccount `json:"account"`
	DateFrom       *string       `json:"date_from"`
	DateTo         *string       `json:"date_to"`
	OpeningBalance float64       `json:"opening_balance"`
	ClosingBalance float64       `json:"closing_balance"`
	TotalDebit     float64       `json:"total_debit"`
	TotalCredit    float64       `json:"total_credit"`
	Lines          []LedgerLine  `json:"lines"`
}

type ledgerAccountRow struct {
	ID, Code, Name, TypeCode, Normal string
	IsContra, IsCashBank, IsPostable bool
	CompanyID                        *string
	Deleted                          bool
}

func (s *Service) ledgerAccount(ctx context.Context, id string) (*ledgerAccountRow, error) {
	return one[ledgerAccountRow](ctx, s.db, `
SELECT coa.id::text, coa.code, coa.name, t.code, t.normal_balance, coa.is_contra, coa.is_cash_bank, coa.is_postable,
       coa.company_id::text, coa.deleted_at IS NOT NULL
  FROM accounting.chart_of_accounts coa
  JOIN accounting.account_types t ON t.id = coa.account_type_id
 WHERE coa.id = $1::uuid`, id)
}

// ledger builds the running-balance ledger of one account (posted lines,
// opening = movements before dateFrom).
func (s *Service) ledger(ctx context.Context, acc *ledgerAccountRow, companyID string, dateFrom, dateTo *string, contra bool) (*Ledger, error) {
	normal := domain.AsNormal(acc.Normal)
	opening := 0.0
	if dateFrom != nil {
		var d, c string
		if err := s.db.QueryRow(ctx, `
SELECT COALESCE(SUM(CASE WHEN l.entry_side = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text,
       COALESCE(SUM(CASE WHEN l.entry_side = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text
  FROM accounting.journal_entry_lines l
  JOIN accounting.journal_entries e ON e.id = l.entry_id AND e.deleted_at IS NULL AND e.status = 'POSTED'
 WHERE l.account_id = $1::uuid AND e.company_id = $2::uuid AND e.entry_date < $3::date`, acc.ID, companyID, *dateFrom).Scan(&d, &c); err != nil {
			return nil, err
		}
		opening = domain.Balance(domain.ParseNumber(d), domain.ParseNumber(c), normal, contra)
	}
	args := []any{acc.ID, companyID}
	where := []string{"l.account_id = $1::uuid", "e.company_id = $2::uuid", "e.deleted_at IS NULL", "e.status = 'POSTED'"}
	if dateFrom != nil {
		args = append(args, *dateFrom)
		where = append(where, "e.entry_date >= $"+itoa(len(args))+"::date")
	}
	if dateTo != nil {
		args = append(args, *dateTo)
		where = append(where, "e.entry_date <= $"+itoa(len(args))+"::date")
	}
	rows, err := collect[struct {
		LineID, EntryID, EntryNo, EntryDate, EntryType string
		Description, Memo                              *string
		Side, Amount                                   string
	}](ctx, s.db, `
SELECT l.id::text, e.id::text, e.entry_no, e.entry_date::text, COALESCE(e.entry_type, 'MANUAL'),
       e.description, l.memo, l.entry_side, l.amount::text
  FROM accounting.journal_entry_lines l
  JOIN accounting.journal_entries e ON e.id = l.entry_id
 WHERE `+strings.Join(where, " AND ")+`
 ORDER BY e.entry_date ASC, e.entry_no ASC, l.sort_order ASC, l.entry_side ASC`, args...)
	if err != nil {
		return nil, err
	}
	running, totalDebit, totalCredit := opening, 0.0, 0.0
	lines := make([]LedgerLine, len(rows))
	for i, r := range rows {
		amount := domain.ParseNumber(r.Amount)
		var debit, credit float64
		if r.Side == domain.Debit {
			debit = amount
		}
		if r.Side == domain.Credit {
			credit = amount
		}
		totalDebit = domain.Round2(totalDebit + debit)
		totalCredit = domain.Round2(totalCredit + credit)
		running = domain.Round2(running + domain.SignedDelta(r.Side, amount, normal, contra))
		side := domain.Debit
		if r.Side == domain.Credit {
			side = domain.Credit
		}
		lines[i] = LedgerLine{LineID: r.LineID, EntryID: r.EntryID, EntryNo: r.EntryNo, EntryDate: r.EntryDate, EntryType: r.EntryType,
			Description: r.Description, Memo: r.Memo, EntrySide: side, Debit: debit, Credit: credit, RunningBalance: running}
	}
	return &Ledger{
		Account:  LedgerAccount{ID: acc.ID, Code: acc.Code, CodeDisplay: domain.FormatAccountCodeDisplay(acc.Code), Name: acc.Name, NormalBalance: normal},
		DateFrom: dateFrom, DateTo: dateTo, OpeningBalance: opening, ClosingBalance: running,
		TotalDebit: totalDebit, TotalCredit: totalCredit, Lines: lines,
	}, nil
}

// CashBankLedger is getCashBankLedger: nil when the account is not a live
// cash/bank account of the company.
func (s *Service) CashBankLedger(ctx context.Context, companyID, accountID string, dateFrom, dateTo *string) (*Ledger, error) {
	acc, err := s.ledgerAccount(ctx, accountID)
	if err != nil {
		return nil, err
	}
	if acc == nil || acc.Deleted || !acc.IsCashBank || acc.CompanyID == nil || *acc.CompanyID != companyID {
		return nil, nil
	}
	return s.ledger(ctx, acc, companyID, dateFrom, dateTo, false)
}

// PostableOption is PostableAccountOption.
type PostableOption struct {
	ID          string `json:"id"`
	Code        string `json:"code"`
	CodeDisplay string `json:"code_display"`
	Name        string `json:"name"`
	IsCashBank  bool   `json:"is_cash_bank"`
}

// PostableAccounts is listPostableAccounts.
func (s *Service) PostableAccounts(ctx context.Context, companyID string) ([]PostableOption, error) {
	rows, err := collect[PostableOption](ctx, s.db, `
SELECT id::text, code, ''::text, name, is_cash_bank
  FROM accounting.chart_of_accounts
 WHERE deleted_at IS NULL AND is_active = true AND is_postable = true AND company_id = $1::uuid
 ORDER BY code ASC`, companyID)
	for i := range rows {
		rows[i].CodeDisplay = domain.FormatAccountCodeDisplay(rows[i].Code)
	}
	return rows, err
}

type cashAccount struct {
	ID, Code, Name                  string
	IsCashBank, IsPostable, Deleted bool
	CompanyID                       *string
}

func (s *Service) cashAccountRow(ctx context.Context, id string) (*cashAccount, error) {
	return one[cashAccount](ctx, s.db, `
SELECT id::text, code, name, is_cash_bank, is_postable, deleted_at IS NOT NULL, company_id::text
  FROM accounting.chart_of_accounts WHERE id = $1::uuid`, id)
}

func (s *Service) assertCashBank(ctx context.Context, companyID, id string) (*cashAccount, error) {
	row, err := s.cashAccountRow(ctx, id)
	if err != nil {
		return nil, err
	}
	if row == nil || row.Deleted || !row.IsPostable || !row.IsCashBank || row.CompanyID == nil || *row.CompanyID != companyID {
		return nil, httpx.BadRequest("Akun kas/bank tidak valid")
	}
	return row, nil
}

// CashMovementInput is a cash in/out or transfer request.
type CashMovementInput struct {
	UserID, CompanyID, Kind, EntryDate string
	Amount                             float64
	CashAccountID, OffsetAccountID     string
	Description, Memo                  *string
}

// CashMovement is CashMovementRow.
type CashMovement struct {
	ID                string  `json:"id"`
	EntryNo           string  `json:"entry_no"`
	EntryDate         string  `json:"entry_date"`
	Description       *string `json:"description"`
	Kind              string  `json:"kind"`
	Amount            float64 `json:"amount"`
	CashAccountID     string  `json:"cash_account_id"`
	CashAccountCode   string  `json:"cash_account_code"`
	CashAccountName   string  `json:"cash_account_name"`
	OffsetAccountID   string  `json:"offset_account_id"`
	OffsetAccountCode string  `json:"offset_account_code"`
	OffsetAccountName string  `json:"offset_account_name"`
	Status            string  `json:"status"`
	CreatedAt         ts      `json:"created_at"`
}

func memoOr(memo *string, def string) *string {
	if m := trimOrNull(memo); m != nil {
		return m
	}
	return &def
}

// CreateCashMovement is createCashMovement: cash in debits the cash/bank
// account, cash out credits it, against a postable offset account.
func (s *Service) CreateCashMovement(ctx context.Context, in CashMovementInput) (*CashMovement, error) {
	amount := domain.Round2(in.Amount)
	if !(amount > 0) {
		return nil, httpx.BadRequest("Amount harus lebih dari 0")
	}
	cash, err := s.assertCashBank(ctx, in.CompanyID, in.CashAccountID)
	if err != nil {
		return nil, err
	}
	if in.OffsetAccountID == in.CashAccountID {
		return nil, httpx.BadRequest("Akun lawan tidak boleh sama dengan akun kas/bank")
	}
	offset, err := s.cashAccountRow(ctx, in.OffsetAccountID)
	if err != nil {
		return nil, err
	}
	if offset == nil || offset.Deleted || !offset.IsPostable || offset.CompanyID == nil || *offset.CompanyID != in.CompanyID {
		return nil, httpx.BadRequest("Akun lawan tidak valid / tidak postable")
	}
	isIn := in.Kind == "cash_in"
	label, cashSide, offsetSide, event := "Cash Out", domain.Credit, domain.Debit, "CASH_OUT"
	if isIn {
		label, cashSide, offsetSide, event = "Cash In", domain.Debit, domain.Credit, "CASH_IN"
	}
	description := trimOrNull(in.Description)
	if description == nil {
		description = strp(label + ": " + cash.Code + " " + cash.Name + " ↔ " + offset.Code + " " + offset.Name)
	}
	memo := memoOr(in.Memo, label)
	module, kind := "CASH_BANK", in.Kind
	ten, twenty := 10, 20
	entry, err := createEntry(ctx, s.db, NewEntry{
		UserID: in.UserID, CompanyID: &in.CompanyID, EntryDate: in.EntryDate, Description: description, Post: true,
		EntryType: domain.EntryManual, SourceModule: &module, SourceEventCode: &event, SourceDocumentType: &kind,
		Lines: []domain.Line{
			{AccountID: cash.ID, Side: cashSide, Amount: amount, Memo: memo, SortOrder: &ten},
			{AccountID: offset.ID, Side: offsetSide, Amount: amount, Memo: memo, SortOrder: &twenty},
		},
	})
	if err != nil {
		return nil, err
	}
	return &CashMovement{ID: entry.ID, EntryNo: entry.EntryNo, EntryDate: entry.EntryDate, Description: entry.Description,
		Kind: in.Kind, Amount: amount, CashAccountID: cash.ID, CashAccountCode: domain.FormatAccountCodeDisplay(cash.Code),
		CashAccountName: cash.Name, OffsetAccountID: offset.ID, OffsetAccountCode: domain.FormatAccountCodeDisplay(offset.Code),
		OffsetAccountName: offset.Name, Status: entry.Status, CreatedAt: entry.CreatedAt}, nil
}

// CashListFilter filters cash movements and transfers.
type CashListFilter struct {
	CompanyID, Kind, Search, DateFrom, DateTo string
	Limit, Offset                             string // JS numbers as text (LIMIT NaN fails like node-pg)
}

func pageClause(where []string, args []any, f CashListFilter) (string, []any) {
	if f.DateFrom != "" {
		args = append(args, f.DateFrom)
		where = append(where, "e.entry_date >= $"+itoa(len(args))+"::date")
	}
	if f.DateTo != "" {
		args = append(args, f.DateTo)
		where = append(where, "e.entry_date <= $"+itoa(len(args))+"::date")
	}
	if t := jsTrim(f.Search); t != "" {
		args = append(args, "%"+t+"%")
		n := itoa(len(args))
		where = append(where, "(e.entry_no ILIKE $"+n+" OR COALESCE(e.description,'') ILIKE $"+n+")")
	}
	return strings.Join(where, " AND "), args
}

func limitOffset(args []any, limit, offset string) (string, []any) {
	args = append(args, limit, offset)
	n := len(args)
	return " LIMIT $" + itoa(n-1) + "::text::bigint OFFSET $" + itoa(n) + "::text::bigint", args
}

// ListCashMovements is listCashMovements.
func (s *Service) ListCashMovements(ctx context.Context, f CashListFilter) ([]CashMovement, int, error) {
	cashSide, offsetSide := domain.Credit, domain.Debit
	if f.Kind == "cash_in" {
		cashSide, offsetSide = domain.Debit, domain.Credit
	}
	where, args := pageClause([]string{"e.deleted_at IS NULL", "e.company_id = $1::uuid", "e.source_document_type = $2"},
		[]any{f.CompanyID, f.Kind, cashSide, offsetSide}, f)
	page, args := limitOffset(args, f.Limit, f.Offset)
	type row struct {
		CashMovement
		Total int
	}
	rows, err := collect[row](ctx, s.db, `
SELECT e.id::text, e.entry_no, e.entry_date::text, e.description, $2::text, cash_line.amount::float8,
       cash_acc.id::text, cash_acc.code, cash_acc.name, offset_acc.id::text, offset_acc.code, offset_acc.name,
       e.status, e.created_at, COUNT(*) OVER()::int
  FROM accounting.journal_entries e
  JOIN accounting.journal_entry_lines cash_line ON cash_line.entry_id = e.id AND cash_line.entry_side = $3
  JOIN accounting.chart_of_accounts cash_acc ON cash_acc.id = cash_line.account_id AND cash_acc.is_cash_bank = true
  JOIN accounting.journal_entry_lines offset_line
    ON offset_line.entry_id = e.id AND offset_line.entry_side = $4 AND offset_line.account_id <> cash_line.account_id
  JOIN accounting.chart_of_accounts offset_acc ON offset_acc.id = offset_line.account_id
 WHERE `+where+`
 ORDER BY e.entry_date DESC, e.entry_no DESC`+page, args...)
	if err != nil {
		return nil, 0, err
	}
	out := make([]CashMovement, len(rows))
	total := 0
	for i, r := range rows {
		m := r.CashMovement
		m.CashAccountCode = domain.FormatAccountCodeDisplay(m.CashAccountCode)
		m.OffsetAccountCode = domain.FormatAccountCodeDisplay(m.OffsetAccountCode)
		out[i] = m
		if i == 0 {
			total = r.Total
		}
	}
	return out, total, nil
}

// CashTransfer is CashTransferRow.
type CashTransfer struct {
	ID              string  `json:"id"`
	EntryNo         string  `json:"entry_no"`
	EntryDate       string  `json:"entry_date"`
	Description     *string `json:"description"`
	Amount          float64 `json:"amount"`
	FromAccountID   string  `json:"from_account_id"`
	FromAccountCode string  `json:"from_account_code"`
	FromAccountName string  `json:"from_account_name"`
	ToAccountID     string  `json:"to_account_id"`
	ToAccountCode   string  `json:"to_account_code"`
	ToAccountName   string  `json:"to_account_name"`
	Status          string  `json:"status"`
	CreatedAt       ts      `json:"created_at"`
}

// CreateCashTransfer is createCashTransfer: debit the destination, credit
// the source.
func (s *Service) CreateCashTransfer(ctx context.Context, in CashMovementInput) (*CashTransfer, error) {
	amount := domain.Round2(in.Amount)
	if !(amount > 0) {
		return nil, httpx.BadRequest("Amount harus lebih dari 0")
	}
	if in.CashAccountID == in.OffsetAccountID {
		return nil, httpx.BadRequest("Akun asal dan tujuan tidak boleh sama")
	}
	from, err := s.assertCashBank(ctx, in.CompanyID, in.CashAccountID)
	if err != nil {
		return nil, err
	}
	to, err := s.assertCashBank(ctx, in.CompanyID, in.OffsetAccountID)
	if err != nil {
		return nil, err
	}
	description := trimOrNull(in.Description)
	if description == nil {
		description = strp("Transfer: " + from.Code + " " + from.Name + " → " + to.Code + " " + to.Name)
	}
	memo := memoOr(in.Memo, "Cash Transfer")
	module, event, kind := "CASH_BANK", "CASH_TRANSFER", "cash_transfer"
	ten, twenty := 10, 20
	entry, err := createEntry(ctx, s.db, NewEntry{
		UserID: in.UserID, CompanyID: &in.CompanyID, EntryDate: in.EntryDate, Description: description, Post: true,
		EntryType: domain.EntryManual, SourceModule: &module, SourceEventCode: &event, SourceDocumentType: &kind,
		Lines: []domain.Line{
			{AccountID: to.ID, Side: domain.Debit, Amount: amount, Memo: memo, SortOrder: &ten},
			{AccountID: from.ID, Side: domain.Credit, Amount: amount, Memo: memo, SortOrder: &twenty},
		},
	})
	if err != nil {
		return nil, err
	}
	return &CashTransfer{ID: entry.ID, EntryNo: entry.EntryNo, EntryDate: entry.EntryDate, Description: entry.Description, Amount: amount,
		FromAccountID: from.ID, FromAccountCode: domain.FormatAccountCodeDisplay(from.Code), FromAccountName: from.Name,
		ToAccountID: to.ID, ToAccountCode: domain.FormatAccountCodeDisplay(to.Code), ToAccountName: to.Name,
		Status: entry.Status, CreatedAt: entry.CreatedAt}, nil
}

// ListCashTransfers is listCashTransfers.
func (s *Service) ListCashTransfers(ctx context.Context, f CashListFilter) ([]CashTransfer, int, error) {
	where, args := pageClause([]string{"e.deleted_at IS NULL", "e.company_id = $1::uuid", "e.source_document_type = 'cash_transfer'"},
		[]any{f.CompanyID}, f)
	page, args := limitOffset(args, f.Limit, f.Offset)
	type row struct {
		CashTransfer
		Total int
	}
	rows, err := collect[row](ctx, s.db, `
SELECT e.id::text, e.entry_no, e.entry_date::text, e.description, debit_line.amount::float8,
       from_acc.id::text, from_acc.code, from_acc.name, to_acc.id::text, to_acc.code, to_acc.name,
       e.status, e.created_at, COUNT(*) OVER()::int
  FROM accounting.journal_entries e
  JOIN accounting.journal_entry_lines debit_line ON debit_line.entry_id = e.id AND debit_line.entry_side = 'DEBIT'
  JOIN accounting.chart_of_accounts to_acc ON to_acc.id = debit_line.account_id AND to_acc.is_cash_bank = true
  JOIN accounting.journal_entry_lines credit_line ON credit_line.entry_id = e.id AND credit_line.entry_side = 'CREDIT'
  JOIN accounting.chart_of_accounts from_acc ON from_acc.id = credit_line.account_id AND from_acc.is_cash_bank = true
 WHERE `+where+`
   AND debit_line.account_id <> credit_line.account_id
 ORDER BY e.entry_date DESC, e.entry_no DESC`+page, args...)
	if err != nil {
		return nil, 0, err
	}
	out := make([]CashTransfer, len(rows))
	total := 0
	for i, r := range rows {
		t := r.CashTransfer
		t.FromAccountCode = domain.FormatAccountCodeDisplay(t.FromAccountCode)
		t.ToAccountCode = domain.FormatAccountCodeDisplay(t.ToAccountCode)
		out[i] = t
		if i == 0 {
			total = r.Total
		}
	}
	return out, total, nil
}
