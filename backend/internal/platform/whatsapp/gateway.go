package whatsapp

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/safehttp"
)

// Gateway is the self-hosted gateway's GatewayConfig.
type Gateway struct {
	BaseURL string
	Token   string
	Timeout time.Duration
}

// DefaultGatewayURL is the gateway on the app's own host, used when neither
// the settings nor WA_GATEWAY_URL name one.
const (
	defaultGatewayHost = "127.0.0.1:3471"
	DefaultGatewayURL  = "http://" + defaultGatewayHost
)

// GatewayPolicy is the safehttp policy of gateway calls: SAFEHTTP_ALLOW_HOSTS
// plus the configured gateway's host:port (from the settings or the env,
// trusted like them) and an explicit entry for DefaultGatewayURL. Any other
// destination, a redirect included, must be public https.
func GatewayPolicy(baseURL string) safehttp.Policy {
	p := safehttp.FromEnv(nil)
	p.AllowHosts = append(p.AllowHosts, defaultGatewayHost)
	if u, err := url.Parse(baseURL); err == nil && u.Hostname() != "" {
		port := u.Port()
		if port == "" && u.Scheme == "https" {
			port = "443"
		} else if port == "" {
			port = "80"
		}
		p.AllowHosts = append(p.AllowHosts, strings.ToLower(net.JoinHostPort(u.Hostname(), port)))
	}
	return p
}

// gatewayClients holds one client per gateway base URL, so connections are
// reused across sends.
var gatewayClients sync.Map // base URL -> *http.Client

// HTTPClient is the safehttp client for calls to this gateway. Each call
// carries its own deadline; the client bounds a call to 60 seconds.
func (g *Gateway) HTTPClient() *http.Client { return GatewayClient(g.BaseURL) }

// GatewayClient is the safehttp client for the gateway at baseURL.
func GatewayClient(baseURL string) *http.Client {
	if c, ok := gatewayClients.Load(baseURL); ok {
		return c.(*http.Client)
	}
	c, _ := gatewayClients.LoadOrStore(baseURL, GatewayPolicy(baseURL).Client(60*time.Second))
	return c.(*http.Client)
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
			BaseURL: firstSet(stored["wa_gateway_url"], c.Getenv("WA_GATEWAY_URL"), DefaultGatewayURL),
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
	status, data, err := postJSON(ctx, g.HTTPClient(), g.BaseURL+"/send", map[string]string{"target": target, "message": message},
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
