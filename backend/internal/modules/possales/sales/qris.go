package sales

import (
	"context"
	"crypto/rand"
	"fmt"
	"math"
	"net/http"

	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// qrisCreateBody is createSchema after validation (nil = absent).
type qrisCreateBody struct {
	Amount     *float64
	CheckoutID string
	OrderID    string
}

// parseQrisCreate mirrors createSchema.safeParse: any issue (including the
// refine) is the single 400 "Nominal tidak valid".
func parseQrisCreate(body any) (qrisCreateBody, bool) {
	f := validate.New(body, true)
	amount := f.Num("amount", validate.Rule{Optional: true}, validate.NumOpts{Positive: true, Max: validate.Bound(999_999_999)})
	checkout := f.UUID("checkout_id", validate.Rule{Optional: true})
	order := f.UUID("order_id", validate.Rule{Optional: true})
	if !f.Valid() {
		return qrisCreateBody{}, false
	}
	out := qrisCreateBody{Amount: amount}
	if checkout != nil {
		out.CheckoutID = *checkout
	}
	if order != nil {
		out.OrderID = *order
	}
	if out.Amount == nil && out.CheckoutID == "" && out.OrderID == "" {
		return out, false
	}
	return out, true
}

func randomUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// qrisData is the response object; extra keys follow the TS spreads.
func reusedQrisData(qr map[string]any, storedQR, storedRef string, amount float64, idKey, id string) *jsrow.Row {
	qrID := domain.StrOr(qr["id"], storedQR)
	ref := domain.StrOr(qr["reference_id"], storedRef)
	var expires any
	if domain.Truthy(qr["expires_at"]) {
		expires = domain.String(qr["expires_at"])
	}
	return jsrow.Object(
		"qr_id", qrID,
		"reference_id", ref,
		"qr_string", domain.StrOr(qr["qr_string"], ""),
		"amount", qrAmount(qr, amount),
		"expires_at", expires,
		idKey, id,
	)
}

// createQris is POST /api/pos/qris.
func (h *Handler) createQris(w http.ResponseWriter, r *http.Request) error {
	user, err := kit.PosUser(h.auth, r)
	if err != nil {
		return err
	}
	if ok, err := h.limiter.Allow(r.Context(), "pos-qris:"+user.ID, 30); err != nil {
		return err
	} else if !ok {
		return kit.Fail(w, 429, "Terlalu banyak permintaan QR — tunggu sebentar")
	}
	ctx := r.Context()
	fail502 := func(err error) error {
		h.log.Error("[pos] create qris error", "error", err)
		return kit.Fail(w, 502, kit.ErrorMessage(err))
	}
	// Shim query errors are not Error instances: "Gagal membuat QR pembayaran".
	failQuery := func(err error) error {
		h.log.Error("[pos] create qris error", "error", err)
		return kit.Fail(w, 502, "Gagal membuat QR pembayaran")
	}
	raw, err := readJSON(r)
	if err != nil {
		return fail502(err)
	}
	body, ok := parseQrisCreate(raw)
	if !ok {
		return kit.Fail(w, 400, "Nominal tidak valid")
	}
	var amount float64 = -1
	if body.Amount != nil {
		amount = *body.Amount
	}
	hasAmount := body.Amount != nil
	referenceID := "pos-" + randomUUID()
	checkoutID := body.CheckoutID
	orderID := ""
	if checkoutID == "" {
		orderID = body.OrderID
	}

	var order *jsrow.Row
	if orderID != "" {
		order, err = jsrow.QueryOne(ctx, h.db, `SELECT id, order_number, total_amount, payment_status, xendit_qr_id, xendit_external_id FROM pos.pos_orders WHERE id = $1`, orderID)
		if err != nil {
			return failQuery(err)
		}
		if order == nil {
			return kit.Fail(w, 404, "Order tidak ditemukan")
		}
		if order.Str("payment_status") == "paid" {
			return kit.Fail(w, 400, "Bill "+order.Str("order_number")+" sudah lunas")
		}
		total := order.Num("total_amount")
		if total <= 0 {
			return kit.Fail(w, 400, "Nominal tidak valid")
		}
		if hasAmount && math.Abs(amount-total) > 1 {
			return kit.Fail(w, 409, fmt.Sprintf("Total di layar (%s) tidak sama dengan bill tersimpan %s (%s) — muat ulang bill sebelum menagih QRIS",
				domain.FormatRupiah(amount), order.Str("order_number"), domain.FormatRupiah(total)))
		}
		amount, hasAmount = total, true
	}

	cfg, err := h.p.Xendit.Config(ctx, h.db)
	if err != nil {
		h.log.Error("[pos] qris gateway config", "error", err)
		if gatewayConfigError.MatchString(err.Error()) {
			return kit.Fail(w, 503, err.Error())
		}
		return fail502(err)
	}

	if orderID != "" {
		storedQR, storedRef := order.Str("xendit_qr_id"), order.Str("xendit_external_id")
		reused, done, err := h.reuseQris(ctx, cfg, "pos_orders", orderID, storedQR, storedRef)
		if err != nil {
			return kit.Fail(w, 500, "Gagal menyimpan QRIS order")
		}
		if done {
			return httpx.Data(w, 200, reusedQrisData(reused, storedQR, storedRef, amount, "order_id", orderID))
		}
		referenceID = "pos-ord-" + orderID
		if _, err := h.db.Exec(ctx, `UPDATE pos.pos_orders SET xendit_external_id = $2, updated_at = $3 WHERE id = $1`, orderID, referenceID, h.clock()); err != nil {
			return kit.Fail(w, 500, "Gagal menyimpan QRIS order")
		}
	}

	if checkoutID != "" {
		checkout, err := jsrow.QueryOne(ctx, h.db, `SELECT id, total_amount, xendit_qr_id, xendit_external_id, payment_status FROM pos.pos_checkouts WHERE id = $1`, checkoutID)
		if err != nil {
			return failQuery(err)
		}
		if checkout == nil {
			return kit.Fail(w, 404, "Checkout tidak ditemukan")
		}
		total := checkout.Num("total_amount")
		if total <= 0 {
			return kit.Fail(w, 400, "Nominal tidak valid")
		}
		if hasAmount && math.Abs(amount-total) > 1 {
			return kit.Fail(w, 400, "Nominal QRIS harus sama dengan total checkout")
		}
		amount, hasAmount = total, true
		storedQR, storedRef := checkout.Str("xendit_qr_id"), checkout.Str("xendit_external_id")
		reused, done, err := h.reuseQris(ctx, cfg, "pos_checkouts", checkoutID, storedQR, storedRef)
		if err != nil {
			return kit.Fail(w, 500, "Gagal menyimpan QRIS checkout")
		}
		if done {
			return httpx.Data(w, 200, reusedQrisData(reused, storedQR, storedRef, amount, "checkout_id", checkoutID))
		}
		referenceID = "pos-chk-" + checkoutID
		if _, err := h.db.Exec(ctx, `UPDATE pos.pos_checkouts SET xendit_external_id = $2, updated_at = $3 WHERE id = $1`, checkoutID, referenceID, h.clock()); err != nil {
			return kit.Fail(w, 500, "Gagal menyimpan QRIS checkout")
		}
	}

	if !hasAmount || amount <= 0 {
		return kit.Fail(w, 400, "Nominal tidak valid")
	}
	qr, err := h.p.Xendit.CreateQR(ctx, cfg.SecretKey, referenceID, amount, cfg.CallbackURL, fmt.Sprintf("POS %s", domain.NumberString(domain.RoundHalfUp(amount))))
	if err != nil {
		return fail502(err)
	}
	for _, t := range []struct{ table, id, msg string }{
		{"pos_checkouts", checkoutID, "Gagal menyimpan QRIS checkout"},
		{"pos_orders", orderID, "Gagal menyimpan QRIS order"},
	} {
		if t.id == "" {
			continue
		}
		if _, err := h.db.Exec(ctx, `UPDATE pos.`+t.table+` SET xendit_qr_id = $2, xendit_external_id = $3, updated_at = $4 WHERE id = $1`,
			t.id, qr.ID, qr.ReferenceID, h.clock()); err != nil {
			h.log.Error("[pos] save qris ids", "table", t.table, "error", err)
			return kit.Fail(w, 500, t.msg)
		}
	}
	identity, err := appSettings(ctx, h.db, "qris_merchant_name", "qris_nmid", "company_legal_name")
	if err != nil {
		return fail502(err)
	}
	data := jsrow.Object(
		"qr_id", qr.ID,
		"reference_id", qr.ReferenceID,
		"qr_string", qr.QRString,
		"amount", qr.Amount,
		"expires_at", qr.ExpiresAt,
	)
	if checkoutID != "" {
		data.Set("checkout_id", checkoutID)
	}
	if orderID != "" {
		data.Set("order_id", orderID)
	}
	data.Set("merchant_name", firstNonEmpty(identity["qris_merchant_name"], identity["company_legal_name"]))
	data.Set("nmid", firstNonEmpty(identity["qris_nmid"]))
	return httpx.Data(w, 200, data)
}

// reuseQris looks up the stored QR of an order/checkout. done=false means
// "create a new one"; a failed self-heal write is err.
func (h *Handler) reuseQris(ctx context.Context, cfg *XenditConfig, table, id, storedQR, storedRef string) (map[string]any, bool, error) {
	action := domain.QrisAction(storedQR, storedRef)
	if action == "create" {
		return nil, false, nil
	}
	var qr map[string]any
	var err error
	if action == "reuse_qr_id" {
		qr, err = h.p.Xendit.GetQR(ctx, cfg.SecretKey, storedQR)
	} else {
		qr, err = h.p.Xendit.GetQRByReference(ctx, cfg.SecretKey, storedRef)
	}
	if err != nil {
		h.log.Warn("[pos] qris reuse lookup miss, falling back to create", "table", table, "id", id, "error", err)
		return nil, false, nil
	}
	if action == "lookup_external_id" && domain.Truthy(qr["id"]) && storedQR == "" {
		if _, err := h.db.Exec(ctx, `UPDATE pos.`+table+` SET xendit_qr_id = $2, updated_at = $3 WHERE id = $1`, id, domain.String(qr["id"]), h.clock()); err != nil {
			return nil, false, err
		}
	}
	return qr, true, nil
}

// appSettings is getSettings(keys) over configuration.app_settings.
func appSettings(ctx context.Context, q database.Querier, keys ...string) (map[string]*string, error) {
	rows, err := q.Query(ctx, `SELECT key, value FROM configuration.app_settings WHERE key = ANY($1)`, keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]*string{}
	for rows.Next() {
		var k string
		var v *string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

func firstNonEmpty(vals ...*string) any {
	for _, v := range vals {
		if v != nil && *v != "" {
			return *v
		}
	}
	return nil
}

// qrisStatus is GET /api/pos/qris/{id}/status.
func (h *Handler) qrisStatus(w http.ResponseWriter, r *http.Request) error {
	if _, err := kit.PosUser(h.auth, r); err != nil {
		return err
	}
	ctx := r.Context()
	qrID := domain.Trim(r.PathValue("id"))
	if qrID == "" || validate.UTF16Len(qrID) > 128 {
		return kit.Fail(w, 400, "QR tidak valid")
	}
	cfg, err := h.p.Xendit.Config(ctx, h.db)
	if err != nil {
		if gatewayConfigError.MatchString(err.Error()) {
			return kit.Fail(w, 503, err.Error())
		}
		return kit.Fail(w, 502, kit.ErrorMessage(err))
	}
	remote, err := h.p.Xendit.GetQR(ctx, cfg.SecretKey, qrID)
	if err != nil {
		h.log.Error("[pos] qris status error", "error", err)
		return kit.Fail(w, 502, kit.ErrorMessage(err))
	}
	paid := isXenditQrPaid(remote)
	status := domain.StrOr(remote["status"], domain.StrOr(remote["payment_status"], "ACTIVE"))
	if !paid {
		if payments, err := h.p.Xendit.QRPayments(ctx, cfg.SecretKey, qrID); err == nil {
			list := make([]any, len(payments))
			for i, p := range payments {
				list[i] = p
			}
			if isXenditQrPaid(map[string]any{"payments": list}) {
				paid = true
				status = "SUCCEEDED"
				for _, p := range payments {
					if isXenditQrPaid(map[string]any{"status": domain.StrOr(p["status"], "")}) {
						status = domain.StrOr(p["status"], "SUCCEEDED")
						break
					}
				}
			}
		}
	}
	return httpx.Data(w, 200, jsrow.Object("qr_id", domain.StrOr(remote["id"], qrID), "paid", paid, "status", status))
}
