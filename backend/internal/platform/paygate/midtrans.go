package paygate

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/localtime"
)

// MidtransClient is the Midtrans adapter (docs: backend/docs/MIDTRANS.md).
// Hosted checkout is a Snap transaction (POST {app}/snap/v1/transactions);
// the QR flow is a Core API QRIS charge (POST {api}/v2/charge); status and
// cancel are GET {api}/v2/{order_id}/status and POST {api}/v2/{order_id}/cancel.
// Sandbox and production differ only in host; the active row's
// environment picks it. MIDTRANS_MOCK=1 (local dev only) answers every call
// without the network: QR strings are fake and Status reports paid.
type MidtransClient struct {
	// APIBase and SnapBase override the per-environment hosts (tests).
	APIBase, SnapBase string
	Client            *http.Client
	Getenv            func(string) string
	Now               func() time.Time
}

const (
	midtransAPISandbox  = "https://api.sandbox.midtrans.com"
	midtransAPILive     = "https://api.midtrans.com"
	midtransSnapSandbox = "https://app.sandbox.midtrans.com"
	midtransSnapLive    = "https://app.midtrans.com"
	// midtransQRISAcquirer is the QRIS acquirer of the Core API charge.
	midtransQRISAcquirer = "gopay"
	midtransMockPrefix   = "mock-midtrans-"
)

var _ Adapter = (*MidtransClient)(nil)

// NewMidtrans reads MIDTRANS_API_BASE_URL and MIDTRANS_SNAP_BASE_URL (a
// local stand-in in tests) from getenv (nil = the process environment).
func NewMidtrans(getenv func(string) string) *MidtransClient {
	if getenv == nil {
		getenv = os.Getenv
	}
	return &MidtransClient{
		APIBase: strings.TrimRight(getenv("MIDTRANS_API_BASE_URL"), "/"), SnapBase: strings.TrimRight(getenv("MIDTRANS_SNAP_BASE_URL"), "/"),
		Client: &http.Client{Timeout: 30 * time.Second}, Getenv: getenv, Now: time.Now,
	}
}

func (m *MidtransClient) Provider() Provider { return Midtrans }

func (m *MidtransClient) mock() bool { return m.Getenv("MIDTRANS_MOCK") == "1" }

func (m *MidtransClient) now() time.Time {
	if m.Now == nil {
		return time.Now()
	}
	return m.Now()
}

func (m *MidtransClient) apiBase(cfg *Config) string {
	if m.APIBase != "" {
		return m.APIBase
	}
	if cfg.Live() {
		return midtransAPILive
	}
	return midtransAPISandbox
}

func (m *MidtransClient) snapBase(cfg *Config) string {
	if m.SnapBase != "" {
		return m.SnapBase
	}
	if cfg.Live() {
		return midtransSnapLive
	}
	return midtransSnapSandbox
}

// HostedProblem: Snap needs the active Midtrans row (its server key).
func (m *MidtransClient) HostedProblem(cfg *Config) string {
	if m.mock() {
		return ""
	}
	if cfg == nil || cfg.Provider != Midtrans || cfg.SecretKey == "" {
		return "Midtrans belum aktif di Settings → Payment Gateways"
	}
	return ""
}

// midtransAmount is gross_amount: whole rupiah.
func midtransAmount(amount float64) int64 { return int64(math.Floor(amount + 0.5)) }

// transactionDetails builds transaction_details plus one item line, since
// Midtrans checks that item prices add up to gross_amount when items are sent.
func transactionDetails(referenceID string, amount float64, description string) map[string]any {
	name := description
	if len(name) > 50 {
		name = name[:50]
	}
	if name == "" {
		name = "Pembayaran"
	}
	gross := midtransAmount(amount)
	return map[string]any{
		"transaction_details": map[string]any{"order_id": referenceID, "gross_amount": gross},
		"item_details":        []map[string]any{{"id": referenceID, "price": gross, "quantity": 1, "name": name}},
	}
}

// CreateQR charges a Core API QRIS. A 402 (the account has no QRIS channel)
// is ErrQRUnavailable so the caller can fall back to Snap.
func (m *MidtransClient) CreateQR(ctx context.Context, cfg *Config, req QRRequest) (*QR, error) {
	if m.mock() {
		return &QR{ID: midtransMockPrefix + req.ReferenceID, QRString: "MOCK-MIDTRANS-QRIS-" + req.ReferenceID,
			ExpiresAt: m.now().Add(orDuration(req.Expiry, 30*time.Minute)).UTC().Format(time.RFC3339)}, nil
	}
	if cfg == nil || cfg.SecretKey == "" {
		return nil, errors.New(MsgNoSecret)
	}
	body := transactionDetails(req.ReferenceID, req.Amount, req.Description)
	body["payment_type"] = "qris"
	body["qris"] = map[string]any{"acquirer": midtransQRISAcquirer}
	if req.Expiry > 0 {
		body["custom_expiry"] = map[string]any{"expiry_duration": int(math.Ceil(req.Expiry.Minutes())), "unit": "minute"}
	}
	status, payload, err := m.call(ctx, http.MethodPost, m.apiBase(cfg)+"/v2/charge", cfg.SecretKey, body)
	if err != nil {
		return nil, err
	}
	code := midtransStatusCode(status, payload)
	if code == 402 {
		return nil, ErrQRUnavailable
	}
	if code < 200 || code > 299 {
		return nil, midtransError("Midtrans menolak pembuatan QRIS", code, payload)
	}
	qr := &QR{ID: str(payload["transaction_id"]), QRString: str(payload["qr_string"]), ExpiresAt: midtransTime(str(payload["expiry_time"]))}
	if actions, ok := payload["actions"].([]any); ok {
		for _, a := range actions {
			if action, _ := a.(map[string]any); str(action["name"]) == "generate-qr-code" {
				qr.ImageURL = str(action["url"])
			}
		}
	}
	if qr.ID == "" || (qr.QRString == "" && qr.ImageURL == "") {
		return nil, errors.New("Incomplete payment gateway response")
	}
	return qr, nil
}

// CreateHosted creates a Snap transaction; the payer opens redirect_url.
func (m *MidtransClient) CreateHosted(ctx context.Context, cfg *Config, req HostedRequest) (*Hosted, error) {
	expiry := orDuration(req.Expiry, 2*time.Hour)
	expiresAt := m.now().Add(expiry)
	if m.mock() {
		return &Hosted{ID: midtransMockPrefix + req.ReferenceID, URL: req.RedirectURL, ExpiresAt: expiresAt, Mock: true}, nil
	}
	if problem := m.HostedProblem(cfg); problem != "" {
		return nil, errors.New(problem)
	}
	body := transactionDetails(req.ReferenceID, req.Amount, req.Description)
	body["expiry"] = map[string]any{"unit": "minutes", "duration": int(math.Ceil(expiry.Minutes()))}
	if req.RedirectURL != "" {
		body["callbacks"] = map[string]any{"finish": req.RedirectURL}
	}
	customer := map[string]any{}
	if req.PayerName != "" {
		customer["first_name"] = req.PayerName
	}
	if req.PayerEmail != "" {
		customer["email"] = req.PayerEmail
	}
	if req.PayerPhone != "" {
		customer["phone"] = req.PayerPhone
	}
	if len(customer) > 0 {
		body["customer_details"] = customer
	}
	status, payload, err := m.call(ctx, http.MethodPost, m.snapBase(cfg)+"/snap/v1/transactions", cfg.SecretKey, body)
	if err != nil {
		return nil, err
	}
	if status < 200 || status > 299 {
		return nil, midtransError("Midtrans menolak pembuatan transaksi Snap", status, payload)
	}
	h := &Hosted{ID: str(payload["token"]), URL: str(payload["redirect_url"]), ExpiresAt: expiresAt}
	if h.ID == "" || h.URL == "" {
		return nil, errors.New("Incomplete payment gateway response")
	}
	return h, nil
}

// Status reads GET /v2/{order_id}/status. A 404 is a Snap page the payer
// never chose a method on: Midtrans has no transaction yet, so it is pending.
func (m *MidtransClient) Status(ctx context.Context, cfg *Config, ref Ref) (*Status, error) {
	if m.mock() {
		return &Status{State: StatePaid, PaymentID: midtransMockPrefix + ref.ReferenceID, Raw: "settlement"}, nil
	}
	if cfg == nil || cfg.SecretKey == "" {
		return nil, errors.New(MsgNoSecret)
	}
	status, payload, err := m.call(ctx, http.MethodGet, m.apiBase(cfg)+"/v2/"+url.PathEscape(ref.ReferenceID)+"/status", cfg.SecretKey, nil)
	if err != nil {
		return nil, err
	}
	code := midtransStatusCode(status, payload)
	if code == 404 {
		return &Status{State: StatePending}, nil
	}
	if code < 200 || code > 299 {
		return nil, midtransError("Gagal membaca status Midtrans", code, payload)
	}
	amount, _ := strconv.ParseFloat(str(payload["gross_amount"]), 64)
	return &Status{
		State: MapState(str(payload["transaction_status"]), str(payload["fraud_status"])), PaymentID: str(payload["transaction_id"]),
		Raw: str(payload["transaction_status"]), Amount: amount,
	}, nil
}

// Cancel posts /v2/{order_id}/cancel. 412 means Midtrans will not change
// the status any more (settled or already closed): ErrNotCancelable. A 404
// has nothing to cancel.
func (m *MidtransClient) Cancel(ctx context.Context, cfg *Config, ref Ref) error {
	if m.mock() {
		return nil
	}
	if cfg == nil || cfg.SecretKey == "" {
		return errors.New(MsgNoSecret)
	}
	status, payload, err := m.call(ctx, http.MethodPost, m.apiBase(cfg)+"/v2/"+url.PathEscape(ref.ReferenceID)+"/cancel", cfg.SecretKey, nil)
	if err != nil {
		return err
	}
	switch code := midtransStatusCode(status, payload); {
	case code == 404 || (code >= 200 && code <= 299):
		return nil
	case code == 412:
		return ErrNotCancelable
	default:
		return midtransError("Gagal membatalkan transaksi Midtrans", code, payload)
	}
}

// TestConnection checks the server key against the environment's status
// endpoint with an order id that cannot exist: 404 means the key was
// accepted, 401 that it was not.
func (m *MidtransClient) TestConnection(ctx context.Context, cfg *Config) error {
	if cfg == nil || cfg.SecretKey == "" {
		return errors.New("Server key belum diisi")
	}
	probe := make([]byte, 8)
	_, _ = rand.Read(probe)
	status, payload, err := m.call(ctx, http.MethodGet, m.apiBase(cfg)+"/v2/nuhabit-ping-"+hex.EncodeToString(probe)+"/status", cfg.SecretKey, nil)
	if err != nil {
		return fmt.Errorf("Midtrans tidak dapat dihubungi: %w", err)
	}
	switch code := midtransStatusCode(status, payload); code {
	case 404:
		return nil
	case 401:
		return errors.New("Server key ditolak Midtrans (401). Periksa key dan environment-nya.")
	default:
		return midtransError("Jawaban Midtrans tidak terduga", code, payload)
	}
}

// call sends a JSON request with Basic auth (server key, empty password)
// and decodes the JSON answer ({} when unreadable).
func (m *MidtransClient) call(ctx context.Context, method, target, serverKey string, body any) (int, map[string]any, error) {
	var raw []byte
	if body != nil {
		var err error
		if raw, err = json.Marshal(body); err != nil {
			return 0, nil, err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(raw))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(serverKey+":")))
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := m.Client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer res.Body.Close()
	payload := map[string]any{}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		payload = map[string]any{}
	}
	return res.StatusCode, payload, nil
}

// midtransStatusCode prefers the body's status_code (Midtrans answers 200
// HTTP with a status_code of its own on some endpoints) over the HTTP status.
func midtransStatusCode(httpStatus int, payload map[string]any) int {
	if code, err := strconv.Atoi(str(payload["status_code"])); err == nil && code > 0 {
		return code
	}
	return httpStatus
}

// midtransError wraps a rejection with its message, never the request.
func midtransError(prefix string, code int, payload map[string]any) error {
	msg := str(payload["status_message"])
	for _, key := range []string{"error_messages", "validation_messages"} {
		if list, ok := payload[key].([]any); ok && len(list) > 0 {
			parts := make([]string, 0, len(list))
			for _, v := range list {
				parts = append(parts, str(v))
			}
			msg = strings.Join(parts, "; ")
		}
	}
	if msg == "" {
		return fmt.Errorf("%s (HTTP %d)", prefix, code)
	}
	return fmt.Errorf("%s (HTTP %d): %s", prefix, code, msg)
}

// MapState maps transaction_status and fraud_status to a State. settlement
// is money received; capture (cards) counts as paid unless the fraud check
// challenged or denied it. authorize and pending wait; expire, cancel,
// deny and failure close the payment; the refund and chargeback statuses
// are reversals after payment.
func MapState(transactionStatus, fraudStatus string) State {
	switch strings.ToLower(strings.TrimSpace(transactionStatus)) {
	case "settlement":
		return StatePaid
	case "capture":
		switch strings.ToLower(strings.TrimSpace(fraudStatus)) {
		case "challenge":
			return StatePending
		case "deny":
			return StateFailed
		}
		return StatePaid
	case "pending", "authorize":
		return StatePending
	case "expire":
		return StateExpired
	case "cancel":
		return StateCanceled
	case "deny", "failure":
		return StateFailed
	case "refund", "partial_refund", "chargeback", "partial_chargeback":
		return StateRefunded
	}
	return StatePending
}

// Notification is a Midtrans HTTP notification (webhook) body.
type Notification struct {
	OrderID           string
	TransactionID     string
	TransactionStatus string
	FraudStatus       string
	StatusCode        string
	PaymentType       string
	SignatureKey      string
	// GrossAmount is the literal from the body ("300000.00"): the signature
	// covers it character for character.
	GrossAmount string
}

// ParseNotification reads the notification fields; ok=false without an
// order_id. Numbers keep their literal text so gross_amount matches what
// Midtrans signed.
func ParseNotification(raw []byte) (Notification, bool) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var body map[string]any
	if err := dec.Decode(&body); err != nil {
		return Notification{}, false
	}
	n := Notification{
		OrderID: str(body["order_id"]), TransactionID: str(body["transaction_id"]), TransactionStatus: str(body["transaction_status"]),
		FraudStatus: str(body["fraud_status"]), StatusCode: str(body["status_code"]), PaymentType: str(body["payment_type"]),
		SignatureKey: str(body["signature_key"]), GrossAmount: str(body["gross_amount"]),
	}
	return n, n.OrderID != ""
}

// Amount is gross_amount as a number (0 when unreadable).
func (n Notification) Amount() float64 {
	v, err := strconv.ParseFloat(n.GrossAmount, 64)
	if err != nil || math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

// State maps the notification's statuses.
func (n Notification) State() State { return MapState(n.TransactionStatus, n.FraudStatus) }

// Verify checks signature_key = SHA-512(order_id + status_code +
// gross_amount + server key) in constant time. An empty key or signature
// never verifies.
func (n Notification) Verify(serverKey string) bool {
	return VerifySignature(n.SignatureKey, n.OrderID, n.StatusCode, n.GrossAmount, serverKey)
}

// VerifySignature is the signature check on its own fields.
func VerifySignature(signature, orderID, statusCode, grossAmount, serverKey string) bool {
	if signature == "" || serverKey == "" {
		return false
	}
	sum := sha512.Sum512([]byte(orderID + statusCode + grossAmount + serverKey))
	want := hex.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(strings.ToLower(strings.TrimSpace(signature))), []byte(want)) == 1
}

// Sign computes signature_key as Midtrans does (tests and the dev simulator).
func Sign(orderID, statusCode, grossAmount, serverKey string) string {
	sum := sha512.Sum512([]byte(orderID + statusCode + grossAmount + serverKey))
	return hex.EncodeToString(sum[:])
}

// midtransTime parses "2023-01-05 11:01:39" (Jakarta time) to RFC 3339; "" stays "".
func midtransTime(s string) string {
	if s == "" {
		return ""
	}
	t, err := time.ParseInLocation(time.DateTime, s, localtime.Jakarta)
	if err != nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func orDuration(d, def time.Duration) time.Duration {
	if d > 0 {
		return d
	}
	return def
}

// str is the string of a JSON scalar ("" for anything else).
func str(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case json.Number:
		return x.String()
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	}
	return ""
}
