package gofood

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"nuhabit/backend/internal/modules/possales/gofood/domain"
)

// APIError is GobizApiError: GoBiz answered with a non-2xx status or
// `success:false`. Body is the parsed response (`{}` when it was not JSON).
type APIError struct {
	Status  int
	Message string
	Body    json.RawMessage
}

func (e *APIError) Error() string { return e.Message }

// errFetchFailed is what fetch throws on a network failure; the route
// returns its message.
var errFetchFailed = errors.New("fetch failed")

// Client is the GoBiz Direct Integration client of lib/gobiz/client.ts:
// OAuth2 client_credentials with an in-memory token cache (refreshed 60 s
// before expiry, dropped on a 401) and the GoFood order endpoints. The API
// base and token URL come from the Config, so tests point them at an
// httptest.Server.
type Client struct {
	http *http.Client
	now  func() time.Time

	mu     sync.Mutex
	tokens map[string]cachedToken
}

type cachedToken struct {
	token     string
	expiresAt time.Time
}

// NewClient builds a client; nil arguments take http.DefaultClient's
// transport with a 30 s timeout and time.Now.
func NewClient(hc *http.Client, now func() time.Time) *Client {
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	if now == nil {
		now = time.Now
	}
	return &Client{http: hc, now: now, tokens: map[string]cachedToken{}}
}

func cacheKey(c domain.Config) string {
	return c.Environment + ":" + c.OAuthURL + ":" + c.ClientID
}

// AccessToken is getGobizAccessToken.
func (c *Client) AccessToken(ctx context.Context, cfg domain.Config) (string, error) {
	key := cacheKey(cfg)
	c.mu.Lock()
	cached, ok := c.tokens[key]
	c.mu.Unlock()
	if ok && cached.expiresAt.After(c.now()) {
		return cached.token, nil
	}

	form := formEncode([][2]string{
		{"grant_type", "client_credentials"},
		{"client_id", cfg.ClientID},
		{"client_secret", cfg.ClientSecret},
		{"scope", domain.Scopes},
	})
	status, raw, body, err := c.do(ctx, http.MethodPost, cfg.OAuthURL, "application/x-www-form-urlencoded", "", strings.NewReader(form))
	if err != nil {
		return "", err
	}
	token, isString := body["access_token"].(string)
	if status < 200 || status > 299 || !isString {
		return "", &APIError{Status: status, Message: errorMessageFrom(body, fmt.Sprintf("Gagal mengambil token GoBiz (%d)", status)), Body: raw}
	}
	expiresIn := jsNumberOr(body["expires_in"], 3599)
	c.mu.Lock()
	c.tokens[key] = cachedToken{token: token, expiresAt: c.now().Add(time.Duration(max(30, expiresIn-60) * float64(time.Second)))}
	c.mu.Unlock()
	return token, nil
}

// request is gobizRequest; payload nil sends no body.
func (c *Client) request(ctx context.Context, cfg domain.Config, method, path string, payload any) error {
	token, err := c.AccessToken(ctx, cfg)
	if err != nil {
		return err
	}
	var rd io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	status, raw, body, err := c.do(ctx, method, cfg.APIBase+path, "application/json", token, rd)
	if err != nil {
		return err
	}
	if status == http.StatusUnauthorized {
		// Token rejected: forget it so the next call asks for a new one.
		c.mu.Lock()
		delete(c.tokens, cacheKey(cfg))
		c.mu.Unlock()
	}
	if status < 200 || status > 299 || body["success"] == false {
		return &APIError{Status: status, Message: errorMessageFrom(body, fmt.Sprintf("GoBiz %s %s gagal (%d)", method, path, status)), Body: raw}
	}
	return nil
}

// do sends one request and parses the JSON answer like
// `response.json().catch(() => ({}))`: raw is the compacted JSON (or `{}`),
// body its top-level object (empty for non-objects).
func (c *Client) do(ctx context.Context, method, url, contentType, token string, rd io.Reader) (int, json.RawMessage, map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, rd)
	if err != nil {
		return 0, nil, nil, errFetchFailed
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Accept", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return 0, nil, nil, errFetchFailed
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	raw := json.RawMessage(`{}`)
	body := map[string]any{}
	var compact bytes.Buffer
	if err == nil && json.Valid(data) && json.Compact(&compact, data) == nil {
		raw = compact.Bytes()
		_ = json.Unmarshal(data, &body)
	}
	return res.StatusCode, raw, body, nil
}

// errorMessageFrom picks GoBiz's own error text: message, error_description,
// error, then errors[0].message.
func errorMessageFrom(body map[string]any, fallback string) string {
	for _, key := range []string{"message", "error_description", "error"} {
		if s, ok := body[key].(string); ok {
			return s
		}
	}
	if list, ok := body["errors"].([]any); ok && len(list) > 0 {
		if first, ok := list[0].(map[string]any); ok {
			if s, ok := first["message"].(string); ok {
				return s
			}
		}
	}
	return fallback
}

func orderPath(cfg domain.Config, orderType, orderID, action string) string {
	return "/integrations/gofood/outlets/" + encodeURIComponent(cfg.OutletID) + "/v1/orders/" + orderType + "/" +
		encodeURIComponent(orderID) + "/" + action
}

// Accept is acceptGofoodOrder: PUT …/accepted with `{}`.
func (c *Client) Accept(ctx context.Context, cfg domain.Config, orderType, orderID string) error {
	return c.request(ctx, cfg, http.MethodPut, orderPath(cfg, orderType, orderID, "accepted"), struct{}{})
}

// Reject is rejectGofoodOrder: PUT …/cancelled with the reason.
func (c *Client) Reject(ctx context.Context, cfg domain.Config, orderType, orderID, code, description string) error {
	return c.request(ctx, cfg, http.MethodPut, orderPath(cfg, orderType, orderID, "cancelled"), struct {
		Code        string `json:"cancel_reason_code"`
		Description string `json:"cancel_reason_description"`
	}{code, domain.PadReason(description)})
}

// FoodReady is markGofoodFoodReady: PUT …/food-prepared {country_code:"ID"}.
func (c *Client) FoodReady(ctx context.Context, cfg domain.Config, orderType, orderID string) error {
	return c.request(ctx, cfg, http.MethodPut, orderPath(cfg, orderType, orderID, "food-prepared"), struct {
		CountryCode string `json:"country_code"`
	}{"ID"})
}

// jsNumberOr is `Number(v) || def` for a decoded JSON value.
func jsNumberOr(v any, def float64) float64 {
	var n float64
	switch x := v.(type) {
	case float64:
		n = x
	case string:
		n, _ = strconv.ParseFloat(strings.TrimSpace(x), 64)
	case bool:
		if x {
			n = 1
		}
	}
	if n == 0 || math.IsNaN(n) {
		return def
	}
	return n
}

// encodeURIComponent keeps A-Z a-z 0-9 - _ . ! ~ * ' ( ) and escapes the
// rest as UTF-8 percent sequences.
func encodeURIComponent(s string) string {
	return percentEncode(s, func(c byte) bool { return strings.IndexByte("-_.!~*'()", c) >= 0 }, false)
}

// formEncode is URLSearchParams.toString(): keys in insertion order, space
// as "+", only * - . _ left unescaped.
func formEncode(pairs [][2]string) string {
	parts := make([]string, len(pairs))
	keep := func(c byte) bool { return strings.IndexByte("*-._", c) >= 0 }
	for i, p := range pairs {
		parts[i] = percentEncode(p[0], keep, true) + "=" + percentEncode(p[1], keep, true)
	}
	return strings.Join(parts, "&")
}

func percentEncode(s string, keep func(byte) bool, spacePlus bool) string {
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case 'a' <= c && c <= 'z', 'A' <= c && c <= 'Z', '0' <= c && c <= '9', keep(c):
			b.WriteByte(c)
		case c == ' ' && spacePlus:
			b.WriteByte('+')
		default:
			b.WriteByte('%')
			b.WriteByte(hex[c>>4])
			b.WriteByte(hex[c&15])
		}
	}
	return b.String()
}
