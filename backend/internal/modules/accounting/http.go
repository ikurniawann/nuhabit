package accounting

import (
	"net/http"
	"slices"
	"strings"

	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	pscope "nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/storage"
)

// Handler is the HTTP transport of /api/accounting/** and /api/finance/**.
type Handler struct {
	svc   *Service
	auth  *auth.Service
	files *storage.Store
}

type staffFunc func(w http.ResponseWriter, r *http.Request, u *auth.User) error

// staff passes callers granted a menu under menus: the accounting
// sub-modules whose pages call the route.
func (h *Handler) staff(menus []string, fn staffFunc) http.Handler {
	return h.staffBy(func(*http.Request) []string { return menus }, fn)
}

// staffBy picks the menus from the request, for a route shared by pages of
// different sub-modules (GET /reports/{report}).
func (h *Handler) staffBy(menus func(*http.Request) []string, fn staffFunc) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		u, err := h.auth.RequireMenuPrefix(r, menus(r)...)
		if err != nil {
			return err
		}
		return fn(w, r, u)
	})
}

func (h *Handler) scope(r *http.Request, u *auth.User) (*pscope.Scope, error) {
	return h.svc.Scope(r.Context(), u.ID)
}

// company is requireAccountingCompanyId(await getApiUserScope(), msg).
func (h *Handler) company(r *http.Request, u *auth.User, msg string) (string, *pscope.Scope, error) {
	sc, err := h.scope(r, u)
	if err != nil {
		return "", sc, err
	}
	id, err := domain.RequireCompany(sc, msg)
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

// Sub-module menus of the routes. A route allows every sub-module whose
// dashboard page calls it, counting pages a parent href covers (Payable
// covers /accounts-payable/**, Receivable /receivable/**, Cash & Bank
// Accounts /cash-bank/**, Overview /reports/**, Fiscal Years
// /fiscal-years/beginning-balance/{id}).
var (
	coaReaders = slices.Concat(iam.AccountingCoa, iam.AccountingJournalMappings, iam.AccountingJournalEntries,
		iam.AccountingJournalHistory, iam.AccountingBeginningBalance, iam.AccountingFiscalYears, iam.AccountingCoaItemReaders)
	fiscalYearReaders = slices.Concat(iam.AccountingFiscalYears, iam.AccountingPeriods, iam.AccountingBeginningBalance,
		iam.AccountingJournalEntries)
	openingBalance = slices.Concat(iam.AccountingBeginningBalance, iam.AccountingFiscalYears)

	// reportMenus maps GET /reports/{report} to its page; the Overview href
	// covers every /reports/** page.
	reportMenus = map[string][]string{
		"trial-balance":    slices.Concat(iam.AccountingTrialBalance, iam.AccountingOverview),
		"balance-sheet":    slices.Concat(iam.AccountingBalanceSheet, iam.AccountingOverview),
		"income-statement": slices.Concat(iam.AccountingIncomeStatement, iam.AccountingOverview),
		"cash-flow":        slices.Concat(iam.AccountingCashFlow, iam.AccountingOverview),
		"general-ledger":   slices.Concat(iam.AccountingGeneralLedger, iam.AccountingOverview),
	}

	// B2B invoices live under Receivable; sales-funnel pages link the faktur.
	financeMenus       = slices.Concat(iam.AccountingArInvoicesB2b, iam.AccountingAr)
	financeViewerMenus = slices.Concat(financeMenus, iam.SalesFunnel)
)

// withParent adds the sub-module whose href covers the pages of groups.
func withParent(parent []string, groups ...[]string) []string {
	return slices.Concat(append(groups, parent)...)
}

func reportMenusFor(r *http.Request) []string {
	if menus, ok := reportMenus[r.PathValue("report")]; ok {
		return menus
	}
	return iam.AccountingOverview
}

// Routes lists every route of /api/accounting and /api/finance.
func (h *Handler) Routes() []module.Route {
	a := func(method, path string, menus []string, fn staffFunc) module.Route {
		return module.Route{Pattern: method + " " + apiAccounting + path, Handler: h.staff(menus, fn)}
	}
	types, coa, mappings := iam.AccountingAccountTypes, iam.AccountingCoa, iam.AccountingJournalMappings
	years, periods, closing := iam.AccountingFiscalYears, iam.AccountingPeriods, iam.AccountingClosing
	entries := iam.AccountingJournalEntries
	cash := func(groups ...[]string) []string { return withParent(iam.AccountingCashBank, groups...) }
	ap := func(groups ...[]string) []string { return withParent(iam.AccountingAp, groups...) }
	ar := func(groups ...[]string) []string { return withParent(iam.AccountingAr, groups...) }
	return []module.Route{
		a("GET", "/account-types", slices.Concat(types, coa), h.listAccountTypes),
		a("POST", "/account-types", types, h.createAccountType),
		a("PUT", "/account-types/{id}", types, h.updateAccountType),
		a("DELETE", "/account-types/{id}", types, h.deleteAccountType),

		a("GET", "/chart-of-accounts", coaReaders, h.listAccounts),
		a("POST", "/chart-of-accounts", coa, h.createAccount),
		a("PUT", "/chart-of-accounts/{id}", coa, h.updateAccount),
		a("DELETE", "/chart-of-accounts/{id}", coa, h.deleteAccount),
		a("POST", "/chart-of-accounts/import", coa, h.importAccounts),

		a("GET", "/journal-mappings", mappings, h.listMappings),
		a("POST", "/journal-mappings", mappings, h.createMapping),
		a("GET", "/journal-mappings/{id}", mappings, h.getMapping),
		a("PUT", "/journal-mappings/{id}", mappings, h.updateMapping),
		a("DELETE", "/journal-mappings/{id}", mappings, h.deleteMapping),

		a("GET", "/fiscal-years", fiscalYearReaders, h.listFiscalYears),
		a("POST", "/fiscal-years", years, h.createFiscalYear),
		a("GET", "/fiscal-years/{id}", years, h.getFiscalYear),
		a("PUT", "/fiscal-years/{id}", years, h.updateFiscalYear),
		a("DELETE", "/fiscal-years/{id}", years, h.deleteFiscalYear),
		a("GET", "/fiscal-years/{id}/beginning-balance", openingBalance, h.getOpening),
		a("POST", "/fiscal-years/{id}/beginning-balance", openingBalance, h.saveOpening),

		a("GET", "/fiscal-periods", slices.Concat(periods, closing), h.listPeriods),
		// The journal entry form opens a closed period from its coverage banner.
		a("POST", "/fiscal-periods/{id}/open", slices.Concat(periods, entries), h.openPeriod),
		a("GET", "/fiscal-periods/{id}/close", closing, h.closePreview),
		a("POST", "/fiscal-periods/{id}/close", closing, h.closePeriod),

		a("GET", "/journal-entries", slices.Concat(entries, iam.AccountingJournalHistory), h.listEntries),
		a("POST", "/journal-entries", entries, h.createEntry),
		a("GET", "/journal-entries/{id}", entries, h.getEntry),
		a("PUT", "/journal-entries/{id}", entries, h.updateEntry),
		a("DELETE", "/journal-entries/{id}", entries, h.deleteEntry),
		a("POST", "/journal-entries/{id}/post", entries, h.postEntry),

		a("GET", "/cash-bank", cash(iam.AccountingCashTransfer), h.cashBankAccounts),
		a("GET", "/cash-bank/accounts-options", cash(iam.AccountingCashIn, iam.AccountingCashOut), h.accountOptions),
		a("GET", "/cash-bank/{accountId}/ledger", cash(), h.cashBankLedger),
		a("GET", "/cash-bank/cash-in", cash(iam.AccountingCashIn), h.listCash("cash_in")),
		a("POST", "/cash-bank/cash-in", cash(iam.AccountingCashIn), h.createCash("cash_in")),
		a("GET", "/cash-bank/cash-out", cash(iam.AccountingCashOut), h.listCash("cash_out")),
		a("POST", "/cash-bank/cash-out", cash(iam.AccountingCashOut), h.createCash("cash_out")),
		a("GET", "/cash-bank/transfer", cash(iam.AccountingCashTransfer), h.listTransfers),
		a("POST", "/cash-bank/transfer", cash(iam.AccountingCashTransfer), h.createTransfer),

		{Pattern: "GET " + apiAccounting + "/reports/{report}", Handler: h.staffBy(reportMenusFor, h.report)},
		a("GET", "/dashboard", iam.AccountingOverview, h.dashboard),
		a("GET", "/ledger/subsidiary", iam.AccountingSubsidiary, h.subsidiary),

		a("GET", "/ap/invoices", ap(iam.AccountingApInvoices, iam.AccountingApPayments), h.listApInvoices),
		a("GET", "/ap/invoices/{id}", ap(iam.AccountingApInvoices), h.getApInvoice),
		a("GET", "/ap/payable", ap(), h.apPayable),
		a("GET", "/ap/aging", ap(iam.AccountingApAging), h.apAging),
		a("GET", "/ap/payments", ap(iam.AccountingApPayments), h.listApPayments),
		// The PO detail opened from an AP invoice records the payment too.
		a("POST", "/ap/payments", ap(iam.AccountingApPayments, iam.AccountingApInvoices), h.recordApPayment),
		a("POST", "/ap/payments/{id}/void", ap(iam.AccountingApPayments), h.voidApPayment),

		a("GET", "/ar/invoices", ar(iam.AccountingArInvoices, iam.AccountingArReceipts), h.listArInvoices),
		a("GET", "/ar/receivable", ar(), h.arReceivable),
		a("GET", "/ar/aging", ar(iam.AccountingArAging), h.arAging),
		a("GET", "/ar/by-sales-invoice/{salesInvoiceId}", ar(iam.AccountingArReceipts), h.arBySalesInvoice),
		a("GET", "/ar/receipts", ar(iam.AccountingArReceipts), h.listArReceipts),
		a("POST", "/ar/receipts", ar(iam.AccountingArReceipts), h.recordArReceipt),

		{Pattern: "GET " + apiFinance + "/invoices", Handler: h.finance(h.listFinanceInvoices)},
		{Pattern: "GET " + apiFinance + "/invoices/{id}", Handler: h.finance(h.getFinanceInvoice)},
		{Pattern: "PATCH " + apiFinance + "/invoices/{id}", Handler: h.finance(h.reviseFinanceInvoice)},
		{Pattern: "GET " + apiFinance + "/invoices/{id}/payments", Handler: h.finance(h.listInvoicePayments)},
		{Pattern: "POST " + apiFinance + "/invoices/{id}/payments", Handler: h.finance(h.receivePaymentGone)},
		{Pattern: "DELETE " + apiFinance + "/payments/{paymentId}", Handler: h.finance(h.deleteDealPayment)},
		{Pattern: "GET " + apiFinance + "/invoices/{id}/faktur-pajak", Handler: h.financeViewer(h.downloadFakturPajak)},
		{Pattern: "POST " + apiFinance + "/invoices/{id}/faktur-pajak", Handler: h.finance(h.uploadFakturPajak)},
		{Pattern: "DELETE " + apiFinance + "/invoices/{id}/faktur-pajak", Handler: h.finance(h.deleteFakturPajak)},
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
