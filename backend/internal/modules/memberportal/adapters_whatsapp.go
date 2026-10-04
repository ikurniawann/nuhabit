package memberportal

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"nuhabit/backend/internal/platform/database"
)

// whatsappNotifier ports the OTP and text paths of lib/whatsapp: provider
// chosen by WHATSAPP_PROVIDER or by the credentials present (Meta, then the
// self-hosted gateway, then Fonnte), every send logged to crm.wa_messages
// (OTP bodies never stored).
type whatsappNotifier struct {
	db     database.Querier
	getenv func(string) string
	client *http.Client
	log    *slog.Logger

	mu       sync.Mutex
	cachedAt time.Time
	cached   *gatewayConfig
}

type gatewayConfig struct {
	baseURL string
	token   string
	timeout time.Duration
}

type metaConfig struct {
	accessToken   string
	phoneNumberID string
	graphVersion  string
}

const gatewayConfigTTL = 30 * time.Second

var errNotConfigured = Delivery{Reason: "WhatsApp provider belum dikonfigurasi"}

func newWhatsAppNotifier(db database.Querier, getenv func(string) string, log *slog.Logger) *whatsappNotifier {
	return &whatsappNotifier{db: db, getenv: getenv, client: &http.Client{}, log: log}
}

func (n *whatsappNotifier) metaConfig() *metaConfig {
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

// gatewayConfig reads configuration.app_settings first, then the env, with
// a 30 second cache. A settings read failure falls back to the env.
func (n *whatsappNotifier) gatewayConfig(ctx context.Context) *gatewayConfig {
	n.mu.Lock()
	defer n.mu.Unlock()
	if !n.cachedAt.IsZero() && time.Since(n.cachedAt) < gatewayConfigTTL {
		return n.cached
	}
	var dbURL, dbToken string
	rows, err := n.db.Query(ctx,
		`SELECT key, value FROM configuration.app_settings WHERE key = ANY($1)`,
		[]string{"wa_gateway_url", "wa_gateway_token"})
	if err == nil {
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
	token := dbToken
	if token == "" {
		token = n.getenv("WA_GATEWAY_TOKEN")
	}
	var cfg *gatewayConfig
	if token != "" {
		base := dbURL
		if base == "" {
			base = n.getenv("WA_GATEWAY_URL")
		}
		if base == "" {
			base = "http://127.0.0.1:3471"
		}
		timeoutMs, err := strconv.Atoi(n.getenv("WA_GATEWAY_TIMEOUT_MS"))
		if err != nil || timeoutMs == 0 {
			timeoutMs = 20000
		}
		cfg = &gatewayConfig{baseURL: base, token: token, timeout: time.Duration(timeoutMs) * time.Millisecond}
	}
	n.cached, n.cachedAt = cfg, time.Now()
	return cfg
}

func (n *whatsappNotifier) provider(ctx context.Context) string {
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
	if n.metaConfig() != nil {
		return "meta"
	}
	if n.gatewayConfig(ctx) != nil {
		return "gateway"
	}
	if n.getenv("FONNTE_API_KEY") != "" {
		return "fonnte"
	}
	return ""
}

// SendOTP sends a login code: a Meta AUTHENTICATION template, or the
// fallback text on the gateway and Fonnte.
func (n *whatsappNotifier) SendOTP(ctx context.Context, target, code, fallbackText string) Delivery {
	result := n.dispatchOTP(ctx, target, code, fallbackText)
	n.logOutbound(ctx, target, "otp", "", result)
	return result
}

func (n *whatsappNotifier) dispatchOTP(ctx context.Context, target, code, fallbackText string) Delivery {
	switch n.provider(ctx) {
	case "meta":
		cfg := n.metaConfig()
		template := n.getenv("META_WA_OTP_TEMPLATE")
		if template == "" {
			template = "otp_login"
		}
		lang := n.getenv("META_WA_OTP_LANG")
		if lang == "" {
			lang = "id"
		}
		components := []any{map[string]any{
			"type":       "body",
			"parameters": []any{map[string]any{"type": "text", "text": code}},
		}}
		if n.getenv("META_WA_OTP_BUTTON") != "false" {
			components = append(components, map[string]any{
				"type": "button", "sub_type": "url", "index": "0",
				"parameters": []any{map[string]any{"type": "text", "text": code}},
			})
		}
		return n.postMeta(ctx, cfg, map[string]any{
			"messaging_product": "whatsapp",
			"recipient_type":    "individual",
			"to":                target,
			"type":              "template",
			"template": map[string]any{
				"name":       template,
				"language":   map[string]any{"code": lang},
				"components": components,
			},
		})
	case "gateway":
		return n.sendGateway(ctx, n.gatewayConfig(ctx), target, fallbackText)
	case "fonnte":
		return n.sendFonnte(ctx, target, fallbackText)
	}
	return errNotConfigured
}

// SendText sends free text (only inside the 24 hour window on Meta).
func (n *whatsappNotifier) SendText(ctx context.Context, target, message, messageType string) Delivery {
	var result Delivery
	switch n.provider(ctx) {
	case "meta":
		result = n.postMeta(ctx, n.metaConfig(), map[string]any{
			"messaging_product": "whatsapp",
			"recipient_type":    "individual",
			"to":                target,
			"type":              "text",
			"text":              map[string]any{"preview_url": false, "body": message},
		})
	case "gateway":
		result = n.sendGateway(ctx, n.gatewayConfig(ctx), target, message)
	case "fonnte":
		result = n.sendFonnte(ctx, target, message)
	default:
		result = errNotConfigured
	}
	n.logOutbound(ctx, target, messageType, message, result)
	return result
}

func (n *whatsappNotifier) postMeta(ctx context.Context, cfg *metaConfig, payload map[string]any) Delivery {
	body, _ := json.Marshal(payload)
	endpoint := "https://graph.facebook.com/" + cfg.graphVersion + "/" + cfg.phoneNumberID + "/messages"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return Delivery{Provider: "meta", Reason: err.Error()}
	}
	req.Header.Set("Authorization", "Bearer "+cfg.accessToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := n.client.Do(req)
	if err != nil {
		return Delivery{Provider: "meta", Reason: err.Error()}
	}
	defer resp.Body.Close()
	var data map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&data)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return Delivery{Provider: "meta", Reason: metaError(data)}
	}
	id := ""
	if msgs, ok := data["messages"].([]any); ok && len(msgs) > 0 {
		if m, ok := msgs[0].(map[string]any); ok {
			id, _ = m["id"].(string)
		}
	}
	return Delivery{Delivered: true, Provider: "meta", MessageID: id}
}

func metaError(data map[string]any) string {
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

// sendGateway calls POST {baseUrl}/send with x-gateway-token, like gateway.ts.
func (n *whatsappNotifier) sendGateway(ctx context.Context, cfg *gatewayConfig, target, message string) Delivery {
	ctx, cancel := context.WithTimeout(ctx, cfg.timeout)
	defer cancel()
	body, _ := json.Marshal(map[string]string{"target": target, "message": message})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.baseURL+"/send", bytes.NewReader(body))
	if err != nil {
		return Delivery{Provider: "gateway", Reason: err.Error()}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-gateway-token", cfg.token)
	resp, err := n.client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return Delivery{Provider: "gateway", Reason: "Gateway tidak merespons (timeout)", TimedOut: true}
		}
		return Delivery{Provider: "gateway", Reason: err.Error()}
	}
	defer resp.Body.Close()
	var data map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&data)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		reason, _ := data["error"].(string)
		if reason == "" {
			reason = "Gateway menolak permintaan kirim"
		}
		return Delivery{Provider: "gateway", Reason: reason}
	}
	id, _ := data["messageId"].(string)
	return Delivery{Delivered: true, Provider: "gateway", MessageID: id}
}

// sendFonnte posts to https://api.fonnte.com/send like lib/fonnte.
func (n *whatsappNotifier) sendFonnte(ctx context.Context, target, message string) Delivery {
	key := n.getenv("FONNTE_API_KEY")
	if key == "" {
		return Delivery{Provider: "fonnte", Reason: "API key not configured"}
	}
	body, _ := json.Marshal(map[string]string{"target": target, "message": message})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.fonnte.com/send", bytes.NewReader(body))
	if err != nil {
		return Delivery{Provider: "fonnte", Reason: err.Error()}
	}
	req.Header.Set("Authorization", key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := n.client.Do(req)
	if err != nil {
		return Delivery{Provider: "fonnte", Reason: err.Error()}
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var data map[string]any
	if json.Unmarshal(raw, &data) != nil {
		return Delivery{Provider: "fonnte", Reason: "invalid response"}
	}
	status, _ := data["status"].(bool)
	reason, _ := data["reason"].(string)
	delivered := status || (resp.StatusCode >= 200 && resp.StatusCode <= 299)
	return Delivery{Delivered: delivered, Provider: "fonnte", Reason: reason}
}

// logOutbound records the send in crm.wa_messages. Failures only log.
func (n *whatsappNotifier) logOutbound(ctx context.Context, phone, messageType, body string, result Delivery) {
	var customerID *string
	err := n.db.QueryRow(ctx,
		`SELECT id FROM pos.pos_customers
		  WHERE regexp_replace(COALESCE(phone,''), '\D', '', 'g')
		        IN ($1, '0' || substring($1 from 3))
		  LIMIT 1`, phone).Scan(&customerID)
	if err != nil && !database.IsNoRows(err) {
		n.log.Error("[wa-log] Gagal mencatat pesan keluar", "error", err.Error())
		return
	}
	status, errReason := "failed", nullable(result.Reason)
	if result.Delivered {
		status, errReason = "sent", nil
	} else if errReason == nil {
		reason := "Unknown error"
		errReason = &reason
	}
	var storedBody *string
	if messageType != "otp" {
		storedBody = &body
	}
	_, err = n.db.Exec(ctx,
		`INSERT INTO crm.wa_messages
		   (conversation_id, direction, message_type, phone, customer_id, body,
		    status, provider, provider_message_id, error_reason, sent_by_user_id)
		 VALUES (NULL, 'out', $1, $2, $3, $4, $5, $6, $7, $8, NULL)
		 ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL
		 DO NOTHING`,
		messageType, phone, customerID, storedBody, status, nullable(result.Provider), nullable(result.MessageID), errReason)
	if err != nil {
		n.log.Error("[wa-log] Gagal mencatat pesan keluar", "error", err.Error())
	}
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// basicAuth is the Authorization value for a secret-key-only Basic auth.
func basicAuth(secret string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(secret+":"))
}
