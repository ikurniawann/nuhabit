package salesfunnel

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/salesfunnel/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/xlsx"
)

// POST /api/sales-funnel/leads/import (leads/import/route.ts and
// lib/sales-funnel/lead-import.ts): CSV or XLSX rows become leads of the
// user's venue. Rows that fail are skipped and reported by row number.

type importRowError struct {
	Row     int    `json:"row"`
	Message string `json:"message"`
}

type leadImportResult struct {
	Imported int              `json:"imported"`
	Skipped  int              `json:"skipped"`
	Errors   []importRowError `json:"errors"`
}

func (h *handler) importLeads(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	res, err := h.runLeadImport(r, u)
	var apiErr *httpx.Error
	if errors.As(err, &apiErr) {
		// CsvImporter reads result.message, so these errors carry both keys.
		return httpx.JSON(w, apiErr.Status, struct {
			Success bool   `json:"success"`
			Error   string `json:"error"`
			Message string `json:"message"`
		}{false, apiErr.Message, apiErr.Message})
	}
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, struct {
		Success bool `json:"success"`
		leadImportResult
		Updated int `json:"updated"`
	}{true, res, 0})
}

func (h *handler) runLeadImport(r *http.Request, u user) (leadImportResult, error) {
	var res leadImportResult
	ctx := r.Context()
	s, err := h.salesScope(ctx, u)
	if err != nil {
		return res, err
	}
	companyID, branchID, err := h.requireVenue(ctx, s, "Venue belum dikonfigurasi (default_company_id/default_branch_id)")
	if err != nil {
		return res, err
	}
	// request.formData() throwing is a 500 in the TS route.
	form, err := storage.ReadForm(r, storage.MaxRequestBytes)
	if err != nil {
		return res, fmt.Errorf("lead import form: %w", err)
	}
	file := form.File("file")
	if file == nil {
		return res, badRequest("File not found")
	}
	rows, err := xlsx.SpreadsheetMatrix(file.Data, file.Name)
	if err != nil {
		return res, err
	}
	if len(rows) < 2 {
		return res, badRequest("File harus berisi baris header dan minimal satu baris data")
	}
	if len(rows)-1 > domain.LeadImportMaxRows {
		return res, badRequest(fmt.Sprintf("Maksimal %d baris per import", domain.LeadImportMaxRows))
	}

	headers := make([]string, len(rows[0]))
	for i, cell := range rows[0] {
		headers[i] = domain.NormalizeLeadHeader(cell)
	}
	used, err := h.leadKeys(ctx, companyID)
	if err != nil {
		return res, err
	}
	var owner any
	if u.Role == "sales" {
		owner = u.ID
	}
	res.Errors = []importRowError{}
	skip := func(row int, msg string) {
		res.Errors = append(res.Errors, importRowError{row, msg})
		res.Skipped++
	}
	for i := 1; i < len(rows); i++ {
		rowNumber := i + 1
		m := domain.MapLeadImportRow(headers, rows[i])
		switch m.Kind {
		case domain.LeadRowEmpty:
			continue
		case domain.LeadRowInvalid:
			skip(rowNumber, m.Message)
			continue
		}
		lead := m.Lead
		key := domain.LeadDedupKey(lead.PicPhone, lead.OrgName)
		if used[key] {
			skip(rowNumber, "Duplikat instansi + no. WA: "+lead.OrgName+" / "+m.RawPhone)
			continue
		}
		if m.Warning != "" {
			res.Errors = append(res.Errors, importRowError{rowNumber, m.Warning})
		}
		// Each row commits on its own, as the TS autocommit inserts do.
		err := database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `INSERT INTO crm.crm_sales_leads
           (company_id, branch_id, org_name, org_type, pic_name, pic_title,
            pic_phone, pic_email, city, source, temperature, notes,
            owner_user_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
				companyID, branchID, lead.OrgName, lead.OrgType, lead.PicName, lead.PicTitle,
				lead.PicPhone, lead.PicEmail, lead.City, lead.Source, lead.Temperature, lead.Notes, owner, u.ID)
			return err
		})
		if err != nil {
			h.log.Error("[sales-funnel] import row error", "error", err)
			skip(rowNumber, "Gagal menyimpan baris")
			continue
		}
		used[key] = true
		res.Imported++
	}

	// EPIC-050: link the imported leads to an account and contact.
	if res.Imported > 0 {
		h.syncUntiedLeads(ctx, companyID)
	}
	return res, nil
}

// leadKeys are the dedup keys of the company's live leads.
func (h *handler) leadKeys(ctx context.Context, companyID string) (map[string]bool, error) {
	rows, err := h.db.Query(ctx, `SELECT pic_phone, org_name FROM crm.crm_sales_leads
     WHERE company_id = $1 AND deleted_at IS NULL`, companyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	used := map[string]bool{}
	for rows.Next() {
		var phone, org string
		if err := rows.Scan(&phone, &org); err != nil {
			return nil, err
		}
		used[domain.LeadDedupKey(phone, org)] = true
	}
	return used, rows.Err()
}

// syncUntiedLeads runs the account/contact sync on the company's newest
// 1000 leads missing either link. Failures are logged, never surfaced.
func (h *handler) syncUntiedLeads(ctx context.Context, companyID string) {
	rows, err := h.db.Query(ctx, `SELECT id::text FROM crm.crm_sales_leads
     WHERE company_id = $1 AND deleted_at IS NULL
       AND (account_id IS NULL OR contact_id IS NULL)
     ORDER BY created_at DESC LIMIT 1000`, companyID)
	var ids []string
	if err == nil {
		ids, err = pgx.CollectRows(rows, pgx.RowTo[string])
	}
	if err != nil {
		h.log.Error("[sales-funnel] sync account/contact import gagal", "error", err)
		return
	}
	for _, id := range ids {
		h.syncLeadAccountContact(ctx, h.db, id)
	}
}
