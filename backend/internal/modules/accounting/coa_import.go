package accounting

import (
	"cmp"
	"context"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/storage"
)

// POST /api/accounting/chart-of-accounts/import (lib/accounting/coa-import.ts):
// an Excel chart of accounts is previewed against the company's chart, and
// committed in one transaction when mode is "commit" and no row has an error.

// CoaImportData is the response data of every import outcome.
type CoaImportData struct {
	Mode    string                  `json:"mode"`
	Issues  []domain.CoaIssue       `json:"issues"`
	Preview []domain.CoaPreviewRow  `json:"preview"`
	Summary domain.CoaImportSummary `json:"summary"`
}

// CoaImportResult is the route body; Message is absent on a preview.
type CoaImportResult struct {
	Data    CoaImportData `json:"data"`
	Message string        `json:"message,omitempty"`
}

// ImportChartOfAccounts is importChartOfAccounts.
func (s *Service) ImportChartOfAccounts(ctx context.Context, companyID, userID string, file []byte, mode string) (*CoaImportResult, error) {
	parsed, issues, err := domain.ParseCoaSpreadsheet(file)
	if err != nil {
		return nil, err
	}
	if len(parsed) == 0 {
		return &CoaImportResult{
			Data: CoaImportData{Mode: mode, Issues: issues, Preview: []domain.CoaPreviewRow{},
				Summary: domain.CoaImportSummary{Error: len(issues)}},
			Message: "Tidak ada baris valid untuk diimpor",
		}, nil
	}

	typeIDs, err := s.activeAccountTypeIDs(ctx)
	if err != nil {
		return nil, err
	}
	existing, err := s.accountsByCode(ctx, companyID)
	if err != nil {
		return nil, err
	}
	preview := domain.BuildCoaImportPreview(parsed, typeIDs, existing)
	summary := domain.SummarizeCoaImport(preview, issues)
	if mode != "commit" {
		return &CoaImportResult{Data: CoaImportData{"preview", issues, preview, summary}}, nil
	}
	if summary.Error > 0 {
		return nil, httpx.BadRequest("Masih ada error — perbaiki file sebelum commit")
	}
	if err := s.commitCoaImport(ctx, companyID, userID, parsed, typeIDs, existing); err != nil {
		return nil, err
	}
	return &CoaImportResult{
		Data:    CoaImportData{"commit", issues, preview, summary},
		Message: "Import selesai: " + strconv.Itoa(summary.Create) + " baru, " + strconv.Itoa(summary.Update) + " update",
	}, nil
}

// activeAccountTypeIDs is loadTypeMap: active types by upper-cased code.
func (s *Service) activeAccountTypeIDs(ctx context.Context) (map[string]string, error) {
	rows, err := collect[struct{ ID, Code string }](ctx, s.db, `SELECT id::text, code FROM accounting.account_types WHERE is_active = true`)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(rows))
	for _, r := range rows {
		out[strings.ToUpper(r.Code)] = r.ID
	}
	return out, nil
}

// accountsByCode is loadExistingByCode: the company's live accounts.
func (s *Service) accountsByCode(ctx context.Context, companyID string) (map[string]domain.ExistingAccount, error) {
	rows, err := collect[struct{ ID, Code, Name string }](ctx, s.db,
		`SELECT id::text, code, name FROM accounting.chart_of_accounts WHERE deleted_at IS NULL AND company_id = $1`, companyID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]domain.ExistingAccount, len(rows))
	for _, r := range rows {
		out[r.Code] = domain.ExistingAccount{ID: r.ID, Name: r.Name}
	}
	return out, nil
}

// commitCoaImport writes parents before children (level, then code), then
// recomputes is_postable for the whole company.
func (s *Service) commitCoaImport(ctx context.Context, companyID, userID string, parsed []domain.CoaRow,
	typeIDs map[string]string, existing map[string]domain.ExistingAccount) error {
	ordered := slices.Clone(parsed)
	slices.SortStableFunc(ordered, func(a, b domain.CoaRow) int {
		return cmp.Or(a.Level-b.Level, strings.Compare(a.Code, b.Code))
	})
	idByCode := make(map[string]string, len(existing)+len(parsed))
	for code, a := range existing {
		idByCode[code] = a.ID
	}
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		for _, row := range ordered {
			typeID := typeIDs[row.AccountTypeCode]
			if typeID == "" {
				continue
			}
			var parentID *string
			if row.ParentCode != nil {
				id, ok := idByCode[*row.ParentCode]
				if !ok {
					return fmt.Errorf("Parent %s belum ter-resolve", *row.ParentCode)
				}
				parentID = &id
			}
			if ex, ok := existing[row.Code]; ok {
				if _, err := tx.Exec(ctx, `
UPDATE accounting.chart_of_accounts
   SET name = $1, parent_id = $2, account_type_id = $3, level = $4, is_contra = $5, is_cash_bank = $6,
       cash_flow_category = $7, description = $8, is_active = true, deleted_at = NULL, deleted_by = NULL,
       updated_by = $9, updated_at = now()
 WHERE id = $10`, row.Name, parentID, typeID, row.Level, row.IsContra, row.IsCashBank,
					row.CashFlowCategory, row.Description, userID, ex.ID); err != nil {
					return err
				}
				continue
			}
			var id string
			if err := tx.QueryRow(ctx, `
INSERT INTO accounting.chart_of_accounts (
  company_id, code, name, parent_id, account_type_id, level,
  is_postable, is_contra, is_cash_bank, cash_flow_category, description,
  is_active, created_by, updated_by
) VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,true,$11,$11)
RETURNING id::text`, companyID, row.Code, row.Name, parentID, typeID, row.Level,
				row.IsContra, row.IsCashBank, row.CashFlowCategory, row.Description, userID).Scan(&id); err != nil {
				return err
			}
			idByCode[row.Code] = id
		}
		_, err := tx.Exec(ctx, `
UPDATE accounting.chart_of_accounts coa
   SET is_postable = NOT EXISTS (
         SELECT 1 FROM accounting.chart_of_accounts child
          WHERE child.parent_id = coa.id AND child.deleted_at IS NULL),
       updated_at = now()
 WHERE coa.deleted_at IS NULL AND coa.company_id = $1`, companyID)
		return err
	})
}

func (h *Handler) importAccounts(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	companyID, _, err := h.company(r, u, "")
	if err != nil {
		return err
	}
	// request.formData() is not caught in the TS route: a broken body is a 500.
	form, err := storage.ReadForm(r, storage.MaxRequestBytes)
	if err != nil {
		return err
	}
	file := form.File("file")
	if file == nil {
		return badRequest("File Excel wajib diunggah")
	}
	mode := form.Value("mode")
	if mode == "" {
		mode = "preview"
	}
	res, err := h.svc.ImportChartOfAccounts(r.Context(), companyID, u.ID, file.Data, mode)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, res)
}
