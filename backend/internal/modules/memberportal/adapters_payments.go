package memberportal

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
	"strings"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/database"
)

// xenditPayments ports the QRIS calls of lib/payments/xendit.ts against the
// configuration.payment_gateways row. XENDIT_API_BASE_URL overrides the API
// host for local mocks.
type xenditPayments struct {
	db      database.Querier
	baseURL func() string
	client  *http.Client
}

func newXenditPayments(db database.Querier, getenv func(string) string) *xenditPayments {
	return &xenditPayments{
		db: db,
		baseURL: func() string {
			base := getenv("XENDIT_API_BASE_URL")
			if base == "" {
				base = "https://api.xendit.co"
			}
			return strings.TrimRight(base, "/")
		},
		client: &http.Client{},
	}
}

// LoadConfig mirrors loadActiveXenditConfig, with its error messages.
func (x *xenditPayments) LoadConfig(ctx context.Context) (*XenditConfig, error) {
	rows, err := x.db.Query(ctx,
		`SELECT is_active, environment, secret_key, callback_url
		   FROM configuration.payment_gateways WHERE provider = 'xendit' LIMIT 2`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type row struct {
		active      bool
		environment string
		secret      *string
		callback    *string
	}
	var found []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.active, &r.environment, &r.secret, &r.callback); err != nil {
			return nil, err
		}
		found = append(found, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	switch {
	case len(found) == 0:
		return nil, errors.New("QRIS payment gateway is not configured. Set it in Settings → Payment Gateways.")
	case len(found) > 1:
		return nil, errors.New("JSON object requested, multiple (or no) rows returned")
	}
	r := found[0]
	if !r.active {
		return nil, errors.New("QRIS payment gateway is inactive. Enable it in Settings → Payment Gateways.")
	}
	if r.secret == nil || strings.TrimSpace(*r.secret) == "" {
		return nil, errors.New("Payment gateway secret key is missing.")
	}
	cfg := &XenditConfig{SecretKey: strings.TrimSpace(*r.secret), Environment: "sandbox"}
	if r.callback != nil {
		cfg.CallbackURL = strings.TrimSpace(*r.callback)
	}
	if r.environment == "live" {
		cfg.Environment = "live"
	}
	return cfg, nil
}

func (x *xenditPayments) authed(ctx context.Context, secret, method, path string, body any) (int, any, error) {
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, x.baseURL()+path, bytes.NewReader(raw))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", basicAuth(secret))
	req.Header.Set("api-version", "2022-07-31")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := x.client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	var payload any
	_ = json.NewDecoder(resp.Body).Decode(&payload)
	return resp.StatusCode, payload, nil
}

// CreateDynamicQR mirrors createXenditDynamicQr (POST /qr_codes).
func (x *xenditPayments) CreateDynamicQR(ctx context.Context, secretKey, referenceID string, amount float64, callbackURL, description string) (*XenditQR, error) {
	body := map[string]any{
		"reference_id": referenceID,
		"type":         "DYNAMIC",
		"currency":     "IDR",
		"amount":       math.Floor(amount + 0.5),
	}
	if callbackURL != "" {
		body["callback_url"] = callbackURL
	}
	if description != "" {
		body["description"] = description
	}
	status, raw, err := x.authed(ctx, secretKey, http.MethodPost, "/qr_codes", body)
	if err != nil {
		return nil, err
	}
	payload, _ := raw.(map[string]any)
	if status < 200 || status > 299 {
		msg, _ := payload["message"].(string)
		if msg == "" {
			msg, _ = payload["error_code"].(string)
		}
		if msg == "" {
			msg = fmt.Sprintf("Failed to create QRIS (%d)", status)
		}
		return nil, errors.New(msg)
	}
	qr := &XenditQR{ID: domain.JSString(payload["id"]), QRString: domain.JSString(payload["qr_string"]), Status: domain.JSString(payload["status"])}
	if qr.QRString == "" || qr.ID == "" {
		return nil, errors.New("Incomplete payment gateway response")
	}
	if qr.Status == "" {
		qr.Status = "ACTIVE"
	}
	qr.ExpiresAt = domain.JSString(payload["expires_at"])
	return qr, nil
}

// QRPayments mirrors getXenditQrPayments (GET /qr_codes/{id}/payments).
func (x *xenditPayments) QRPayments(ctx context.Context, secretKey, qrID string) ([]map[string]any, error) {
	status, raw, err := x.authed(ctx, secretKey, http.MethodGet, "/qr_codes/"+url.PathEscape(qrID)+"/payments", nil)
	if err != nil {
		return nil, err
	}
	if status < 200 || status > 299 {
		msg := ""
		if m, isMap := raw.(map[string]any); isMap {
			msg, _ = m["message"].(string)
		}
		if msg == "" {
			msg = fmt.Sprintf("Failed to fetch QRIS payments (%d)", status)
		}
		return nil, errors.New(msg)
	}
	if list, isList := raw.([]any); isList {
		out := []map[string]any{}
		for _, item := range list {
			if m, isMap := item.(map[string]any); isMap {
				out = append(out, m)
			}
		}
		return out, nil
	}
	m, _ := raw.(map[string]any)
	return nonNil(domain.XenditPaymentRows(m)), nil
}

// QRCode mirrors getXenditQrCode (GET /qr_codes/{id}).
func (x *xenditPayments) QRCode(ctx context.Context, secretKey, qrID string) (map[string]any, error) {
	status, raw, err := x.authed(ctx, secretKey, http.MethodGet, "/qr_codes/"+url.PathEscape(qrID), nil)
	if err != nil {
		return nil, err
	}
	payload, _ := raw.(map[string]any)
	if payload == nil {
		payload = map[string]any{}
	}
	if status < 200 || status > 299 {
		msg, _ := payload["message"].(string)
		if msg == "" {
			msg = fmt.Sprintf("Failed to fetch QRIS status (%d)", status)
		}
		return nil, errors.New(msg)
	}
	if domain.JSString(payload["id"]) == "" {
		payload["id"] = qrID
	}
	return payload, nil
}

// basicAuth is the Authorization value for a secret-key-only Basic auth.
func basicAuth(secret string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(secret+":"))
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
