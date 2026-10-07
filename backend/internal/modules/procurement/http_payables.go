package procurement

import (
	"net/http"
	"os"
	"strings"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/audit"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// Port of frontend/src/app/api/purchasing/{vendor-payments,vendor-credits,docs}/**.
func (h *Handler) payableRoutes(add addRoute) {
	add("GET /api/purchasing/vendor-payments", h.vendorPayments)
	add("GET /api/purchasing/vendor-credits/apply", h.creditsForPo)
	add("POST /api/purchasing/vendor-credits/apply", h.applyCredits)
	add("PATCH /api/purchasing/vendor-credits/{id}/approve", h.approveCredit)
	add("GET /api/purchasing/docs/spec", h.openAPI)
}

func (h *Handler) vendorPayments(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	var search *string
	if q.Has("search") {
		v := strings.TrimSpace(q.Get("search"))
		search = &v
	}
	scope, err := h.svc.Scope(r.Context(), user.ID)
	if err != nil {
		return err
	}
	data, err := h.svc.PurchaseInvoices(r.Context(), domain.ModuleType(q.Get("module_type")), search, queryPtr(r, "status"), scope)
	if err != nil {
		return err
	}
	return writeOK(w, http.StatusOK, data)
}

func (h *Handler) outstanding(r *http.Request, poID string) (float64, error) {
	out, err := h.svc.PoOutstanding(r.Context(), poID)
	if err != nil {
		return 0, err
	}
	if out == nil {
		return 0, httpx.NotFound("PO tidak ditemukan")
	}
	return *out, nil
}

func (h *Handler) creditsForPo(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.Items...); err != nil {
		return err
	}
	poID := r.URL.Query().Get("purchase_order_id")
	if !validate.IsUUID(poID) {
		return httpx.BadRequest("purchase_order_id wajib")
	}
	credits, err := h.svc.CreditsForPo(r.Context(), poID)
	if err != nil {
		return err
	}
	outstanding, err := h.outstanding(r, poID)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, struct {
		Success bool   `json:"success"`
		Data    []*Row `json:"data"`
		Meta    any    `json:"meta"`
	}{true, credits, obj("outstanding", outstanding)})
}

func (h *Handler) applyCredits(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	f, err := bodyForm(r)
	if err != nil {
		return err
	}
	poID := f.UUID("purchase_order_id", validate.Rule{})
	var amount float64
	if v, _, done := f.Take("amount", "number", validate.Rule{}); !done {
		if x, ok := f.CheckNumber("amount", v, validate.NumOpts{}); ok {
			amount = x
			if x <= 0 {
				f.Fail("amount", "too_small", "Jumlah harus lebih dari 0")
			}
		}
	}
	dryRun := f.Bool("dry_run", optional)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	outstanding, err := h.outstanding(r, *poID)
	if err != nil {
		return err
	}
	if amount > outstanding+0.01 {
		return httpx.BadRequest("Jumlah melebihi sisa tagihan PO (" + formatJSNumber(outstanding) + ")")
	}
	dry := dryRun != nil && *dryRun
	res, err := h.svc.ApplyVendorCredits(r.Context(), *poID, amount, dry, actorAudit(user).WithRequest(r))
	if err != nil {
		return err
	}
	used := formatJSNumber(domain.JSRound((amount-res.Remaining)*100) / 100)
	msg := "Kredit vendor " + used + " dipakai untuk PO ini"
	if dry {
		msg = "Kredit yang bisa dipakai: " + used
	}
	return writeOKMessage(w, http.StatusOK, res, msg)
}

func (h *Handler) approveCredit(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Items...)
	if err != nil {
		return err
	}
	// The body is optional: unreadable JSON reads as {}.
	var expiry *string
	if body, present := validate.ReadBody(r); present {
		if m, ok := body.(map[string]any); ok {
			switch v := m["expiry_date"].(type) {
			case nil:
			case string:
				if !isoDate.MatchString(v) {
					return httpx.BadRequest("Format tanggal kedaluwarsa YYYY-MM-DD")
				}
				expiry = &v
			default:
				return httpx.BadRequest("Format tanggal kedaluwarsa YYYY-MM-DD")
			}
		} else {
			return httpx.BadRequest("Format tanggal kedaluwarsa YYYY-MM-DD")
		}
	}
	id := r.PathValue("id")
	updated, err := h.svc.ApproveVendorCredit(r.Context(), id, user.ID, expiry)
	if err != nil {
		return err
	}
	var label *string
	var total any
	if updated != nil {
		label, total = updated.StrPtr("credit_number"), updated.Get("total_amount")
	}
	h.svc.recordAuditAfterCommit(r.Context(), audit.Entry{
		ActorID: user.ID, ActorName: nonEmpty(&user.FullName), Action: "vendor_credit.approve", Entity: "vendor_credit", EntityID: &id,
		EntityLabel: label, After: obj("status", "approved", "total_amount", total, "expiry_date", expiry),
	}.WithRequest(r))
	return writeOKMessage(w, http.StatusOK, updated, "Vendor credit approved. Purchase invoice net payable has been reduced.")
}

// openAPI serves the static spec (force-static in Next; no session needed
// inside the route).
func (h *Handler) openAPI(w http.ResponseWriter, r *http.Request) error {
	origin := strings.TrimSpace(os.Getenv("NEXT_PUBLIC_APP_URL"))
	if origin == "" {
		origin = strings.TrimSpace(os.Getenv("NEXT_PUBLIC_BASE_URL"))
	}
	body := openAPISpec(strings.TrimRight(origin, "/"))
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.WriteHeader(http.StatusOK)
	_, err := w.Write(body)
	return err
}
