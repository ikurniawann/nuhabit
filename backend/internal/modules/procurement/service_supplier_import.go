package procurement

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/database"
	pscope "nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/xlsx"
)

// Port of lib/purchasing/import-suppliers.ts, supplier-spreadsheet.ts and
// the shared parts of import-spreadsheet.ts and export-scope.ts.

// supplierColumns are SUPPLIER_IMPORT_COLUMNS keys: the export header row
// and the fields a blank row lacks.
var supplierColumns = []string{
	"kode", "nama_supplier", "pic_name", "pic_phone", "pic_email", "telepon", "email", "alamat", "kota", "npwp",
	"payment_terms", "currency", "bank_nama", "bank_rekening", "bank_atas_nama", "kategori", "catatan", "status",
}

var supplierHeader = xlsx.HeaderNormalizer(map[string]string{
	"code": "kode", "supplier_code": "kode",
	"nama": "nama_supplier", "name": "nama_supplier", "supplier_name": "nama_supplier",
	"contact_person": "pic_name", "nama_pic": "pic_name",
	"contact_phone": "pic_phone", "telepon_pic": "pic_phone",
	"contact_email": "pic_email", "email_pic": "pic_email",
	"phone": "telepon", "company_phone": "telepon",
	"company_email": "email",
	"address":       "alamat",
	"city":          "kota",
	"tax_id":        "npwp",
	"payment_term":  "payment_terms", "termin_pembayaran": "payment_terms",
	"mata_uang":    "currency",
	"bank_name":    "bank_nama",
	"bank_account": "bank_rekening", "no_rekening": "bank_rekening",
	"account_holder": "bank_atas_nama", "atas_nama": "bank_atas_nama",
	"category": "kategori",
	"notes":    "catatan", "description": "catatan", "deskripsi": "catatan",
})

/* ── Import summary (ImportTally) ────────────────────────────────────── */

type importIssue struct {
	Row     int    `json:"row"`
	Message string `json:"message"`
}

// importSummary is ImportTally.summary().
type importSummary struct {
	Success  bool          `json:"success"`
	Imported int           `json:"imported"`
	Updated  int           `json:"updated"`
	Skipped  int           `json:"skipped"`
	Errors   []importIssue `json:"errors"`
}

func (t *importSummary) skip(row int, msg string) {
	t.Errors = append(t.Errors, importIssue{row, msg})
	t.Skipped++
}

// emptyToNull is emptyToNull: the trimmed cell, nil when blank.
func emptyToNull(v string) *string {
	if v = domain.JSTrim(v); v == "" {
		return nil
	}
	return &v
}

var trailingSequence = regexp.MustCompile(`-(\d+)$`)

// nextCodeSequence is nextCodeSequence: "SUP-2026-0007" → 8, else 1.
func nextCodeSequence(last string) int {
	m := trailingSequence.FindStringSubmatch(last)
	if m == nil {
		return 1
	}
	n, _ := strconv.Atoi(m[1])
	return n + 1
}

/* ── Supplier rules ──────────────────────────────────────────────────── */

var whitespaceRun = regexp.MustCompile(`\s+`)

// normalizePaymentTerms: "top 30" → TOP30, CASH/COD → CBD, unknown → TOP30.
func normalizePaymentTerms(v string) string {
	raw := whitespaceRun.ReplaceAllString(strings.ToUpper(domain.JSTrim(v)), "")
	switch {
	case raw == "":
		return "TOP30"
	case contains(paymentTerms, raw):
		return raw
	case raw == "CASH" || raw == "COD":
		return "CBD"
	}
	return "TOP30"
}

func normalizeCurrency(v string) string {
	if raw := strings.ToUpper(domain.JSTrim(v)); contains(currencies, raw) {
		return raw
	}
	return "IDR"
}

func normalizeSupplierStatus(v string) string {
	raw := strings.ToLower(domain.JSTrim(v))
	switch {
	case raw == "":
		return "active"
	case contains(supplierStatuses, raw):
		return raw
	case contains([]string{"nonaktif", "false", "0", "no"}, raw):
		return "inactive"
	}
	return "active"
}

// setSupplierPayload is buildSupplierPayload: inactive and blocked
// suppliers are is_active false.
func setSupplierPayload(f *fields, data map[string]string, nama string) *fields {
	status := normalizeSupplierStatus(data["status"])
	f.set("nama_supplier", nama, "")
	for _, col := range []string{"pic_name", "pic_phone", "pic_email", "telepon", "email", "alamat", "kota", "npwp"} {
		f.set(col, emptyToNull(data[col]), "")
	}
	f.set("payment_terms", normalizePaymentTerms(data["payment_terms"]), "")
	f.set("currency", normalizeCurrency(data["currency"]), "")
	for _, col := range []string{"bank_nama", "bank_rekening", "bank_atas_nama", "kategori", "catatan"} {
		f.set(col, emptyToNull(data[col]), "")
	}
	return f.set("status", status, "").set("is_active", status != "inactive" && status != "blocked", "")
}

/* ── Import and export ───────────────────────────────────────────────── */

// ImportSuppliers is importSuppliers: a code already used in the caller's
// exact company/branch is updated, the rest inserted. Each row commits on
// its own; a failing row is reported with the database message.
func (s *Service) ImportSuppliers(ctx context.Context, rows []xlsx.ImportRow, userID string, companyID, branchID *string) (*importSummary, error) {
	sum := &importSummary{Success: true, Errors: []importIssue{}}
	for _, row := range rows {
		if xlsx.IsBlankRow(row.Data, supplierColumns...) {
			continue
		}
		nama := domain.JSTrim(row.Data["nama_supplier"])
		if nama == "" {
			sum.skip(row.RowNumber, "Required field missing: nama_supplier")
			continue
		}
		kode := domain.JSTrim(row.Data["kode"])
		if kode == "" {
			var err error
			if kode, err = s.nextSupplierCode(ctx); err != nil {
				return nil, err
			}
		}
		var existingID string
		err := s.db.QueryRow(ctx, `SELECT id::text FROM suppliers WHERE kode = $1 AND deleted_at IS NULL
			AND company_id IS NOT DISTINCT FROM $2::uuid AND branch_id IS NOT DISTINCT FROM $3::uuid LIMIT 1`,
			kode, companyID, branchID).Scan(&existingID)
		if err != nil && !database.IsNoRows(err) {
			return nil, err
		}

		var sql string
		var args []any
		if existingID != "" {
			f := setSupplierPayload(&fields{}, row.Data, nama).set("updated_by", userID, "").set("updated_at", s.now(), "")
			sql, args = f.updateSQL("suppliers", "id = $1::text::uuid", existingID)
		} else {
			f := (&fields{}).set("kode", kode, "").set("company_id", companyID, "").set("branch_id", branchID, "")
			sql, args = setSupplierPayload(f, row.Data, nama).set("created_by", userID, "").insertSQL("suppliers")
		}
		err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, sql, args...)
			return err
		})
		switch {
		case err != nil:
			sum.skip(row.RowNumber, pgMessage(err))
		case existingID != "":
			sum.Updated++
		default:
			sum.Imported++
		}
	}
	return sum, nil
}

// nextSupplierCode is generateSupplierCode: SUP-YYYY-#### across companies.
func (s *Service) nextSupplierCode(ctx context.Context) (string, error) {
	year := s.now().In(s.loc).Year()
	var last string
	err := s.db.QueryRow(ctx, `SELECT kode FROM suppliers WHERE kode ILIKE $1 ORDER BY kode DESC LIMIT 1`,
		fmt.Sprintf("SUP-%d-%%", year)).Scan(&last)
	if err != nil && !database.IsNoRows(err) {
		return "", err
	}
	return fmt.Sprintf("SUP-%d-%04d", year, nextCodeSequence(last)), nil
}

// ExportSuppliers is GET /api/purchasing/export/suppliers: the scoped
// suppliers as the import sheet. Every column is read as text, the string
// node-postgres hands to spreadsheetCell.
func (s *Service) ExportSuppliers(ctx context.Context, scope *pscope.Scope) ([]byte, error) {
	w := scopeFilters(newWhere().add("s.deleted_at IS NULL"), scope)
	rows, err := s.db.Query(ctx, `SELECT s.kode, s.nama_supplier, s.pic_name, s.pic_phone, s.pic_email, s.telepon, s.email,
		s.alamat, s.kota, s.npwp, COALESCE(s.payment_terms, 'TOP30'), COALESCE(s.currency, 'IDR'), s.bank_nama,
		s.bank_rekening, s.bank_atas_nama, s.kategori, s.catatan, COALESCE(s.status, 'active')
		FROM purchasing.suppliers s `+w.sql()+` ORDER BY s.nama_supplier ASC`, w.args...)
	if err != nil {
		return nil, err
	}
	header := make([]any, len(supplierColumns))
	for i, k := range supplierColumns {
		header[i] = k
	}
	sheet := [][]any{header}
	for rows.Next() {
		cells := make([]*string, len(supplierColumns))
		dest := make([]any, len(cells))
		for i := range cells {
			dest[i] = &cells[i]
		}
		if err := rows.Scan(dest...); err != nil {
			rows.Close()
			return nil, err
		}
		line := make([]any, len(cells))
		for i, c := range cells {
			line[i] = ""
			if c != nil {
				line[i] = domain.JSTrim(*c)
			}
		}
		sheet = append(sheet, line)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return xlsx.Build(xlsx.SheetSpec{Name: "Suppliers", Rows: sheet})
}
