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
// gateway row read from configuration.payment_gateways.
type XenditGateway struct {
	// BaseURL defaults to XENDIT_API_BASE_URL or https://api.xendit.co.
	BaseURL string
	Client  *http.Client
}

var _ QRISGateway = (*XenditGateway)(nil)

// NewXenditGateway reads XENDIT_API_BASE_URL (a local mock in tests).
func NewXenditGateway() *XenditGateway {
	base := os.Getenv("XENDIT_API_BASE_URL")
	if base == "" {
		base = "https://api.xendit.co"
	}
	return &XenditGateway{BaseURL: strings.TrimRight(base, "/"), Client: &http.Client{Timeout: 30 * time.Second}}
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
