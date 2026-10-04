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

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/modules/storedvalue"
	"nuhabit/backend/internal/modules/storedvalue/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// storedValuePorts wires the stored-value ports. POS checkout builds the
// exported services with the same ports (storedvalue.NewWallet etc.).
func storedValuePorts(d module.Deps) storedvalue.Ports {
	return storedvalue.Ports{
		Directory:   svDirectory{},
		Loyalty:     svLoyalty{engine: &xp.Engine{Pos: crmPosReads{}, Log: d.Log, Now: d.Now}},
		Supervisors: svSupervisors{db: d.DB, now: d.Now},
		WhatsApp:    svWhatsApp{wa: newPosOpsWhatsApp(d.DB, os.Getenv, d.Log), pool: d.DB, now: d.Now},
		Gateway:     newSvXendit(os.Getenv),
		Orders:      svBillOrders{},
		GiftCards:   storedValueGiftCardPorts(d),
		Promo:       storedValuePromoPorts(d),
	}
}

/* ── WhatsApp (lib/whatsapp, lib/wa/comp-notification) ───────────────── */

// svWhatsApp reuses the lib/whatsapp port of adapters_posops.go.
type svWhatsApp struct {
	wa   *posOpsWhatsApp
	pool *pgxpool.Pool
	now  func() time.Time
}

func (w svWhatsApp) SendText(ctx context.Context, target, message, messageType string, sentByUserID *string) storedvalue.WADelivery {
	by := ""
	if sentByUserID != nil {
		by = *sentByUserID
	}
	d := w.wa.SendText(ctx, target, message, by)
	return storedvalue.WADelivery{Delivered: d.Delivered, Reason: d.Reason}
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
	recipients, _ := json.Marshal([]string{compNotifTarget})
	var claimID string
	err := w.pool.QueryRow(ctx,
		`INSERT INTO configuration.wa_notif_log (notif_type, dedup_key, message, recipients)
		 VALUES ('komplimen', $1, $2, $3::jsonb)
		 ON CONFLICT (notif_type, dedup_key) DO NOTHING RETURNING id`, key, message, string(recipients)).Scan(&claimID)
	if err != nil {
		if !database.IsNoRows(err) {
			w.wa.log.Error("[wa-comp] notifikasi topup FOC error", "error", err.Error())
		}
		return
	}
	release := func() { _, _ = w.pool.Exec(ctx, `DELETE FROM configuration.wa_notif_log WHERE id = $1`, claimID) }
	cfg := w.wa.gatewayConfig(ctx)
	if cfg == nil {
		w.wa.log.Warn("[wa-comp] gateway belum dikonfigurasi — notifikasi komplimen dilewati")
		release()
		return
	}
	res := w.wa.sendGateway(ctx, cfg, compNotifTarget, message)
	if !res.delivered && res.reason != "Gateway tidak merespons (timeout)" {
		w.wa.log.Error("[wa-comp] gagal kirim", "target", compNotifTarget, "reason", res.reason)
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

/* ── Supervisor PIN (lib/pos/supervisor-pin-server.ts) ───────────────── */

// STOPGAP until pos-sales exposes approveWithSupervisorPin: the durable
// attempt limit of lib/security/attempt-limit.ts (scope pos_supervisor_pin,
// 5 failures in 15 minutes lock the cashier 15 minutes) and the PIN check
// of lib/pos/supervisor-pin.ts. bcryptjs hashes ($2a$/$2b$) are verified by
// pgcrypto crypt(); $2b$ is the same algorithm as $2a$ for short PINs.
type svSupervisors struct {
	db  *pgxpool.Pool
	now func() time.Time
}

const (
	pinScope       = "pos_supervisor_pin"
	pinMaxFailures = 5
	pinWindow      = 15 * time.Minute
	pinLockout     = 15 * time.Minute
)

type svScope struct {
	role, businessScope, company, branch *string
}

func (s svScope) unscoped() bool {
	return (s.role != nil && *s.role == "super_admin") || s.businessScope == nil || *s.businessScope == ""
}

// covers is isOperationalRowInBusinessScope(scope, unit).
func (s svScope) covers(company, branch *string) bool {
	if s.unscoped() {
		return true
	}
	differs := func(a, b *string) bool { return a != nil && *a != "" && b != nil && *b != "" && *a != *b }
	switch *s.businessScope {
	case "branch":
		return !differs(s.company, company) && !differs(branch, s.branch)
	case "company":
		return !differs(s.company, company)
	}
	return true
}

func minutesUntil(until, now time.Time) int {
	return max(1, int(math.Ceil(until.Sub(now).Minutes())))
}

func (a svSupervisors) Approve(ctx context.Context, callerID, pin string) (storedvalue.SupervisorApproval, error) {
	subject := "user:" + callerID
	now := a.now()
	var lockedUntil *time.Time
	err := a.db.QueryRow(ctx, `SELECT locked_until FROM auth.attempt_limits WHERE scope = $1 AND subject = $2`, pinScope, subject).Scan(&lockedUntil)
	if err != nil && !database.IsNoRows(err) {
		return storedvalue.SupervisorApproval{}, err
	}
	if lockedUntil != nil && lockedUntil.After(now) {
		return storedvalue.SupervisorApproval{Reason: "locked", RetryMinutes: minutesUntil(*lockedUntil, now)}, nil
	}
	sup, err := a.find(ctx, callerID, strings.TrimSpace(pin))
	if err != nil {
		return storedvalue.SupervisorApproval{}, err
	}
	if sup == nil {
		lock, err := a.recordFailure(ctx, subject)
		if err != nil {
			return storedvalue.SupervisorApproval{}, err
		}
		if lock != nil {
			return storedvalue.SupervisorApproval{Reason: "locked", RetryMinutes: minutesUntil(*lock, a.now())}, nil
		}
		return storedvalue.SupervisorApproval{Reason: "invalid"}, nil
	}
	if _, err := a.db.Exec(ctx, `DELETE FROM auth.attempt_limits WHERE scope = $1 AND subject = ANY($2::text[])`, pinScope, []string{subject}); err != nil {
		return storedvalue.SupervisorApproval{}, err
	}
	return storedvalue.SupervisorApproval{OK: true, Supervisor: *sup}, nil
}

// find returns the in-scope active supervisor whose PIN matches.
func (a svSupervisors) find(ctx context.Context, callerID, pin string) (*storedvalue.ApprovedSupervisor, error) {
	if pin == "" {
		return nil, nil
	}
	var caller svScope
	err := a.db.QueryRow(ctx,
		`SELECT role::text, business_scope::text, company_id::text, branch_id::text FROM configuration.users WHERE id = $1`, callerID).
		Scan(&caller.role, &caller.businessScope, &caller.company, &caller.branch)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := a.db.Query(ctx,
		`SELECT id::text, full_name, role::text, business_scope::text, company_id::text, branch_id::text,
		        CASE WHEN pos_pin LIKE '$2%' THEN public.crypt($1, '$2a$' || substr(pos_pin, 5)) = '$2a$' || substr(pos_pin, 5)
		             ELSE pos_pin = $1 END AS matches
		   FROM configuration.users
		  WHERE role = 'pos_supervisor' AND status = 'active' AND pos_pin IS NOT NULL`, pin)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var name *string
		var s svScope
		var matches bool
		if err := rows.Scan(&id, &name, &s.role, &s.businessScope, &s.company, &s.branch, &matches); err != nil {
			return nil, err
		}
		if matches && s.covers(caller.company, caller.branch) {
			n := "Supervisor"
			if name != nil && *name != "" {
				n = *name
			}
			return &storedvalue.ApprovedSupervisor{ID: id, Name: n}, nil
		}
	}
	return nil, rows.Err()
}

// recordFailure is recordFailure: one more failure under a row lock;
// the active lock after it, or nil.
func (a svSupervisors) recordFailure(ctx context.Context, subject string) (*time.Time, error) {
	var lock *time.Time
	err := database.WithTx(ctx, a.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO auth.attempt_limits (scope, subject) VALUES ($1, $2) ON CONFLICT (scope, subject) DO NOTHING`,
			pinScope, subject); err != nil {
			return err
		}
		var failures int
		var windowStart time.Time
		var lockedUntil *time.Time
		if err := tx.QueryRow(ctx,
			`SELECT failures, window_started_at, locked_until FROM auth.attempt_limits WHERE scope = $1 AND subject = $2 FOR UPDATE`,
			pinScope, subject).Scan(&failures, &windowStart, &lockedUntil); err != nil {
			return err
		}
		now := a.now()
		lockExpired := lockedUntil != nil && !lockedUntil.After(now)
		fresh := now.Sub(windowStart) > pinWindow || lockExpired || failures == 0
		if fresh {
			failures, windowStart, lockedUntil = 1, now, nil
		} else {
			failures++
		}
		if failures >= pinMaxFailures {
			t := now.Add(pinLockout)
			lockedUntil = &t
		}
		if _, err := tx.Exec(ctx,
			`UPDATE auth.attempt_limits SET failures = $3, window_started_at = $4, locked_until = $5, updated_at = now()
			  WHERE scope = $1 AND subject = $2`, pinScope, subject, failures, windowStart, lockedUntil); err != nil {
			return err
		}
		if lockedUntil != nil && lockedUntil.After(now) {
			lock = lockedUntil
		}
		return nil
	})
	return lock, err
}
