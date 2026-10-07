package app

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

	"github.com/jackc/pgx/v5/pgxpool"

	"nuhabit/backend/internal/modules/crm"
	"nuhabit/backend/internal/modules/possales/adapters"
	"nuhabit/backend/internal/modules/possales/sales"
	"nuhabit/backend/internal/modules/storedvalue"
	"nuhabit/backend/internal/modules/storedvalue/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/whatsapp"
)

// storedValuePorts wires the stored-value ports. POS checkout builds the
// exported services with the same ports (storedvalue.NewWallet etc.).
func storedValuePorts(d module.Deps) storedvalue.Ports {
	return storedvalue.Ports{
		Directory:   svDirectory{},
		Loyalty:     svLoyalty{engine: crm.NewEngine(d, crmPosReads{})},
		Supervisors: svSupervisors{pins: sales.NewSupervisors(d.DB, adapters.Directory{}, d.Now)},
		WhatsApp:    svWhatsApp{wa: whatsapp.New(d.Log), pool: d.DB, now: d.Now},
		Gateway:     newSvXendit(os.Getenv),
		Orders:      svBillOrders{},
		GiftCards:   storedValueGiftCardPorts(d),
		Promo:       storedValuePromoPorts(d),
	}
}

/* ── WhatsApp (lib/whatsapp, lib/wa/comp-notification) ───────────────── */

type svWhatsApp struct {
	wa   *whatsapp.Client
	pool *pgxpool.Pool
	now  func() time.Time
}

func (w svWhatsApp) SendText(ctx context.Context, target, message, messageType string, sentByUserID *string) storedvalue.WADelivery {
	by := ""
	if sentByUserID != nil {
		by = *sentByUserID
	}
	res := w.wa.SendText(ctx, w.pool, target, message, messageType, by)
	return storedvalue.WADelivery{Delivered: res.Success, Reason: res.Reason}
}

// compNotifTarget is COMP_NOTIF_TARGET (the owner's number).
const compNotifTarget = "6281809078014"

// NotifyFocTopup is notifyFocTopup: claim the dedup row, send through the
// gateway, release the claim on a clear failure (a timeout keeps it, so
// at most once). Errors are only logged.
func (w svWhatsApp) NotifyFocTopup(ctx context.Context, n storedvalue.FocTopupNotice) {
	customer := ""
	var name *string
	if err := w.pool.QueryRow(ctx, `SELECT name FROM pos.pos_customers WHERE id = $1`, n.CustomerID).Scan(&name); err == nil && name != nil {
		customer = strings.TrimSpace(*name)
	}
	approved := ""
	if n.ApprovedName != nil {
		approved = strings.TrimSpace(*n.ApprovedName)
	}
	message := strings.Join([]string{
		"NüHabit OS — Topup FOC (Gratis)",
		"Customer : " + orDash(customer),
		"Saldo ARK : Rp " + domain.GroupThousands(int64(domain.JSRound(n.AmountIdr))) + " (tanpa pembayaran, tanpa XP)",
		"Disetujui : " + orDash(approved),
		domain.JamWib(w.now()) + " WIB",
	}, "\n")
	key := "foc-topup:" + n.TransactionID
	if len(key) > 160 {
		key = key[:160]
	}
	claimID, err := whatsapp.Claim(ctx, w.pool, "komplimen", key, message, []string{compNotifTarget})
	if err != nil {
		w.wa.Log.Error("[wa-comp] notifikasi topup FOC error", "error", err.Error())
	}
	if claimID == "" {
		return
	}
	release := func() { _ = whatsapp.Release(ctx, w.pool, claimID) }
	gateway := w.wa.LoadGateway(ctx, w.pool)
	if gateway == nil {
		w.wa.Log.Warn("[wa-comp] gateway belum dikonfigurasi — notifikasi komplimen dilewati")
		release()
		return
	}
	if res := gateway.SendText(ctx, compNotifTarget, message); !res.Success && !res.TimedOut {
		w.wa.Log.Error("[wa-comp] gagal kirim", "target", compNotifTarget, "reason", res.Reason)
		release()
	}
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

/* ── Xendit QRIS (lib/payments/xendit.ts) ────────────────────────────── */

type svXendit struct {
	baseURL string
	client  *http.Client
}

func newSvXendit(getenv func(string) string) svXendit {
	base := getenv("XENDIT_API_BASE_URL")
	if base == "" {
		base = "https://api.xendit.co"
	}
	return svXendit{baseURL: strings.TrimRight(base, "/"), client: &http.Client{Timeout: 30 * time.Second}}
}

// LoadConfig is loadActiveXenditConfig, with its error messages.
func (x svXendit) LoadConfig(ctx context.Context, q database.Querier) (*storedvalue.XenditConfig, error) {
	var active bool
	var environment string
	var secret, callback *string
	err := q.QueryRow(ctx,
		`SELECT is_active, environment, secret_key, callback_url
		   FROM configuration.payment_gateways WHERE provider = 'xendit' LIMIT 1`).Scan(&active, &environment, &secret, &callback)
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
	cfg := &storedvalue.XenditConfig{SecretKey: strings.TrimSpace(*secret), Environment: "sandbox"}
	if callback != nil {
		cfg.CallbackURL = strings.TrimSpace(*callback)
	}
	if environment == "live" {
		cfg.Environment = "live"
	}
	return cfg, nil
}

func (x svXendit) call(ctx context.Context, method, path, secret string, body any) (int, any, error) {
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, x.baseURL+path, bytes.NewReader(raw))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(secret+":")))
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

func ok2xx(status int) bool { return status >= 200 && status <= 299 }

// CreateDynamicQR is createXenditDynamicQr.
func (x svXendit) CreateDynamicQR(ctx context.Context, secret, referenceID string, amount float64, callbackURL, description string) (*storedvalue.XenditQR, error) {
	body := map[string]any{"reference_id": referenceID, "type": "DYNAMIC", "currency": "IDR", "amount": math.Floor(amount + 0.5)}
	if callbackURL != "" {
		body["callback_url"] = callbackURL
	}
	if description != "" {
		body["description"] = description
	}
	status, raw, err := x.call(ctx, http.MethodPost, "/qr_codes", secret, body)
	if err != nil {
		return nil, err
	}
	payload, _ := raw.(map[string]any)
	if !ok2xx(status) {
		msg := domain.JSOr(payload["message"])
		if msg == "" {
			msg = domain.JSOr(payload["error_code"])
		}
		if msg == "" {
			msg = fmt.Sprintf("Failed to create QRIS (%d)", status)
		}
		return nil, errors.New(msg)
	}
	qr := &storedvalue.XenditQR{ID: domain.JSOr(payload["id"]), QRString: domain.JSOr(payload["qr_string"]),
		Status: domain.JSOr(payload["status"]), ExpiresAt: domain.JSOr(payload["expires_at"])}
	if qr.ID == "" || qr.QRString == "" {
		return nil, errors.New("Incomplete payment gateway response")
	}
	if qr.Status == "" {
		qr.Status = "ACTIVE"
	}
	return qr, nil
}

func objectRows(list []any) []map[string]any {
	out := []map[string]any{}
	for _, item := range list {
		if m, isMap := item.(map[string]any); isMap {
			out = append(out, m)
		}
	}
	return out
}

// QRPayments is getXenditQrPayments.
func (x svXendit) QRPayments(ctx context.Context, secret, qrID string) ([]map[string]any, error) {
	status, raw, err := x.call(ctx, http.MethodGet, "/qr_codes/"+url.PathEscape(qrID)+"/payments", secret, nil)
	if err != nil {
		return nil, err
	}
	if !ok2xx(status) {
		payload, _ := raw.(map[string]any)
		if msg, isString := payload["message"].(string); isString && msg != "" {
			return nil, errors.New(msg)
		}
		return nil, fmt.Errorf("Failed to fetch QRIS payments (%d)", status)
	}
	if list, isList := raw.([]any); isList {
		return objectRows(list), nil
	}
	payload, _ := raw.(map[string]any)
	for _, key := range []string{"payments", "data"} {
		if list, isList := payload[key].([]any); isList {
			return objectRows(list), nil
		}
	}
	return []map[string]any{}, nil
}

// QRCode is getXenditQrCode.
func (x svXendit) QRCode(ctx context.Context, secret, qrID string) (map[string]any, error) {
	status, raw, err := x.call(ctx, http.MethodGet, "/qr_codes/"+url.PathEscape(qrID), secret, nil)
	if err != nil {
		return nil, err
	}
	payload, _ := raw.(map[string]any)
	if payload == nil {
		payload = map[string]any{}
	}
	if !ok2xx(status) {
		if msg, isString := payload["message"].(string); isString && msg != "" {
			return nil, errors.New(msg)
		}
		return nil, fmt.Errorf("Failed to fetch QRIS status (%d)", status)
	}
	if domain.JSOr(payload["id"]) == "" {
		payload["id"] = qrID
	}
	return payload, nil
}

/* ── Supervisor PIN (pos-sales approveWithSupervisorPin) ─────────────── */

type svSupervisors struct{ pins *sales.Supervisors }

func (a svSupervisors) Approve(ctx context.Context, callerID, pin string) (storedvalue.SupervisorApproval, error) {
	r, err := a.pins.Approve(ctx, callerID, pin)
	switch {
	case err != nil:
		return storedvalue.SupervisorApproval{}, err
	case r.Approver != nil:
		return storedvalue.SupervisorApproval{OK: true, Supervisor: storedvalue.ApprovedSupervisor{ID: r.Approver.ID, Name: r.Approver.Name}}, nil
	case r.RetryMinutes > 0:
		return storedvalue.SupervisorApproval{Reason: "locked", RetryMinutes: r.RetryMinutes}, nil
	}
	return storedvalue.SupervisorApproval{Reason: "invalid"}, nil
}
