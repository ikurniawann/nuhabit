package tableorder

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/possales/tableorder/domain"
)

// Xendit is the QR code API client of lib/payments/xendit.ts that self-order
// uses. BaseURL defaults to XENDIT_API_BASE_URL or https://api.xendit.co;
// tests point it at an httptest server.
type Xendit struct {
	BaseURL string
	Client  *http.Client
}

// NewXendit reads XENDIT_API_BASE_URL.
func NewXendit() *Xendit {
	base := os.Getenv("XENDIT_API_BASE_URL")
	if base == "" {
		base = "https://api.xendit.co"
	}
	return &Xendit{BaseURL: strings.TrimRight(base, "/"), Client: &http.Client{Timeout: 30 * time.Second}}
}

// do sends a request and decodes the JSON body (an empty object when it is
// not JSON, like `response.json().catch(() => ({}))`).
func (x *Xendit) do(ctx context.Context, method, path, secretKey string, body any) (int, any, error) {
	var raw []byte
	if body != nil {
		var err error
		if raw, err = json.Marshal(body); err != nil {
			return 0, nil, err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, x.BaseURL+path, bytes.NewReader(raw))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(secretKey+":")))
	req.Header.Set("api-version", "2022-07-31")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := x.Client.Do(req)
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

func ok(status int) bool { return status >= 200 && status <= 299 }

// failure is the message of a non-2xx answer: payload.message, else fallback.
func failure(payload any, fallback string, status int) error {
	if m, isMap := payload.(map[string]any); isMap {
		if msg, isStr := m["message"].(string); isStr && msg != "" {
			return errors.New(msg)
		}
	}
	return fmt.Errorf("%s (%d)", fallback, status)
}

// QR is a QR code object (the raw payload; id always set).
type QR map[string]any

// QRCode is getXenditQrCode.
func (x *Xendit) QRCode(ctx context.Context, secretKey, qrID string) (QR, error) {
	status, raw, err := x.do(ctx, http.MethodGet, "/qr_codes/"+url.PathEscape(qrID), secretKey, nil)
	if err != nil {
		return nil, err
	}
	payload, _ := raw.(map[string]any)
	if !ok(status) {
		return nil, failure(raw, "Failed to fetch QRIS status", status)
	}
	if payload == nil {
		payload = map[string]any{}
	}
	if !domain.Truthy(payload["id"]) {
		payload["id"] = qrID
	}
	return payload, nil
}

// QRCodeByReference is getXenditQrCodeByReferenceId.
func (x *Xendit) QRCodeByReference(ctx context.Context, secretKey, referenceID string) (QR, error) {
	status, raw, err := x.do(ctx, http.MethodGet, "/qr_codes?reference_id="+url.QueryEscape(referenceID), secretKey, nil)
	if err != nil {
		return nil, err
	}
	if !ok(status) {
		return nil, failure(raw, "Failed to lookup QRIS", status)
	}
	var rows []any
	switch v := raw.(type) {
	case []any:
		rows = v
	case map[string]any:
		if data, isList := v["data"].([]any); isList {
			rows = data
		} else if domain.Truthy(v["id"]) {
			rows = []any{v}
		}
	}
	if len(rows) > 0 {
		if row, isMap := rows[0].(map[string]any); isMap && domain.Truthy(row["id"]) {
			return row, nil
		}
	}
	return nil, errors.New("QRIS existing tidak ditemukan untuk checkout ini")
}

// QRPayments is getXenditQrPayments: the payment rows as decoded.
func (x *Xendit) QRPayments(ctx context.Context, secretKey, qrID string) ([]any, error) {
	status, raw, err := x.do(ctx, http.MethodGet, "/qr_codes/"+url.PathEscape(qrID)+"/payments", secretKey, nil)
	if err != nil {
		return nil, err
	}
	if !ok(status) {
		return nil, failure(raw, "Failed to fetch QRIS payments", status)
	}
	if list, isList := raw.([]any); isList {
		return list, nil
	}
	payload, _ := raw.(map[string]any)
	if list, isList := payload["payments"].([]any); isList {
		return list, nil
	}
	list, _ := payload["data"].([]any)
	return list, nil
}

// CreatedQR is CreateXenditQrResult without the raw payload.
type CreatedQR struct {
	ID          string
	ReferenceID string
	QRString    string
	Amount      float64
	ExpiresAt   *string
}

// CreateDynamicQR is createXenditDynamicQr.
func (x *Xendit) CreateDynamicQR(ctx context.Context, secretKey, referenceID string, amount float64, callbackURL, description string) (*CreatedQR, error) {
	body := map[string]any{"reference_id": referenceID, "type": "DYNAMIC", "currency": "IDR", "amount": domain.JSRound(amount)}
	if callbackURL != "" {
		body["callback_url"] = callbackURL
	}
	if description != "" {
		body["description"] = description
	}
	status, raw, err := x.do(ctx, http.MethodPost, "/qr_codes", secretKey, body)
	if err != nil {
		return nil, err
	}
	payload, _ := raw.(map[string]any)
	if !ok(status) {
		if msg, isStr := payload["message"].(string); isStr && msg != "" {
			return nil, errors.New(msg)
		}
		if code, isStr := payload["error_code"].(string); isStr && code != "" {
			return nil, errors.New(code)
		}
		return nil, fmt.Errorf("Failed to create QRIS (%d)", status)
	}
	qr := &CreatedQR{
		ID:          domain.JSOr(payload["id"]),
		ReferenceID: domain.JSOr(payload["reference_id"]),
		QRString:    domain.JSOr(payload["qr_string"]),
		Amount:      domain.QRAmount(payload["amount"], amount),
		ExpiresAt:   expiresAt(payload["expires_at"]),
	}
	if qr.QRString == "" || qr.ID == "" {
		return nil, errors.New("Incomplete payment gateway response")
	}
	if qr.ReferenceID == "" {
		qr.ReferenceID = referenceID
	}
	return qr, nil
}

// expiresAt is `value ? String(value) : null`.
func expiresAt(v any) *string {
	if !domain.Truthy(v) {
		return nil
	}
	s := domain.JSString(v)
	return &s
}
