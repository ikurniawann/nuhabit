package gymcredits

import (
	"errors"
	"net/http"
	"os"
	"strings"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
)

// Handler serves the staff (/api/gym/...) and member portal routes.
type Handler struct {
	svc  *Service
	auth *auth.Service
}

// Routes lists every route of the module.
func (h *Handler) Routes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/gym/packages", Handler: h.api(h.listPackages)},
		{Pattern: "POST /api/gym/packages", Handler: h.api(h.savePackage)},
		{Pattern: "PATCH /api/gym/packages/{id}", Handler: h.api(h.setPackageStatus)},
		{Pattern: "DELETE /api/gym/packages/{id}", Handler: h.api(h.deletePackage)},
		{Pattern: "GET /api/gym/credits", Handler: h.api(h.searchMembers)},
		{Pattern: "GET /api/gym/credits/{customerId}", Handler: h.api(h.memberCredits)},
		{Pattern: "POST /api/gym/credits/{customerId}/adjust", Handler: h.api(h.adjust)},
		{Pattern: "POST /api/gym/credits/{customerId}/sell", Handler: h.api(h.sell)},
		{Pattern: "POST /api/gym/credits/reverse", Handler: h.api(h.reverse)},
		{Pattern: "POST /api/gym/credits/purchases/{id}/refund", Handler: h.api(h.refund)},
		{Pattern: "GET /api/gym/rules", Handler: h.api(h.rules)},
		{Pattern: "PUT /api/gym/rules", Handler: h.api(h.saveRules)},

		{Pattern: "GET /api/public/site/plans", Handler: h.api(h.publicPlans)},

		{Pattern: "GET /api/member-portal/gym/credits", Handler: h.auth.MemberHandler("Gagal memuat kredit kelas", h.memberWallet)},
		{Pattern: "GET /api/member-portal/gym/credits/packages", Handler: h.auth.MemberHandler("Gagal memuat paket kredit", h.portalPackages)},
		{Pattern: "POST /api/member-portal/gym/credits/purchases", Handler: h.auth.MemberHandler("Gagal membeli paket", h.buy)},
		{Pattern: "GET /api/member-portal/gym/credits/purchases/{id}", Handler: h.auth.MemberHandler("Gagal memuat status pembelian", h.purchaseStatus)},
		{Pattern: "POST /api/member-portal/gym/credits/purchases/{id}/simulate-paid", Handler: h.auth.MemberHandler("Gagal mensimulasikan pembayaran", h.simulatePaid)},
	}
}

/* ── Envelopes ───────────────────────────────────────────────────────── */

type okEnvelope struct {
	Success bool `json:"success"`
	Data    any  `json:"data"`
}

func ok(w http.ResponseWriter, data any) error {
	return httpx.JSON(w, http.StatusOK, okEnvelope{Success: true, Data: data})
}

// asHTTP renders a credit rule failure (GymCreditError) with its status.
func asHTTP(err error) error {
	var e *Error
	if errors.As(err, &e) {
		return httpx.Status(e.Status, e.Message)
	}
	return err
}

// api wraps a handler like apiHandler: *Error and *httpx.Error keep their
// status, Postgres constraint errors become friendly 4xx, the rest is 500.
func (h *Handler) api(fn httpx.HandlerFunc) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error { return asHTTP(fn(w, r)) })
}

func requireUUID(value string) (string, error) {
	if !isUUID(value) {
		return "", httpx.BadRequest("ID tidak valid")
	}
	return value, nil
}

// rejectIfArkCoinDisabled writes the 409 of the TS guard and reports
// whether the request was rejected.
func (h *Handler) rejectIfArkCoinDisabled(w http.ResponseWriter, r *http.Request, usesArk bool) (bool, error) {
	if !usesArk || h.svc.ArkCoinEnabled(r.Context()) {
		return false, nil
	}
	return true, httpx.JSON(w, http.StatusConflict, map[string]any{
		"success": false, "error": "Fitur ARK Coin sedang dinonaktifkan di pengaturan CRM", "code": "ARK_COIN_DISABLED",
	})
}

/* ── Staff: packages ─────────────────────────────────────────────────── */

func (h *Handler) listPackages(w http.ResponseWriter, r *http.Request) error {
	prefixes := append(append([]string{}, iam.GymPackages...), iam.GymCredits...)
	if _, err := h.auth.RequireMenuPrefix(r, prefixes...); err != nil {
		return err
	}
	view, err := h.svc.ListPackages(r.Context())
	if err != nil {
		return err
	}
	return ok(w, view)
}

func (h *Handler) savePackage(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.GymPackages...)
	if err != nil {
		return err
	}
	body, _ := readJSON(r, undefined)
	input, err := parsePackage(body)
	if err != nil {
		return err
	}
	saved, err := h.svc.SavePackage(r.Context(), input, user.ID)
	if err != nil {
		return err
	}
	return ok(w, saved)
}

func (h *Handler) setPackageStatus(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.GymPackages...); err != nil {
		return err
	}
	id, err := requireUUID(r.PathValue("id"))
	if err != nil {
		return err
	}
	body, _ := readJSON(r, undefined)
	status, err := parsePackageStatus(body)
	if err != nil {
		return err
	}
	row, err := h.svc.SetPackageStatus(r.Context(), id, status)
	if err != nil {
		return err
	}
	return ok(w, row)
}

func (h *Handler) deletePackage(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.GymPackages...); err != nil {
		return err
	}
	id, err := requireUUID(r.PathValue("id"))
	if err != nil {
		return err
	}
	if err := h.svc.DeletePackage(r.Context(), id); err != nil {
		return err
	}
	return ok(w, map[string]any{"id": id, "deleted": true})
}

/* ── Staff: member credits ───────────────────────────────────────────── */

func (h *Handler) searchMembers(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.GymCredits...); err != nil {
		return err
	}
	rows, err := h.svc.SearchMembers(r.Context(), strings.TrimSpace(r.URL.Query().Get("q")))
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *Handler) memberCredits(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.GymCredits...); err != nil {
		return err
	}
	customerID, err := requireUUID(r.PathValue("customerId"))
	if err != nil {
		return err
	}
	view, err := h.svc.MemberCredits(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, view)
}

func (h *Handler) adjust(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.GymCredits...)
	if err != nil {
		return err
	}
	customerID, err := requireUUID(r.PathValue("customerId"))
	if err != nil {
		return err
	}
	body, _ := readJSON(r, undefined)
	in, err := parseAdjust(body)
	if err != nil {
		return err
	}
	res, err := h.svc.AdjustTx(r.Context(), customerID, in.Amount, in.Reason, user.ID)
	if err != nil {
		return err
	}
	return ok(w, res)
}

func (h *Handler) sell(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.GymCredits...)
	if err != nil {
		return err
	}
	customerID, err := requireUUID(r.PathValue("customerId"))
	if err != nil {
		return err
	}
	body, _ := readJSON(r, undefined)
	in, err := parseSell(body)
	if err != nil {
		return err
	}
	if rejected, err := h.rejectIfArkCoinDisabled(w, r, in.PaymentMethod == "ark_coin"); rejected || err != nil {
		return err
	}
	purchase, err := h.svc.SellPackage(r.Context(), FrontDeskSale{
		CustomerID: customerID, PackageID: in.PackageID, PaymentMethod: in.PaymentMethod, DiscountIdr: in.DiscountIdr,
		BranchID: in.BranchID, Note: in.Note, CashierID: user.ID,
	})
	if err != nil {
		return err
	}
	return ok(w, purchase)
}

func (h *Handler) reverse(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.GymCredits...)
	if err != nil {
		return err
	}
	body, _ := readJSON(r, undefined)
	in, err := parseReverse(body)
	if err != nil {
		return err
	}
	res, err := h.svc.ReverseTx(r.Context(), in.EntryID, in.Reason, user.ID)
	if err != nil {
		return err
	}
	return ok(w, res)
}

func (h *Handler) refund(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.GymCredits...)
	if err != nil {
		return err
	}
	id, err := requireUUID(r.PathValue("id"))
	if err != nil {
		return err
	}
	body, _ := readJSON(r, undefined)
	reason, err := parseRefund(body)
	if err != nil {
		return err
	}
	purchase, err := h.svc.RefundPurchaseTx(r.Context(), id, reason, user.ID)
	if err != nil {
		return err
	}
	return ok(w, purchase)
}

/* ── Staff: rules ────────────────────────────────────────────────────── */

func (h *Handler) rules(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.GymRules...); err != nil {
		return err
	}
	view, err := h.svc.RulesAdmin(r.Context())
	if err != nil {
		return err
	}
	return ok(w, view)
}

func (h *Handler) saveRules(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.GymRules...)
	if err != nil {
		return err
	}
	body, raw := readJSON(r, undefined)
	in, err := parseRulesPut(body, raw)
	if err != nil {
		return err
	}
	msg, err := h.svc.SaveRules(r.Context(), in.BranchID, in.Rules, user.ID)
	if err != nil {
		return err
	}
	if msg != "" {
		return httpx.BadRequest(msg)
	}
	view, err := h.svc.RulesAdmin(r.Context())
	if err != nil {
		return err
	}
	return ok(w, view)
}

/* ── Public site ─────────────────────────────────────────────────────── */

// publicPlans is the price list of /join: public packages priced for the
// branch in ?branch= (slug, code or id).
func (h *Handler) publicPlans(w http.ResponseWriter, r *http.Request) error {
	view, err := h.svc.PublicPlans(r.Context(), strings.TrimSpace(r.URL.Query().Get("branch")))
	if err != nil {
		return err
	}
	return ok(w, view)
}

/* ── Member portal ───────────────────────────────────────────────────── */

func (h *Handler) memberWallet(w http.ResponseWriter, r *http.Request, customerID string) error {
	wallet, err := h.svc.MemberWallet(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, wallet)
}

func (h *Handler) portalPackages(w http.ResponseWriter, r *http.Request, customerID string) error {
	view, err := h.svc.PortalPackages(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, view)
}

func (h *Handler) buy(w http.ResponseWriter, r *http.Request, customerID string) error {
	body, _ := readJSON(r, map[string]any{})
	in, err := parseMemberPurchase(body)
	if err != nil {
		return err
	}
	if rejected, err := h.rejectIfArkCoinDisabled(w, r, in.Method == "ark_coin"); rejected || err != nil {
		return err
	}
	var view *MemberPurchaseView
	purchase := MemberPurchase{CustomerID: customerID, PackageID: in.PackageID, BranchID: in.BranchID}
	origin := appOrigin(r)
	switch in.Method {
	case "ark_coin":
		view, err = h.svc.BuyWithArk(r.Context(), customerID, in.PackageID)
	case "invoice":
		view, err = h.svc.StartInvoicePurchase(r.Context(), purchase, func(purchaseID string) string {
			return origin + "/member/wallet/pay/" + purchaseID
		})
	default:
		view, err = h.svc.StartQRISPurchase(r.Context(), purchase, func(configured string) string {
			if configured != "" {
				return configured
			}
			return origin + "/api/payments/xendit/webhook"
		})
	}
	if err != nil {
		return asHTTP(err) // these routes catch GymCreditError
	}
	return ok(w, view)
}

func (h *Handler) purchaseStatus(w http.ResponseWriter, r *http.Request, customerID string) error {
	id := r.PathValue("id")
	if !isUUID(id) {
		return httpx.BadRequest("ID tidak valid")
	}
	view, err := h.svc.RefreshMemberPurchase(r.Context(), customerID, id)
	if err != nil {
		return err
	}
	if view == nil {
		return httpx.NotFound("Pembelian tidak ditemukan")
	}
	return ok(w, view)
}

func (h *Handler) simulatePaid(w http.ResponseWriter, r *http.Request, customerID string) error {
	if !h.svc.CanSimulate() {
		return httpx.NotFound("Not found")
	}
	id := r.PathValue("id")
	if !isUUID(id) {
		return httpx.BadRequest("ID tidak valid")
	}
	view, err := h.svc.SimulatePaid(r.Context(), customerID, id)
	if err != nil {
		return asHTTP(err) // these routes catch GymCreditError
	}
	if view == nil {
		return httpx.NotFound("Pembelian tidak ditemukan")
	}
	return ok(w, view)
}

// appOrigin mirrors frontend/src/lib/app-origin.ts: NEXT_PUBLIC_APP_URL (or
// NEXT_PUBLIC_BASE_URL), else the public origin of the request as the
// Next.js proxy forwards it.
func appOrigin(r *http.Request) string {
	origin := strings.TrimSpace(os.Getenv("NEXT_PUBLIC_APP_URL"))
	if origin == "" {
		origin = strings.TrimSpace(os.Getenv("NEXT_PUBLIC_BASE_URL"))
	}
	if origin == "" {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		if p := r.Header.Get("X-Forwarded-Proto"); p != "" {
			scheme = strings.TrimSpace(strings.Split(p, ",")[0])
		}
		host := r.Host
		if fh := r.Header.Get("X-Forwarded-Host"); fh != "" {
			host = strings.TrimSpace(strings.Split(fh, ",")[0])
		}
		origin = scheme + "://" + host
	}
	return strings.TrimRight(origin, "/")
}
