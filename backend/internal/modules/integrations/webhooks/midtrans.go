package webhooks

import (
	"net/http"
	"strings"

	"nuhabit/backend/internal/modules/integrations/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/paygate"
)

// The Midtrans HTTP notification (Settings → Configuration → Payment
// Notification URL in the Midtrans dashboard; docs/MIDTRANS.md). Midtrans
// signs each body with signature_key = SHA-512(order_id + status_code +
// gross_amount + server key); nothing is read before that check passes.
// Every other outcome is a 200: Midtrans retries non-2xx answers up to five
// times, and nothing here improves on retry.

// GET /api/payments/midtrans/webhook: a reachability probe for the dashboard.
func (h *Handler) midtransProbe(w http.ResponseWriter, _ *http.Request) {
	_ = httpx.JSON(w, http.StatusOK, struct {
		Success bool   `json:"success"`
		Service string `json:"service"`
	}{true, "midtrans-webhook"})
}

// POST /api/payments/midtrans/webhook
func (h *Handler) midtransWebhook(w http.ResponseWriter, r *http.Request) {
	if err := h.handleMidtrans(w, r); err != nil {
		h.log.ErrorContext(r.Context(), "Midtrans webhook error", "error", err)
		msg := err.Error()
		_ = httpx.JSON(w, http.StatusOK, ignored{Success: true, Ignored: true, Reason: "handler_error", Error: &msg})
	}
}

func (h *Handler) handleMidtrans(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	// The row's key verifies the signature even when Midtrans is no longer
	// the active gateway: payments started before the switch still settle.
	cfg, err := paygate.Load(ctx, h.db, paygate.Midtrans)
	if err != nil {
		ignore(w, "midtrans_not_configured")
		return nil
	}
	raw, err := readBody(r, 1<<20)
	if err != nil {
		return err
	}
	n, ok := paygate.ParseNotification(raw)
	if !ok {
		ignore(w, "invalid_body")
		return nil
	}
	if !n.Verify(cfg.SecretKey) {
		return httpx.JSON(w, http.StatusUnauthorized, struct {
			Success bool   `json:"success"`
			Error   string `json:"error"`
		}{false, "Invalid signature"})
	}
	state := n.State()
	status := strings.ToUpper(n.TransactionStatus)

	if h.ports.Payments.IsGymPurchaseReference(n.OrderID) && state.Closed() {
		closedAs := "failed"
		if state == paygate.StateExpired || state == paygate.StateCanceled {
			closedAs = "expired"
		}
		result, err := h.ports.Payments.CloseGymPurchase(ctx, h.db, n.OrderID, closedAs)
		if err != nil {
			return err
		}
		return httpx.Data(w, http.StatusOK, struct {
			GymPurchase any `json:"gym_purchase"`
		}{result})
	}
	if state != paygate.StatePaid {
		return httpx.JSON(w, http.StatusOK, ignored{Success: true, Ignored: true, Reason: "not_paid", Status: &status})
	}
	return h.settlePaidQR(w, r, domain.QrWebhook{
		Paid: true, Status: status, QRID: n.TransactionID, ReferenceID: n.OrderID, Amount: n.Amount(), PaymentID: n.TransactionID,
	})
}
