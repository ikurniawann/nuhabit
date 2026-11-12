package salesfunnel

import (
	"context"
	"net/http"
	"slices"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
)

// routes lists every /api/sales-funnel route; none is left in Next. The
// lead import and the PDFs live in leadimport.go and pdf.go, the
// document page reads in documents.go. Each route names the menus whose
// dashboard pages call it; requireUser and requireFinance check them.
func (h *handler) routes() []module.Route {
	leads, pipeline, accounts := iam.SalesFunnelLeads, iam.SalesFunnelPipeline, iam.SalesFunnelAccounts
	contacts, followups, settings := iam.SalesFunnelContacts, iam.SalesFunnelFollowups, iam.SalesFunnelSettings
	// Pages with a task list, the timeline or custom fields on a record.
	tasks := slices.Concat(followups, leads, accounts, contacts, pipeline)
	records := slices.Concat(leads, accounts, contacts)
	r := func(pattern string, menus []string, fn httpx.HandlerFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(func(w http.ResponseWriter, req *http.Request) error {
			return fn(w, req.WithContext(context.WithValue(req.Context(), menusKey{}, menus)))
		})}
	}
	const p = "/api/sales-funnel"
	return []module.Route{
		r("GET "+p+"/leads", slices.Concat(leads, pipeline), h.listLeads),
		r("POST "+p+"/leads", leads, h.createLead),
		r("POST "+p+"/leads/import", leads, h.importLeads),
		r("GET "+p+"/leads/by-phone", leads, h.leadByPhone),
		r("GET "+p+"/leads/{id}", leads, h.leadDetail),
		r("PATCH "+p+"/leads/{id}", leads, h.updateLead),
		r("DELETE "+p+"/leads/{id}", leads, h.deleteLead),
		r("POST "+p+"/leads/{id}/link-customer", slices.Concat(leads, pipeline), h.linkLeadCustomer),
		r("DELETE "+p+"/leads/{id}/link-customer", leads, h.unlinkLeadCustomer),

		r("GET "+p+"/deals", pipeline, h.listDeals),
		r("POST "+p+"/deals", slices.Concat(pipeline, leads), h.createDeal),
		r("GET "+p+"/deals/{id}", pipeline, h.dealDetail),
		r("PATCH "+p+"/deals/{id}", pipeline, h.updateDeal),
		r("DELETE "+p+"/deals/{id}", pipeline, h.deleteDeal),
		r("GET "+p+"/deals/{id}/members", pipeline, h.listDealMembers),
		r("POST "+p+"/deals/{id}/members", pipeline, h.addDealMember),
		r("DELETE "+p+"/deals/{id}/members", pipeline, h.removeDealMember),
		r("POST "+p+"/deals/{id}/send-wa", pipeline, h.sendDealWa),
		r("GET "+p+"/deals/{id}/quotations", pipeline, h.listDealQuotations),
		r("POST "+p+"/deals/{id}/quotations", pipeline, h.createQuotation),
		r("GET "+p+"/deals/{id}/invoices", pipeline, h.dealInvoices),
		r("POST "+p+"/deals/{id}/invoices", pipeline, h.createInvoice),
		r("GET "+p+"/deals/{id}/payments", pipeline, h.dealPayments),
		r("POST "+p+"/deals/{id}/payments", pipeline, h.createPayment),
		r("DELETE "+p+"/deals/{id}/payments/{paymentId}", pipeline, h.deletePayment),

		r("GET "+p+"/quotations/{id}", pipeline, h.quotationDetail),
		r("PATCH "+p+"/quotations/{id}", pipeline, h.updateQuotation),
		r("DELETE "+p+"/quotations/{id}", pipeline, h.deleteQuotation),
		r("POST "+p+"/quotations/{id}/revise", pipeline, h.reviseQuotation),
		r("POST "+p+"/quotations/{id}/realize", pipeline, h.realizeQuotation),
		r("POST "+p+"/quotations/{id}/send-wa", pipeline, h.sendQuotationWa),
		r("GET "+p+"/quotations/{id}/pdf", pipeline, h.quotationPDF),

		r("PATCH "+p+"/invoices/{id}", pipeline, h.updateInvoice),
		r("DELETE "+p+"/invoices/{id}", pipeline, h.deleteInvoice),
		r("GET "+p+"/invoices/{id}/pdf", pipeline, h.invoicePDF),

		r("GET "+p+"/activities", tasks, h.listActivities),
		r("POST "+p+"/activities", tasks, h.createActivity),
		r("PATCH "+p+"/activities/{id}", tasks, h.updateActivity),
		r("DELETE "+p+"/activities/{id}", tasks, h.deleteActivity),

		r("GET "+p+"/accounts", slices.Concat(accounts, contacts), h.listAccounts),
		r("POST "+p+"/accounts", accounts, h.createAccount),
		r("GET "+p+"/accounts/{id}", accounts, h.accountDetail),
		r("PATCH "+p+"/accounts/{id}", accounts, h.updateAccount),
		r("DELETE "+p+"/accounts/{id}", accounts, h.deleteAccount),

		r("GET "+p+"/contacts", contacts, h.listContacts),
		r("POST "+p+"/contacts", slices.Concat(contacts, accounts), h.createContact),
		r("GET "+p+"/contacts/{id}", contacts, h.contactDetail),
		r("PATCH "+p+"/contacts/{id}", slices.Concat(contacts, accounts), h.updateContact),
		r("DELETE "+p+"/contacts/{id}", contacts, h.deleteContact),

		r("GET "+p+"/pipelines", slices.Concat(pipeline, leads, settings, iam.SalesFunnelForecast), h.listPipelines),
		r("POST "+p+"/pipelines", settings, h.createPipeline),
		r("PATCH "+p+"/pipelines/{id}", settings, h.updatePipeline),
		r("GET "+p+"/stages", slices.Concat(pipeline, settings, iam.SalesFunnelCrmStagePickers), h.listStages),
		r("POST "+p+"/stages", settings, h.createStage),
		r("PATCH "+p+"/stages/{id}", settings, h.updateStage),

		r("GET "+p+"/owners", slices.Concat(pipeline, iam.SalesFunnelCrmOwnerPickers), h.listOwners),
		r("GET "+p+"/lost-reasons", pipeline, h.listLostReasons),
		r("GET "+p+"/products", slices.Concat(pipeline, settings), h.listProducts),
		r("GET "+p+"/customers", leads, h.searchCustomers),
		r("GET "+p+"/raw-materials", settings, h.searchRawMaterials),
		r("GET "+p+"/custom-fields", slices.Concat(records, pipeline), h.customFields),
		r("GET "+p+"/recipes", settings, h.getRecipe),
		r("PUT "+p+"/recipes", settings, h.putRecipe),
		r("GET "+p+"/wa-templates", slices.Concat(settings, pipeline), h.listWaTemplates),
		r("POST "+p+"/wa-templates", settings, h.createWaTemplate),
		r("PATCH "+p+"/wa-templates/{id}", settings, h.updateWaTemplate),
		r("DELETE "+p+"/wa-templates/{id}", settings, h.deleteWaTemplate),

		r("GET "+p+"/forecast", iam.SalesFunnelForecast, h.forecast),
		r("GET "+p+"/targets", iam.SalesFunnelForecast, h.listTargets),
		r("PUT "+p+"/targets", iam.SalesFunnelForecast, h.saveTargets),
		r("GET "+p+"/reports", iam.SalesFunnelReports, h.report),
		r("GET "+p+"/timeline", records, h.timeline),
	}
}

// menusKey carries the route's menu codes to requireUser.
type menusKey struct{}

// routeMenus is the menu codes the route was mounted with (none outside
// routes(), which fails every guard closed).
func routeMenus(r *http.Request) []string {
	menus, _ := r.Context().Value(menusKey{}).([]string)
	return menus
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
