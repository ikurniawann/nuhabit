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

// Fiscal years, periods, coverage and period closing (fiscal-year-store.ts,
// fiscal.ts).

// PeriodItem is FiscalPeriodItem.
type PeriodItem struct {
	ID           string `json:"id"`
	FiscalYearID string `json:"fiscal_year_id"`
	PeriodNo     int    `json:"period_no"`
	Name         string `json:"name"`
	StartDate    string `json:"start_date"`
	EndDate      string `json:"end_date"`
	Status       string `json:"status"`
}

// FiscalYear is FiscalYearItem.
type FiscalYear struct {
	ID               string       `json:"id"`
	CompanyID        *string      `json:"company_id"`
	Code             string       `json:"code"`
	Name             string       `json:"name"`
	StartDate        string       `json:"start_date"`
	EndDate          string       `json:"end_date"`
	IsActive         bool         `json:"is_active"`
	CreatedAt        ts           `json:"created_at"`
	UpdatedAt        ts           `json:"updated_at"`
	Periods          []PeriodItem `json:"periods"`
	OpenPeriodsCount int          `json:"open_periods_count"`
}

type yearRow struct {
	ID        string
	CompanyID *string
	Code      string
	Name      string
	StartDate string
	EndDate   string
	IsActive  bool
	CreatedAt ts
	UpdatedAt ts
}

const yearSelect = `SELECT y.id::text, y.company_id::text, y.code, y.name,
       y.start_date::text AS start_date, y.end_date::text AS end_date,
       y.is_active, y.created_at, y.updated_at
  FROM accounting.fiscal_years y`

func yearsWithPeriods(ctx context.Context, q database.Querier, rows []yearRow) ([]FiscalYear, error) {
	out := make([]FiscalYear, len(rows))
	if len(rows) == 0 {
		return out, nil
	}
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	periods, err := collect[PeriodItem](ctx, q, `
SELECT id::text, fiscal_year_id::text, period_no, name, start_date::text, end_date::text, status
  FROM accounting.fiscal_periods
 WHERE fiscal_year_id = ANY($1::uuid[])
 ORDER BY period_no ASC`, ids)
	if err != nil {
		return nil, err
	}
	byYear := map[string][]PeriodItem{}
	for _, p := range periods {
		byYear[p.FiscalYearID] = append(byYear[p.FiscalYearID], p)
	}
	for i, r := range rows {
		ps := byYear[r.ID]
		if ps == nil {
			ps = []PeriodItem{}
		}
		open := 0
		for _, p := range ps {
			if p.Status == domain.PeriodOpen {
				open++
			}
		}
		out[i] = FiscalYear{ID: r.ID, CompanyID: r.CompanyID, Code: r.Code, Name: r.Name, StartDate: r.StartDate,
			EndDate: r.EndDate, IsActive: r.IsActive, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
			Periods: ps, OpenPeriodsCount: open}
	}
	return out, nil
}

// ListFiscalYears is listFiscalYears for one company.
func (s *Service) ListFiscalYears(ctx context.Context, companyID, search, isActive string) ([]FiscalYear, error) {
	where := []string{"y.deleted_at IS NULL"}
	args := []any{}
	switch isActive {
	case "true":
		where = append(where, "y.is_active = true")
	case "false":
		where = append(where, "y.is_active = false")
	}
	if search != "" {
		args = append(args, "%"+search+"%")
		n := itoa(len(args))
		where = append(where, "(y.code ILIKE $"+n+" OR y.name ILIKE $"+n+")")
	}
	args = append(args, companyID)
	where = append(where, "y.company_id = $"+itoa(len(args)))
	rows, err := collect[yearRow](ctx, s.db, yearSelect+` WHERE `+strings.Join(where, " AND ")+` ORDER BY y.start_date DESC, y.code ASC`, args...)
	if err != nil {
		return nil, err
	}
	return yearsWithPeriods(ctx, s.db, rows)
}

// FiscalYear is getFiscalYear: nil when missing or deleted.
func (s *Service) FiscalYear(ctx context.Context, id string) (*FiscalYear, error) {
	rows, err := collect[yearRow](ctx, s.db, yearSelect+` WHERE y.id = $1 AND y.deleted_at IS NULL`, id)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	out, err := yearsWithPeriods(ctx, s.db, rows)
	if err != nil {
		return nil, err
	}
	return &out[0], nil
}

// FiscalYearInput is a normalised fiscal year payload.
type FiscalYearInput struct {
	Code, Name, StartDate, EndDate string
	IsActive                       bool
	Periods                        []domain.PeriodInput
}

type openYear struct {
	Code, Name, OpenCount string
}

// assertPreviousYearsClosed: a year with an OPEN period needs every earlier
// year of the company fully CLOSED.
func assertPreviousYearsClosed(ctx context.Context, q database.Querier, companyID *string, startDate string, excludeID *string, hasOpen bool) error {
	if !hasOpen {
		return nil
	}
	row, err := one[openYear](ctx, q, `
SELECT y.code, y.name, COUNT(p.id) FILTER (WHERE p.status = 'OPEN')::text AS open_count
  FROM accounting.fiscal_years y
  JOIN accounting.fiscal_periods p ON p.fiscal_year_id = y.id
 WHERE y.deleted_at IS NULL
   AND y.end_date < $1::date
   AND `+companyMatch("y.company_id", "$2")+`
   AND ($3::uuid IS NULL OR y.id <> $3::uuid)
 GROUP BY y.id, y.code, y.name
HAVING COUNT(p.id) FILTER (WHERE p.status = 'OPEN') > 0
 ORDER BY y.end_date DESC
 LIMIT 1`, startDate, companyID, excludeID)
	if err != nil {
		return err
	}
	if row != nil {
		return httpx.BadRequest("Tidak bisa OPEN fiscal: fiscal year " + row.Code + " (" + row.Name + ") masih punya " + row.OpenCount +
			" period OPEN. Closing semua period fiscal sebelumnya terlebih dahulu.")
	}
	return nil
}

func insertPeriod(ctx context.Context, q database.Querier, yearID string, p domain.PeriodInput) error {
	_, err := q.Exec(ctx, `
INSERT INTO accounting.fiscal_periods (fiscal_year_id, period_no, name, start_date, end_date, status)
VALUES ($1,$2,$3,$4::date,$5::date,$6)`, yearID, p.PeriodNo, p.Name, p.StartDate, p.EndDate, p.Status)
	return err
}

func replacePeriods(ctx context.Context, q database.Querier, yearID string, periods []domain.PeriodInput) error {
	if _, err := q.Exec(ctx, `DELETE FROM accounting.fiscal_periods WHERE fiscal_year_id = $1`, yearID); err != nil {
		return err
	}
	for _, p := range periods {
		if err := insertPeriod(ctx, q, yearID, p); err != nil {
			return err
		}
	}
	return nil
}

const duplicateYearCode = "Kode fiscal year sudah dipakai"

// CreateFiscalYear is createFiscalYearRecord.
func (s *Service) CreateFiscalYear(ctx context.Context, userID, companyID string, in FiscalYearInput) (*FiscalYear, error) {
	if msg := domain.ValidateFiscalYear(in.StartDate, in.EndDate, in.Periods); msg != "" {
		return nil, httpx.BadRequest(msg)
	}
	var id string
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := assertPreviousYearsClosed(ctx, tx, &companyID, in.StartDate, nil, domain.HasOpenPeriod(in.Periods)); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
INSERT INTO accounting.fiscal_years (company_id, code, name, start_date, end_date, is_active, created_by, updated_by)
VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$7) RETURNING id::text`,
			companyID, jsTrim(in.Code), jsTrim(in.Name), in.StartDate, in.EndDate, in.IsActive, userID).Scan(&id); err != nil {
			return err
		}
		return replacePeriods(ctx, tx, id, in.Periods)
	})
	if err != nil {
		return nil, uniqueAs400(err, duplicateYearCode)
	}
	return s.reloadYear(ctx, id, "Gagal memuat fiscal year setelah create")
}

func (s *Service) reloadYear(ctx context.Context, id, failMsg string) (*FiscalYear, error) {
	y, err := s.FiscalYear(ctx, id)
	if err == nil && y == nil {
		err = errors.New(failMsg)
	}
	return y, err
}

// UpdateFiscalYear is updateFiscalYearRecord: periods used by journals are
// updated in place and never dropped.
func (s *Service) UpdateFiscalYear(ctx context.Context, id, userID string, in FiscalYearInput) (*FiscalYear, error) {
	if msg := domain.ValidateFiscalYear(in.StartDate, in.EndDate, in.Periods); msg != "" {
		return nil, httpx.BadRequest(msg)
	}
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		companyID, found, err := scalar[*string](ctx, tx, `SELECT company_id::text FROM accounting.fiscal_years WHERE id = $1 AND deleted_at IS NULL`, id)
		if err != nil {
			return err
		}
		if !found {
			return httpx.NotFound("Fiscal year tidak ditemukan")
		}
		if err := assertPreviousYearsClosed(ctx, tx, companyID, in.StartDate, &id, domain.HasOpenPeriod(in.Periods)); err != nil {
			return err
		}
		used, err := collect[struct{ PeriodNo int }](ctx, tx, `
SELECT DISTINCT p.period_no
  FROM accounting.fiscal_periods p
  JOIN accounting.journal_entries e ON e.fiscal_period_id = p.id AND e.deleted_at IS NULL
 WHERE p.fiscal_year_id = $1`, id)
		if err != nil {
			return err
		}
		if len(used) == 0 {
			if err := replacePeriods(ctx, tx, id, in.Periods); err != nil {
				return err
			}
		} else if err := s.updateUsedPeriods(ctx, tx, id, used, in.Periods); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
UPDATE accounting.fiscal_years
   SET code = $1, name = $2, start_date = $3::date, end_date = $4::date,
       is_active = $5, updated_by = $6, updated_at = now()
 WHERE id = $7 AND deleted_at IS NULL`, jsTrim(in.Code), jsTrim(in.Name), in.StartDate, in.EndDate, in.IsActive, userID, id)
		return err
	})
	if err != nil {
		return nil, uniqueAs400(err, duplicateYearCode)
	}
	return s.reloadYear(ctx, id, "Gagal memuat fiscal year setelah update")
}

func (s *Service) updateUsedPeriods(ctx context.Context, tx pgx.Tx, yearID string, used []struct{ PeriodNo int }, periods []domain.PeriodInput) error {
	keep := map[int]bool{}
	nos := make([]int32, len(periods))
	for i, p := range periods {
		keep[p.PeriodNo] = true
		nos[i] = int32(p.PeriodNo)
	}
	for _, u := range used {
		if !keep[u.PeriodNo] {
			return httpx.BadRequest("Period " + itoa(u.PeriodNo) + " masih dipakai journal entry dan tidak boleh dihapus")
		}
	}
	for _, p := range periods {
		existing, found, err := scalar[string](ctx, tx, `SELECT id::text FROM accounting.fiscal_periods WHERE fiscal_year_id = $1 AND period_no = $2`, yearID, p.PeriodNo)
		if err != nil {
			return err
		}
		if found {
			_, err = tx.Exec(ctx, `
UPDATE accounting.fiscal_periods
   SET name = $1, start_date = $2::date, end_date = $3::date, status = $4, updated_at = now()
 WHERE id = $5`, p.Name, p.StartDate, p.EndDate, p.Status, existing)
		} else {
			err = insertPeriod(ctx, tx, yearID, p)
		}
		if err != nil {
			return err
		}
	}
	_, err := tx.Exec(ctx, `
DELETE FROM accounting.fiscal_periods p
 WHERE p.fiscal_year_id = $1
   AND NOT EXISTS (SELECT 1 FROM accounting.journal_entries e WHERE e.fiscal_period_id = p.id AND e.deleted_at IS NULL)
   AND p.period_no <> ALL($2::int[])`, yearID, nos)
	return err
}

// DeleteFiscalYear is softDeleteFiscalYear.
func (s *Service) DeleteFiscalYear(ctx context.Context, id, userID string) error {
	n, _, err := scalar[int](ctx, s.db, `
SELECT COUNT(*)::int
  FROM accounting.journal_entries e
  JOIN accounting.fiscal_periods p ON p.id = e.fiscal_period_id
 WHERE p.fiscal_year_id = $1 AND e.deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if n > 0 {
		return httpx.BadRequest("Fiscal year masih dipakai journal entry dan tidak bisa dihapus")
	}
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM accounting.fiscal_periods WHERE fiscal_year_id = $1`, id); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
UPDATE accounting.fiscal_years
   SET deleted_at = now(), deleted_by = $2, is_active = false, updated_by = $2, updated_at = now()
 WHERE id = $1 AND deleted_at IS NULL`, id, userID)
		return err
	})
}

/* ── Coverage ────────────────────────────────────────────────────────── */

// PeriodRef is a period named in an open suggestion.
type PeriodRef struct {
	ID       string `json:"id"`
	PeriodNo int    `json:"period_no"`
	Name     string `json:"name"`
}

// OpenSuggestion is FiscalOpenSuggestion.
type OpenSuggestion struct {
	Period        FiscalPeriod `json:"period"`
	CanOpen       bool         `json:"can_open"`
	ClosePrevious []PeriodRef  `json:"close_previous"`
	Message       string       `json:"message"`
}

// Coverage is FiscalCoverageResult.
type Coverage struct {
	Date       string          `json:"date"`
	Ready      bool            `json:"ready"`
	Period     *FiscalPeriod   `json:"period"`
	Suggestion *OpenSuggestion `json:"suggestion"`
}

func previousOpenPeriods(ctx context.Context, q database.Querier, yearID string, periodNo int) ([]PeriodRef, error) {
	return collect[PeriodRef](ctx, q, `
SELECT id::text, period_no, name
  FROM accounting.fiscal_periods
 WHERE fiscal_year_id = $1 AND period_no < $2 AND status = 'OPEN'
 ORDER BY period_no ASC`, yearID, periodNo)
}

// priorYearOpenSQL finds an earlier year of the same company that still
// has OPEN periods.
const priorYearOpenSQL = `
SELECT y.code, COUNT(p.id)::text AS open_count
  FROM accounting.fiscal_years y
  JOIN accounting.fiscal_periods p ON p.fiscal_year_id = y.id
  JOIN accounting.fiscal_years cur ON cur.id = $1
 WHERE y.deleted_at IS NULL
   AND y.end_date < cur.start_date
   AND p.status = 'OPEN'
   AND ((cur.company_id IS NULL AND y.company_id IS NULL) OR (cur.company_id IS NOT NULL AND y.company_id = cur.company_id))
 GROUP BY y.id, y.code
HAVING COUNT(p.id) > 0`

// Coverage is resolveFiscalCoverage.
func (s *Service) Coverage(ctx context.Context, date string, companyID *string) (*Coverage, error) {
	if companyID == nil {
		return &Coverage{Date: date}, nil
	}
	open, err := openPeriod(ctx, s.db, date, companyID)
	if err != nil {
		return nil, err
	}
	if open != nil {
		return &Coverage{Date: date, Ready: true, Period: open}, nil
	}
	covering, err := one[FiscalPeriod](ctx, s.db, `SELECT `+periodSelect+`
  FROM accounting.fiscal_periods p
  JOIN accounting.fiscal_years y ON y.id = p.fiscal_year_id AND y.deleted_at IS NULL
 WHERE y.is_active = true
   AND p.start_date <= $1::date AND p.end_date >= $1::date
   AND `+companyMatch("y.company_id", "$2")+`
 ORDER BY p.period_no ASC
 LIMIT 1`, date, companyID)
	if err != nil {
		return nil, err
	}
	if covering == nil || covering.Status == domain.PeriodOpen {
		return &Coverage{Date: date}, nil
	}
	previous, err := previousOpenPeriods(ctx, s.db, covering.FiscalYearID, covering.PeriodNo)
	if err != nil {
		return nil, err
	}
	prior, err := one[struct{ Code, OpenCount string }](ctx, s.db, priorYearOpenSQL+` ORDER BY y.end_date DESC LIMIT 1`, covering.FiscalYearID)
	if err != nil {
		return nil, err
	}
	if prior != nil {
		return &Coverage{Date: date, Suggestion: &OpenSuggestion{
			Period: *covering, ClosePrevious: []PeriodRef{},
			Message: "Period " + covering.Name + " masih CLOSED, tapi fiscal year " + prior.Code + " masih punya " + prior.OpenCount +
				" period OPEN. Closing fiscal sebelumnya dulu.",
		}}, nil
	}
	msg := "Period " + covering.Name + " belum OPEN. Buka sekarang agar bisa input jurnal di tanggal ini."
	if len(previous) > 0 {
		names := make([]string, len(previous))
		for i, p := range previous {
			names[i] = p.Name
		}
		msg = "Period " + covering.Name + " belum OPEN. Sistem bisa menutup " + strings.Join(names, ", ") + " lalu membuka " + covering.Name + "."
	}
	return &Coverage{Date: date, Suggestion: &OpenSuggestion{Period: *covering, CanOpen: true, ClosePrevious: previous, Message: msg}}, nil
}

/* ── Periods ─────────────────────────────────────────────────────────── */

// PeriodListItem is AccountingPeriodListItem.
type PeriodListItem struct {
	FiscalPeriod
	PostedCount int `json:"posted_count"`
	DraftCount  int `json:"draft_count"`
}

// ListPeriods is listAccountingPeriods.
func (s *Service) ListPeriods(ctx context.Context, companyID, fiscalYearID, status, search string) ([]PeriodListItem, error) {
	args := []any{companyID}
	where := []string{"y.deleted_at IS NULL", "y.company_id = $1::uuid", "y.is_active = true"}
	if fiscalYearID != "" {
		args = append(args, fiscalYearID)
		where = append(where, "y.id = $"+itoa(len(args))+"::uuid")
	}
	if status == domain.PeriodOpen || status == domain.PeriodClosed {
		args = append(args, status)
		where = append(where, "p.status = $"+itoa(len(args)))
	}
	if t := jsTrim(search); t != "" {
		args = append(args, "%"+t+"%")
		n := itoa(len(args))
		where = append(where, "(p.name ILIKE $"+n+" OR y.code ILIKE $"+n+" OR y.name ILIKE $"+n+")")
	}
	type row struct {
		FiscalPeriod
		PostedCount int
		DraftCount  int
	}
	rows, err := collect[row](ctx, s.db, `SELECT `+periodSelect+`,
       COALESCE(je.posted_count, 0)::int AS posted_count,
       COALESCE(je.draft_count, 0)::int AS draft_count
  FROM accounting.fiscal_periods p
  JOIN accounting.fiscal_years y ON y.id = p.fiscal_year_id AND y.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT COUNT(*) FILTER (WHERE e.status = 'POSTED')::int AS posted_count,
           COUNT(*) FILTER (WHERE e.status = 'DRAFT')::int AS draft_count
      FROM accounting.journal_entries e
     WHERE e.fiscal_period_id = p.id AND e.deleted_at IS NULL
  ) je ON true
 WHERE `+strings.Join(where, " AND ")+`
 ORDER BY y.start_date DESC, p.period_no ASC`, args...)
	out := make([]PeriodListItem, len(rows))
	for i, r := range rows {
		out[i] = PeriodListItem(r)
	}
	return out, err
}

// AssertPeriodInScope is assertFiscalPeriodInScope.
func (s *Service) AssertPeriodInScope(ctx context.Context, id string, scope *pscope.Scope) error {
	companyID, found, err := scalar[*string](ctx, s.db, `
SELECT y.company_id::text
  FROM accounting.fiscal_periods p
  JOIN accounting.fiscal_years y ON y.id = p.fiscal_year_id
 WHERE p.id = $1 AND y.deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	return rejection(domain.AssertRecordInScope(scope, found, companyID, domain.RecordScopeMessages{
		NotFound: "Fiscal period tidak ditemukan", OutOfScope: "Fiscal period di luar scope"}))
}

// OpenedPeriod is the open route's data: the period, plus company_id when
// it was already OPEN (the TS returns its lookup row as is).
type OpenedPeriod struct {
	FiscalPeriod
	CompanyID *string `json:"company_id,omitempty"`
	withCo    bool
}

// MarshalJSON keeps company_id (even null) only on the already-open path.
func (o OpenedPeriod) MarshalJSON() ([]byte, error) {
	if !o.withCo {
		return marshalJSON(o.FiscalPeriod)
	}
	return marshalJSON(struct {
		FiscalPeriod
		CompanyID *string `json:"company_id"`
	}{o.FiscalPeriod, o.CompanyID})
}

type periodWithCompany struct {
	FiscalPeriod
	CompanyID *string
}

// OpenPeriod is openFiscalPeriodById.
func (s *Service) OpenPeriod(ctx context.Context, id, userID string, companyID *string, closePrevious bool) (*OpenedPeriod, error) {
	var out *OpenedPeriod
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		target, err := one[periodWithCompany](ctx, tx, `SELECT `+periodSelect+`, y.company_id::text
  FROM accounting.fiscal_periods p
  JOIN accounting.fiscal_years y ON y.id = p.fiscal_year_id AND y.deleted_at IS NULL
 WHERE p.id = $1`, id)
		if err != nil {
			return err
		}
		if target == nil {
			return httpx.NotFound("Fiscal period tidak ditemukan")
		}
		if !target.FiscalYearIsActive {
			return httpx.BadRequest("Fiscal year tidak aktif")
		}
		if companyID != nil && target.CompanyID != nil && *target.CompanyID != *companyID {
			return httpx.BadRequest("Fiscal period di luar scope company")
		}
		if target.Status == domain.PeriodOpen {
			out = &OpenedPeriod{FiscalPeriod: target.FiscalPeriod, CompanyID: target.CompanyID, withCo: true}
			return nil
		}
		prior, err := one[struct{ Code, OpenCount string }](ctx, tx, priorYearOpenSQL+` LIMIT 1`, target.FiscalYearID)
		if err != nil {
			return err
		}
		if prior != nil {
			return httpx.BadRequest("Tidak bisa OPEN: fiscal year " + prior.Code + " belum fully CLOSED")
		}
		previous, err := previousOpenPeriods(ctx, tx, target.FiscalYearID, target.PeriodNo)
		if err != nil {
			return err
		}
		if len(previous) > 0 {
			names := make([]string, len(previous))
			ids := make([]string, len(previous))
			for i, p := range previous {
				names[i], ids[i] = p.Name, p.ID
			}
			if !closePrevious {
				return httpx.BadRequest("Tutup period " + strings.Join(names, ", ") + " terlebih dahulu sebelum OPEN " + target.Name)
			}
			if _, err := tx.Exec(ctx, `UPDATE accounting.fiscal_periods SET status = 'CLOSED', updated_at = now() WHERE id = ANY($1::uuid[])`, ids); err != nil {
				return err
			}
		}
		if err := s.touchPeriod(ctx, tx, id, "OPEN", target.FiscalYearID, userID, false); err != nil {
			return err
		}
		refreshed, err := refreshedPeriod(ctx, tx, id)
		if err != nil {
			return err
		}
		out = &OpenedPeriod{FiscalPeriod: *refreshed}
		return nil
	})
	return out, err
}

func (s *Service) touchPeriod(ctx context.Context, tx pgx.Tx, id, status, yearID, userID string, onlyOpen bool) error {
	sql := `UPDATE accounting.fiscal_periods SET status = $2, updated_at = now() WHERE id = $1`
	if onlyOpen {
		sql += ` AND status = 'OPEN'`
	}
	if _, err := tx.Exec(ctx, sql, id, status); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE accounting.fiscal_years SET updated_by = $2, updated_at = now() WHERE id = $1`, yearID, userID)
	return err
}

func refreshedPeriod(ctx context.Context, q database.Querier, id string) (*FiscalPeriod, error) {
	p, err := one[FiscalPeriod](ctx, q, `SELECT `+periodSelect+`
  FROM accounting.fiscal_periods p
  JOIN accounting.fiscal_years y ON y.id = p.fiscal_year_id
 WHERE p.id = $1`, id)
	if err == nil && p == nil {
		err = errors.New("Fiscal period tidak ditemukan setelah close")
	}
	return p, err
}

// DraftEntryRef is a DRAFT journal blocking a close.
type DraftEntryRef struct {
	ID          string  `json:"id"`
	EntryNo     string  `json:"entry_no"`
	EntryDate   string  `json:"entry_date"`
	Description *string `json:"description"`
}

// ClosePreview is PeriodClosePreview.
type ClosePreview struct {
	Period       FiscalPeriod    `json:"period"`
	PostedCount  int             `json:"posted_count"`
	DraftCount   int             `json:"draft_count"`
	DraftEntries []DraftEntryRef `json:"draft_entries"`
	CanClose     bool            `json:"can_close"`
	Blockers     []string        `json:"blockers"`
}

// ClosePreview is getPeriodClosePreview.
func (s *Service) ClosePreview(ctx context.Context, id, companyID string) (*ClosePreview, error) {
	period, err := one[FiscalPeriod](ctx, s.db, `SELECT `+periodSelect+`
  FROM accounting.fiscal_periods p
  JOIN accounting.fiscal_years y ON y.id = p.fiscal_year_id AND y.deleted_at IS NULL
 WHERE p.id = $1 AND y.company_id = $2::uuid`, id, companyID)
	if err != nil {
		return nil, err
	}
	if period == nil {
		return nil, httpx.NotFound("Fiscal period tidak ditemukan")
	}
	drafts, err := collect[DraftEntryRef](ctx, s.db, `
SELECT id::text, entry_no, entry_date::text AS entry_date, description
  FROM accounting.journal_entries
 WHERE fiscal_period_id = $1 AND deleted_at IS NULL AND status = 'DRAFT'
 ORDER BY entry_date ASC, entry_no ASC
 LIMIT 20`, id)
	if err != nil {
		return nil, err
	}
	var posted, draft int
	if err := s.db.QueryRow(ctx, `
SELECT COUNT(*) FILTER (WHERE status = 'POSTED')::int, COUNT(*) FILTER (WHERE status = 'DRAFT')::int
  FROM accounting.journal_entries
 WHERE fiscal_period_id = $1 AND deleted_at IS NULL`, id).Scan(&posted, &draft); err != nil {
		return nil, err
	}
	blockers := domain.CloseBlockers(period.Name, period.Status, period.FiscalYearIsActive, draft)
	return &ClosePreview{Period: *period, PostedCount: posted, DraftCount: draft, DraftEntries: drafts,
		CanClose: len(blockers) == 0, Blockers: blockers}, nil
}

// ClosePeriod is closeFiscalPeriodById: soft close, refused while DRAFT
// journals remain. No closing journals are created.
func (s *Service) ClosePeriod(ctx context.Context, id, userID, companyID string) (*FiscalPeriod, error) {
	preview, err := s.ClosePreview(ctx, id, companyID)
	if err != nil {
		return nil, err
	}
	if !preview.CanClose {
		return nil, httpx.BadRequest(preview.Blockers[0])
	}
	var out *FiscalPeriod
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		drafts, _, err := scalar[int](ctx, tx, `
SELECT COUNT(*)::int FROM accounting.journal_entries
 WHERE fiscal_period_id = $1 AND deleted_at IS NULL AND status = 'DRAFT'`, id)
		if err != nil {
			return err
		}
		if drafts > 0 {
			return httpx.BadRequest("Masih ada " + itoa(drafts) + " jurnal DRAFT. Posting atau hapus dulu sebelum closing.")
		}
		if err := s.touchPeriod(ctx, tx, id, "CLOSED", preview.Period.FiscalYearID, userID, true); err != nil {
			return err
		}
		row, err := refreshedPeriod(ctx, tx, id)
		if err != nil {
			return err
		}
		if row.Status != domain.PeriodClosed {
			return errors.New("Period " + row.Name + " gagal ditutup")
		}
		out = row
		return nil
	})
	return out, err
}
