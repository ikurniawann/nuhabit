package accounting

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	pscope "nuhabit/backend/internal/platform/scope"
)

// Setup data: account types, the chart of accounts and journal mappings
// (account-type-store.ts, coa-store.ts, coa-postable.ts,
// journal-mapping-store.ts).

// errNoRows is the query builder's PGRST116 ("No rows found") from
// .single(): the TS routes let it through as a 500.
var errNoRows = errors.New("No rows found")

/* ── Account types ───────────────────────────────────────────────────── */

// AccountType is an accounting.account_types row.
type AccountType struct {
	ID            string `json:"id"`
	Code          string `json:"code"`
	Name          string `json:"name"`
	NormalBalance string `json:"normal_balance"`
	SortOrder     int    `json:"sort_order"`
	IsActive      bool   `json:"is_active"`
	CreatedAt     ts     `json:"created_at"`
	UpdatedAt     ts     `json:"updated_at"`
}

// AccountTypeInput is accountTypePayloadSchema after normalisation.
type AccountTypeInput struct {
	Code, Name, NormalBalance string
	SortOrder                 int
	IsActive                  bool
}

const accountTypeCols = `id::text, code, name, normal_balance, sort_order, is_active, created_at, updated_at`

const duplicateAccountType = "Kode account type sudah digunakan"

func uniqueAs400(err error, msg string) error {
	if database.IsUniqueViolation(err) {
		return httpx.BadRequest(msg)
	}
	return err
}

// ListAccountTypes is listAccountTypes.
func (s *Service) ListAccountTypes(ctx context.Context) ([]AccountType, error) {
	return collect[AccountType](ctx, s.db, `SELECT `+accountTypeCols+` FROM accounting.account_types ORDER BY sort_order ASC, name ASC`)
}

// CreateAccountType is createAccountType.
func (s *Service) CreateAccountType(ctx context.Context, userID string, in AccountTypeInput) (*AccountType, error) {
	row, err := one[AccountType](ctx, s.db, `
INSERT INTO accounting.account_types (code, name, normal_balance, sort_order, is_active, created_by, updated_by)
VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING `+accountTypeCols,
		strings.ToUpper(in.Code), in.Name, in.NormalBalance, in.SortOrder, in.IsActive, userID)
	return row, uniqueAs400(err, duplicateAccountType)
}

// UpdateAccountType is updateAccountType (a missing id is the shim's 500).
func (s *Service) UpdateAccountType(ctx context.Context, id, userID string, in AccountTypeInput) (*AccountType, error) {
	row, err := one[AccountType](ctx, s.db, `
UPDATE accounting.account_types
   SET code = $1, name = $2, normal_balance = $3, sort_order = $4, is_active = $5, updated_by = $6, updated_at = $7
 WHERE id = $8 RETURNING `+accountTypeCols,
		strings.ToUpper(in.Code), in.Name, in.NormalBalance, in.SortOrder, in.IsActive, userID, s.now(), id)
	if err != nil {
		return nil, uniqueAs400(err, duplicateAccountType)
	}
	if row == nil {
		return nil, errNoRows
	}
	return row, nil
}

// DeleteAccountType is deleteAccountType: refused while active COA use it.
// The count's own failure is ignored like the TS (`const { count }`).
func (s *Service) DeleteAccountType(ctx context.Context, id string) error {
	n, _, _ := scalar[int](ctx, s.db, `SELECT count(*)::int FROM accounting.chart_of_accounts WHERE account_type_id = $1 AND deleted_at IS NULL`, id)
	if n > 0 {
		return httpx.BadRequest("Tidak dapat dihapus — masih dipakai " + itoa(n) + " akun COA")
	}
	_, err := s.db.Exec(ctx, `DELETE FROM accounting.account_types WHERE id = $1`, id)
	return err
}

/* ── Chart of accounts ───────────────────────────────────────────────── */

// Account is the mapped COA row.
type Account struct {
	ID               string  `json:"id"`
	CompanyID        *string `json:"company_id"`
	Code             string  `json:"code"`
	CodeDisplay      string  `json:"code_display"`
	Name             string  `json:"name"`
	ParentID         *string `json:"parent_id"`
	AccountTypeID    string  `json:"account_type_id"`
	AccountTypeCode  *string `json:"account_type_code"`
	AccountTypeName  *string `json:"account_type_name"`
	NormalBalance    *string `json:"normal_balance"`
	Level            int     `json:"level"`
	IsPostable       bool    `json:"is_postable"`
	IsContra         bool    `json:"is_contra"`
	IsCashBank       bool    `json:"is_cash_bank"`
	CashFlowCategory *string `json:"cash_flow_category"`
	Description      *string `json:"description"`
	IsActive         bool    `json:"is_active"`
	CreatedAt        ts      `json:"created_at"`
	UpdatedAt        ts      `json:"updated_at"`
}

const accountSelect = `
SELECT coa.id::text, coa.company_id::text, coa.code, ''::text AS code_display, coa.name, coa.parent_id::text,
       coa.account_type_id::text, t.code, t.name, t.normal_balance, coa.level,
       coa.is_postable, coa.is_contra, coa.is_cash_bank, coa.cash_flow_category, coa.description, coa.is_active,
       coa.created_at, coa.updated_at
  FROM accounting.chart_of_accounts coa
  LEFT JOIN accounting.account_types t ON t.id = coa.account_type_id`

func withDisplay(rows []Account) []Account {
	for i := range rows {
		rows[i].CodeDisplay = domain.FormatAccountCodeDisplay(rows[i].Code)
	}
	return rows
}

// AccountFilters are the GET /chart-of-accounts query filters.
type AccountFilters struct {
	AccountTypeID    string
	Bools            [][2]string // column, "true"/"false" in BOOLEAN_FILTERS order
	CashFlowCategory string
	Search           string
}

// ListAccounts is listChartOfAccounts.
func (s *Service) ListAccounts(ctx context.Context, companyID string, f AccountFilters) ([]Account, error) {
	args := []any{companyID}
	where := []string{"coa.deleted_at IS NULL", "coa.company_id = $1"}
	if f.AccountTypeID != "" {
		args = append(args, f.AccountTypeID)
		where = append(where, "coa.account_type_id = $"+itoa(len(args)))
	}
	for _, b := range f.Bools {
		args = append(args, b[1] == "true")
		where = append(where, "coa."+b[0]+" = $"+itoa(len(args)))
	}
	if f.CashFlowCategory != "" {
		args = append(args, f.CashFlowCategory)
		where = append(where, "coa.cash_flow_category = $"+itoa(len(args)))
	}
	if f.Search != "" {
		where = append(where, postgrestOr("coa", "code.ilike.%"+f.Search+"%,name.ilike.%"+f.Search+"%", &args))
	}
	rows, err := collect[Account](ctx, s.db, accountSelect+` WHERE `+strings.Join(where, " AND ")+` ORDER BY coa.code ASC`, args...)
	return withDisplay(rows), err
}

func account(ctx context.Context, q database.Querier, id string) (*Account, error) {
	rows, err := collect[Account](ctx, q, accountSelect+` WHERE coa.id = $1`, id)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return &withDisplay(rows)[0], nil
}

// AccountInput is chartOfAccountPayloadSchema.
type AccountInput struct {
	Code             string
	Name             string
	ParentID         *string
	AccountTypeID    string
	IsContra         bool
	IsCashBank       bool
	CashFlowCategory *string
	Description      *string
	IsActive         bool
}

func resolveCode(raw string) (string, int, error) {
	code := domain.NormalizeAccountCode(raw)
	if code == "" {
		return "", 0, httpx.BadRequest("Format kode akun tidak valid")
	}
	level := domain.InferAccountLevel(code)
	if level == 0 {
		return "", 0, httpx.BadRequest("Level kode akun tidak dikenali")
	}
	return code, level, nil
}

// recomputePostable is recomputePostableChain: a leaf (no live children) is
// postable, its ancestors are not.
func recomputePostable(ctx context.Context, q database.Querier, id *string) error {
	visited := map[string]bool{}
	for id != nil && *id != "" && !visited[*id] {
		visited[*id] = true
		if _, err := q.Exec(ctx, `
UPDATE accounting.chart_of_accounts coa
   SET is_postable = NOT EXISTS (
         SELECT 1 FROM accounting.chart_of_accounts child
          WHERE child.parent_id = coa.id AND child.deleted_at IS NULL),
       updated_at = now()
 WHERE coa.id = $1`, *id); err != nil {
			return err
		}
		parent, _, err := scalar[*string](ctx, q, `SELECT parent_id::text FROM accounting.chart_of_accounts WHERE id = $1`, *id)
		if err != nil {
			return err
		}
		id = parent
	}
	return nil
}

type scopedAccount struct {
	ID        string
	CompanyID *string
	ParentID  *string
	Deleted   bool
	Level     int
}

func loadAccountRow(ctx context.Context, q database.Querier, id string) (*scopedAccount, error) {
	return one[scopedAccount](ctx, q, `SELECT id::text, company_id::text, parent_id::text, deleted_at IS NOT NULL, level FROM accounting.chart_of_accounts WHERE id = $1`, id)
}

func (s *Service) loadScopedAccount(ctx context.Context, id string, scope *pscope.Scope) (*scopedAccount, error) {
	row, err := loadAccountRow(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if row == nil || row.Deleted {
		return nil, httpx.NotFound("Akun tidak ditemukan")
	}
	if !pscope.RowInScope(scope, row.CompanyID, nil) {
		return nil, httpx.Forbidden("Akun di luar scope")
	}
	return row, nil
}

// CreateAccount is createChartOfAccount.
func (s *Service) CreateAccount(ctx context.Context, userID, companyID string, scope *pscope.Scope, in AccountInput) (*Account, error) {
	code, level, err := resolveCode(in.Code)
	if err != nil {
		return nil, err
	}
	if in.ParentID != nil {
		// maybeSingle(): a lookup failure reads as "not found".
		parent, _ := loadAccountRow(ctx, s.db, *in.ParentID)
		if parent == nil || parent.Deleted {
			return nil, httpx.BadRequest("Parent akun tidak ditemukan")
		}
		if !pscope.RowInScope(scope, parent.CompanyID, nil) {
			return nil, httpx.Forbidden("Parent di luar scope")
		}
		if parent.CompanyID == nil || *parent.CompanyID != companyID {
			return nil, httpx.BadRequest("Parent harus dalam company yang sama")
		}
	}
	var id string
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
INSERT INTO accounting.chart_of_accounts (
  name, parent_id, account_type_id, is_contra, is_cash_bank, cash_flow_category, description, is_active,
  company_id, code, level, is_postable, created_by, updated_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$12) RETURNING id::text`,
			in.Name, in.ParentID, in.AccountTypeID, in.IsContra, in.IsCashBank, in.CashFlowCategory, trimOrNull(in.Description), in.IsActive,
			companyID, code, level, userID).Scan(&id); err != nil {
			return uniqueAs400(err, "Kode akun sudah digunakan")
		}
		if err := recomputePostable(ctx, tx, in.ParentID); err != nil {
			return err
		}
		return recomputePostable(ctx, tx, &id)
	})
	if err != nil {
		return nil, err
	}
	return account(ctx, s.db, id)
}

// UpdateAccount is updateChartOfAccount.
func (s *Service) UpdateAccount(ctx context.Context, id, userID string, scope *pscope.Scope, in AccountInput) (*Account, error) {
	existing, err := s.loadScopedAccount(ctx, id, scope)
	if err != nil {
		return nil, err
	}
	code, level, err := resolveCode(in.Code)
	if err != nil {
		return nil, err
	}
	if in.ParentID != nil && *in.ParentID == id {
		return nil, httpx.BadRequest("Parent tidak boleh akun itu sendiri")
	}
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
UPDATE accounting.chart_of_accounts
   SET name = $1, parent_id = $2, account_type_id = $3, is_contra = $4, is_cash_bank = $5,
       cash_flow_category = $6, description = $7, is_active = $8, code = $9, level = $10,
       updated_by = $11, updated_at = $12
 WHERE id = $13`,
			in.Name, in.ParentID, in.AccountTypeID, in.IsContra, in.IsCashBank, in.CashFlowCategory, trimOrNull(in.Description), in.IsActive,
			code, level, userID, s.now(), id); err != nil {
			return uniqueAs400(err, "Kode akun sudah digunakan")
		}
		for _, chain := range []*string{existing.ParentID, in.ParentID, &id} {
			if err := recomputePostable(ctx, tx, chain); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return account(ctx, s.db, id)
}

// DeleteAccount is softDeleteChartOfAccount: refused while live children exist.
func (s *Service) DeleteAccount(ctx context.Context, id, userID string, scope *pscope.Scope) error {
	existing, err := s.loadScopedAccount(ctx, id, scope)
	if err != nil {
		return err
	}
	n, _, _ := scalar[int](ctx, s.db, `SELECT count(*)::int FROM accounting.chart_of_accounts WHERE parent_id = $1 AND deleted_at IS NULL`, id)
	if n > 0 {
		return httpx.BadRequest("Tidak dapat dihapus — masih ada " + itoa(n) + " akun anak")
	}
	now := s.now()
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
UPDATE accounting.chart_of_accounts
   SET deleted_at = $2, deleted_by = $3, is_active = false, updated_by = $3, updated_at = $2
 WHERE id = $1`, id, now, userID); err != nil {
			return err
		}
		return recomputePostable(ctx, tx, existing.ParentID)
	})
}

// postgrestOr is the query builder's .or("a.ilike.x,b.eq.y"): top-level
// comma split, "col.op.value" parts, "*" -> "%", OR-ed in parentheses.
func postgrestOr(alias, expr string, args *[]any) string {
	ops := map[string]string{"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<=", "like": "LIKE", "ilike": "ILIKE"}
	var parts []string
	for _, p := range splitTopLevel(expr) {
		seg := strings.Split(p, ".")
		col := `"` + strings.ReplaceAll(seg[0], `"`, `""`) + `"`
		op, val := "", ""
		if len(seg) > 1 {
			op = seg[1]
		}
		if len(seg) > 2 {
			val = strings.Join(seg[2:], ".")
		}
		if op == "is" {
			if val == "not.null" {
				parts = append(parts, alias+"."+col+" IS NOT NULL")
			} else {
				parts = append(parts, alias+"."+col+" IS NULL")
			}
			continue
		}
		sqlOp, ok := ops[op]
		if !ok {
			sqlOp = "="
		}
		*args = append(*args, strings.ReplaceAll(val, "*", "%"))
		parts = append(parts, alias+"."+col+" "+sqlOp+" $"+itoa(len(*args)))
	}
	return "(" + strings.Join(parts, " OR ") + ")"
}

// splitTopLevel splits on commas outside parentheses, trimming each part.
func splitTopLevel(s string) []string {
	var out []string
	depth := 0
	var cur strings.Builder
	for _, ch := range s {
		switch ch {
		case '(':
			depth++
		case ')':
			depth--
		}
		if ch == ',' && depth == 0 {
			out = append(out, jsTrim(cur.String()))
			cur.Reset()
			continue
		}
		cur.WriteRune(ch)
	}
	if t := jsTrim(cur.String()); t != "" {
		out = append(out, t)
	}
	return out
}

/* ── Journal mappings ────────────────────────────────────────────────── */

// MappingLineView is JournalMappingLineItem.
type MappingLineView struct {
	ID           string  `json:"id"`
	MappingID    string  `json:"mapping_id"`
	EntrySide    string  `json:"entry_side"`
	LineRole     string  `json:"line_role"`
	AccountID    *string `json:"account_id"`
	AccountCode  *string `json:"account_code"`
	AccountName  *string `json:"account_name"`
	AmountSource string  `json:"amount_source"`
	SortOrder    int     `json:"sort_order"`
	IsRequired   bool    `json:"is_required"`
}

// Mapping is JournalMappingItem.
type Mapping struct {
	ID          string            `json:"id"`
	CompanyID   *string           `json:"company_id"`
	EventCode   string            `json:"event_code"`
	Name        string            `json:"name"`
	Description *string           `json:"description"`
	Module      string            `json:"module"`
	IsActive    bool              `json:"is_active"`
	CreatedAt   ts                `json:"created_at"`
	UpdatedAt   ts                `json:"updated_at"`
	Lines       []MappingLineView `json:"lines"`
	LinesCount  int               `json:"lines_count"`
	MappedCount int               `json:"mapped_count"`
}

const mappingSelect = `SELECT m.id::text, m.company_id::text, m.event_code, m.name, m.description,
       m.module, m.is_active, m.created_at, m.updated_at
  FROM accounting.journal_mappings m`

type mappingRow struct {
	ID          string
	CompanyID   *string
	EventCode   string
	Name        string
	Description *string
	Module      string
	IsActive    bool
	CreatedAt   ts
	UpdatedAt   ts
}

func mappingsWithLines(ctx context.Context, q database.Querier, rows []mappingRow) ([]Mapping, error) {
	out := make([]Mapping, len(rows))
	if len(rows) == 0 {
		return out, nil
	}
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	lines, err := collect[MappingLineView](ctx, q, `
SELECT l.id::text, l.mapping_id::text, l.entry_side, l.line_role, l.account_id::text,
       coa.code, coa.name, l.amount_source, l.sort_order, l.is_required
  FROM accounting.journal_mapping_lines l
  LEFT JOIN accounting.chart_of_accounts coa ON coa.id = l.account_id AND coa.deleted_at IS NULL
 WHERE l.mapping_id = ANY($1::uuid[])
 ORDER BY l.sort_order ASC, l.entry_side ASC`, ids)
	if err != nil {
		return nil, err
	}
	byID := map[string][]MappingLineView{}
	for _, l := range lines {
		if l.AccountCode != nil && *l.AccountCode != "" {
			c := domain.FormatAccountCodeDisplay(*l.AccountCode)
			l.AccountCode = &c
		} else {
			l.AccountCode = nil
		}
		byID[l.MappingID] = append(byID[l.MappingID], l)
	}
	for i, r := range rows {
		ls := byID[r.ID]
		if ls == nil {
			ls = []MappingLineView{}
		}
		mapped := 0
		for _, l := range ls {
			if l.AccountID != nil && *l.AccountID != "" {
				mapped++
			}
		}
		out[i] = Mapping{ID: r.ID, CompanyID: r.CompanyID, EventCode: r.EventCode, Name: r.Name, Description: r.Description,
			Module: r.Module, IsActive: r.IsActive, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
			Lines: ls, LinesCount: len(ls), MappedCount: mapped}
	}
	return out, nil
}

// ListMappings is listJournalMappings for one company.
func (s *Service) ListMappings(ctx context.Context, companyID, search, module, isActive string) ([]Mapping, error) {
	where := []string{"m.deleted_at IS NULL"}
	args := []any{}
	if module != "" {
		args = append(args, module)
		where = append(where, "m.module = $"+itoa(len(args)))
	}
	switch isActive {
	case "true":
		where = append(where, "m.is_active = true")
	case "false":
		where = append(where, "m.is_active = false")
	}
	if search != "" {
		args = append(args, "%"+search+"%")
		n := itoa(len(args))
		where = append(where, "(m.event_code ILIKE $"+n+" OR m.name ILIKE $"+n+")")
	}
	args = append(args, companyID)
	where = append(where, "m.company_id = $"+itoa(len(args)))
	rows, err := collect[mappingRow](ctx, s.db, mappingSelect+` WHERE `+strings.Join(where, " AND ")+` ORDER BY m.module ASC, m.event_code ASC`, args...)
	if err != nil {
		return nil, err
	}
	return mappingsWithLines(ctx, s.db, rows)
}

// Mapping is getJournalMapping: nil when missing or deleted.
func (s *Service) Mapping(ctx context.Context, id string) (*Mapping, error) {
	rows, err := collect[mappingRow](ctx, s.db, mappingSelect+` WHERE m.id = $1 AND m.deleted_at IS NULL`, id)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	out, err := mappingsWithLines(ctx, s.db, rows)
	if err != nil {
		return nil, err
	}
	return &out[0], nil
}

// MappingLineInput is one journalMappingPayloadSchema line.
type MappingLineInput struct {
	EntrySide    string
	LineRole     string
	AccountID    *string
	AmountSource string
	SortOrder    *int
	IsRequired   *bool
}

// MappingInput is a normalised journal mapping payload.
type MappingInput struct {
	EventCode   string
	Name        string
	Description *string
	Module      string
	IsActive    bool
	Lines       []MappingLineInput
}

func mappingAccountIDs(lines []MappingLineInput) []string {
	ids := []string{}
	for _, l := range lines {
		if l.AccountID != nil && *l.AccountID != "" {
			ids = append(ids, *l.AccountID)
		}
	}
	return ids
}

func replaceMappingLines(ctx context.Context, q database.Querier, mappingID string, lines []MappingLineInput) error {
	if _, err := q.Exec(ctx, `DELETE FROM accounting.journal_mapping_lines WHERE mapping_id = $1`, mappingID); err != nil {
		return err
	}
	for i, l := range lines {
		sort := (i + 1) * 10
		if l.SortOrder != nil {
			sort = *l.SortOrder
		}
		required := true
		if l.IsRequired != nil {
			required = *l.IsRequired
		}
		if _, err := q.Exec(ctx, `
INSERT INTO accounting.journal_mapping_lines (mapping_id, entry_side, line_role, account_id, amount_source, sort_order, is_required)
VALUES ($1,$2,$3,$4,$5,$6,$7)`, mappingID, l.EntrySide, l.LineRole, strOrNull(l.AccountID), l.AmountSource, sort, required); err != nil {
			return err
		}
	}
	return nil
}

const mappingHeaderMsg = "Akun mapping harus postable (bukan header)"

// CreateMapping is createJournalMappingRecord.
func (s *Service) CreateMapping(ctx context.Context, userID, companyID string, in MappingInput) (*Mapping, error) {
	var id string
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := checkAccounts(ctx, tx, mappingAccountIDs(in.Lines), &companyID, "", mappingHeaderMsg); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
INSERT INTO accounting.journal_mappings (company_id, event_code, name, description, module, is_active, created_by, updated_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id::text`,
			companyID, in.EventCode, in.Name, in.Description, in.Module, in.IsActive, userID).Scan(&id); err != nil {
			return err
		}
		return replaceMappingLines(ctx, tx, id, in.Lines)
	})
	if err != nil {
		return nil, err
	}
	return s.reloadMapping(ctx, id, "Gagal memuat mapping setelah create")
}

func (s *Service) reloadMapping(ctx context.Context, id, failMsg string) (*Mapping, error) {
	m, err := s.Mapping(ctx, id)
	if err == nil && m == nil {
		err = errors.New(failMsg)
	}
	return m, err
}

// UpdateMapping is updateJournalMappingRecord; accounts must belong to the
// mapping's own company.
func (s *Service) UpdateMapping(ctx context.Context, id, userID string, existingCompanyID *string, in MappingInput) (*Mapping, error) {
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := checkAccounts(ctx, tx, mappingAccountIDs(in.Lines), existingCompanyID, "", mappingHeaderMsg); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
UPDATE accounting.journal_mappings
   SET event_code = $1, name = $2, description = $3, module = $4, is_active = $5, updated_by = $6, updated_at = now()
 WHERE id = $7 AND deleted_at IS NULL`, in.EventCode, in.Name, in.Description, in.Module, in.IsActive, userID, id); err != nil {
			return err
		}
		return replaceMappingLines(ctx, tx, id, in.Lines)
	})
	if err != nil {
		return nil, err
	}
	return s.reloadMapping(ctx, id, "Gagal memuat mapping setelah update")
}

// DeleteMapping is softDeleteJournalMapping.
func (s *Service) DeleteMapping(ctx context.Context, id, userID string) error {
	_, err := s.db.Exec(ctx, `
UPDATE accounting.journal_mappings
   SET deleted_at = now(), deleted_by = $2, is_active = false, updated_by = $2, updated_at = now()
 WHERE id = $1 AND deleted_at IS NULL`, id, userID)
	return err
}
