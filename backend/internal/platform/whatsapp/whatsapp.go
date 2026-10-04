// Package whatsapp is frontend/src/lib/whatsapp: free text and OTP through
// Meta's Cloud API, the self-hosted gateway (services/wa-gateway) or Fonnte,
// each send logged to crm.wa_messages, plus the owner alerts of
// lib/wa/notifications-sender deduplicated in configuration.wa_notif_log.
// Sends never fail the caller: a problem comes back in Result.
package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"nuhabit/backend/internal/platform/database"
)

// Result is WhatsAppResult.
type Result struct {
	Success bool
	// Reason says why a send failed (never the message text).
	Reason string
	// TimedOut marks an uncertain gateway send: the message may have gone
	// out. At-most-once callers keep their claim on it.
	TimedOut  bool
	Provider  string
	MessageID string
}

// NotConfigured is the reason when no provider has credentials.
const NotConfigured = "WhatsApp provider belum dikonfigurasi"

// httpClient bounds Meta and Fonnte calls, which the TS leaves unbounded;
// gateway calls also carry their own WA_GATEWAY_TIMEOUT_MS deadline.
var httpClient = &http.Client{Timeout: 60 * time.Second}

// Client resolves the provider and sends. The zero value is not usable;
// call New.
type Client struct {
	Getenv func(string) string
	Log    *slog.Logger
	// Endpoints, overridden by tests.
	MetaBase  string
	FonnteURL string

	mu       sync.Mutex
	cachedAt time.Time
	cached   *Gateway
}

// New reads credentials from the process environment.
func New(log *slog.Logger) *Client {
	if log == nil {
		log = slog.Default()
	}
	return &Client{Getenv: os.Getenv, Log: log, MetaBase: "https://graph.facebook.com", FonnteURL: "https://api.fonnte.com/send"}
}

type metaConfig struct{ accessToken, phoneNumberID, graphVersion string }

func (c *Client) metaConfig() *metaConfig {
	token, phoneID := c.Getenv("META_WA_ACCESS_TOKEN"), c.Getenv("META_WA_PHONE_NUMBER_ID")
	if token == "" || phoneID == "" {
		return nil
	}
	return &metaConfig{accessToken: token, phoneNumberID: phoneID, graphVersion: firstSet(c.Getenv("META_WA_GRAPH_VERSION"), "v21.0")}
}

// provider is resolveProviderAsync: WHATSAPP_PROVIDER when set, else the
// first configured of Meta, the gateway and Fonnte.
func (c *Client) provider(ctx context.Context, q database.Querier) string {
	checks := []struct {
		name string
		ok   func() bool
	}{
		{"meta", func() bool { return c.metaConfig() != nil }},
		{"gateway", func() bool { return c.LoadGateway(ctx, q) != nil }},
		{"fonnte", func() bool { return c.Getenv("FONNTE_API_KEY") != "" }},
	}
	explicit := strings.ToLower(strings.TrimSpace(c.Getenv("WHATSAPP_PROVIDER")))
	for _, p := range checks {
		if explicit == p.name {
			if p.ok() {
				return p.name
			}
			return ""
		}
	}
	for _, p := range checks {
		if p.ok() {
			return p.name
		}
	}
	return ""
}

// Dispatch is dispatchText without the log.
func (c *Client) Dispatch(ctx context.Context, q database.Querier, target, message string) Result {
	switch c.provider(ctx, q) {
	case "meta":
		return c.postMeta(ctx, c.metaConfig(), map[string]any{
			"messaging_product": "whatsapp",
			"recipient_type":    "individual",
			"to":                target,
			"type":              "text",
			"text":              map[string]any{"preview_url": false, "body": message},
		})
	case "gateway":
		return c.LoadGateway(ctx, q).SendText(ctx, target, message)
	case "fonnte":
		return c.sendFonnte(ctx, target, message)
	}
	return Result{Reason: NotConfigured}
}

// SendText is sendWhatsAppText: Dispatch, then the crm.wa_messages log
// (messageType "" = "notification", sentByUserID "" = NULL).
func (c *Client) SendText(ctx context.Context, q database.Querier, target, message, messageType, sentByUserID string) Result {
	res := c.Dispatch(ctx, q, target, message)
	c.logOutbound(ctx, q, target, firstSet(messageType, "notification"), message, sentByUserID, res)
	return res
}

// SendOTP is sendWhatsAppOtp: Meta's AUTHENTICATION template (name and
// language from the env, copy-code button unless META_WA_OTP_BUTTON is
// "false"), fallbackText on the gateway and Fonnte. The code is never logged.
func (c *Client) SendOTP(ctx context.Context, q database.Querier, target, code, fallbackText string) Result {
	var res Result
	switch c.provider(ctx, q) {
	case "meta":
		components := []any{map[string]any{
			"type":       "body",
			"parameters": []any{map[string]any{"type": "text", "text": code}},
		}}
		if c.Getenv("META_WA_OTP_BUTTON") != "false" {
			components = append(components, map[string]any{
				"type": "button", "sub_type": "url", "index": "0",
				"parameters": []any{map[string]any{"type": "text", "text": code}},
			})
		}
		res = c.postMeta(ctx, c.metaConfig(), map[string]any{
			"messaging_product": "whatsapp",
			"recipient_type":    "individual",
			"to":                target,
			"type":              "template",
			"template": map[string]any{
				"name":       firstSet(c.Getenv("META_WA_OTP_TEMPLATE"), "otp_login"),
				"language":   map[string]any{"code": firstSet(c.Getenv("META_WA_OTP_LANG"), "id")},
				"components": components,
			},
		})
	case "gateway":
		res = c.LoadGateway(ctx, q).SendText(ctx, target, fallbackText)
	case "fonnte":
		res = c.sendFonnte(ctx, target, fallbackText)
	default:
		res = Result{Reason: NotConfigured}
	}
	c.logOutbound(ctx, q, target, "otp", "", "", res)
	return res
}

func (c *Client) postMeta(ctx context.Context, cfg *metaConfig, payload map[string]any) Result {
	status, data, err := postJSON(ctx, c.MetaBase+"/"+cfg.graphVersion+"/"+cfg.phoneNumberID+"/messages", payload,
		map[string]string{"Authorization": "Bearer " + cfg.accessToken})
	if err != nil && !errors.Is(err, errNotJSON) { // a reply that is not JSON reads as null
		return Result{Provider: "meta", Reason: fetchFailed}
	}
	if !is2xx(status) {
		return Result{Provider: "meta", Reason: metaError(data)}
	}
	res := Result{Success: true, Provider: "meta"}
	if msgs, _ := field(data, "messages").([]any); len(msgs) > 0 {
		res.MessageID, _ = field(msgs[0], "id").(string)
	}
	return res
}

// metaError is extractMetaError: "message · code N · subcode M".
func metaError(data any) string {
	e := field(data, "error")
	if e == nil {
		return "Unknown error"
	}
	msg, isString := field(e, "message").(string)
	if !isString {
		msg = "Unknown error"
	}
	parts := []string{msg}
	if v := field(e, "code"); v != nil {
		parts = append(parts, "code "+jsString(v))
	}
	if v := field(e, "error_subcode"); v != nil {
		parts = append(parts, "subcode "+jsString(v))
	}
	return strings.Join(parts, " · ")
}

// sendFonnte is lib/fonnte sendWhatsApp: success is data.status or an HTTP
// 2xx; a body that is not JSON fails like response.json() does.
func (c *Client) sendFonnte(ctx context.Context, target, message string) Result {
	key := c.Getenv("FONNTE_API_KEY")
	if key == "" {
		return Result{Provider: "fonnte", Reason: "API key not configured"}
	}
	status, data, err := postJSON(ctx, c.FonnteURL, map[string]string{"target": target, "message": message},
		map[string]string{"Authorization": key})
	switch {
	case errors.Is(err, errNotJSON):
		return Result{Provider: "fonnte", Reason: "Unexpected end of JSON input"}
	case err != nil:
		return Result{Provider: "fonnte", Reason: fetchFailed}
	}
	reason, _ := field(data, "reason").(string)
	return Result{Success: truthy(field(data, "status")) || is2xx(status), Provider: "fonnte", Reason: reason}
}

/* ── HTTP ─────────────────────────────────────────────────────────────── */

// fetchFailed is the message of the TypeError fetch throws on a network error.
const fetchFailed = "fetch failed"

var errNotJSON = errors.New("response is not JSON")

// postJSON posts payload as JSON and decodes the reply. A reply that is not
// JSON comes back with errNotJSON and its status.
func postJSON(ctx context.Context, url string, payload any, headers map[string]string) (int, any, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return resp.StatusCode, nil, err
	}
	var data any
	if json.Unmarshal(raw, &data) != nil {
		return resp.StatusCode, nil, errNotJSON
	}
	return resp.StatusCode, data, nil
}

func is2xx(status int) bool { return status >= 200 && status <= 299 }

// isTimeout reports a deadline from ctx or the HTTP client.
func isTimeout(ctx context.Context, err error) bool {
	var ne net.Error
	return errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) ||
		(errors.As(err, &ne) && ne.Timeout())
}

/* ── JS value helpers ─────────────────────────────────────────────────── */

// field is obj?.[key] on decoded JSON.
func field(v any, key string) any {
	m, _ := v.(map[string]any)
	return m[key]
}

func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case float64:
		return x != 0 && !math.IsNaN(x)
	}
	return true
}

// jsString is String(v) for a decoded JSON scalar.
func jsString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	}
	raw, _ := json.Marshal(v)
	return string(raw)
}

func firstSet(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
