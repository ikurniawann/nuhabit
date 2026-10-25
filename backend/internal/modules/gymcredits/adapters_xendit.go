package gymcredits

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/paygate"
)

// XenditGateway is the Xendit adapter of the payment gateway port: dynamic
// QRIS (the calls of frontend/src/lib/payments/xendit.ts, keyed by the
// gateway row) and hosted invoices (lib/xendit/client.ts, keyed by
// XENDIT_SECRET_KEY, with the dev-only XENDIT_MOCK=1 mode). It is also the
// saved payment methods client (adapters_xendit_saved.go).
type XenditGateway struct {
	// BaseURL defaults to XENDIT_API_BASE_URL or https://api.xendit.co.
	BaseURL string
	Client  *http.Client
	Getenv  func(string) string
}

var _ paygate.Adapter = (*XenditGateway)(nil)

// NewXenditGateway reads XENDIT_API_BASE_URL (a local mock in tests).
func NewXenditGateway() *XenditGateway {
	base := os.Getenv("XENDIT_API_BASE_URL")
	if base == "" {
		base = "https://api.xendit.co"
	}
	return &XenditGateway{BaseURL: strings.TrimRight(base, "/"), Client: &http.Client{Timeout: 30 * time.Second}, Getenv: os.Getenv}
}

func (g *XenditGateway) Provider() paygate.Provider { return paygate.Xendit }

const (
	invoiceExpiryHours = 2
	msgNoXenditKey     = "XENDIT_SECRET_KEY belum dikonfigurasi"
)

// mockInvoices is isXenditMock.
func (g *XenditGateway) mockInvoices() bool { return g.Getenv("XENDIT_MOCK") == "1" }

// HostedProblem: invoices need XENDIT_SECRET_KEY (or the mock mode); the
// gateway row is not involved.
func (g *XenditGateway) HostedProblem(*paygate.Config) string {
	if g.Getenv("XENDIT_SECRET_KEY") != "" || g.mockInvoices() {
		return ""
	}
	return msgNoXenditKey
}

// CreateHosted mirrors createInvoice (POST /v2/invoices). In mock mode the
// invoice URL is the redirect URL itself and Status reports it paid.
func (g *XenditGateway) CreateHosted(ctx context.Context, _ *paygate.Config, in paygate.HostedRequest) (*paygate.Hosted, error) {
	expiresAt := time.Now().Add(invoiceExpiryHours * time.Hour)
	if g.mockInvoices() {
		return &paygate.Hosted{ID: "mock-" + in.ReferenceID, URL: in.RedirectURL, ExpiresAt: expiresAt, Mock: true}, nil
	}
	secret := g.Getenv("XENDIT_SECRET_KEY")
	if secret == "" {
		return nil, errors.New(msgNoXenditKey)
	}
	status, raw, err := g.do(ctx, http.MethodPost, "/v2/invoices", secret, map[string]any{
		"external_id":          in.ReferenceID,
		"amount":               in.Amount,
		"description":          in.Description,
		"invoice_duration":     invoiceExpiryHours * 60 * 60,
		"success_redirect_url": in.RedirectURL,
		"failure_redirect_url": in.RedirectURL,
		"currency":             "IDR",
		"customer":             map[string]string{"given_names": in.PayerName},
	})
	if err != nil {
		return nil, err
	}
	payload, _ := raw.(map[string]any)
	if status < 200 || status > 299 {
		return nil, fmt.Errorf("Xendit menolak pembuatan invoice (HTTP %d): %s", status, jsString(payload["message"]))
	}
	inv := &paygate.Hosted{ID: jsString(payload["id"]), URL: jsString(payload["invoice_url"]), ExpiresAt: expiresAt}
	if inv.ID == "" || inv.URL == "" {
		return nil, errors.New("Incomplete payment gateway response")
	}
	if t, err := time.Parse(time.RFC3339Nano, jsString(payload["expiry_date"])); err == nil {
		inv.ExpiresAt = t
	}
	return inv, nil
}

// invoiceStatus mirrors GET /v2/invoices/{id}: PENDING, PAID, SETTLED or EXPIRED.
func (g *XenditGateway) invoiceStatus(ctx context.Context, invoiceID string) (string, error) {
	if g.mockInvoices() && strings.HasPrefix(invoiceID, "mock-") {
		return "PAID", nil
	}
	status, raw, err := g.do(ctx, http.MethodGet, "/v2/invoices/"+url.PathEscape(invoiceID), g.Getenv("XENDIT_SECRET_KEY"), nil)
	if err != nil {
		return "", err
	}
	payload, _ := raw.(map[string]any)
	if status < 200 || status > 299 {
		return "", fmt.Errorf("Failed to fetch invoice (%d)", status)
	}
	return strings.ToUpper(jsString(payload["status"])), nil
}

func (g *XenditGateway) do(ctx context.Context, method, path, secretKey string, body any) (int, any, error) {
	return g.send(ctx, method, path, secretKey, "2022-07-31", nil, body)
}

// send calls the Xendit API with basic auth. apiVersion "" sends no
// api-version header; headers are added as given.
func (g *XenditGateway) send(ctx context.Context, method, path, secretKey, apiVersion string, headers map[string]string, body any) (int, any, error) {
	var raw []byte
	if body != nil {
		var err error
		if raw, err = json.Marshal(body); err != nil {
			return 0, nil, err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, g.BaseURL+path, bytes.NewReader(raw))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(secretKey+":")))
	if apiVersion != "" {
		req.Header.Set("api-version", apiVersion)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := g.Client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer res.Body.Close()
	var payload any
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		payload = map[string]any{}
	}
	return res.StatusCode, payload, nil
}

// CreateQR mirrors createXenditDynamicQr (POST /qr_codes) with the row's
// secret key.
func (g *XenditGateway) CreateQR(ctx context.Context, cfg *paygate.Config, in paygate.QRRequest) (*paygate.QR, error) {
	if cfg == nil || cfg.SecretKey == "" {
		return nil, errors.New(paygate.MsgNoSecret)
	}
	body := map[string]any{
		"reference_id": in.ReferenceID,
		"type":         "DYNAMIC",
		"currency":     "IDR",
		"amount":       math.Floor(in.Amount + 0.5),
	}
	if in.CallbackURL != "" {
		body["callback_url"] = in.CallbackURL
	}
	if in.Description != "" {
		body["description"] = in.Description
	}
	status, raw, err := g.do(ctx, http.MethodPost, "/qr_codes", cfg.SecretKey, body)
	if err != nil {
		return nil, err
	}
	payload, _ := raw.(map[string]any)
	if status < 200 || status > 299 {
		if msg, ok := payload["message"].(string); ok && msg != "" {
			return nil, errors.New(msg)
		}
		if code, ok := payload["error_code"].(string); ok && code != "" {
			return nil, errors.New(code)
		}
		return nil, fmt.Errorf("Failed to create QRIS (%d)", status)
	}
	qr := &paygate.QR{ID: jsString(payload["id"]), QRString: jsString(payload["qr_string"]), ExpiresAt: jsString(payload["expires_at"])}
	if qr.ID == "" || qr.QRString == "" {
		return nil, errors.New("Incomplete payment gateway response")
	}
	return qr, nil
}

// Status reads a QR's payments (GET /qr_codes/{id}/payments) or an
// invoice's status. A Xendit QR never reports expiry; the caller's own
// expires_at closes it.
func (g *XenditGateway) Status(ctx context.Context, cfg *paygate.Config, ref paygate.Ref) (*paygate.Status, error) {
	if ref.QRID != "" {
		if cfg == nil || cfg.SecretKey == "" {
			return nil, errors.New(paygate.MsgNoSecret)
		}
		payments, err := g.qrPayments(ctx, cfg.SecretKey, ref.QRID)
		if err != nil {
			return nil, err
		}
		if paymentID, paid := pickPaidPayment(payments); paid {
			return &paygate.Status{State: paygate.StatePaid, PaymentID: paymentID, Raw: "SUCCEEDED"}, nil
		}
		return &paygate.Status{State: paygate.StatePending}, nil
	}
	if ref.HostedID == "" {
		return &paygate.Status{State: paygate.StatePending}, nil
	}
	status, err := g.invoiceStatus(ctx, ref.HostedID)
	if err != nil {
		return nil, err
	}
	st := &paygate.Status{State: paygate.StatePending, Raw: status}
	switch status {
	case "PAID", "SETTLED":
		st.State = paygate.StatePaid
	case "EXPIRED":
		st.State = paygate.StateExpired
	}
	return st, nil
}

// Cancel is a no-op: a dynamic QR expires on its own and the webhook
// still settles a late payment, which the purchase then honours.
func (g *XenditGateway) Cancel(context.Context, *paygate.Config, paygate.Ref) error { return nil }

// qrPayments mirrors getXenditQrPayments.
func (g *XenditGateway) qrPayments(ctx context.Context, secretKey, qrID string) ([]map[string]any, error) {
	status, raw, err := g.do(ctx, http.MethodGet, "/qr_codes/"+url.PathEscape(qrID)+"/payments", secretKey, nil)
	if err != nil {
		return nil, err
	}
	if status < 200 || status > 299 {
		if payload, ok := raw.(map[string]any); ok {
			if msg, ok := payload["message"].(string); ok {
				return nil, errors.New(msg)
			}
		}
		return nil, fmt.Errorf("Failed to fetch QRIS payments (%d)", status)
	}
	if list, ok := raw.([]any); ok {
		return objects(list), nil
	}
	payload, _ := raw.(map[string]any)
	if list, ok := payload["payments"].([]any); ok {
		return objects(list), nil
	}
	if list, ok := payload["data"].([]any); ok {
		return objects(list), nil
	}
	return nil, nil
}

// paidStatuses are the Xendit payment statuses that mean money arrived.
var paidStatuses = map[string]bool{"SUCCEEDED": true, "SUCCESS": true, "COMPLETED": true, "PAID": true}

// pickPaidPayment returns the id of the first successful payment, or "".
func pickPaidPayment(rows []map[string]any) (string, bool) {
	for _, row := range rows {
		if !paidStatuses[strings.ToUpper(jsString(row["status"]))] {
			continue
		}
		id := jsString(row["id"])
		if id == "" {
			id = jsString(row["payment_id"])
		}
		return id, true
	}
	return "", false
}

func objects(list []any) []map[string]any {
	out := make([]map[string]any, 0, len(list))
	for _, item := range list {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}
