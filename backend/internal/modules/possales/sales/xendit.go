package sales

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/platform/database"
)

// XenditConfig is the active Xendit gateway (configuration.payment_gateways).
type XenditConfig struct {
	SecretKey   string
	CallbackURL string
}

// CreatedQR is createXenditDynamicQr's result.
type CreatedQR struct {
	ID          string
	ReferenceID string
	QRString    string
	Amount      float64
	ExpiresAt   *string
}

// Gateway is the Xendit QRIS API (lib/payments/xendit.ts). Payment gateway
// settings belong to the settings context, which no wave ports, so the
// adapter lives here.
type Gateway interface {
	Config(ctx context.Context, q database.Querier) (*XenditConfig, error)
	CreateQR(ctx context.Context, secret, referenceID string, amount float64, callbackURL, description string) (*CreatedQR, error)
	GetQR(ctx context.Context, secret, qrID string) (map[string]any, error)
	GetQRByReference(ctx context.Context, secret, referenceID string) (map[string]any, error)
	QRPayments(ctx context.Context, secret, qrID string) ([]map[string]any, error)
}

// isGatewayConfigError matches the config errors the routes answer with 503.
var gatewayConfigError = regexp.MustCompile(`(?i)not configured|inactive|secret key is missing`)

// XenditHTTP is the Gateway over net/http. BaseURL defaults to
// XENDIT_API_BASE_URL or https://api.xendit.co.
type XenditHTTP struct {
	BaseURL string
	Client  *http.Client
}

// NewXenditHTTP reads XENDIT_API_BASE_URL like the TS module.
func NewXenditHTTP() *XenditHTTP {
	base := os.Getenv("XENDIT_API_BASE_URL")
	if base == "" {
		base = "https://api.xendit.co"
	}
	return &XenditHTTP{BaseURL: strings.TrimRight(base, "/"), Client: &http.Client{Timeout: 30 * time.Second}}
}

// Config is loadActiveXenditConfig.
func (x *XenditHTTP) Config(ctx context.Context, q database.Querier) (*XenditConfig, error) {
	var active *bool
	var secret, callback *string
	err := q.QueryRow(ctx, `SELECT is_active, secret_key, callback_url FROM configuration.payment_gateways WHERE provider = 'xendit' LIMIT 1`).
		Scan(&active, &secret, &callback)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("QRIS payment gateway is not configured. Set it in Settings → Payment Gateways.")
	}
	if err != nil {
		return nil, err
	}
	if active == nil || !*active {
		return nil, errors.New("QRIS payment gateway is inactive. Enable it in Settings → Payment Gateways.")
	}
	if secret == nil || domain.Trim(*secret) == "" {
		return nil, errors.New("Payment gateway secret key is missing.")
	}
	cfg := &XenditConfig{SecretKey: domain.Trim(*secret)}
	if callback != nil {
		cfg.CallbackURL = domain.Trim(*callback)
	}
	return cfg, nil
}

func (x *XenditHTTP) call(ctx context.Context, secret, method, path string, body any) (int, any, error) {
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, x.BaseURL+path, rd)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(secret+":")))
	req.Header.Set("api-version", "2022-07-31")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := x.Client.Do(req)
	if err != nil {
		return 0, nil, errors.New("fetch failed")
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var payload any
	if dec.Decode(&payload) != nil {
		payload = map[string]any{}
	}
	return res.StatusCode, payload, nil
}

func asObject(v any) map[string]any {
	m, _ := v.(map[string]any)
	if m == nil {
		return map[string]any{}
	}
	return m
}

func ok2xx(status int) bool { return status >= 200 && status < 300 }

// CreateQR is createXenditDynamicQr.
func (x *XenditHTTP) CreateQR(ctx context.Context, secret, referenceID string, amount float64, callbackURL, description string) (*CreatedQR, error) {
	body := map[string]any{
		"reference_id": referenceID,
		"type":         "DYNAMIC",
		"currency":     "IDR",
		"amount":       domain.RoundHalfUp(amount),
	}
	if callbackURL != "" {
		body["callback_url"] = callbackURL
	}
	if description != "" {
		body["description"] = description
	}
	status, raw, err := x.call(ctx, secret, http.MethodPost, "/qr_codes", body)
	if err != nil {
		return nil, err
	}
	p := asObject(raw)
	if !ok2xx(status) {
		if m, _ := p["message"].(string); m != "" {
			return nil, errors.New(m)
		}
		if c, _ := p["error_code"].(string); c != "" {
			return nil, errors.New(c)
		}
		return nil, fmt.Errorf("Failed to create QRIS (%d)", status)
	}
	qrString, id := domain.StrOr(p["qr_string"], ""), domain.StrOr(p["id"], "")
	if qrString == "" || id == "" {
		return nil, errors.New("Incomplete payment gateway response")
	}
	out := &CreatedQR{ID: id, ReferenceID: domain.StrOr(p["reference_id"], referenceID), QRString: qrString, Amount: qrAmount(p, amount)}
	if domain.Truthy(p["expires_at"]) {
		s := domain.String(p["expires_at"])
		out.ExpiresAt = &s
	}
	return out, nil
}

// GetQR is getXenditQrCode.
func (x *XenditHTTP) GetQR(ctx context.Context, secret, qrID string) (map[string]any, error) {
	status, raw, err := x.call(ctx, secret, http.MethodGet, "/qr_codes/"+url.PathEscape(qrID), nil)
	if err != nil {
		return nil, err
	}
	p := asObject(raw)
	if !ok2xx(status) {
		if m, _ := p["message"].(string); m != "" {
			return nil, errors.New(m)
		}
		return nil, fmt.Errorf("Failed to fetch QRIS status (%d)", status)
	}
	p["id"] = domain.StrOr(p["id"], qrID)
	return p, nil
}

// GetQRByReference is getXenditQrCodeByReferenceId.
func (x *XenditHTTP) GetQRByReference(ctx context.Context, secret, referenceID string) (map[string]any, error) {
	status, raw, err := x.call(ctx, secret, http.MethodGet, "/qr_codes?reference_id="+url.QueryEscape(referenceID), nil)
	if err != nil {
		return nil, err
	}
	if !ok2xx(status) {
		if m, _ := asObject(raw)["message"].(string); m != "" {
			return nil, errors.New(m)
		}
		return nil, fmt.Errorf("Failed to lookup QRIS (%d)", status)
	}
	var rows []any
	switch v := raw.(type) {
	case []any:
		rows = v
	case map[string]any:
		if d, ok := v["data"].([]any); ok {
			rows = d
		} else if domain.Truthy(v["id"]) {
			rows = []any{v}
		}
	}
	var row map[string]any
	if len(rows) > 0 {
		row, _ = rows[0].(map[string]any)
	}
	if row == nil || domain.StrOr(row["id"], "") == "" {
		return nil, errors.New("QRIS existing tidak ditemukan untuk checkout ini")
	}
	row["id"] = domain.String(row["id"])
	return row, nil
}

// QRPayments is getXenditQrPayments.
func (x *XenditHTTP) QRPayments(ctx context.Context, secret, qrID string) ([]map[string]any, error) {
	status, raw, err := x.call(ctx, secret, http.MethodGet, "/qr_codes/"+url.PathEscape(qrID)+"/payments", nil)
	if err != nil {
		return nil, err
	}
	if !ok2xx(status) {
		if m, _ := asObject(raw)["message"].(string); m != "" {
			return nil, errors.New(m)
		}
		return nil, fmt.Errorf("Failed to fetch QRIS payments (%d)", status)
	}
	if arr, ok := raw.([]any); ok {
		return objects(arr), nil
	}
	return paymentRows(asObject(raw)), nil
}

func objects(arr []any) []map[string]any {
	var out []map[string]any
	for _, r := range arr {
		if m, ok := r.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func paymentRows(p map[string]any) []map[string]any {
	if arr, ok := p["payments"].([]any); ok {
		return objects(arr)
	}
	if arr, ok := p["data"].([]any); ok {
		return objects(arr)
	}
	return nil
}

var paidQrStatuses = map[string]bool{"SUCCEEDED": true, "SUCCESS": true, "COMPLETED": true, "PAID": true}

// isXenditQrPaid is isXenditQrPaid.
func isXenditQrPaid(p map[string]any) bool {
	if paidQrStatuses[strings.ToUpper(domain.StrOr(p["status"], ""))] || paidQrStatuses[strings.ToUpper(domain.StrOr(p["payment_status"], ""))] {
		return true
	}
	for _, row := range paymentRows(p) {
		if paidQrStatuses[strings.ToUpper(domain.StrOr(row["status"], ""))] {
			return true
		}
	}
	return false
}

// qrAmount is `Number(qr.amount != null ? qr.amount : fallback) || fallback`.
func qrAmount(qr map[string]any, fallback float64) float64 {
	v, ok := qr["amount"]
	if !ok || v == nil {
		return fallback
	}
	n := domain.Number(v)
	if math.IsNaN(n) || n == 0 {
		return fallback
	}
	return n
}
