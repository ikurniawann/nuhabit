package whatsapp

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/database"
)

// Gateway is the self-hosted gateway's GatewayConfig.
type Gateway struct {
	BaseURL string
	Token   string
	Timeout time.Duration
}

// gatewayCacheTTL keeps one settings read per 30 seconds, like the TS.
const gatewayCacheTTL = 30 * time.Second

// LoadGateway is loadGatewayConfig: the URL and token from
// configuration.app_settings, then the env (a settings read failure falls
// back to the env), cached 30 seconds. nil when no token is set.
func (c *Client) LoadGateway(ctx context.Context, q database.Querier) *Gateway {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.cachedAt.IsZero() && time.Since(c.cachedAt) < gatewayCacheTTL {
		return c.cached
	}
	stored := map[string]string{}
	if rows, err := q.Query(ctx, `SELECT key, value FROM configuration.app_settings WHERE key = ANY($1)`,
		[]string{"wa_gateway_url", "wa_gateway_token"}); err == nil {
		for rows.Next() {
			var key string
			var value *string
			if rows.Scan(&key, &value) == nil && value != nil {
				stored[key] = strings.TrimSpace(*value)
			}
		}
		rows.Close()
	}
	var g *Gateway
	if token := firstSet(stored["wa_gateway_token"], c.Getenv("WA_GATEWAY_TOKEN")); token != "" {
		ms, err := strconv.ParseFloat(c.Getenv("WA_GATEWAY_TIMEOUT_MS"), 64)
		if err != nil || ms <= 0 {
			ms = 20000
		}
		g = &Gateway{
			BaseURL: firstSet(stored["wa_gateway_url"], c.Getenv("WA_GATEWAY_URL"), "http://127.0.0.1:3471"),
			Token:   token,
			Timeout: time.Duration(ms * float64(time.Millisecond)),
		}
	}
	c.cached, c.cachedAt = g, time.Now()
	return g
}

// timeoutReason is the gateway's reason for an uncertain send.
const timeoutReason = "Gateway tidak merespons (timeout)"

// SendText is sendGatewayText: POST {baseUrl}/send with x-gateway-token,
// bounded by the gateway timeout. It does not log to crm.wa_messages.
func (g *Gateway) SendText(ctx context.Context, target, message string) Result {
	ctx, cancel := context.WithTimeout(ctx, g.Timeout)
	defer cancel()
	status, data, err := postJSON(ctx, g.BaseURL+"/send", map[string]string{"target": target, "message": message},
		map[string]string{"x-gateway-token": g.Token})
	switch {
	case errors.Is(err, errNotJSON): // response.json().catch(() => null)
	case err != nil && isTimeout(ctx, err):
		return Result{Provider: "gateway", Reason: timeoutReason, TimedOut: true}
	case err != nil:
		return Result{Provider: "gateway", Reason: fetchFailed}
	}
	if !is2xx(status) {
		reason, isString := field(data, "error").(string)
		if !isString {
			reason = "Gateway menolak permintaan kirim"
		}
		return Result{Provider: "gateway", Reason: reason}
	}
	id, _ := field(data, "messageId").(string)
	return Result{Success: true, Provider: "gateway", MessageID: id}
}
