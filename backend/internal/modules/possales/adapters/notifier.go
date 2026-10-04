package adapters

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/database"
)

// Notifier ports the WhatsApp sends of the POS sale: sendWhatsAppText
// (lib/whatsapp: Meta, the self-hosted gateway or Fonnte, logged to
// crm.wa_messages), the owner's comp alert (lib/wa/comp-notification.ts),
// the large-void alert (notifications-sender.ts) and the gift card code
// message (lib/giftcard/gift-card-wa.ts). It runs on the pool, outside any
// sale transaction, like the TS. Approach copied from
// memberportal/adapters_whatsapp.go.
type Notifier struct {
	db     database.Querier
	log    *slog.Logger
	now    func() time.Time
	getenv func(string) string
	client *http.Client

	// Endpoints, overridden by tests.
	metaBase  string
	fonnteURL string

	mu       sync.Mutex
	cachedAt time.Time
	cached   *gatewayConfig
}

var _ ports.Notifier = (*Notifier)(nil)

// NewNotifier reads provider credentials from the process environment.
func NewNotifier(db database.Querier, log *slog.Logger, now func() time.Time) *Notifier {
	if log == nil {
		log = slog.Default()
	}
	if now == nil {
		now = time.Now
	}
	return &Notifier{
		db: db, log: log, now: now, getenv: os.Getenv, client: &http.Client{},
		metaBase: "https://graph.facebook.com", fonnteURL: "https://api.fonnte.com/send",
	}
}

type gatewayConfig struct {
	baseURL string
	token   string
	timeout time.Duration
}

type metaConfig struct{ accessToken, phoneNumberID, graphVersion string }

// sendResult is WhatsAppResult.
type sendResult struct {
	ok        bool
	reason    string
	timedOut  bool
	provider  string
	messageID string
}

var notConfigured = sendResult{reason: "WhatsApp provider belum dikonfigurasi"}

const gatewayConfigTTL = 30 * time.Second

func (n *Notifier) metaConfig() *metaConfig {
	token, phoneID := n.getenv("META_WA_ACCESS_TOKEN"), n.getenv("META_WA_PHONE_NUMBER_ID")
	if token == "" || phoneID == "" {
		return nil
	}
	version := n.getenv("META_WA_GRAPH_VERSION")
	if version == "" {
		version = "v21.0"
	}
	return &metaConfig{accessToken: token, phoneNumberID: phoneID, graphVersion: version}
}

// gatewayConfig is loadGatewayConfig: app_settings first, then the env,
// cached 30 seconds. A settings read failure falls back to the env.
func (n *Notifier) gatewayConfig(ctx context.Context) *gatewayConfig {
	n.mu.Lock()
	defer n.mu.Unlock()
	if !n.cachedAt.IsZero() && time.Since(n.cachedAt) < gatewayConfigTTL {
		return n.cached
	}
	var dbURL, dbToken string
	if rows, err := n.db.Query(ctx, `SELECT key, value FROM configuration.app_settings WHERE key = ANY($1)`,
		[]string{"wa_gateway_url", "wa_gateway_token"}); err == nil {
		for rows.Next() {
			var key string
			var value *string
			if rows.Scan(&key, &value) == nil && value != nil {
				switch key {
				case "wa_gateway_url":
					dbURL = strings.TrimSpace(*value)
				case "wa_gateway_token":
					dbToken = strings.TrimSpace(*value)
				}
			}
		}
		rows.Close()
	}
	token := firstSet(dbToken, n.getenv("WA_GATEWAY_TOKEN"))
	var cfg *gatewayConfig
	if token != "" {
		timeoutMs, err := strconv.Atoi(n.getenv("WA_GATEWAY_TIMEOUT_MS"))
		if err != nil || timeoutMs == 0 {
			timeoutMs = 20000
		}
		cfg = &gatewayConfig{
			baseURL: firstSet(dbURL, n.getenv("WA_GATEWAY_URL"), "http://127.0.0.1:3471"),
			token:   token,
			timeout: time.Duration(timeoutMs) * time.Millisecond,
		}
	}
	n.cached, n.cachedAt = cfg, time.Now()
	return cfg
}

func firstSet(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// provider is resolveProviderAsync: WHATSAPP_PROVIDER, else the first
// configured of Meta, gateway, Fonnte.
func (n *Notifier) provider(ctx context.Context) string {
	switch strings.ToLower(strings.TrimSpace(n.getenv("WHATSAPP_PROVIDER"))) {
	case "meta":
		if n.metaConfig() != nil {
			return "meta"
		}
		return ""
	case "gateway":
		if n.gatewayConfig(ctx) != nil {
			return "gateway"
		}
		return ""
	case "fonnte":
		if n.getenv("FONNTE_API_KEY") != "" {
			return "fonnte"
		}
		return ""
	}
	switch {
	case n.metaConfig() != nil:
		return "meta"
	case n.gatewayConfig(ctx) != nil:
		return "gateway"
	case n.getenv("FONNTE_API_KEY") != "":
		return "fonnte"
	}
	return ""
}

// SendText is sendWhatsAppText: dispatch, then log to crm.wa_messages.
func (n *Notifier) SendText(ctx context.Context, target, message, messageType, sentByUserID string) ports.Delivery {
	var res sendResult
	switch n.provider(ctx) {
	case "meta":
		res = n.postMeta(ctx, n.metaConfig(), map[string]any{
			"messaging_product": "whatsapp",
			"recipient_type":    "individual",
			"to":                target,
			"type":              "text",
			"text":              map[string]any{"preview_url": false, "body": message},
		})
	case "gateway":
		res = n.sendGateway(ctx, n.gatewayConfig(ctx), target, message)
	case "fonnte":
		res = n.sendFonnte(ctx, target, message)
	default:
		res = notConfigured
	}
	if messageType == "" {
		messageType = "notification"
	}
	n.logOutbound(ctx, target, messageType, message, sentByUserID, res)
	return ports.Delivery{OK: res.ok, Reason: res.reason}
}

func (n *Notifier) postMeta(ctx context.Context, cfg *metaConfig, payload map[string]any) sendResult {
	body, _ := json.Marshal(payload)
	endpoint := n.metaBase + "/" + cfg.graphVersion + "/" + cfg.phoneNumberID + "/messages"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return sendResult{provider: "meta", reason: err.Error()}
	}
	req.Header.Set("Authorization", "Bearer "+cfg.accessToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := n.client.Do(req)
	if err != nil {
		return sendResult{provider: "meta", reason: err.Error()}
	}
	defer resp.Body.Close()
	var data map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&data)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return sendResult{provider: "meta", reason: extractMetaError(data)}
	}
	id := ""
	if msgs, ok := data["messages"].([]any); ok && len(msgs) > 0 {
		if m, ok := msgs[0].(map[string]any); ok {
			id, _ = m["id"].(string)
		}
	}
	return sendResult{ok: true, provider: "meta", messageID: id}
}

// extractMetaError is "message · code N · subcode M".
func extractMetaError(data map[string]any) string {
	e, ok := data["error"].(map[string]any)
	if !ok {
		return "Unknown error"
	}
	msg, _ := e["message"].(string)
	if msg == "" {
		msg = "Unknown error"
	}
	parts := []string{msg}
	if code, ok := e["code"].(float64); ok {
		parts = append(parts, "code "+strconv.FormatFloat(code, 'f', -1, 64))
	}
	if sub, ok := e["error_subcode"].(float64); ok {
		parts = append(parts, "subcode "+strconv.FormatFloat(sub, 'f', -1, 64))
	}
	return strings.Join(parts, " · ")
}

// sendGateway is sendGatewayText: POST {base}/send with x-gateway-token.
func (n *Notifier) sendGateway(ctx context.Context, cfg *gatewayConfig, target, message string) sendResult {
	ctx, cancel := context.WithTimeout(ctx, cfg.timeout)
	defer cancel()
	body, _ := json.Marshal(map[string]string{"target": target, "message": message})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.baseURL+"/send", bytes.NewReader(body))
	if err != nil {
		return sendResult{provider: "gateway", reason: err.Error()}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-gateway-token", cfg.token)
	resp, err := n.client.Do(req)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return sendResult{provider: "gateway", reason: "Gateway tidak merespons (timeout)", timedOut: true}
		}
		return sendResult{provider: "gateway", reason: err.Error()}
	}
	defer resp.Body.Close()
	var data map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&data)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		reason, ok := data["error"].(string)
		if !ok {
			reason = "Gateway menolak permintaan kirim"
		}
		return sendResult{provider: "gateway", reason: reason}
	}
	id, _ := data["messageId"].(string)
	return sendResult{ok: true, provider: "gateway", messageID: id}
}

// sendFonnte is lib/fonnte sendWhatsApp: success = data.status || HTTP ok.
func (n *Notifier) sendFonnte(ctx context.Context, target, message string) sendResult {
	key := n.getenv("FONNTE_API_KEY")
	if key == "" {
		return sendResult{provider: "fonnte", reason: "API key not configured"}
	}
	body, _ := json.Marshal(map[string]string{"target": target, "message": message})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.fonnteURL, bytes.NewReader(body))
	if err != nil {
		return sendResult{provider: "fonnte", reason: err.Error()}
	}
	req.Header.Set("Authorization", key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := n.client.Do(req)
	if err != nil {
		return sendResult{provider: "fonnte", reason: err.Error()}
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return sendResult{provider: "fonnte", reason: err.Error()}
	}
	reason, _ := data["reason"].(string)
	ok := domain.Truthy(data["status"]) || (resp.StatusCode >= 200 && resp.StatusCode <= 299)
	return sendResult{ok: ok, provider: "fonnte", reason: reason}
}

// logOutbound is logOutboundMessage: failures are logged, never returned.
func (n *Notifier) logOutbound(ctx context.Context, phone, messageType, body, sentBy string, res sendResult) {
	var customerID *string
	err := n.db.QueryRow(ctx, `SELECT id::text FROM pos.pos_customers
		WHERE regexp_replace(COALESCE(phone,''), '\D', '', 'g') IN ($1, '0' || substring($1 from 3))
		LIMIT 1`, phone).Scan(&customerID)
	if err != nil && !database.IsNoRows(err) {
		n.log.Error("[wa-log] Gagal mencatat pesan keluar", "error", err.Error())
		return
	}
	status, errReason := "sent", (*string)(nil)
	if !res.ok {
		status, errReason = "failed", nullable(firstSet(res.reason, "Unknown error"))
	}
	var storedBody *string
	if messageType != "otp" {
		storedBody = &body
	}
	if _, err := n.db.Exec(ctx, `INSERT INTO crm.wa_messages
		  (conversation_id, direction, message_type, phone, customer_id, body,
		   status, provider, provider_message_id, error_reason, sent_by_user_id)
		VALUES (NULL, 'out', $1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING`,
		messageType, phone, customerID, storedBody, status, nullable(res.provider), nullable(res.messageID),
		errReason, nullable(sentBy)); err != nil {
		n.log.Error("[wa-log] Gagal mencatat pesan keluar", "error", err.Error())
	}
}

/* ── owner alerts (wa_notif_log dedup) ───────────────────────────────── */

// claimNotif inserts the dedup row; "" when the key was already claimed.
func (n *Notifier) claimNotif(ctx context.Context, notifType, key, message string, recipients []string) (string, error) {
	list, _ := json.Marshal(recipients)
	var id string
	err := n.db.QueryRow(ctx, `INSERT INTO configuration.wa_notif_log (notif_type, dedup_key, message, recipients)
		VALUES ($1, $2, $3, $4::jsonb)
		ON CONFLICT (notif_type, dedup_key) DO NOTHING
		RETURNING id::text`, notifType, key, message, string(list)).Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

func (n *Notifier) releaseNotif(ctx context.Context, id string) error {
	_, err := n.db.Exec(ctx, `DELETE FROM configuration.wa_notif_log WHERE id = $1`, id)
	return err
}

// NotifyComp is notifyCompTransaction: one gateway message to the owner per
// comp (dedup 'komplimen'), the claim released on a clear failure.
func (n *Notifier) NotifyComp(ctx context.Context, c ports.CompNotice) {
	var name *string
	if c.CustomerID != nil && *c.CustomerID != "" {
		_ = n.db.QueryRow(ctx, `SELECT name FROM pos.pos_customers WHERE id = $1`, *c.CustomerID).Scan(&name)
	}
	message := buildCompNotifMessage(c, name, n.now())
	id, err := n.claimNotif(ctx, "komplimen", compDedupKey(c), message, []string{compNotifTarget})
	if err != nil {
		n.log.Error("[wa-comp] notifikasi komplimen error", "error", err.Error())
		return
	}
	if id == "" {
		return // already sent
	}
	gateway := n.gatewayConfig(ctx)
	if gateway == nil {
		n.log.Warn("[wa-comp] gateway belum dikonfigurasi — notifikasi komplimen dilewati")
		_ = n.releaseNotif(ctx, id)
		return
	}
	if res := n.sendGateway(ctx, gateway, compNotifTarget, message); !res.ok && !res.timedOut {
		n.log.Error("[wa-comp] gagal kirim ke " + compNotifTarget + ": " + res.reason)
		_ = n.releaseNotif(ctx, id)
	}
}

// NotifyLargeVoid is step 5 of the void route: when the voided total
// reaches wa_notif_config.voidThresholdRp, sendOwnerNotification('voidBesar').
func (n *Notifier) NotifyLargeVoid(ctx context.Context, v ports.VoidNotice) {
	var raw *string
	err := n.db.QueryRow(ctx, `SELECT value FROM configuration.app_settings WHERE key = 'wa_notif_config'`).Scan(&raw)
	if err != nil && !database.IsNoRows(err) {
		n.log.Error("[wa-notif] gagal menyiapkan notif void", "error", err.Error())
		return
	}
	cfg := parseWaNotifConfig(raw)
	if v.Total < cfg.VoidThresholdRp || !cfg.Enabled || !cfg.VoidBesar || len(cfg.Recipients) == 0 {
		return
	}
	gateway := n.gatewayConfig(ctx)
	if gateway == nil {
		return
	}
	orderNumber := v.OrderNumber
	if orderNumber == "" {
		orderNumber = sliceUTF16(v.OrderID, 8)
	}
	message := buildVoidBesarMessage(orderNumber, v.Total, v.Reason, v.SupervisorName)
	id, err := n.claimNotif(ctx, "voidBesar", v.OrderID, message, cfg.Recipients)
	if err != nil || id == "" {
		if err != nil {
			n.log.Error("[wa-notif] voidBesar gagal terkirim", "error", err.Error())
		}
		return
	}
	delivered, timedOut := 0, false
	for _, r := range cfg.Recipients {
		res := n.sendGateway(ctx, gateway, r, message)
		switch {
		case res.ok:
			delivered++
		case res.timedOut:
			timedOut = true
		default:
			n.log.Error("[wa-notif] gagal kirim ke " + r + ": " + res.reason)
		}
	}
	if delivered == 0 && !timedOut {
		if err := n.releaseNotif(ctx, id); err != nil {
			n.log.Error("[wa-notif] voidBesar gagal terkirim", "error", err.Error())
		}
	}
}

// NotifyGiftCardsSold is sendGiftCardSoldWa (gateway only, best-effort).
func (n *Notifier) NotifyGiftCardsSold(ctx context.Context, g ports.GiftCardsSoldNotice) {
	if g.BuyerPhone == "" || len(g.Cards) == 0 {
		return
	}
	gateway := n.gatewayConfig(ctx)
	if gateway == nil {
		n.log.Error("[giftcard] WA gateway belum dikonfigurasi — kode tidak terkirim")
		return
	}
	if res := n.sendGateway(ctx, gateway, g.BuyerPhone, buildGiftCardSoldMessage(g.BuyerName, g.Cards)); !res.ok {
		n.log.Error("[giftcard] kirim WA gagal: " + res.reason)
	}
}
