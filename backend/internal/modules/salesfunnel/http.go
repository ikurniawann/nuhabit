package salesfunnel

import (
	"net/http"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// routes lists every ported /api/sales-funnel route. Left in Next:
// POST leads/import (CSV/XLSX parsing with exceljs) and GET
// quotations/{id}/pdf, invoices/{id}/pdf (pdfkit).
func (h *handler) routes() []module.Route {
	r := func(pattern string, fn httpx.HandlerFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(fn)}
	}
	const p = "/api/sales-funnel"
	return []module.Route{
		r("GET "+p+"/leads", h.listLeads),
		r("POST "+p+"/leads", h.createLead),
		r("GET "+p+"/leads/by-phone", h.leadByPhone),
		r("GET "+p+"/leads/{id}", h.leadDetail),
		r("PATCH "+p+"/leads/{id}", h.updateLead),
		r("DELETE "+p+"/leads/{id}", h.deleteLead),
		r("POST "+p+"/leads/{id}/link-customer", h.linkLeadCustomer),
		r("DELETE "+p+"/leads/{id}/link-customer", h.unlinkLeadCustomer),

		r("GET "+p+"/deals", h.listDeals),
		r("POST "+p+"/deals", h.createDeal),
		r("PATCH "+p+"/deals/{id}", h.updateDeal),
		r("DELETE "+p+"/deals/{id}", h.deleteDeal),
		r("GET "+p+"/deals/{id}/members", h.listDealMembers),
		r("POST "+p+"/deals/{id}/members", h.addDealMember),
		r("DELETE "+p+"/deals/{id}/members", h.removeDealMember),
		r("POST "+p+"/deals/{id}/send-wa", h.sendDealWa),
		r("GET "+p+"/deals/{id}/quotations", h.listDealQuotations),
		r("POST "+p+"/deals/{id}/quotations", h.createQuotation),
		r("GET "+p+"/deals/{id}/invoices", h.dealInvoices),
		r("POST "+p+"/deals/{id}/invoices", h.createInvoice),
		r("GET "+p+"/deals/{id}/payments", h.dealPayments),
		r("POST "+p+"/deals/{id}/payments", h.createPayment),
		r("DELETE "+p+"/deals/{id}/payments/{paymentId}", h.deletePayment),

		r("PATCH "+p+"/quotations/{id}", h.updateQuotation),
		r("DELETE "+p+"/quotations/{id}", h.deleteQuotation),
		r("POST "+p+"/quotations/{id}/revise", h.reviseQuotation),
		r("POST "+p+"/quotations/{id}/realize", h.realizeQuotation),
		r("POST "+p+"/quotations/{id}/send-wa", h.sendQuotationWa),

		r("PATCH "+p+"/invoices/{id}", h.updateInvoice),
		r("DELETE "+p+"/invoices/{id}", h.deleteInvoice),

		r("GET "+p+"/activities", h.listActivities),
		r("POST "+p+"/activities", h.createActivity),
		r("PATCH "+p+"/activities/{id}", h.updateActivity),
		r("DELETE "+p+"/activities/{id}", h.deleteActivity),

		r("GET "+p+"/accounts", h.listAccounts),
		r("POST "+p+"/accounts", h.createAccount),
		r("GET "+p+"/accounts/{id}", h.accountDetail),
		r("PATCH "+p+"/accounts/{id}", h.updateAccount),
		r("DELETE "+p+"/accounts/{id}", h.deleteAccount),

		r("GET "+p+"/contacts", h.listContacts),
		r("POST "+p+"/contacts", h.createContact),
		r("GET "+p+"/contacts/{id}", h.contactDetail),
		r("PATCH "+p+"/contacts/{id}", h.updateContact),
		r("DELETE "+p+"/contacts/{id}", h.deleteContact),

		r("GET "+p+"/pipelines", h.listPipelines),
		r("POST "+p+"/pipelines", h.createPipeline),
		r("PATCH "+p+"/pipelines/{id}", h.updatePipeline),
		r("GET "+p+"/stages", h.listStages),
		r("POST "+p+"/stages", h.createStage),
		r("PATCH "+p+"/stages/{id}", h.updateStage),

		r("GET "+p+"/owners", h.listOwners),
		r("GET "+p+"/lost-reasons", h.listLostReasons),
		r("GET "+p+"/products", h.listProducts),
		r("GET "+p+"/customers", h.searchCustomers),
		r("GET "+p+"/raw-materials", h.searchRawMaterials),
		r("GET "+p+"/custom-fields", h.customFields),
		r("GET "+p+"/recipes", h.getRecipe),
		r("PUT "+p+"/recipes", h.putRecipe),
		r("GET "+p+"/wa-templates", h.listWaTemplates),
		r("POST "+p+"/wa-templates", h.createWaTemplate),
		r("PATCH "+p+"/wa-templates/{id}", h.updateWaTemplate),
		r("DELETE "+p+"/wa-templates/{id}", h.deleteWaTemplate),

		r("GET "+p+"/forecast", h.forecast),
		r("GET "+p+"/targets", h.listTargets),
		r("PUT "+p+"/targets", h.saveTargets),
		r("GET "+p+"/reports", h.report),
		r("GET "+p+"/timeline", h.timeline),
	}
}

/* ── Envelopes (lib/api/auth.ts) ─────────────────────────────────────── */

func ok(w http.ResponseWriter, data any) error { return httpx.Data(w, http.StatusOK, data) }

func okMsg(w http.ResponseWriter, data any, msg string) error {
	return httpx.DataMessage(w, http.StatusOK, data, msg)
}

func created(w http.ResponseWriter, data any, msg string) error {
	return httpx.DataMessage(w, http.StatusCreated, data, msg)
}

func noContent(w http.ResponseWriter) error {
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// pageMeta is PaginationMeta.
type pageMeta struct {
	Page       float64 `json:"page"`
	Limit      float64 `json:"limit"`
	Total      float64 `json:"total"`
	TotalPages float64 `json:"totalPages"`
}

// paginated is paginatedResponse without a message.
func paginated(w http.ResponseWriter, data any, meta pageMeta) error {
	return httpx.JSON(w, http.StatusOK, struct {
		Success    bool     `json:"success"`
		Data       any      `json:"data"`
		Pagination pageMeta `json:"pagination"`
	}{true, data, meta})
}

// tooMany is `new ApiError(429, msg)`.
func tooMany(msg string) error { return httpx.Status(http.StatusTooManyRequests, msg) }

// query is searchParams.get: nil when absent.
func query(r *http.Request, key string) *string {
	vals, ok := r.URL.Query()[key]
	if !ok || len(vals) == 0 {
		return nil
	}
	return &vals[0]
}

// queryStr is searchParams.get(key) ?? "".
func queryStr(r *http.Request, key string) string { return str(query(r, key)) }
