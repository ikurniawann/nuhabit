package accounting

import (
	"net/http"
	"strings"

	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
)

// Handler is the HTTP transport of /api/accounting/** and /api/finance/**.
type Handler struct {
	svc  *Service
	auth *auth.Service
}

type staffFunc func(w http.ResponseWriter, r *http.Request, u *auth.User) error

// staff is requireIamMenuPrefix(IAM.accounting) inside apiHandler.
func (h *Handler) staff(fn staffFunc) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		u, err := h.auth.RequireMenuPrefix(r, iam.Accounting...)
		if err != nil {
			return err
		}
		return fn(w, r, u)
	})
}

func (h *Handler) scope(r *http.Request, u *auth.User) (domain.Scope, error) {
	return h.svc.Scope(r.Context(), u.ID)
}

// company is requireAccountingCompanyId(await getApiUserScope(), msg).
func (h *Handler) company(r *http.Request, u *auth.User, msg string) (string, domain.Scope, error) {
	sc, err := h.scope(r, u)
	if err != nil {
		return "", sc, err
	}
	id, err := sc.RequireCompany(msg)
	return id, sc, rejection(err)
}

func badRequest(msg string) error { return httpx.BadRequest(msg) }

// query is sp.get(key)?.trim() || "" (absent and blank read the same).
func query(r *http.Request, key string) string { return jsTrim(r.URL.Query().Get(key)) }

// raw is sp.get(key) || "".
func raw(r *http.Request, key string) string { return r.URL.Query().Get(key) }

// numberParam is Number(sp.get(key) || def).
func numberParam(r *http.Request, key string, def float64) float64 {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def
	}
	return domain.ParseNumber(v)
}

func nonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

/* ── Response envelopes (key order as the TS writes them) ────────────── */

type dataBody struct {
	Data any `json:"data"`
}

type dataMessage struct {
	Data    any    `json:"data"`
	Message string `json:"message"`
}

type messageBody struct {
	Message string `json:"message"`
}

type successMeta struct {
	Success bool `json:"success"`
	Data    any  `json:"data"`
	Meta    struct {
		Total int `json:"total"`
	} `json:"meta"`
}

func withMeta(data any, total int) successMeta {
	b := successMeta{Success: true, Data: data}
	b.Meta.Total = total
	return b
}

type successInvoice struct {
	Success bool   `json:"success"`
	Data    any    `json:"data"`
	Invoice any    `json:"invoice"`
	Message string `json:"message"`
}

func noteMessage(base, note string) string {
	if note == "" {
		return base
	}
	return base + " (" + note + ")"
}

const (
	apiAccounting = "/api/accounting"
	apiFinance    = "/api/finance"
)

// Routes lists every ported route. POST /api/accounting/chart-of-accounts/import
// (xlsx) and /api/finance/invoices/{id}/faktur-pajak (local file storage)
// stay in TS.
func (h *Handler) Routes() []module.Route {
	a := func(method, path string, fn staffFunc) module.Route {
		return module.Route{Pattern: method + " " + apiAccounting + path, Handler: h.staff(fn)}
	}
	return []module.Route{
		a("GET", "/account-types", h.listAccountTypes),
		a("POST", "/account-types", h.createAccountType),
		a("PUT", "/account-types/{id}", h.updateAccountType),
		a("DELETE", "/account-types/{id}", h.deleteAccountType),

		a("GET", "/chart-of-accounts", h.listAccounts),
		a("POST", "/chart-of-accounts", h.createAccount),
		a("PUT", "/chart-of-accounts/{id}", h.updateAccount),
		a("DELETE", "/chart-of-accounts/{id}", h.deleteAccount),

		a("GET", "/journal-mappings", h.listMappings),
		a("POST", "/journal-mappings", h.createMapping),
		a("GET", "/journal-mappings/{id}", h.getMapping),
		a("PUT", "/journal-mappings/{id}", h.updateMapping),
		a("DELETE", "/journal-mappings/{id}", h.deleteMapping),

		a("GET", "/fiscal-years", h.listFiscalYears),
		a("POST", "/fiscal-years", h.createFiscalYear),
		a("GET", "/fiscal-years/{id}", h.getFiscalYear),
		a("PUT", "/fiscal-years/{id}", h.updateFiscalYear),
		a("DELETE", "/fiscal-years/{id}", h.deleteFiscalYear),
		a("GET", "/fiscal-years/{id}/beginning-balance", h.getOpening),
		a("POST", "/fiscal-years/{id}/beginning-balance", h.saveOpening),

		a("GET", "/fiscal-periods", h.listPeriods),
		a("POST", "/fiscal-periods/{id}/open", h.openPeriod),
		a("GET", "/fiscal-periods/{id}/close", h.closePreview),
		a("POST", "/fiscal-periods/{id}/close", h.closePeriod),

		a("GET", "/journal-entries", h.listEntries),
		a("POST", "/journal-entries", h.createEntry),
		a("GET", "/journal-entries/{id}", h.getEntry),
		a("PUT", "/journal-entries/{id}", h.updateEntry),
		a("DELETE", "/journal-entries/{id}", h.deleteEntry),
		a("POST", "/journal-entries/{id}/post", h.postEntry),

		a("GET", "/cash-bank", h.cashBankAccounts),
		a("GET", "/cash-bank/accounts-options", h.accountOptions),
		a("GET", "/cash-bank/{accountId}/ledger", h.cashBankLedger),
		a("GET", "/cash-bank/cash-in", h.listCash("cash_in")),
		a("POST", "/cash-bank/cash-in", h.createCash("cash_in")),
		a("GET", "/cash-bank/cash-out", h.listCash("cash_out")),
		a("POST", "/cash-bank/cash-out", h.createCash("cash_out")),
		a("GET", "/cash-bank/transfer", h.listTransfers),
		a("POST", "/cash-bank/transfer", h.createTransfer),

		a("GET", "/reports/{report}", h.report),
		a("GET", "/dashboard", h.dashboard),
		a("GET", "/ledger/subsidiary", h.subsidiary),

		a("GET", "/ap/invoices", h.listApInvoices),
		a("GET", "/ap/invoices/{id}", h.getApInvoice),
		a("GET", "/ap/payable", h.apPayable),
		a("GET", "/ap/aging", h.apAging),
		a("GET", "/ap/payments", h.listApPayments),
		a("POST", "/ap/payments", h.recordApPayment),
		a("POST", "/ap/payments/{id}/void", h.voidApPayment),

		a("GET", "/ar/invoices", h.listArInvoices),
		a("GET", "/ar/receivable", h.arReceivable),
		a("GET", "/ar/aging", h.arAging),
		a("GET", "/ar/by-sales-invoice/{salesInvoiceId}", h.arBySalesInvoice),
		a("GET", "/ar/receipts", h.listArReceipts),
		a("POST", "/ar/receipts", h.recordArReceipt),

		{Pattern: "GET " + apiFinance + "/invoices", Handler: h.finance(h.listFinanceInvoices)},
		{Pattern: "GET " + apiFinance + "/invoices/{id}", Handler: h.finance(h.getFinanceInvoice)},
		{Pattern: "PATCH " + apiFinance + "/invoices/{id}", Handler: h.finance(h.reviseFinanceInvoice)},
		{Pattern: "GET " + apiFinance + "/invoices/{id}/payments", Handler: h.finance(h.listInvoicePayments)},
		{Pattern: "POST " + apiFinance + "/invoices/{id}/payments", Handler: h.finance(h.receivePaymentGone)},
		{Pattern: "DELETE " + apiFinance + "/payments/{paymentId}", Handler: h.finance(h.deleteDealPayment)},
	}
}

// requestMeta is lib/audit requestMeta: the first x-forwarded-for hop, else
// x-real-ip, and the user agent.
func requestMeta(r *http.Request) (ip, ua *string) {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		if first := jsTrim(strings.Split(fwd, ",")[0]); first != "" {
			ip = &first
		}
	}
	if ip == nil {
		if real := r.Header.Get("X-Real-Ip"); real != "" {
			ip = &real
		}
	}
	if agent := r.Header.Get("User-Agent"); agent != "" {
		ua = &agent
	}
	return ip, ua
}
