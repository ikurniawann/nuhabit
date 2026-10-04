package accounting

import (
	"context"
	"errors"
	"math"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/inventory"
	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/contracts/procurement"
	"nuhabit/backend/internal/contracts/storedvalue"
	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Journals of operational events (lib/pos/accounting-posting.ts,
// lib/purchasing/accounting-posting.ts, ap-store createApInvoiceFromGrn,
// lib/inventory/accounting-posting.ts). Each runs on db, the subscriber's
// transaction or a caller's when a publisher needs the note in its response
// (ERP brief rule 2), and is idempotent per (event code, source document).

// ErrSourceMissing is the TS plain Error for a vanished source document.
var ErrSourceMissing = errors.New("source document not found")

// PostPosSale is postPosSaleAccountingJournals: the sale journal by payment
// method, then COGS relief when the order has a cost.
func (s *Service) PostPosSale(ctx context.Context, db database.DB, in possales.SaleSettled) ([]domain.PostResult, error) {
	sale, err := s.ports.PosOrders.SaleSnapshot(ctx, db, in.OrderID)
	if err != nil {
		return nil, err
	}
	if sale == nil {
		return nil, ErrSourceMissing
	}
	amounts := domain.Amounts(in.AmountsOverride)
	if in.AmountsOverride == nil {
		total := sale.Total
		amounts = domain.PosAmounts(domain.PosAmountsInput{Subtotal: sale.Subtotal, Discount: sale.Discount, Tax: sale.Tax,
			ServiceCharge: sale.ServiceCharge, OtherCharges: sale.OtherCharges, Total: &total, AmountPaid: sale.AmountPaid, Cogs: sale.Cogs})
	}
	if !(amounts["TOTAL"] > 0) {
		return []domain.PostResult{{Status: domain.PostSkipped, Reason: "Nilai penjualan 0 — tidak ada jurnal"}}, nil
	}
	method := ""
	if in.PaymentMethod != nil {
		method = *in.PaymentMethod
	} else if sale.PaymentMethod != nil {
		method = *sale.PaymentMethod
	}
	event := domain.SaleEventForMethod(method)
	switch event {
	case domain.SkipNFCTab:
		return []domain.PostResult{{Status: domain.PostSkipped, Reason: "NFC Tab dipindah ke ticketing AR — jurnal POS dilewati"}}, nil
	case "":
		label := method
		if label == "" {
			label = "kosong"
		}
		return []domain.PostResult{{Status: domain.PostSkipped, Reason: "Metode pembayaran " + label + " tidak punya journal mapping POS"}}, nil
	}
	docID, docType := in.DocumentID, in.DocumentType
	if docID == "" {
		docID = in.OrderID
	}
	if docType == "" {
		docType = "pos_order"
	}
	label := method
	if label == "" {
		label = event
	}
	post := MappingPost{CompanyID: sale.CompanyID, UserID: in.UserID, DocumentType: docType, DocumentID: docID,
		EntryDate: sale.EntryDate, Amounts: amounts, SourceModule: "POS",
		EventCode: event, Description: "POS " + sale.OrderNumber + " — penjualan " + label}
	saleResult, err := PostFromMapping(ctx, db, post)
	if err != nil {
		return nil, err
	}
	results := []domain.PostResult{saleResult}
	if amounts["COGS"] > 0 {
		post.EventCode, post.Description = "POS_COGS_RELIEF", "POS "+sale.OrderNumber+" — HPP / relief inventory"
		cogs, err := PostFromMapping(ctx, db, post)
		if err != nil {
			return nil, err
		}
		results = append(results, cogs)
	}
	return results, nil
}

// PostMemberDeposit posts a member bill instalment (recordMemberBillPayment).
func (s *Service) PostMemberDeposit(ctx context.Context, db database.DB, in storedvalue.MemberBillPaid) (domain.PostResult, error) {
	return PostFromMapping(ctx, db, MappingPost{CompanyID: in.CompanyID, UserID: in.UserID, EventCode: in.EventCode,
		DocumentType: in.DocumentType, DocumentID: in.PaymentID, EntryDate: in.EntryDate,
		Amounts: domain.Amounts{"TOTAL": in.AmountTotal}, Description: in.Description, SourceModule: in.SourceModule})
}

// PostGrn is postGrnAccountingJournals: PURCHASE_GRN, then the GRN's AP
// invoice and PURCHASE_AP_INVOICE. An AP failure becomes a skipped result.
func (s *Service) PostGrn(ctx context.Context, db database.DB, in procurement.GrnPosted) ([]domain.PostResult, error) {
	grn, err := s.ports.Purchasing.GrnPosting(ctx, db, in.GrnID)
	if err != nil {
		return nil, err
	}
	if grn == nil {
		return nil, ErrSourceMissing
	}
	amounts := domain.GrnAmounts(grn.Lines, grn.PpnPercent)
	if !(amounts["TOTAL"] > 0) {
		return []domain.PostResult{{Status: domain.PostSkipped, Reason: "Nilai GRN 0 — tidak ada jurnal"}}, nil
	}
	grnResult, err := PostFromMapping(ctx, db, MappingPost{CompanyID: grn.CompanyID, UserID: in.UserID, DocumentType: "grn",
		DocumentID: in.GrnID, EntryDate: grn.EntryDate, Amounts: amounts, SourceModule: "PURCHASING", EventCode: "PURCHASE_GRN",
		Description: "GRN " + grn.GrnNumber + " — penerimaan inventory"})
	if err != nil {
		return nil, err
	}
	apResult, err := s.postGrnAp(ctx, db, grn, amounts, in.UserID)
	if err != nil {
		var pe *PostError
		var he *httpx.Error
		if !errors.As(err, &pe) && !errors.As(err, &he) && database.PgCode(err) == "" {
			return nil, err
		}
		apResult = domain.PostResult{Status: domain.PostSkipped, Reason: errMessage(err)}
	}
	return []domain.PostResult{grnResult, apResult}, nil
}

type grnInvoice struct {
	ID, InvoiceNo, InvoiceDate string
	Subtotal, Tax, Total       string
}

// postGrnAp is createApInvoiceFromGrn + postApInvoiceJournal. The invoice
// insert is a savepoint so a failure leaves db usable.
func (s *Service) postGrnAp(ctx context.Context, db database.DB, grn *GrnPosting, amounts domain.Amounts, userID string) (domain.PostResult, error) {
	inv, err := one[grnInvoice](ctx, db, `
SELECT id::text, invoice_no, invoice_date::text, subtotal::text, tax_amount::text, total_amount::text
  FROM accounting.ap_invoices WHERE grn_id = $1 AND deleted_at IS NULL LIMIT 1`, grn.GrnID)
	if err != nil {
		return domain.PostResult{}, err
	}
	if inv == nil {
		vendorID, supplierID := grn.VendorID, grn.SupplierID
		if vendorID == nil && supplierID == nil {
			return domain.PostResult{}, httpx.BadRequest("GRN/PO tidak punya vendor atau supplier")
		}
		if vendorID != nil && supplierID != nil {
			supplierID = nil
		}
		err = database.WithTx(ctx, db, func(tx pgx.Tx) error {
			invoiceNo, err := s.nextDailyNo(ctx, tx, "ap_invoices", "invoice_no", "AP", false)
			if err != nil {
				return err
			}
			inv, err = one[grnInvoice](ctx, tx, `
INSERT INTO accounting.ap_invoices (
  company_id, invoice_no, invoice_date, due_date, vendor_id, supplier_id, purchase_order_id, grn_id, currency,
  subtotal, tax_amount, total_amount, status, description, posted_at, posted_by, created_by, updated_by)
VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,$8,'IDR',$9,$10,$11,'POSTED',$12,$13,$14,$14,$14)
RETURNING id::text, invoice_no, invoice_date::text, subtotal::text, tax_amount::text, total_amount::text`,
				grn.CompanyID, invoiceNo, grn.EntryDate, grn.DueDate, vendorID, supplierID, grn.PurchaseOrderID, grn.GrnID,
				domain.Round2(amounts["SUBTOTAL"]), domain.Round2(amounts["TAX"]), domain.Round2(amounts["TOTAL"]),
				"AP dari GRN "+grn.GrnNumber, s.now(), userID)
			return err
		})
		if err != nil {
			if !uniqueRace.MatchString(errMessage(err)) {
				return domain.PostResult{}, err
			}
			if inv, err = one[grnInvoice](ctx, db, `
SELECT id::text, invoice_no, invoice_date::text, subtotal::text, tax_amount::text, total_amount::text
  FROM accounting.ap_invoices WHERE grn_id = $1 AND deleted_at IS NULL LIMIT 1`, grn.GrnID); err != nil || inv == nil {
				return domain.PostResult{}, err
			}
		}
	}
	apAmounts := domain.Amounts{"SUBTOTAL": domain.ToNumber(inv.Subtotal), "TAX": domain.ToNumber(inv.Tax), "TOTAL": domain.ToNumber(inv.Total)}
	if !(apAmounts["TOTAL"] > 0) {
		return domain.PostResult{Status: domain.PostSkipped, Reason: "Nilai AP invoice 0"}, nil
	}
	return PostFromMapping(ctx, db, MappingPost{CompanyID: grn.CompanyID, UserID: userID, EventCode: "PURCHASE_AP_INVOICE",
		DocumentType: "ap_invoice", DocumentID: inv.ID, EntryDate: inv.InvoiceDate, Amounts: apAmounts, SourceModule: "PURCHASING",
		Description: "GRN " + grn.GrnNumber + " / " + inv.InvoiceNo + " — pengakuan hutang vendor (AP)"})
}

// PostPurchaseReturn is postReturnAccountingJournal.
func (s *Service) PostPurchaseReturn(ctx context.Context, db database.DB, in procurement.PurchaseReturnApproved) (domain.PostResult, error) {
	amounts := domain.ReturnAmounts(in.TotalAmount)
	if !(amounts["TOTAL"] > 0) {
		return domain.PostResult{Status: domain.PostSkipped, Reason: "Nilai retur 0"}, nil
	}
	return PostFromMapping(ctx, db, MappingPost{CompanyID: in.CompanyID, UserID: in.UserID, EventCode: "PURCHASE_RETURN",
		DocumentType: "purchase_return", DocumentID: in.ReturnID, EntryDate: in.ReturnDate, Amounts: amounts,
		Description: "Retur pembelian " + in.ReturnNumber, SourceModule: "PURCHASING"})
}

/* ── Inventory ───────────────────────────────────────────────────────── */

var coaCodeNoise = regexp.MustCompile(`[\s\-_.]`)
var sevenDigits = regexp.MustCompile(`^\d{7}$`)

// coaByCode is resolveCoaIdByCode: a postable account by compact code, the
// company's before the global one.
func coaByCode(ctx context.Context, q database.Querier, companyID *string, code string) (string, error) {
	compact := coaCodeNoise.ReplaceAllString(code, "")
	if !sevenDigits.MatchString(compact) {
		return "", nil
	}
	id, _, err := scalar[string](ctx, q, `
SELECT id::text FROM accounting.chart_of_accounts
 WHERE deleted_at IS NULL AND is_active = true AND is_postable = true AND code = $1
   AND (($2::uuid IS NOT NULL AND company_id = $2::uuid) OR company_id IS NULL)
 ORDER BY CASE WHEN company_id IS NULL THEN 1 ELSE 0 END ASC
 LIMIT 1`, compact, companyID)
	return id, err
}

// mappingAccount is resolveMappingAccount: the account of a mapping role.
func mappingAccount(ctx context.Context, q database.Querier, eventCode string, companyID *string, role string) (string, error) {
	id, _, err := scalar[*string](ctx, q, `
SELECT l.account_id::text
  FROM accounting.journal_mappings m
  JOIN accounting.journal_mapping_lines l ON l.mapping_id = m.id
 WHERE m.deleted_at IS NULL AND m.is_active = true AND m.event_code = $1 AND l.line_role = $2
   AND (($3::uuid IS NOT NULL AND m.company_id = $3::uuid) OR m.company_id IS NULL)
 ORDER BY CASE WHEN m.company_id IS NULL THEN 1 ELSE 0 END ASC, l.sort_order ASC
 LIMIT 1`, eventCode, role, companyID)
	if err != nil || id == nil {
		return "", err
	}
	return *id, nil
}

func inventoryAccount(ctx context.Context, q database.Querier, companyID *string, eventCode string, coaAsset *string) (string, error) {
	if coaAsset != nil && *coaAsset != "" {
		id, err := coaByCode(ctx, q, companyID, *coaAsset)
		if err != nil || id != "" {
			return id, err
		}
	}
	return mappingAccount(ctx, q, eventCode, companyID, "INVENTORY")
}

type variancePost struct {
	companyID                                     *string
	userID, eventCode, docType, docID, date, desc string
	lines                                         []domain.VarianceLine
	shortage                                      bool
}

type bucket struct {
	account string
	amount  float64
	labels  []string
}

// postVariance is postVarianceJournal: COGS against the inventory account
// of each material (its coa_asset, else the mapping's INVENTORY role).
func (s *Service) postVariance(ctx context.Context, db database.DB, v variancePost) (domain.PostResult, error) {
	valued, total := domain.ValueVariances(v.lines, v.shortage)
	if !(total > 0) {
		return domain.PostResult{Status: domain.PostSkipped, Reason: "Nilai selisih 0 — tidak ada jurnal"}, nil
	}
	existing, err := findEntryBySource(ctx, db, v.companyID, v.eventCode, v.docID)
	if err != nil {
		return domain.PostResult{}, err
	}
	if existing != nil {
		return existingResult(existing), nil
	}
	ids := make([]string, len(valued))
	for i, l := range valued {
		ids[i] = l.RawMaterialID
	}
	materials, err := s.ports.Materials.Materials(ctx, db, ids)
	if err != nil {
		return domain.PostResult{}, err
	}
	companyID := v.companyID
	if companyID == nil {
		for _, id := range ids {
			if m, ok := materials[id]; ok && m.CompanyID != nil {
				companyID = m.CompanyID
				break
			}
		}
	}
	offset, err := mappingAccount(ctx, db, v.eventCode, companyID, "COGS")
	if err != nil {
		return domain.PostResult{}, err
	}
	if offset == "" {
		return PostFromMapping(ctx, db, MappingPost{CompanyID: companyID, UserID: v.userID, EventCode: v.eventCode,
			DocumentType: v.docType, DocumentID: v.docID, EntryDate: v.date, Amounts: domain.Amounts{"TOTAL": total},
			Description: v.desc, SourceModule: "INVENTORY"})
	}
	var buckets []*bucket
	byAccount := map[string]*bucket{}
	for _, l := range valued {
		m, hasMat := materials[l.RawMaterialID]
		account, err := inventoryAccount(ctx, db, companyID, v.eventCode, m.CoaAsset)
		if err != nil {
			return domain.PostResult{}, err
		}
		if account == "" {
			name := l.RawMaterialID
			if hasMat && m.Nama != "" {
				name = m.Nama
			}
			return domain.PostResult{Status: domain.PostDraft, Reason: "Akun inventori belum tersedia untuk " + name}, nil
		}
		b := byAccount[account]
		if b == nil {
			b = &bucket{account: account}
			byAccount[account] = b
			buckets = append(buckets, b)
		}
		b.amount = domain.Round2(b.amount + l.Value)
		if hasMat && m.Nama != "" {
			b.labels = append(b.labels, m.Nama)
		}
	}
	memoFor := func(b *bucket) *string {
		if len(b.labels) == 0 {
			return &v.desc
		}
		labels := b.labels
		if len(labels) > 3 {
			labels = labels[:3]
		}
		return strp(v.desc + " (" + strings.Join(labels, ", ") + ")")
	}
	var lines []domain.Line
	sort := 10
	add := func(account, side string, amount float64, memo *string) {
		order := sort
		lines = append(lines, domain.Line{AccountID: account, Side: side, Amount: amount, Memo: memo, SortOrder: &order})
		sort += 10
	}
	if v.shortage {
		add(offset, domain.Debit, total, &v.desc)
		for _, b := range buckets {
			add(b.account, domain.Credit, b.amount, memoFor(b))
		}
	} else {
		for _, b := range buckets {
			add(b.account, domain.Debit, b.amount, memoFor(b))
		}
		add(offset, domain.Credit, total, &v.desc)
	}
	return postAuto(ctx, db, companyID, v.userID, v.eventCode, v.docType, v.docID, v.date, v.desc, "INVENTORY", lines)
}

func varianceLines(in []inventory.VarianceLine) []domain.VarianceLine {
	out := make([]domain.VarianceLine, len(in))
	for i, l := range in {
		out[i] = domain.VarianceLine{RawMaterialID: l.RawMaterialID, QtyDiff: l.QtyDiff, UnitCost: l.UnitCost}
	}
	return out
}

// PostStockOpname is postStockOpnameAccounting: shortage then surplus.
func (s *Service) PostStockOpname(ctx context.Context, db database.DB, in inventory.StockOpnameCompleted) ([]domain.PostResult, error) {
	lines := varianceLines(in.Lines)
	var results []domain.PostResult
	for _, dir := range []struct {
		event, label string
		shortage     bool
	}{{"STOCK_OPNAME_SHORTAGE", "shortage", true}, {"STOCK_OPNAME_SURPLUS", "surplus", false}} {
		r, err := s.postVariance(ctx, db, variancePost{companyID: in.CompanyID, userID: in.UserID, eventCode: dir.event,
			docType: "stock_opname", docID: in.OpnameID, date: in.OpnameDate,
			desc: "Stock opname " + in.OpnameNumber + " — " + dir.label, lines: lines, shortage: dir.shortage})
		if err != nil {
			return nil, err
		}
		results = append(results, r)
	}
	return results, nil
}

// PostStockAdjustment is postStockAdjustmentAccounting.
func (s *Service) PostStockAdjustment(ctx context.Context, db database.DB, in inventory.StockAdjusted) (domain.PostResult, error) {
	if in.QtyDiff == 0 {
		return domain.PostResult{Status: domain.PostSkipped, Reason: "Tidak ada selisih qty"}, nil
	}
	shortage := in.QtyDiff < 0
	direction, event := "surplus", "STOCK_ADJUSTMENT_SURPLUS"
	if shortage {
		direction, event = "shortage", "STOCK_ADJUSTMENT_SHORTAGE"
	}
	desc := ""
	if in.Notes != nil {
		desc = jsTrim(*in.Notes)
	}
	if desc == "" {
		sign := ""
		if in.QtyDiff > 0 {
			sign = "+"
		}
		desc = "Stock adjustment " + direction + " (" + sign + domain.FormatNumber(in.QtyDiff) + ")"
	}
	return s.postVariance(ctx, db, variancePost{companyID: in.CompanyID, userID: in.UserID, eventCode: event,
		docType: "stock_adjustment", docID: in.DocumentID, date: in.EntryDate, desc: desc, shortage: shortage,
		lines: []domain.VarianceLine{{RawMaterialID: in.RawMaterialID, QtyDiff: in.QtyDiff, UnitCost: in.UnitCost}}})
}

// PostStockTransfer is postStockTransferAccounting: a debit and credit of
// the same inventory account, an audit trail of the moved value.
func (s *Service) PostStockTransfer(ctx context.Context, db database.DB, in inventory.StockTransferred) (domain.PostResult, error) {
	amount := domain.Round2(float64(math.Abs(in.Qty) * in.UnitCost))
	if !(amount > 0) {
		return domain.PostResult{Status: domain.PostSkipped, Reason: "Nilai transfer 0"}, nil
	}
	materials, err := s.ports.Materials.Materials(ctx, db, []string{in.RawMaterialID})
	if err != nil {
		return domain.PostResult{}, err
	}
	m, hasMat := materials[in.RawMaterialID]
	companyID := in.CompanyID
	if companyID == nil && hasMat {
		companyID = m.CompanyID
	}
	account, err := inventoryAccount(ctx, db, companyID, "STOCK_TRANSFER", m.CoaAsset)
	if err != nil {
		return domain.PostResult{}, err
	}
	if account == "" {
		return PostFromMapping(ctx, db, MappingPost{CompanyID: companyID, UserID: in.UserID, EventCode: "STOCK_TRANSFER",
			DocumentType: "stock_transfer", DocumentID: in.TransferID, EntryDate: in.EntryDate,
			Amounts: domain.Amounts{"TOTAL": amount}, Description: "Transfer " + in.TransferNumber, SourceModule: "INVENTORY"})
	}
	existing, err := findEntryBySource(ctx, db, companyID, "STOCK_TRANSFER", in.TransferID)
	if err != nil {
		return domain.PostResult{}, err
	}
	if existing != nil {
		return existingResult(existing), nil
	}
	from, to := in.SourceWarehouseName, in.DestWarehouseName
	if from == "" {
		from = "sumber"
	}
	if to == "" {
		to = "tujuan"
	}
	desc := "Transfer " + in.TransferNumber + ": " + from + " → " + to
	if hasMat && m.Nama != "" {
		desc += " (" + m.Nama + ")"
	}
	ten, twenty := 10, 20
	module, event, docType := "INVENTORY", "STOCK_TRANSFER", "stock_transfer"
	entry, err := createEntry(ctx, db, NewEntry{UserID: in.UserID, CompanyID: companyID, EntryDate: in.EntryDate, Description: &desc,
		Post: true, EntryType: domain.EntryAuto, SourceModule: &module, SourceEventCode: &event, SourceDocumentType: &docType,
		SourceDocumentID: &in.TransferID,
		Lines: []domain.Line{
			{AccountID: account, Side: domain.Debit, Amount: amount, Memo: strp(desc + " — in"), SortOrder: &ten},
			{AccountID: account, Side: domain.Credit, Amount: amount, Memo: strp(desc + " — out"), SortOrder: &twenty},
		}})
	if err != nil {
		return domain.PostResult{}, &PostError{Message: "Gagal posting jurnal STOCK_TRANSFER: " + errMessage(err)}
	}
	return domain.PostResult{Status: domain.PostPosted, EntryID: entry.ID}, nil
}
