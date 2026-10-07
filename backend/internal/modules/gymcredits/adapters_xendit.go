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

	"nuhabit/backend/internal/platform/database"
)

// XenditGateway is the QRIS adapter: the calls of
// frontend/src/lib/payments/xendit.ts that gym purchases use, with the
// gateway row read from configuration.payment_gateways. It is also the
// invoice adapter (lib/xendit/client.ts): hosted checkout pages keyed by
// XENDIT_SECRET_KEY, with the dev-only XENDIT_MOCK=1 mode.
type XenditGateway struct {
	// BaseURL defaults to XENDIT_API_BASE_URL or https://api.xendit.co.
	BaseURL string
	Client  *http.Client
	Getenv  func(string) string
}

var (
	_ QRISGateway    = (*XenditGateway)(nil)
	_ InvoiceGateway = (*XenditGateway)(nil)
)

// NewXenditGateway reads XENDIT_API_BASE_URL (a local mock in tests).
func NewXenditGateway() *XenditGateway {
	base := os.Getenv("XENDIT_API_BASE_URL")
	if base == "" {
		base = "https://api.xendit.co"
	}
	return &XenditGateway{BaseURL: strings.TrimRight(base, "/"), Client: &http.Client{Timeout: 30 * time.Second}, Getenv: os.Getenv}
}

const invoiceExpiryHours = 2

// mockInvoices is isXenditMock.
func (g *XenditGateway) mockInvoices() bool { return g.Getenv("XENDIT_MOCK") == "1" }

func (g *XenditGateway) InvoiceConfigured() bool {
	return g.Getenv("XENDIT_SECRET_KEY") != "" || g.mockInvoices()
}

// CreateInvoice mirrors createInvoice (POST /v2/invoices). In mock mode the
// invoice URL is the redirect URL itself and InvoiceStatus reports it paid.
func (g *XenditGateway) CreateInvoice(ctx context.Context, in InvoiceRequest) (*Invoice, error) {
	expiresAt := time.Now().Add(invoiceExpiryHours * time.Hour)
	if g.mockInvoices() {
		return &Invoice{ID: "mock-" + in.ExternalID, URL: in.RedirectURL, ExpiresAt: expiresAt, Mock: true}, nil
	}
	secret := g.Getenv("XENDIT_SECRET_KEY")
	if secret == "" {
		return nil, errors.New("XENDIT_SECRET_KEY belum dikonfigurasi")
	}
	status, raw, err := g.do(ctx, http.MethodPost, "/v2/invoices", secret, map[string]any{
		"external_id":          in.ExternalID,
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
	inv := &Invoice{ID: jsString(payload["id"]), URL: jsString(payload["invoice_url"]), ExpiresAt: expiresAt}
	if inv.ID == "" || inv.URL == "" {
		return nil, errors.New("Incomplete payment gateway response")
	}
	if t, err := time.Parse(time.RFC3339Nano, jsString(payload["expiry_date"])); err == nil {
		inv.ExpiresAt = t
	}
	return inv, nil
}

// InvoiceStatus mirrors GET /v2/invoices/{id}.
func (g *XenditGateway) InvoiceStatus(ctx context.Context, invoiceID string) (string, error) {
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

// ActiveConfig mirrors loadActiveXenditConfig, with its error messages.
func (g *XenditGateway) ActiveConfig(ctx context.Context, db database.Querier) (*XenditConfig, error) {
	var active bool
	var secret, callback *string
	var environment string
	err := db.QueryRow(ctx,
		`SELECT is_active, secret_key, callback_url, environment
		   FROM configuration.payment_gateways WHERE provider = 'xendit' LIMIT 1`,
	).Scan(&active, &secret, &callback, &environment)
	switch {
	case database.IsNoRows(err):
		return nil, errors.New("QRIS payment gateway is not configured. Set it in Settings → Payment Gateways.")
	case err != nil:
		return nil, err
	case !active:
		return nil, errors.New("QRIS payment gateway is inactive. Enable it in Settings → Payment Gateways.")
	case secret == nil || strings.TrimSpace(*secret) == "":
		return nil, errors.New("Payment gateway secret key is missing.")
	}
	cfg := &XenditConfig{SecretKey: strings.TrimSpace(*secret), Environment: "sandbox"}
	if callback != nil {
		cfg.CallbackURL = strings.TrimSpace(*callback)
	}
	if environment == "live" {
		cfg.Environment = "live"
	}
	return cfg, nil
}

func (g *XenditGateway) do(ctx context.Context, method, path, secretKey string, body any) (int, any, error) {
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
	req.Header.Set("api-version", "2022-07-31")
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

// CreateDynamicQR mirrors createXenditDynamicQr.
func (g *XenditGateway) CreateDynamicQR(ctx context.Context, in QRRequest) (*QRCode, error) {
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
	status, raw, err := g.do(ctx, http.MethodPost, "/qr_codes", in.SecretKey, body)
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
	qr := &QRCode{ID: jsString(payload["id"]), QRString: jsString(payload["qr_string"]), ExpiresAt: jsString(payload["expires_at"])}
	if qr.ID == "" || qr.QRString == "" {
		return nil, errors.New("Incomplete payment gateway response")
	}
	return qr, nil
}

// QRPayments mirrors getXenditQrPayments.
func (g *XenditGateway) QRPayments(ctx context.Context, secretKey, qrID string) ([]map[string]any, error) {
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

func objects(list []any) []map[string]any {
	out := make([]map[string]any, 0, len(list))
	for _, item := range list {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}
