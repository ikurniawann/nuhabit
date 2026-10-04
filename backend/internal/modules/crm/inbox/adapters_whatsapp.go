package inbox

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"nuhabit/backend/internal/platform/database"
)

// WhatsAppGateway is a stopgap adapter: moves to the WhatsApp/notifications
// context once it is ported. It mirrors lib/whatsapp dispatchText (provider
// from WHATSAPP_PROVIDER, else Meta, the self-hosted gateway, then Fonnte)
// and reads the gateway URL/token from configuration.app_settings.
type WhatsAppGateway struct {
	Getenv func(string) string
	Client *http.Client

	mu       sync.Mutex
	cachedAt time.Time
	gateway  *gatewayConfig
}

var _ WhatsApp = (*WhatsAppGateway)(nil)

type gatewayConfig struct {
	baseURL, token string
	timeout        time.Duration
}

const waNotConfigured = "WhatsApp provider belum dikonfigurasi"

// SendText dispatches one free-text message.
func (g *WhatsAppGateway) SendText(ctx context.Context, q database.Querier, target, message string) SendResult {
	switch g.provider(ctx, q) {
	case "meta":
		return g.sendMeta(ctx, target, message)
	case "gateway":
		res, _ := g.gatewaySend(ctx, g.gatewayConfig(ctx, q), target, message)
		return res
	case "fonnte":
		return g.sendFonnte(ctx, target, message)
	}
	return SendResult{Reason: waNotConfigured}
}

func (g *WhatsAppGateway) metaConfigured() bool {
	return g.Getenv("META_WA_ACCESS_TOKEN") != "" && g.Getenv("META_WA_PHONE_NUMBER_ID") != ""
}

func (g *WhatsAppGateway) provider(ctx context.Context, q database.Querier) string {
	explicit := strings.ToLower(strings.TrimSpace(g.Getenv("WHATSAPP_PROVIDER")))
	// Detection order is preference order: official, own gateway, third party.
	checks := []struct {
		name string
		ok   func() bool
	}{
		{"meta", g.metaConfigured},
		{"gateway", func() bool { return g.gatewayConfig(ctx, q) != nil }},
		{"fonnte", func() bool { return g.Getenv("FONNTE_API_KEY") != "" }},
	}
	for _, c := range checks {
		if explicit == c.name {
			if c.ok() {
				return c.name
			}
			return ""
		}
	}
	for _, c := range checks {
		if c.ok() {
			return c.name
		}
	}
	return ""
}

// gatewayConfig is loadGatewayConfig: app_settings first (a read failure
// falls back to the env), cached for 30 seconds.
func (g *WhatsAppGateway) gatewayConfig(ctx context.Context, q database.Querier) *gatewayConfig {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.cachedAt.IsZero() && time.Since(g.cachedAt) < 30*time.Second {
		return g.gateway
	}
	stored, _ := appSettings(ctx, q, "wa_gateway_url", "wa_gateway_token")
	var cfg *gatewayConfig
	if token := firstSet(stored["wa_gateway_token"], g.Getenv("WA_GATEWAY_TOKEN")); token != "" {
		ms, _ := strconv.ParseFloat(g.Getenv("WA_GATEWAY_TIMEOUT_MS"), 64)
		if ms == 0 {
			ms = 20000
		}
		cfg = &gatewayConfig{
			baseURL: firstSet(stored["wa_gateway_url"], g.Getenv("WA_GATEWAY_URL"), "http://127.0.0.1:3471"),
			token:   token,
			timeout: time.Duration(ms) * time.Millisecond,
		}
	}
	g.gateway, g.cachedAt = cfg, time.Now()
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

func (g *WhatsAppGateway) sendMeta(ctx context.Context, target, message string) SendResult {
	version := firstSet(g.Getenv("META_WA_GRAPH_VERSION"), "v21.0")
	url := "https://graph.facebook.com/" + version + "/" + g.Getenv("META_WA_PHONE_NUMBER_ID") + "/messages"
	res, err := doRequest(ctx, httpClient(g.Client), http.MethodPost, url, map[string]any{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                target,
		"type":              "text",
		"text":              map[string]any{"preview_url": false, "body": message},
	}, map[string]string{"Authorization": "Bearer " + g.Getenv("META_WA_ACCESS_TOKEN"), "Content-Type": "application/json"})
	if err != nil {
		return SendResult{Provider: "meta", Reason: fetchError(ctx, err)}
	}
	if !res.ok() {
		return SendResult{Provider: "meta", Reason: metaErrorReason(res.data)}
	}
	out := SendResult{Success: true, Provider: "meta"}
	if msgs, _ := res.data["messages"].([]any); len(msgs) > 0 {
		if first, _ := msgs[0].(map[string]any); first != nil {
			if id, ok := first["id"].(string); ok {
				out.MessageID = &id
			}
		}
	}
	return out
}

// metaErrorReason is extractMetaError.
func metaErrorReason(data map[string]any) string {
	e, ok := data["error"].(map[string]any)
	if !ok {
		return "Unknown error"
	}
	msg, _ := e["message"].(string)
	parts := []string{firstSet(msg, "Unknown error")}
	if code, ok := e["code"].(float64); ok {
		parts = append(parts, "code "+strconv.FormatFloat(code, 'f', -1, 64))
	}
	if sub, ok := e["error_subcode"].(float64); ok {
		parts = append(parts, "subcode "+strconv.FormatFloat(sub, 'f', -1, 64))
	}
	return strings.Join(parts, " · ")
}

// gatewaySend is sendGatewayText; the bool reports a timeout (delivery
// uncertain).
func (g *WhatsAppGateway) gatewaySend(ctx context.Context, cfg *gatewayConfig, target, message string) (SendResult, bool) {
	ctx, cancel := context.WithTimeout(ctx, cfg.timeout)
	defer cancel()
	res, err := doRequest(ctx, httpClient(g.Client), http.MethodPost, cfg.baseURL+"/send",
		map[string]string{"target": target, "message": message},
		map[string]string{"Content-Type": "application/json", "x-gateway-token": cfg.token})
	if err != nil {
		if ctx.Err() != nil {
			return SendResult{Provider: "gateway", Reason: "Gateway tidak merespons (timeout)"}, true
		}
		return SendResult{Provider: "gateway", Reason: fetchError(ctx, err)}, false
	}
	if !res.ok() {
		reason, ok := res.data["error"].(string)
		if !ok {
			reason = "Gateway menolak permintaan kirim"
		}
		return SendResult{Provider: "gateway", Reason: reason}, false
	}
	out := SendResult{Success: true, Provider: "gateway"}
	if id, ok := res.data["messageId"].(string); ok {
		out.MessageID = &id
	}
	return out, false
}

func (g *WhatsAppGateway) sendFonnte(ctx context.Context, target, message string) SendResult {
	res, err := doRequest(ctx, httpClient(g.Client), http.MethodPost, "https://api.fonnte.com/send",
		map[string]string{"target": target, "message": message},
		map[string]string{"Authorization": g.Getenv("FONNTE_API_KEY"), "Content-Type": "application/json"})
	if err != nil {
		return SendResult{Provider: "fonnte", Reason: fetchError(ctx, err)}
	}
	if res.data == nil {
		return SendResult{Provider: "fonnte", Reason: "Unexpected end of JSON input"}
	}
	status, _ := res.data["status"].(bool)
	reason, _ := res.data["reason"].(string)
	return SendResult{Success: status || res.ok(), Provider: "fonnte", Reason: reason}
}

// OwnerNotifierWA is a stopgap adapter: moves to the notifications context
// once it is ported. It mirrors lib/wa/notifications-sender
// sendOwnerNotification: wa_notif_config gates it, a configuration.wa_notif_log
// row claims the dedup key before sending through the gateway, and the
// claim is released when every recipient clearly refused.
type OwnerNotifierWA struct {
	DB       database.DB
	WhatsApp *WhatsAppGateway
	Log      *slog.Logger
}

var _ OwnerNotifier = (*OwnerNotifierWA)(nil)

// Fire sends in the background; failures are only logged.
func (n *OwnerNotifierWA) Fire(notifType, dedupKey, message string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		if err := n.send(ctx, notifType, dedupKey, message); err != nil {
			n.Log.Error("[wa-notif] gagal terkirim", "type", notifType, "error", err)
		}
	}()
}

func (n *OwnerNotifierWA) send(ctx context.Context, notifType, dedupKey, message string) error {
	stored, err := appSettings(ctx, n.DB, "wa_notif_config")
	if err != nil {
		return err
	}
	enabled, typeOn, recipients := parseNotifConfig(stored["wa_notif_config"], notifType)
	if !enabled || !typeOn || len(recipients) == 0 {
		return nil
	}
	gw := n.WhatsApp.gatewayConfig(ctx, n.DB)
	if gw == nil {
		return nil
	}
	recipientsJSON, _ := json.Marshal(recipients)
	var claimID string
	err = n.DB.QueryRow(ctx, `INSERT INTO configuration.wa_notif_log (notif_type, dedup_key, message, recipients)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (notif_type, dedup_key) DO NOTHING
       RETURNING id::text`, notifType, dedupKey, message, string(recipientsJSON)).Scan(&claimID)
	if database.IsNoRows(err) {
		return nil // already sent
	}
	if err != nil {
		return err
	}
	delivered, timedOut := 0, false
	for _, to := range recipients {
		res, uncertain := n.WhatsApp.gatewaySend(ctx, gw, to, message)
		switch {
		case res.Success:
			delivered++
		case uncertain:
			timedOut = true
		default:
			n.Log.Error("[wa-notif] gagal kirim", "to", to, "reason", res.Reason)
		}
	}
	if delivered == 0 && !timedOut {
		_, err = n.DB.Exec(ctx, `DELETE FROM configuration.wa_notif_log WHERE id = $1::uuid`, claimID)
	}
	return err
}

var waRecipient = regexp.MustCompile(`^62\d{8,13}$`)

// normalizeWaRecipient turns 08…, +62… or 62… into 62xxxxxxxxxx.
func normalizeWaRecipient(raw string) string {
	var b strings.Builder
	for _, r := range raw {
		if (r >= '0' && r <= '9') || r == '+' {
			b.WriteRune(r)
		}
	}
	n := strings.TrimPrefix(b.String(), "+")
	if strings.HasPrefix(n, "0") {
		n = "62" + n[1:]
	}
	if !waRecipient.MatchString(n) {
		return ""
	}
	return n
}

// parseNotifConfig reads the parts of wa_notif_config the inbox needs:
// the master switch (default off), the type switch (komplain and
// reviewRendah default on) and up to five unique recipients.
func parseNotifConfig(raw, notifType string) (enabled, typeOn bool, recipients []string) {
	typeOn = true
	var o map[string]any
	if raw == "" || json.Unmarshal([]byte(raw), &o) != nil || o == nil {
		return false, typeOn, nil
	}
	enabled, _ = o["enabled"].(bool)
	if types, ok := o["types"].(map[string]any); ok {
		if v, ok := types[notifType].(bool); ok {
			typeOn = v
		}
	}
	list, _ := o["recipients"].([]any)
	valid := 0
	for _, item := range list {
		s, _ := item.(string)
		if r := normalizeWaRecipient(s); r != "" && valid < 5 {
			valid++
			if !slices.Contains(recipients, r) {
				recipients = append(recipients, r)
			}
		}
	}
	return enabled, typeOn, recipients
}
