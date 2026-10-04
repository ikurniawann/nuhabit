package accounting

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Journal entries: the double-entry core every other use case posts through
// (journal-entry-store.ts, fiscal.ts resolveOpenFiscalPeriod).

// JournalLine is JournalEntryLineItem.
type JournalLine struct {
	ID          string  `json:"id"`
	EntryID     string  `json:"entry_id"`
	AccountID   string  `json:"account_id"`
	AccountCode *string `json:"account_code"`
	AccountName *string `json:"account_name"`
	EntrySide   string  `json:"entry_side"`
	Amount      float64 `json:"amount"`
	Memo        *string `json:"memo"`
	SortOrder   int     `json:"sort_order"`
}

// JournalEntry is JournalEntryItem.
type JournalEntry struct {
	ID                 string        `json:"id"`
	CompanyID          *string       `json:"company_id"`
	EntryNo            string        `json:"entry_no"`
	EntryDate          string        `json:"entry_date"`
	Description        *string       `json:"description"`
	FiscalPeriodID     string        `json:"fiscal_period_id"`
	FiscalPeriodName   *string       `json:"fiscal_period_name"`
	FiscalYearCode     *string       `json:"fiscal_year_code"`
	EntryType          string        `json:"entry_type"`
	Status             string        `json:"status"`
	IsRecon            bool          `json:"is_recon"`
	PostedAt           *ts           `json:"posted_at"`
	PostedBy           *string       `json:"posted_by"`
	CreatedAt          ts            `json:"created_at"`
	UpdatedAt          ts            `json:"updated_at"`
	SourceModule       *string       `json:"source_module"`
	SourceEventCode    *string       `json:"source_event_code"`
	SourceDocumentType *string       `json:"source_document_type"`
	SourceDocumentID   *string       `json:"source_document_id"`
	Lines              []JournalLine `json:"lines"`
	TotalDebit         float64       `json:"total_debit"`
	TotalCredit        float64       `json:"total_credit"`
	CanEdit            bool          `json:"can_edit"`
}

type entryRow struct {
	ID                 string
	CompanyID          *string
	EntryNo            string
	EntryDate          string
	Description        *string
	FiscalPeriodID     string
	FiscalPeriodName   *string
	FiscalYearCode     *string
	EntryType          string
	Status             string
	IsRecon            bool
	PostedAt           *ts
	PostedBy           *string
	CreatedAt          ts
	UpdatedAt          ts
	SourceModule       *string
	SourceEventCode    *string
	SourceDocumentType *string
	SourceDocumentID   *string
}

const entrySelect = `
  e.id::text, e.company_id::text, e.entry_no,
  e.entry_date::text AS entry_date,
  e.description, e.fiscal_period_id::text,
  p.name AS fiscal_period_name,
  y.code AS fiscal_year_code,
  COALESCE(e.entry_type, 'MANUAL') AS entry_type,
  e.status, e.is_recon, e.posted_at, e.posted_by::text,
  e.created_at, e.updated_at,
  e.source_module, e.source_event_code,
  e.source_document_type, e.source_document_id::text`

const entryFrom = `
     FROM accounting.journal_entries e
     JOIN accounting.fiscal_periods p ON p.id = e.fiscal_period_id
     JOIN accounting.fiscal_years y ON y.id = p.fiscal_year_id`

type lineRow struct {
	ID          string
	EntryID     string
	AccountID   string
	EntrySide   string
	Amount      string
	Memo        *string
	SortOrder   int
	AccountCode *string
	AccountName *string
}

func fetchEntryLines(ctx context.Context, q database.Querier, ids []string) (map[string][]JournalLine, error) {
	out := map[string][]JournalLine{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := collect[lineRow](ctx, q, `
SELECT l.id::text, l.entry_id::text, l.account_id::text, l.entry_side,
       l.amount::text AS amount, l.memo, l.sort_order,
       coa.code AS account_code, coa.name AS account_name
  FROM accounting.journal_entry_lines l
  LEFT JOIN accounting.chart_of_accounts coa
    ON coa.id = l.account_id AND coa.deleted_at IS NULL
 WHERE l.entry_id = ANY($1::uuid[])
 ORDER BY l.sort_order ASC, l.entry_side ASC`, ids)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		var code *string
		if r.AccountCode != nil && *r.AccountCode != "" {
			c := domain.FormatAccountCodeDisplay(*r.AccountCode)
			code = &c
		}
		out[r.EntryID] = append(out[r.EntryID], JournalLine{
			ID: r.ID, EntryID: r.EntryID, AccountID: r.AccountID, AccountCode: code, AccountName: r.AccountName,
			EntrySide: r.EntrySide, Amount: domain.ToNumber(r.Amount), Memo: r.Memo, SortOrder: r.SortOrder,
		})
	}
	return out, nil
}

func mapEntry(r entryRow, lines []JournalLine) JournalEntry {
	if lines == nil {
		lines = []JournalLine{}
	}
	sides := make([]string, len(lines))
	amounts := make([]float64, len(lines))
	for i, l := range lines {
		sides[i], amounts[i] = l.EntrySide, l.Amount
	}
	debit, credit := domain.Totals(sides, amounts)
	entryType := domain.NormalizeEntryType(r.EntryType)
	return JournalEntry{
		ID: r.ID, CompanyID: r.CompanyID, EntryNo: r.EntryNo, EntryDate: r.EntryDate, Description: r.Description,
		FiscalPeriodID: r.FiscalPeriodID, FiscalPeriodName: r.FiscalPeriodName, FiscalYearCode: r.FiscalYearCode,
		EntryType: entryType, Status: r.Status, IsRecon: r.IsRecon, PostedAt: r.PostedAt, PostedBy: r.PostedBy,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
		SourceModule: r.SourceModule, SourceEventCode: r.SourceEventCode,
		SourceDocumentType: r.SourceDocumentType, SourceDocumentID: r.SourceDocumentID,
		Lines: lines, TotalDebit: debit, TotalCredit: credit,
		CanEdit: domain.CanEdit(r.Status, r.IsRecon, entryType),
	}
}

func entriesWithLines(ctx context.Context, q database.Querier, rows []entryRow) ([]JournalEntry, error) {
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	lines, err := fetchEntryLines(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	out := make([]JournalEntry, len(rows))
	for i, r := range rows {
		out[i] = mapEntry(r, lines[r.ID])
	}
	return out, nil
}

// JournalFilters are the GET /journal-entries query filters.
type JournalFilters struct {
	Search, Status, DateFrom, DateTo, EntryType, AccountID string
	CompanyID                                              string
}

// ListJournalEntries is listJournalEntries for one company.
func (s *Service) ListJournalEntries(ctx context.Context, f JournalFilters) ([]JournalEntry, error) {
	where := []string{"e.deleted_at IS NULL"}
	args := []any{}
	add := func(clause string, v any) {
		args = append(args, v)
		where = append(where, strings.ReplaceAll(clause, "?", "$"+itoa(len(args))))
	}
	if f.Status != "" {
		add("e.status = ?", f.Status)
	}
	if f.EntryType != "" {
		add("e.entry_type = ?", f.EntryType)
	}
	if f.DateFrom != "" {
		add("e.entry_date >= ?::date", f.DateFrom)
	}
	if f.DateTo != "" {
		add("e.entry_date <= ?::date", f.DateTo)
	}
	if f.Search != "" {
		add("(e.entry_no ILIKE ? OR e.description ILIKE ?)", "%"+f.Search+"%")
	}
	if f.AccountID != "" {
		add(`EXISTS (SELECT 1 FROM accounting.journal_entry_lines l WHERE l.entry_id = e.id AND l.account_id = ?::uuid)`, f.AccountID)
	}
	add("e.company_id = ?", f.CompanyID)
	rows, err := collect[entryRow](ctx, s.db, `SELECT `+entrySelect+entryFrom+`
     WHERE `+strings.Join(where, " AND ")+`
     ORDER BY e.entry_date DESC, e.entry_no DESC`, args...)
	if err != nil {
		return nil, err
	}
	return entriesWithLines(ctx, s.db, rows)
}

// journalEntry is getJournalEntry: nil when missing or deleted.
func journalEntry(ctx context.Context, q database.Querier, id string) (*JournalEntry, error) {
	row, err := one[entryRow](ctx, q, `SELECT `+entrySelect+entryFrom+`
     WHERE e.id = $1 AND e.deleted_at IS NULL`, id)
	if err != nil || row == nil {
		return nil, err
	}
	entries, err := entriesWithLines(ctx, q, []entryRow{*row})
	if err != nil {
		return nil, err
	}
	return &entries[0], nil
}

// JournalEntry returns one entry, nil when missing or deleted.
func (s *Service) JournalEntry(ctx context.Context, id string) (*JournalEntry, error) {
	return journalEntry(ctx, s.db, id)
}

// findEntryBySource is findJournalEntryBySource: the live entry a source
// document already posted for an event, nil when none.
func findEntryBySource(ctx context.Context, q database.Querier, companyID *string, eventCode, documentID string) (*JournalEntry, error) {
	row, err := one[entryRow](ctx, q, `SELECT `+entrySelect+entryFrom+`
     WHERE e.deleted_at IS NULL
       AND e.source_event_code = $1
       AND e.source_document_id = $2::uuid
       AND (($3::uuid IS NULL AND e.company_id IS NULL) OR ($3::uuid IS NOT NULL AND e.company_id = $3::uuid))
     LIMIT 1`, eventCode, documentID, companyID)
	if err != nil || row == nil {
		return nil, err
	}
	entries, err := entriesWithLines(ctx, q, []entryRow{*row})
	if err != nil {
		return nil, err
	}
	return &entries[0], nil
}

/* ── Fiscal period resolution ────────────────────────────────────────── */

// FiscalPeriod is ResolvedFiscalPeriod.
type FiscalPeriod struct {
	ID                 string `json:"id"`
	FiscalYearID       string `json:"fiscal_year_id"`
	PeriodNo           int    `json:"period_no"`
	Name               string `json:"name"`
	StartDate          string `json:"start_date"`
	EndDate            string `json:"end_date"`
	Status             string `json:"status"`
	FiscalYearCode     string `json:"fiscal_year_code"`
	FiscalYearName     string `json:"fiscal_year_name"`
	FiscalYearIsActive bool   `json:"fiscal_year_is_active"`
}

const periodSelect = `
  p.id::text, p.fiscal_year_id::text, p.period_no, p.name,
  p.start_date::text AS start_date,
  p.end_date::text AS end_date,
  p.status,
  y.code AS fiscal_year_code,
  y.name AS fiscal_year_name,
  y.is_active AS fiscal_year_is_active`

// companyMatch compares a company column with a nullable uuid parameter.
func companyMatch(col, param string) string {
	return `((` + param + `::uuid IS NULL AND ` + col + ` IS NULL) OR (` + param + `::uuid IS NOT NULL AND ` + col + ` = ` + param + `::uuid))`
}

// openPeriod is resolveOpenFiscalPeriod: the OPEN period of an active year
// covering the date, nil when none.
func openPeriod(ctx context.Context, q database.Querier, date string, companyID *string) (*FiscalPeriod, error) {
	return one[FiscalPeriod](ctx, q, `SELECT `+periodSelect+`
    FROM accounting.fiscal_periods p
    JOIN accounting.fiscal_years y ON y.id = p.fiscal_year_id AND y.deleted_at IS NULL
   WHERE y.is_active = true
     AND p.status = 'OPEN'
     AND p.start_date <= $1::date
     AND p.end_date >= $1::date
     AND `+companyMatch("y.company_id", "$2")+`
   ORDER BY p.period_no ASC
   LIMIT 1`, date, companyID)
}

func assertOpenPeriod(ctx context.Context, q database.Querier, date string, companyID *string) (*FiscalPeriod, error) {
	p, err := openPeriod(ctx, q, date, companyID)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, httpx.BadRequest("Tidak ada fiscal period OPEN untuk tanggal jurnal. Konfigurasi Fiscal Years terlebih dahulu.")
	}
	return p, nil
}

/* ── Writes ──────────────────────────────────────────────────────────── */

// checkAccounts is assertPostableAccounts over the distinct non-empty ids.
// emptyMsg is returned when no id is left ("" = allowed, for mappings).
func checkAccounts(ctx context.Context, q database.Querier, ids []string, companyID *string, emptyMsg, headerMsg string) error {
	unique := domain.UniqueIDs(ids)
	if len(unique) == 0 {
		if emptyMsg == "" {
			return nil
		}
		return httpx.BadRequest(emptyMsg)
	}
	rows, err := collect[domain.AccountCheck](ctx, q, `
SELECT id::text, is_postable, company_id::text, deleted_at IS NOT NULL
  FROM accounting.chart_of_accounts
 WHERE id = ANY($1::uuid[])`, unique)
	if err != nil {
		return err
	}
	return rejection(domain.CheckPostableAccounts(len(unique), rows, companyID, headerMsg))
}

func replaceEntryLines(ctx context.Context, q database.Querier, entryID string, lines []domain.Line) error {
	if _, err := q.Exec(ctx, `DELETE FROM accounting.journal_entry_lines WHERE entry_id = $1`, entryID); err != nil {
		return err
	}
	for i, l := range lines {
		sort := (i + 1) * 10
		if l.SortOrder != nil {
			sort = *l.SortOrder
		}
		if _, err := q.Exec(ctx, `
INSERT INTO accounting.journal_entry_lines (entry_id, account_id, entry_side, amount, memo, sort_order)
VALUES ($1,$2,$3,$4,$5,$6)`, entryID, l.AccountID, l.Side, domain.Round2(l.Amount), trimOrNull(l.Memo), sort); err != nil {
			return err
		}
	}
	return nil
}

// nextNo locks the latest document number with the prefix and returns the
// next one ("JE-202610-0001", "OB-2026-0001").
func nextNo(ctx context.Context, q database.Querier, prefix string, companyID *string) (string, error) {
	last, _, err := scalar[string](ctx, q, `
SELECT entry_no
  FROM accounting.journal_entries
 WHERE deleted_at IS NULL
   AND entry_no LIKE $1
   AND `+companyMatch("company_id", "$2")+`
 ORDER BY entry_no DESC
 LIMIT 1
 FOR UPDATE`, prefix+"%", companyID)
	if err != nil {
		return "", err
	}
	return domain.NextSequenceNo(prefix, last), nil
}

func entryNoPrefix(entryDate string) string {
	ym := entryDate
	if len(ym) > 7 {
		ym = ym[:7]
	}
	return "JE-" + strings.Replace(ym, "-", "", 1) + "-"
}

// NewEntry is createJournalEntryRecord's input.
type NewEntry struct {
	UserID             string
	CompanyID          *string
	EntryDate          string
	Description        *string
	IsRecon            bool
	Lines              []domain.Line
	Post               bool
	EntryType          string // MANUAL (default) or AUTO
	SourceModule       *string
	SourceEventCode    *string
	SourceDocumentType *string
	SourceDocumentID   *string
}

// createEntry is createJournalEntryRecord: validate, then in one
// transaction resolve the OPEN period, check the accounts, number and insert
// the entry with its lines. It returns the stored entry.
func createEntry(ctx context.Context, db database.DB, in NewEntry) (*JournalEntry, error) {
	if err := domain.ValidateBalanced(in.Lines); err != nil {
		return nil, rejection(err)
	}
	entryType := in.EntryType
	if entryType == "" {
		entryType = domain.EntryManual
	}
	var id string
	err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
		period, err := assertOpenPeriod(ctx, tx, in.EntryDate, in.CompanyID)
		if err != nil {
			return err
		}
		ids := make([]string, len(in.Lines))
		for i, l := range in.Lines {
			ids[i] = l.AccountID
		}
		if err := checkAccounts(ctx, tx, ids, in.CompanyID, "Akun COA wajib diisi", "Akun jurnal harus postable (bukan header)"); err != nil {
			return err
		}
		entryNo, err := nextNo(ctx, tx, entryNoPrefix(in.EntryDate), in.CompanyID)
		if err != nil {
			return err
		}
		status := domain.StatusDraft
		if in.Post {
			status = domain.StatusPosted
		}
		if err := tx.QueryRow(ctx, `
INSERT INTO accounting.journal_entries (
  company_id, entry_no, entry_date, description,
  fiscal_period_id, status, is_recon, entry_type,
  source_module, source_event_code,
  source_document_type, source_document_id,
  posted_at, posted_by, created_by, updated_by
) VALUES (
  $1,$2,$3::date,$4,$5,$6::varchar,$7,$8::varchar,
  $9,$10,$11,$12::uuid,
  CASE WHEN $6::text = 'POSTED' THEN now() ELSE NULL END,
  CASE WHEN $6::text = 'POSTED' THEN $13::uuid ELSE NULL END,
  $13::uuid,$13::uuid
) RETURNING id::text`,
			in.CompanyID, entryNo, in.EntryDate, in.Description, period.ID, status, in.IsRecon, entryType,
			in.SourceModule, in.SourceEventCode, in.SourceDocumentType, in.SourceDocumentID, strOrNull(&in.UserID)).Scan(&id); err != nil {
			return err
		}
		return replaceEntryLines(ctx, tx, id, in.Lines)
	})
	if err != nil {
		return nil, err
	}
	entry, err := journalEntry(ctx, db, id)
	if err == nil && entry == nil {
		err = errors.New("Gagal memuat journal entry setelah create")
	}
	return entry, err
}

// EntryUpdate is updateJournalEntryRecord's input.
type EntryUpdate struct {
	ID, UserID  string
	CompanyID   *string
	EntryDate   string
	Description *string
	Lines       []domain.Line
	Post        bool
}

// UpdateJournalEntry is updateJournalEntryRecord.
func (s *Service) UpdateJournalEntry(ctx context.Context, in EntryUpdate) (*JournalEntry, error) {
	existing, err := journalEntry(ctx, s.db, in.ID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, httpx.NotFound("Journal entry tidak ditemukan")
	}
	if err := domain.AssertMutable(existing.EntryType, existing.Status, existing.IsRecon); err != nil {
		return nil, rejection(err)
	}
	if err := domain.ValidateBalanced(in.Lines); err != nil {
		return nil, rejection(err)
	}
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		period, err := assertOpenPeriod(ctx, tx, in.EntryDate, in.CompanyID)
		if err != nil {
			return err
		}
		ids := make([]string, len(in.Lines))
		for i, l := range in.Lines {
			ids[i] = l.AccountID
		}
		if err := checkAccounts(ctx, tx, ids, in.CompanyID, "Akun COA wajib diisi", "Akun jurnal harus postable (bukan header)"); err != nil {
			return err
		}
		status := domain.StatusDraft
		if in.Post {
			status = domain.StatusPosted
		}
		if _, err := tx.Exec(ctx, `
UPDATE accounting.journal_entries
   SET entry_date = $1::date,
       description = $2,
       fiscal_period_id = $3,
       status = $4::varchar,
       posted_at = CASE WHEN $4::text = 'POSTED' THEN COALESCE(posted_at, now()) ELSE NULL END,
       posted_by = CASE WHEN $4::text = 'POSTED' THEN COALESCE(posted_by, $5::uuid) ELSE NULL END,
       updated_by = $5::uuid,
       updated_at = now()
 WHERE id = $6::uuid AND deleted_at IS NULL`, in.EntryDate, in.Description, period.ID, status, in.UserID, in.ID); err != nil {
			return err
		}
		return replaceEntryLines(ctx, tx, in.ID, in.Lines)
	})
	if err != nil {
		return nil, err
	}
	return s.reload(ctx, in.ID, "Gagal memuat journal entry setelah update")
}

func (s *Service) reload(ctx context.Context, id, failMsg string) (*JournalEntry, error) {
	entry, err := journalEntry(ctx, s.db, id)
	if err == nil && entry == nil {
		err = errors.New(failMsg)
	}
	return entry, err
}

// PostJournalEntry is postJournalEntry: DRAFT -> POSTED inside an OPEN period.
func (s *Service) PostJournalEntry(ctx context.Context, id, userID string) (*JournalEntry, error) {
	existing, err := journalEntry(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, httpx.NotFound("Journal entry tidak ditemukan")
	}
	if err := domain.AssertPostable(existing.Status, len(existing.Lines), existing.TotalDebit, existing.TotalCredit); err != nil {
		return nil, rejection(err)
	}
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := assertOpenPeriod(ctx, tx, existing.EntryDate, existing.CompanyID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
UPDATE accounting.journal_entries
   SET status = 'POSTED', posted_at = now(), posted_by = $2, updated_by = $2, updated_at = now()
 WHERE id = $1 AND deleted_at IS NULL AND status = 'DRAFT'`, id, userID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.reload(ctx, id, "Gagal memuat journal entry setelah post")
}

func softDeleteEntry(ctx context.Context, q database.Querier, id, userID string) error {
	_, err := q.Exec(ctx, `
UPDATE accounting.journal_entries
   SET deleted_at = now(), deleted_by = $2, updated_by = $2, updated_at = now()
 WHERE id = $1 AND deleted_at IS NULL`, id, userID)
	return err
}

// DeleteJournalEntry is softDeleteJournalEntry.
func (s *Service) DeleteJournalEntry(ctx context.Context, id, userID string) error {
	existing, err := journalEntry(ctx, s.db, id)
	if err != nil {
		return err
	}
	if existing == nil {
		return httpx.NotFound("Journal entry tidak ditemukan")
	}
	if err := domain.AssertMutable(existing.EntryType, existing.Status, existing.IsRecon); err != nil {
		return rejection(err)
	}
	return softDeleteEntry(ctx, s.db, id, userID)
}

// CreateJournalEntry posts a manual entry for the HTTP route.
func (s *Service) CreateJournalEntry(ctx context.Context, in NewEntry) (*JournalEntry, error) {
	return createEntry(ctx, s.db, in)
}

/* ── Errors ──────────────────────────────────────────────────────────── */

// errMessage is error.message as the TS caught it: the ApiError message or
// the PostgreSQL message (node-pg puts only the server message there).
func errMessage(err error) string {
	var he *httpx.Error
	if errors.As(err, &he) {
		return he.Message
	}
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		return pe.Message
	}
	var re *domain.Rejection
	if errors.As(err, &re) {
		return re.Message
	}
	return err.Error()
}

var uniqueRace = regexp.MustCompile(`(?i)duplicate key|unique constraint`)

// PostError is AccountingPostError: a ready mapping failed to post. Routes
// that surface it answer 500 with its message.
type PostError struct{ Message string }

func (e *PostError) Error() string { return e.Message }

// postErrorAs500 is rethrowAccountingPostError.
func postErrorAs500(err error) error {
	var pe *PostError
	if errors.As(err, &pe) {
		return httpx.Status(500, pe.Message)
	}
	return err
}

func itoa(n int) string { return domain.FormatNumber(float64(n)) }
