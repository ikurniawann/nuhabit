package webhooks

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/integrations"
	"nuhabit/backend/internal/modules/integrations/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/validate"
)

// The Xendit QR payment callback (configured in the Xendit dashboard and in
// Settings → Payment Gateways). Every outcome except a bad callback token is
// a 200: Xendit retries any non-2xx, and nothing here improves on retry.

// ignored is {success: true, ignored: true, reason, …}.
type ignored struct {
	Success bool    `json:"success"`
	Ignored bool    `json:"ignored"`
	Reason  string  `json:"reason"`
	Status  *string `json:"status,omitempty"`
	Error   *string `json:"error,omitempty"`
	Data    any     `json:"data,omitempty"`
}

func ignore(w http.ResponseWriter, reason string) {
	_ = httpx.JSON(w, http.StatusOK, ignored{Success: true, Ignored: true, Reason: reason})
}

// GET /api/payments/xendit/webhook: Xendit probes the URL when it is saved.
func (h *Handler) xenditProbe(w http.ResponseWriter, _ *http.Request) {
	_ = httpx.JSON(w, http.StatusOK, struct {
		Success bool   `json:"success"`
		Service string `json:"service"`
	}{true, "xendit-webhook"})
}

// xenditWebhookSecret is loadActiveXenditConfig's webhookToken; ok=false
// when the gateway is missing, inactive or has no secret key.
func xenditWebhookSecret(ctx context.Context, q database.Querier) (secret string, ok bool, err error) {
	var active bool
	var secretKey, webhook *string
	err = q.QueryRow(ctx, `SELECT is_active, secret_key, webhook_secret FROM configuration.payment_gateways WHERE provider = 'xendit'`).
		Scan(&active, &secretKey, &webhook)
	if database.IsNoRows(err) {
		return "", false, nil
	}
	if err != nil || !active || secretKey == nil || validate.JSTrim(*secretKey) == "" {
		return "", false, err
	}
	if webhook != nil {
		secret = *webhook
	}
	return secret, true, nil
}

// POST /api/payments/xendit/webhook
func (h *Handler) xenditWebhook(w http.ResponseWriter, r *http.Request) {
	if err := h.handleXendit(w, r); err != nil {
		// ACK 200 anyway; the cashier poll or a manual retry settles it.
		h.log.ErrorContext(r.Context(), "Xendit webhook error", "error", err)
		msg := err.Error()
		_ = httpx.JSON(w, http.StatusOK, ignored{Success: true, Ignored: true, Reason: "handler_error", Error: &msg})
	}
}

func (h *Handler) handleXendit(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	secret, configured, err := xenditWebhookSecret(ctx, h.db)
	if err != nil || !configured {
		// ACK so the Xendit dashboard does not show failures; the cashier
		// poll settles instead.
		ignore(w, "xendit_not_configured")
		return nil
	}
	if !domain.VerifyXenditToken(r.Header.Get("x-callback-token"), secret) {
		return httpx.JSON(w, http.StatusUnauthorized, struct {
			Success bool   `json:"success"`
			Error   string `json:"error"`
		}{false, "Invalid callback token"})
	}
	raw, err := readBody(r, 1<<20)
	if err != nil {
		return err
	}
	body, _ := domain.ParseJSON(raw)
	p := domain.ParseQrWebhook(domain.Obj(body))
	if !p.Paid {
		return httpx.JSON(w, http.StatusOK, ignored{Success: true, Ignored: true, Reason: "not_paid", Status: &p.Status})
	}

	// Gym credit package purchase (reference_id gymcp_…).
	if h.ports.Payments.IsGymPurchaseReference(p.ReferenceID) {
		purchase, err := h.ports.Payments.GymPurchase(ctx, h.db, p.ReferenceID)
		if err != nil {
			return err
		}
		if purchase != nil && !domain.AmountMatches(purchase.Amount, p.Amount) {
			return h.amountMismatch(w, "gym_purchase", purchase, p.Amount)
		}
		paymentID := firstNonEmpty(p.PaymentID, p.QRID)
		result, err := h.ports.Payments.SettleGymPurchase(ctx, h.db, p.ReferenceID, paymentID)
		if err != nil {
			return err
		}
		return httpx.Data(w, http.StatusOK, struct {
			GymPurchase any `json:"gym_purchase"`
		}{result})
	}

	// A pending top-up by QR id, merchant reference or payment id (some
	// payloads carry the QR id in `id` and nest the payment id).
	topup, err := h.findTopup(ctx, p)
	if err != nil {
		return err
	}
	var checkout, order *Pending
	childCount := 0
	if topup == nil && p.ReferenceID != "" {
		checkout = h.lookup(ctx, "checkout", h.ports.Payments.Checkout, p.ReferenceID)
	}
	if checkout != nil {
		if childCount, err = h.ports.Payments.CheckoutChildren(ctx, h.db, checkout.ID); err != nil {
			return err
		}
	}
	// An open-bill order bound to its own QRIS (incident 2026-08-25),
	// looked up only when no top-up or checkout matched.
	if topup == nil && checkout == nil && p.ReferenceID != "" {
		order = h.lookup(ctx, "order", h.ports.Payments.Order, p.ReferenceID)
	}

	action := domain.ResolvePaidAction(idOf(topup), idOf(checkout), childCount, idOf(order))
	target := map[domain.PaidAction]*Pending{
		domain.ActionCreditTopup: topup, domain.ActionCompleteCheckout: checkout, domain.ActionCompleteOrder: order,
	}[action]
	if target != nil && !domain.AmountMatches(target.Amount, p.Amount) {
		return h.amountMismatch(w, string(action), target, p.Amount)
	}

	switch action {
	case domain.ActionNoopCheckout:
		return httpx.JSON(w, http.StatusOK, ignored{Success: true, Ignored: true, Reason: "checkout_children_exist",
			Data: struct {
				CheckoutID string `json:"checkout_id"`
			}{checkout.ID}})
	case domain.ActionIgnore:
		h.log.WarnContext(ctx, "[xendit webhook] no matching topup", "qrId", p.QRID, "referenceId", p.ReferenceID, "paymentId", p.PaymentID)
		ignore(w, "topup_not_found")
		return nil
	}
	return h.queueSettlement(w, r, action, target.ID, p)
}

// queueSettlement publishes the settlement for the owning context (stored
// value credits top-ups, pos-sales completes checkouts and orders). They
// settle it from the outbox, so the response cannot carry the outcome the
// TS returned (credit_status, balance_after, order_ids, settle_status).
func (h *Handler) queueSettlement(w http.ResponseWriter, r *http.Request, action domain.PaidAction, targetID string, p domain.QrWebhook) error {
	event := integrations.XenditQrPaid{
		Action: string(action), TargetID: targetID, ReferenceID: p.ReferenceID, QRID: p.QRID,
		PaymentID: p.PaymentID, Amount: p.Amount, XenditPaymentID: p.PaymentID,
	}
	if event.XenditPaymentID == "" {
		event.XenditPaymentID = p.QRID
	}
	data := map[domain.PaidAction]string{
		domain.ActionCreditTopup: "topup_id", domain.ActionCompleteCheckout: "checkout_id", domain.ActionCompleteOrder: "order_id",
	}
	if action == domain.ActionCreditTopup {
		event.Notes = "Top-up QRIS"
	}
	if err := database.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		return outbox.Publish(r.Context(), tx, integrations.TopicXenditQrPaid, targetID, event)
	}); err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, struct {
		Success bool              `json:"success"`
		Queued  bool              `json:"queued"`
		Data    map[string]string `json:"data"`
	}{true, true, map[string]string{data[action]: targetID}})
}

// findTopup tries the QR id, the merchant reference, then the payment id.
func (h *Handler) findTopup(ctx context.Context, p domain.QrWebhook) (*Pending, error) {
	tries := [][2]string{{"xendit_transaction_id", p.QRID}, {"reference_id", p.ReferenceID}}
	if p.PaymentID != p.QRID {
		tries = append(tries, [2]string{"xendit_transaction_id", p.PaymentID})
	}
	for _, t := range tries {
		if t[1] == "" {
			continue
		}
		found, err := h.ports.Payments.Topup(ctx, h.db, t[0], t[1])
		if found != nil || err != nil {
			return found, err
		}
	}
	return nil, nil
}

// lookup runs a checkout/order lookup whose failure the TS only logs.
func (h *Handler) lookup(ctx context.Context, what string, find func(context.Context, database.Querier, string) (*Pending, error), ref string) *Pending {
	found, err := find(ctx, h.db, ref)
	if err != nil {
		h.log.WarnContext(ctx, "[xendit webhook] "+what+" lookup skipped", "error", err)
		return nil
	}
	return found
}

// amountMismatch: the callback amount differs from the pending record, so
// nothing is credited; ACK 200 because a retry will not fix it.
func (h *Handler) amountMismatch(w http.ResponseWriter, kind string, target *Pending, received float64) error {
	h.log.Error("[xendit webhook] amount mismatch", "kind", kind, "id", target.ID, "expected", target.Amount, "got", received)
	ignore(w, "amount_mismatch")
	return nil
}

func idOf(p *Pending) string {
	if p == nil {
		return ""
	}
	return p.ID
}

// firstNonEmpty is `a || b || null`.
func firstNonEmpty(values ...string) *string {
	for _, v := range values {
		if v != "" {
			return &v
		}
	}
	return nil
}
