package accounting

import (
	"context"
	"sort"
	"strings"

	"nuhabit/backend/internal/modules/accounting/domain"
)

// Subsidiary ledger: AP per vendor/supplier and AR per customer name, from
// posted invoices and their payment allocations (subsidiary-ledger-store.ts).

// SubsidiaryParty is SubsidiaryPartyOption.
type SubsidiaryParty struct {
	PartyKey     string  `json:"party_key"`
	PartyName    string  `json:"party_name"`
	Outstanding  float64 `json:"outstanding"`
	InvoiceCount float64 `json:"invoice_count"`
}

// SubsidiaryParties is listSubsidiaryParties.
func (s *Service) SubsidiaryParties(ctx context.Context, companyID, kind string) ([]SubsidiaryParty, error) {
	sql := `
SELECT COALESCE(NULLIF(TRIM(i.customer_name), ''), 'Customer') AS party_key,
       COALESCE(NULLIF(TRIM(i.customer_name), ''), 'Customer') AS party_name,
       SUM(GREATEST(i.total_amount - COALESCE((
         SELECT SUM(a.amount) FROM accounting.ar_receipt_allocations a
           JOIN accounting.ar_receipts r ON r.id = a.receipt_id
          WHERE a.invoice_id = i.id AND r.deleted_at IS NULL AND r.status = 'POSTED'), 0), 0))::text AS outstanding,
       COUNT(*)::text AS invoice_count
  FROM accounting.ar_invoices i
 WHERE i.deleted_at IS NULL AND i.status = 'POSTED' AND i.company_id = $1::uuid
 GROUP BY 1, 2
 ORDER BY party_name ASC`
	if kind == "AP" {
		// Cross-context read: vendor/supplier names come from purchasing.
		sql = `
SELECT CASE WHEN i.vendor_id IS NOT NULL THEN 'vendor:' || i.vendor_id::text ELSE 'supplier:' || i.supplier_id::text END AS party_key,
       COALESCE(v.name, s.nama_supplier, 'Vendor') AS party_name,
       SUM(GREATEST(i.total_amount - COALESCE((
         SELECT SUM(a.amount) FROM accounting.ap_payment_allocations a
           JOIN accounting.ap_payments p ON p.id = a.payment_id
          WHERE a.invoice_id = i.id AND p.deleted_at IS NULL AND p.status = 'POSTED'), 0), 0))::text AS outstanding,
       COUNT(*)::text AS invoice_count
  FROM accounting.ap_invoices i
  LEFT JOIN purchasing.vendors v ON v.id = i.vendor_id
  LEFT JOIN purchasing.suppliers s ON s.id = i.supplier_id
 WHERE i.deleted_at IS NULL AND i.status = 'POSTED' AND i.company_id = $1::uuid
   AND (i.vendor_id IS NOT NULL OR i.supplier_id IS NOT NULL)
 GROUP BY 1, 2
 ORDER BY party_name ASC`
	}
	rows, err := collect[struct{ Key, Name, Outstanding, Count string }](ctx, s.db, sql, companyID)
	if err != nil {
		return nil, err
	}
	out := make([]SubsidiaryParty, len(rows))
	for i, r := range rows {
		out[i] = SubsidiaryParty{PartyKey: r.Key, PartyName: r.Name,
			Outstanding: domain.Round2(domain.ToNumber(r.Outstanding)), InvoiceCount: domain.ToNumber(r.Count)}
	}
	return out, nil
}

// SubsidiaryLine is SubsidiaryLedgerLine.
type SubsidiaryLine struct {
	LineID         string  `json:"line_id"`
	EntryDate      string  `json:"entry_date"`
	DocType        string  `json:"doc_type"`
	DocNo          string  `json:"doc_no"`
	Description    *string `json:"description"`
	Debit          float64 `json:"debit"`
	Credit         float64 `json:"credit"`
	SourceID       string  `json:"source_id"`
	RunningBalance float64 `json:"running_balance"`
}

// SubsidiaryLedger is SubsidiaryLedgerReport.
type SubsidiaryLedger struct {
	Kind           string           `json:"kind"`
	PartyKey       string           `json:"party_key"`
	PartyName      string           `json:"party_name"`
	DateFrom       *string          `json:"date_from"`
	DateTo         *string          `json:"date_to"`
	OpeningBalance float64          `json:"opening_balance"`
	TotalDebit     float64          `json:"total_debit"`
	TotalCredit    float64          `json:"total_credit"`
	ClosingBalance float64          `json:"closing_balance"`
	Lines          []SubsidiaryLine `json:"lines"`
}

type subMove struct {
	ID, DocNo, Date, Amount string
	Description             *string
}

// SubsidiaryLedgerFor is getSubsidiaryLedger: nil when an AP party key is
// not "vendor:<id>" or "supplier:<id>".
func (s *Service) SubsidiaryLedgerFor(ctx context.Context, companyID, kind, partyKey string, dateFrom, dateTo *string) (*SubsidiaryLedger, error) {
	var party, invTable, partyName string
	var partyArgs []any
	var invSQL, paySQL, openSQL, docType, linePrefix, descPrefix string
	if kind == "AP" {
		var vendorID, supplierID *string
		switch {
		case strings.HasPrefix(partyKey, "vendor:"):
			vendorID = strp(partyKey[7:])
		case strings.HasPrefix(partyKey, "supplier:"):
			supplierID = strp(partyKey[9:])
		}
		if (vendorID == nil || *vendorID == "") && (supplierID == nil || *supplierID == "") {
			return nil, nil
		}
		nameSQL, nameID := `SELECT nama_supplier FROM purchasing.suppliers WHERE id = $1::uuid`, supplierID
		if vendorID != nil && *vendorID != "" {
			nameSQL, nameID = `SELECT name FROM purchasing.vendors WHERE id = $1::uuid`, vendorID
		}
		name, _, err := scalar[*string](ctx, s.db, nameSQL, *nameID)
		if err != nil {
			return nil, err
		}
		partyName = "Vendor"
		if name != nil && *name != "" {
			partyName = *name
		}
		party = `(($2::uuid IS NOT NULL AND i.vendor_id = $2::uuid) OR ($3::uuid IS NOT NULL AND i.supplier_id = $3::uuid))`
		partyArgs = []any{vendorID, supplierID}
		invTable = "accounting.ap_invoices"
		paySQL = `SELECT a.id::text, p.payment_no, p.payment_date::text, a.amount::text, i.invoice_no
  FROM accounting.ap_payment_allocations a
  JOIN accounting.ap_payments p ON p.id = a.payment_id
  JOIN accounting.ap_invoices i ON i.id = a.invoice_id
 WHERE p.deleted_at IS NULL AND p.status = 'POSTED' AND i.deleted_at IS NULL AND i.status = 'POSTED'
   AND i.company_id = $1::uuid AND ` + party
		openSQL = `
SELECT (COALESCE((SELECT SUM(i.total_amount) FROM accounting.ap_invoices i
          WHERE i.deleted_at IS NULL AND i.status = 'POSTED' AND i.company_id = $1::uuid
            AND i.invoice_date < $4::date AND ` + party + `), 0)
      - COALESCE((SELECT SUM(a.amount) FROM accounting.ap_payment_allocations a
          JOIN accounting.ap_payments p ON p.id = a.payment_id
          JOIN accounting.ap_invoices i ON i.id = a.invoice_id
          WHERE p.deleted_at IS NULL AND p.status = 'POSTED' AND i.deleted_at IS NULL AND i.status = 'POSTED'
            AND i.company_id = $1::uuid AND p.payment_date < $4::date AND ` + party + `), 0))::text`
		docType, linePrefix, descPrefix = "payment", "pay-", "Bayar "
	} else {
		partyName = partyKey
		party = `COALESCE(NULLIF(TRIM(i.customer_name), ''), 'Customer') = $2`
		partyArgs = []any{partyKey}
		invTable = "accounting.ar_invoices"
		paySQL = `SELECT a.id::text, r.receipt_no, r.receipt_date::text, a.amount::text, i.invoice_no
  FROM accounting.ar_receipt_allocations a
  JOIN accounting.ar_receipts r ON r.id = a.receipt_id
  JOIN accounting.ar_invoices i ON i.id = a.invoice_id
 WHERE r.deleted_at IS NULL AND r.status = 'POSTED' AND i.deleted_at IS NULL AND i.status = 'POSTED'
   AND i.company_id = $1::uuid AND ` + party
		openSQL = `
SELECT (COALESCE((SELECT SUM(i.total_amount) FROM accounting.ar_invoices i
          WHERE i.deleted_at IS NULL AND i.status = 'POSTED' AND i.company_id = $1::uuid
            AND i.invoice_date < $3::date AND ` + party + `), 0)
      - COALESCE((SELECT SUM(a.amount) FROM accounting.ar_receipt_allocations a
          JOIN accounting.ar_receipts r ON r.id = a.receipt_id
          JOIN accounting.ar_invoices i ON i.id = a.invoice_id
          WHERE r.deleted_at IS NULL AND r.status = 'POSTED' AND i.deleted_at IS NULL AND i.status = 'POSTED'
            AND i.company_id = $1::uuid AND r.receipt_date < $3::date AND ` + party + `), 0))::text`
		docType, linePrefix, descPrefix = "receipt", "rcp-", "Terima "
	}
	base := append([]any{companyID}, partyArgs...)

	opening := 0.0
	if dateFrom != nil {
		bal, _, err := scalar[string](ctx, s.db, openSQL, append(append([]any{}, base...), *dateFrom)...)
		if err != nil {
			return nil, err
		}
		opening = domain.Round2(domain.ToNumber(bal))
	}

	dated := func(sql, col string) (string, []any) {
		args := append([]any{}, base...)
		if dateFrom != nil {
			args = append(args, *dateFrom)
			sql += " AND " + col + " >= $" + itoa(len(args)) + "::date"
		}
		if dateTo != nil {
			args = append(args, *dateTo)
			sql += " AND " + col + " <= $" + itoa(len(args)) + "::date"
		}
		return sql, args
	}
	invSQL, invArgs := dated(`SELECT i.id::text, i.invoice_no, i.invoice_date::text, i.total_amount::text, i.description
  FROM `+invTable+` i
 WHERE i.deleted_at IS NULL AND i.status = 'POSTED' AND i.company_id = $1::uuid AND `+party, "i.invoice_date")
	invoices, err := collect[subMove](ctx, s.db, invSQL+` ORDER BY i.invoice_date ASC, i.invoice_no ASC`, invArgs...)
	if err != nil {
		return nil, err
	}
	payCol, payOrder := "p.payment_date", " ORDER BY p.payment_date ASC, p.payment_no ASC"
	if kind != "AP" {
		payCol, payOrder = "r.receipt_date", " ORDER BY r.receipt_date ASC, r.receipt_no ASC"
	}
	pSQL, pArgs := dated(paySQL, payCol)
	payments, err := collect[struct{ ID, DocNo, Date, Amount, InvoiceNo string }](ctx, s.db, pSQL+payOrder, pArgs...)
	if err != nil {
		return nil, err
	}

	lines := make([]SubsidiaryLine, 0, len(invoices)+len(payments))
	for _, i := range invoices {
		lines = append(lines, SubsidiaryLine{LineID: "inv-" + i.ID, EntryDate: i.Date, DocType: "invoice", DocNo: i.DocNo,
			Description: i.Description, Debit: domain.Round2(domain.ToNumber(i.Amount)), SourceID: i.ID})
	}
	for _, p := range payments {
		lines = append(lines, SubsidiaryLine{LineID: linePrefix + p.ID, EntryDate: p.Date, DocType: docType, DocNo: p.DocNo,
			Description: strp(descPrefix + p.InvoiceNo), Credit: domain.Round2(domain.ToNumber(p.Amount)), SourceID: p.ID})
	}
	sort.SliceStable(lines, func(a, b int) bool {
		if lines[a].EntryDate != lines[b].EntryDate {
			return lines[a].EntryDate < lines[b].EntryDate
		}
		return lines[a].DocNo < lines[b].DocNo
	})
	running, td, tc := opening, 0.0, 0.0
	for i := range lines {
		td = domain.Round2(td + lines[i].Debit)
		tc = domain.Round2(tc + lines[i].Credit)
		running = domain.Round2(running + lines[i].Debit - lines[i].Credit)
		lines[i].RunningBalance = running
	}
	return &SubsidiaryLedger{Kind: kind, PartyKey: partyKey, PartyName: partyName, DateFrom: dateFrom, DateTo: dateTo,
		OpeningBalance: opening, TotalDebit: td, TotalCredit: tc, ClosingBalance: running, Lines: lines}, nil
}
