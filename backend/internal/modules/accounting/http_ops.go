package accounting

import (
	"net/http"
	"strings"

	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
)

/* ── Cash & bank ─────────────────────────────────────────────────────── */

func (h *Handler) cashBankAccounts(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	sc, err := h.scope(r, u)
	if err != nil {
		return err
	}
	if sc.CompanyID == nil {
		return httpx.JSON(w, 200, dataBody{[]any{}})
	}
	rows, err := h.svc.ListCashBankAccounts(r.Context(), *sc.CompanyID)
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, dataBody{rows})
}

func (h *Handler) accountOptions(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	companyID, _, err := h.company(r, u, "")
	if err != nil {
		return err
	}
	rows, err := h.svc.PostableAccounts(r.Context(), companyID)
	if err != nil {
		return err
	}
	return httpx.Data(w, 200, rows)
}

func (h *Handler) cashBankLedger(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	companyID, _, err := h.company(r, u, "Akun Anda belum terikat company. Data Cash & Bank hanya untuk company user yang login.")
	if err != nil {
		return err
	}
	data, err := h.svc.CashBankLedger(r.Context(), companyID, r.PathValue("accountId"), nonEmpty(query(r, "date_from")), nonEmpty(query(r, "date_to")))
	if err != nil {
		return err
	}
	if data == nil {
		return httpx.NotFound("Akun kas/bank tidak ditemukan")
	}
	return httpx.JSON(w, 200, dataBody{data})
}

func cashFilter(r *http.Request, companyID, kind string) CashListFilter {
	return CashListFilter{CompanyID: companyID, Kind: kind, Search: raw(r, "search"), DateFrom: raw(r, "date_from"), DateTo: raw(r, "date_to"),
		Limit:  formatPage(numberParam(r, "limit", 50), 1, 100),
		Offset: formatPage(numberParam(r, "offset", 0), 0, 0)}
}

func (h *Handler) listCash(kind string) staffFunc {
	return func(w http.ResponseWriter, r *http.Request, u *auth.User) error {
		companyID, _, err := h.company(r, u, "")
		if err != nil {
			return err
		}
		rows, total, err := h.svc.ListCashMovements(r.Context(), cashFilter(r, companyID, kind))
		if err != nil {
			return err
		}
		return httpx.JSON(w, 200, withMeta(rows, total))
	}
}

func (h *Handler) createCash(kind string) staffFunc {
	label := "Cash Out"
	if kind == "cash_in" {
		label = "Cash In"
	}
	return func(w http.ResponseWriter, r *http.Request, u *auth.User) error {
		companyID, _, err := h.company(r, u, "")
		if err != nil {
			return err
		}
		body, err := parseCash(r, "cash_account_id", "offset_account_id")
		if err != nil {
			return err
		}
		data, err := h.svc.CreateCashMovement(r.Context(), CashMovementInput{UserID: u.ID, CompanyID: companyID, Kind: kind,
			EntryDate: body.EntryDate, Amount: body.Amount, CashAccountID: body.FromID, OffsetAccountID: body.ToID,
			Description: body.Description, Memo: body.Memo})
		if err != nil {
			return err
		}
		return httpx.DataMessage(w, 201, data, label+" berhasil dicatat & diposting")
	}
}

func (h *Handler) listTransfers(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	companyID, _, err := h.company(r, u, "")
	if err != nil {
		return err
	}
	rows, total, err := h.svc.ListCashTransfers(r.Context(), cashFilter(r, companyID, ""))
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, withMeta(rows, total))
}

func (h *Handler) createTransfer(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	companyID, _, err := h.company(r, u, "")
	if err != nil {
		return err
	}
	body, err := parseCash(r, "from_account_id", "to_account_id")
	if err != nil {
		return err
	}
	data, err := h.svc.CreateCashTransfer(r.Context(), CashMovementInput{UserID: u.ID, CompanyID: companyID, EntryDate: body.EntryDate,
		Amount: body.Amount, CashAccountID: body.FromID, OffsetAccountID: body.ToID, Description: body.Description, Memo: body.Memo})
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, 201, data, "Transfer berhasil dicatat & diposting")
}

/* ── Reports, dashboard, subsidiary ledger ───────────────────────────── */

func (h *Handler) report(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	sc, err := h.scope(r, u)
	if err != nil {
		return err
	}
	if sc.CompanyID == nil {
		return httpx.JSON(w, 200, dataBody{nil})
	}
	companyID, ctx := *sc.CompanyID, r.Context()
	today := h.svc.today()
	or := func(key, def string) string {
		if v := query(r, key); v != "" {
			return v
		}
		return def
	}
	asOf, dateFrom, dateTo := or("as_of", today), or("date_from", jsSlice(today, 4)+"-01-01"), or("date_to", today)
	var data any
	switch r.PathValue("report") {
	case "trial-balance":
		data, err = h.svc.TrialBalance(ctx, companyID, asOf)
	case "balance-sheet":
		data, err = h.svc.BalanceSheet(ctx, companyID, asOf)
	case "income-statement":
		data, err = h.svc.IncomeStatement(ctx, companyID, dateFrom, dateTo)
	case "cash-flow":
		data, err = h.svc.CashFlow(ctx, companyID, dateFrom, dateTo)
	case "general-ledger":
		accountID := query(r, "account_id")
		if accountID == "" {
			data, err = h.svc.GLAccounts(ctx, companyID, asOf)
			break
		}
		ledger, gerr := h.svc.GeneralLedger(ctx, companyID, accountID, nonEmpty(query(r, "date_from")), nonEmpty(query(r, "date_to")))
		if gerr != nil {
			return gerr
		}
		if ledger == nil {
			return httpx.NotFound("Akun tidak ditemukan")
		}
		data = ledger
	default:
		return httpx.NotFound("Report tidak ditemukan")
	}
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, dataBody{data})
}

func (h *Handler) dashboard(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	sc, err := h.scope(r, u)
	if err != nil {
		return err
	}
	if sc.CompanyID == nil {
		return httpx.JSON(w, 200, dataBody{nil})
	}
	asOf := query(r, "as_of")
	if asOf == "" {
		asOf = h.svc.today()
	}
	dateFrom := query(r, "date_from")
	if dateFrom == "" {
		dateFrom = jsSlice(asOf, 4) + "-01-01"
	}
	dateTo := query(r, "date_to")
	if dateTo == "" {
		dateTo = asOf
	}
	data, err := h.svc.Dashboard(r.Context(), *sc.CompanyID, asOf, dateFrom, dateTo)
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, dataBody{data})
}

func (h *Handler) subsidiary(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	companyID, _, err := h.company(r, u, "")
	if err != nil {
		return err
	}
	kind := raw(r, "kind")
	if kind == "" {
		kind = "AP"
	}
	kind = strings.ToUpper(kind)
	if kind != "AP" && kind != "AR" {
		return httpx.BadRequest("kind harus AP atau AR")
	}
	partyKey := query(r, "party_key")
	if partyKey == "" {
		rows, err := h.svc.SubsidiaryParties(r.Context(), companyID, kind)
		if err != nil {
			return err
		}
		return httpx.Data(w, 200, rows)
	}
	today := h.svc.today()
	dateFrom, dateTo := query(r, "date_from"), query(r, "date_to")
	if dateFrom == "" {
		dateFrom = jsSlice(today, 4) + "-01-01"
	}
	if dateTo == "" {
		dateTo = today
	}
	data, err := h.svc.SubsidiaryLedgerFor(r.Context(), companyID, kind, partyKey, &dateFrom, &dateTo)
	if err != nil {
		return err
	}
	if data == nil {
		return httpx.NotFound("Party tidak ditemukan")
	}
	return httpx.Data(w, 200, data)
}

/* ── AP ──────────────────────────────────────────────────────────────── */

func invoiceFilter(r *http.Request, companyID string) InvoiceListFilter {
	return InvoiceListFilter{CompanyID: companyID, Status: raw(r, "status"), PaymentStatus: raw(r, "payment_status"),
		Search: raw(r, "search"), Limit: numberParam(r, "limit", 20), Offset: numberParam(r, "offset", 0)}
}

func (h *Handler) listApInvoices(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	companyID, _, err := h.company(r, u, "")
	if err != nil {
		return err
	}
	rows, total, err := h.svc.ListApInvoices(r.Context(), invoiceFilter(r, companyID))
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, withMeta(rows, total))
}

func (h *Handler) getApInvoice(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	row, err := h.svc.ApInvoice(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	if row == nil {
		return httpx.NotFound("AP invoice tidak ditemukan")
	}
	return httpx.Data(w, 200, row)
}

func (h *Handler) apPayable(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	companyID, _, err := h.company(r, u, "")
	if err != nil {
		return err
	}
	rows, err := h.svc.ApPayable(r.Context(), companyID)
	if err != nil {
		return err
	}
	return httpx.Data(w, 200, rows)
}

func (h *Handler) apAging(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	companyID, _, err := h.company(r, u, "")
	if err != nil {
		return err
	}
	data, err := h.svc.ApAging(r.Context(), companyID, raw(r, "as_of"))
	if err != nil {
		return err
	}
	return httpx.Data(w, 200, data)
}

func (h *Handler) listApPayments(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	companyID, _, err := h.company(r, u, "")
	if err != nil {
		return err
	}
	rows, total, err := h.svc.ListApPayments(r.Context(), companyID, raw(r, "search"), numberParam(r, "limit", 20), numberParam(r, "offset", 0))
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, withMeta(rows, total))
}

func (h *Handler) recordApPayment(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if _, _, err := h.company(r, u, ""); err != nil {
		return err
	}
	body, err := parseSettlement(r, "payment_date", apMethods)
	if err != nil {
		return err
	}
	ip, ua := requestMeta(r)
	res, err := h.svc.RecordApPayment(r.Context(), ApPaymentInput{UserID: u.ID, UserName: u.FullName, InvoiceID: body.InvoiceID,
		Amount: body.Amount, PaymentDate: body.Date, Method: body.Method, ReferenceNumber: body.ReferenceNumber, Notes: body.Notes,
		IP: ip, UserAgent: ua})
	if err != nil {
		return err
	}
	return httpx.JSON(w, 201, successInvoice{true, res.Payment, res.Invoice, noteMessage("Pembayaran AP berhasil dicatat", res.Note)})
}

func (h *Handler) voidApPayment(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if _, _, err := h.company(r, u, ""); err != nil {
		return err
	}
	reason, err := parseVoidReason(r)
	if err != nil {
		return err
	}
	ip, ua := requestMeta(r)
	data, note, err := h.svc.VoidApPayment(r.Context(), VoidInput{PaymentID: r.PathValue("id"), Reason: reason, UserID: u.ID,
		UserName: u.FullName, IP: ip, UserAgent: ua})
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, 200, data, noteMessage("Pembayaran "+data.PaymentNo+" di-void", note))
}

/* ── AR ──────────────────────────────────────────────────────────────── */

// syncedCompany is the AR list prelude: company, then the lazy B2B sync.
func (h *Handler) syncedCompany(r *http.Request, u *auth.User) (string, error) {
	companyID, _, err := h.company(r, u, "")
	if err != nil {
		return "", err
	}
	return companyID, h.svc.SyncArFromSales(r.Context(), companyID, u.ID, 30)
}

func (h *Handler) listArInvoices(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	companyID, err := h.syncedCompany(r, u)
	if err != nil {
		return err
	}
	rows, total, err := h.svc.ListArInvoices(r.Context(), invoiceFilter(r, companyID))
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, withMeta(rows, total))
}

func (h *Handler) arReceivable(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	companyID, err := h.syncedCompany(r, u)
	if err != nil {
		return err
	}
	rows, err := h.svc.ArReceivable(r.Context(), companyID)
	if err != nil {
		return err
	}
	return httpx.Data(w, 200, rows)
}

func (h *Handler) arAging(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	companyID, err := h.syncedCompany(r, u)
	if err != nil {
		return err
	}
	data, err := h.svc.ArAging(r.Context(), companyID, raw(r, "as_of"))
	if err != nil {
		return err
	}
	return httpx.Data(w, 200, data)
}

func (h *Handler) arBySalesInvoice(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id := r.PathValue("salesInvoiceId")
	row, err := h.svc.ArInvoiceBySalesInvoice(r.Context(), id)
	if err != nil {
		return err
	}
	if row == nil {
		// Created on demand; an invoice that does not qualify stays a 404.
		row, _ = h.svc.CreateArFromSalesInvoice(r.Context(), h.svc.db, id, u.ID)
	}
	if row == nil {
		return httpx.NotFound("AR invoice tidak ditemukan untuk B2B ini")
	}
	return httpx.Data(w, 200, row)
}

func (h *Handler) listArReceipts(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	companyID, _, err := h.company(r, u, "")
	if err != nil {
		return err
	}
	rows, total, err := h.svc.ListArReceipts(r.Context(), companyID, raw(r, "search"), numberParam(r, "limit", 20), numberParam(r, "offset", 0))
	if err != nil {
		return err
	}
	return httpx.JSON(w, 200, withMeta(rows, total))
}

func (h *Handler) recordArReceipt(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	if _, _, err := h.company(r, u, ""); err != nil {
		return err
	}
	body, err := parseSettlement(r, "receipt_date", arMethods)
	if err != nil {
		return err
	}
	res, err := h.svc.RecordArReceipt(r.Context(), ArReceiptInput{UserID: u.ID, InvoiceID: body.InvoiceID, Amount: body.Amount,
		ReceiptDate: body.Date, Method: body.Method, ReferenceNumber: body.ReferenceNumber, Notes: body.Notes})
	if err != nil {
		return err
	}
	return httpx.JSON(w, 201, successInvoice{true, res.Receipt, res.Invoice, noteMessage("Penerimaan AR berhasil dicatat", res.Note)})
}

/* ── Finance ─────────────────────────────────────────────────────────── */

type financeFunc func(w http.ResponseWriter, r *http.Request, u FinanceUser) error

// finance is requireFinanceUser(): a session plus an accounting menu grant.
func (h *Handler) finance(fn financeFunc) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		u, err := h.auth.RequireMenuPrefix(r, iam.Accounting...)
		if err != nil {
			return err
		}
		sc, err := h.scope(r, u)
		if err != nil {
			return err
		}
		return fn(w, r, FinanceUser{ID: u.ID, Role: u.Role, Scope: sc})
	})
}

func (h *Handler) listFinanceInvoices(w http.ResponseWriter, r *http.Request, u FinanceUser) error {
	rows, err := h.svc.ListFinanceInvoices(r.Context(), u, raw(r, "status"), query(r, "q"))
	if err != nil {
		return err
	}
	return httpx.Data(w, 200, rows)
}

func (h *Handler) getFinanceInvoice(w http.ResponseWriter, r *http.Request, u FinanceUser) error {
	data, err := h.svc.FinanceInvoiceDetail(r.Context(), r.PathValue("id"), u)
	if err != nil {
		return err
	}
	return httpx.Data(w, 200, data)
}

func (h *Handler) reviseFinanceInvoice(w http.ResponseWriter, r *http.Request, u FinanceUser) error {
	body, err := parseRevise(r)
	if err != nil {
		return err
	}
	row, err := h.svc.ReviseFinanceInvoice(r.Context(), r.PathValue("id"), u, body.Label, body.Amount, body.DueDate, body.Note)
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, 200, row, "Invoice "+row.InvoiceNumber+" direvisi")
}

func (h *Handler) listInvoicePayments(w http.ResponseWriter, r *http.Request, u FinanceUser) error {
	rows, err := h.svc.InvoicePayments(r.Context(), r.PathValue("id"), u)
	if err != nil {
		return err
	}
	return httpx.Data(w, 200, rows)
}

// receivePaymentGone is the deprecated POST: receipts moved to AR.
func (h *Handler) receivePaymentGone(w http.ResponseWriter, _ *http.Request, _ FinanceUser) error {
	return httpx.JSON(w, 410, struct {
		Success  bool   `json:"success"`
		Error    string `json:"error"`
		Redirect string `json:"redirect"`
	}{false, "Penerimaan piutang dipindah ke Accounting → Accounts Receivable → Receipt. Gunakan /dashboard/accounting/receivable/receipts",
		"/dashboard/accounting/receivable/receipts"})
}

func (h *Handler) deleteDealPayment(w http.ResponseWriter, r *http.Request, u FinanceUser) error {
	if err := h.svc.DeleteDealPayment(r.Context(), r.PathValue("paymentId"), u); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// formatPage is a JavaScript page number clamped like the stores and
// printed as node-pg sends it.
func formatPage(n, lo, hi float64) string {
	return domain.FormatNumber(domain.PageNumber(n, lo, hi))
}
