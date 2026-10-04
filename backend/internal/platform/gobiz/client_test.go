package gobiz

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeGobiz is an httptest GoBiz: /oauth issues tokens, everything else goes
// to api. It records each request.
type fakeGobiz struct {
	*httptest.Server
	mu       sync.Mutex
	tokens   int
	token    func(n int) (int, string)
	api      func(r *http.Request, body string) (int, string)
	requests []seenRequest
}

type seenRequest struct {
	Method, Path, Body string
	Header             http.Header
}

func newFakeGobiz(t *testing.T) *fakeGobiz {
	f := &fakeGobiz{
		token: func(n int) (int, string) { return 200, `{"access_token":"T","expires_in":3599}` },
		api:   func(*http.Request, string) (int, string) { return 200, `{"success":true,"data":{}}` },
	}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.requests = append(f.requests, seenRequest{r.Method, r.URL.EscapedPath(), string(raw), r.Header.Clone()})
		var status int
		var body string
		if r.URL.Path == "/oauth" {
			f.tokens++
			status, body = f.token(f.tokens)
		} else {
			status, body = f.api(r, string(raw))
		}
		f.mu.Unlock()
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(f.Close)
	return f
}

func (f *fakeGobiz) config() Config {
	return Config{
		Enabled: true, Environment: Sandbox, ClientID: "cid", ClientSecret: "sec", OutletID: "G123",
		APIBase: f.URL, OAuthURL: f.URL + "/oauth",
	}
}

func (f *fakeGobiz) last() seenRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.requests[len(f.requests)-1]
}

func TestAccessTokenCachesUntilNearExpiry(t *testing.T) {
	f := newFakeGobiz(t)
	f.token = func(int) (int, string) { return 200, `{"access_token":"T1","expires_in":3599}` }
	now := time.Unix(1000, 0)
	c := NewClient(nil, func() time.Time { return now })
	ctx := context.Background()

	t1, err := c.AccessToken(ctx, f.config())
	if err != nil || t1 != "T1" {
		t.Fatalf("token: %q %v", t1, err)
	}
	now = now.Add(time.Second)
	if t2, _ := c.AccessToken(ctx, f.config()); t2 != "T1" || f.tokens != 1 {
		t.Fatalf("cached token: %q after %d requests", t2, f.tokens)
	}
	req := f.last()
	if req.Method != "POST" || req.Header.Get("Content-Type") != "application/x-www-form-urlencoded" || req.Header.Get("Accept") != "application/json" {
		t.Fatalf("token request: %+v", req)
	}
	for _, part := range []string{"grant_type=client_credentials", "client_id=cid", "scope=gofood%3Acatalog%3Awrite"} {
		if !strings.Contains(req.Body, part) {
			t.Fatalf("form body %q lacks %q", req.Body, part)
		}
	}
	if form, err := url.ParseQuery(req.Body); err != nil || form.Get("scope") != Scopes || form.Get("client_secret") != "sec" {
		t.Fatalf("form body does not round-trip: %q", req.Body)
	}

	now = time.Unix(1000, 0).Add((3599-60)*time.Second + time.Millisecond) // past the refresh mark
	if _, err := c.AccessToken(ctx, f.config()); err != nil || f.tokens != 2 {
		t.Fatalf("token should refresh: %d requests, %v", f.tokens, err)
	}
}

func TestAccessTokenError(t *testing.T) {
	f := newFakeGobiz(t)
	f.token = func(int) (int, string) { return 401, `{"error":"invalid_client","error_description":"Client salah"}` }
	_, err := NewClient(nil, nil).AccessToken(context.Background(), f.config())
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Status != 401 || apiErr.Message != "Client salah" ||
		string(apiErr.Body) != `{"error":"invalid_client","error_description":"Client salah"}` {
		t.Fatalf("got %#v", err)
	}

	f.token = func(int) (int, string) { return 500, `<html>` }
	_, err = NewClient(nil, nil).AccessToken(context.Background(), f.config())
	if !errors.As(err, &apiErr) || apiErr.Message != "Gagal mengambil token GoBiz (500)" || string(apiErr.Body) != `{}` {
		t.Fatalf("non-JSON answer: %#v", err)
	}
}

func TestOrderEndpoints(t *testing.T) {
	f := newFakeGobiz(t)
	c := NewClient(nil, nil)
	ctx := context.Background()

	if err := c.Accept(ctx, f.config(), "delivery", "F-1"); err != nil {
		t.Fatal(err)
	}
	req := f.last()
	if req.Method != "PUT" || req.Path != "/integrations/gofood/outlets/G123/v1/orders/delivery/F-1/accepted" ||
		req.Body != "{}" || req.Header.Get("Authorization") != "Bearer T" || req.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("accept request: %+v", req)
	}

	if err := c.Reject(ctx, f.config(), "pickup", "F-2", "ITEMS_OUT_OF_STOCK", "Habis"); err != nil {
		t.Fatal(err)
	}
	if req := f.last(); req.Path != "/integrations/gofood/outlets/G123/v1/orders/pickup/F-2/cancelled" ||
		req.Body != `{"cancel_reason_code":"ITEMS_OUT_OF_STOCK","cancel_reason_description":"Habis"}` {
		t.Fatalf("reject request: %+v", req)
	}

	if err := c.FoodReady(ctx, f.config(), "pickup", "F-2"); err != nil {
		t.Fatal(err)
	}
	if req := f.last(); req.Path != "/integrations/gofood/outlets/G123/v1/orders/pickup/F-2/food-prepared" || req.Body != `{"country_code":"ID"}` {
		t.Fatalf("food ready request: %+v", req)
	}
	if f.tokens != 1 {
		t.Fatalf("one token for three calls, got %d", f.tokens)
	}

	// encodeURIComponent on outlet and order ids.
	cfg := f.config()
	cfg.OutletID = "G 1/2"
	_ = c.Accept(ctx, cfg, "delivery", "F#3")
	if req := f.last(); req.Path != "/integrations/gofood/outlets/G%201%2F2/v1/orders/delivery/F%233/accepted" {
		t.Fatalf("escaped path: %s", req.Path)
	}
}

func TestRequestErrorsAndTokenDrop(t *testing.T) {
	f := newFakeGobiz(t)
	f.token = func(n int) (int, string) {
		return 200, `{"access_token":"T` + string(rune('0'+n)) + `","expires_in":3599}`
	}
	f.api = func(*http.Request, string) (int, string) { return 401, `{"message":"Unauthorized"}` }
	c := NewClient(nil, nil)
	ctx := context.Background()
	for range 2 {
		var apiErr *APIError
		if err := c.Accept(ctx, f.config(), "delivery", "F-3"); !errors.As(err, &apiErr) || apiErr.Status != 401 || apiErr.Message != "Unauthorized" {
			t.Fatalf("got %v", err)
		}
	}
	if f.tokens != 2 {
		t.Fatalf("a 401 must drop the cached token: %d token requests", f.tokens)
	}

	f.api = func(*http.Request, string) (int, string) {
		return 200, `{"success":false,"errors":[{"message":"Order sudah diterima"}]}`
	}
	var apiErr *APIError
	if err := c.Accept(ctx, f.config(), "delivery", "F-4"); !errors.As(err, &apiErr) || apiErr.Message != "Order sudah diterima" || apiErr.Status != 200 {
		t.Fatalf("success:false: %v", err)
	}

	f.api = func(*http.Request, string) (int, string) { return 404, `nope` }
	if err := c.FoodReady(ctx, f.config(), "pickup", "F-5"); !errors.As(err, &apiErr) ||
		apiErr.Message != "GoBiz PUT /integrations/gofood/outlets/G123/v1/orders/pickup/F-5/food-prepared gagal (404)" {
		t.Fatalf("fallback message: %v", err)
	}
	var body map[string]any
	if json.Unmarshal(apiErr.Body, &body) != nil || len(body) != 0 {
		t.Fatalf("non-JSON body should be {}: %s", apiErr.Body)
	}

	cfg := f.config()
	cfg.OAuthURL = "http://127.0.0.1:1/oauth"
	if _, err := NewClient(nil, nil).AccessToken(ctx, cfg); err == nil || err.Error() != "fetch failed" {
		t.Fatalf("network failure: %v", err)
	}
}

func TestFormEncodeMatchesURLSearchParams(t *testing.T) {
	got := formEncode([][2]string{{"a b", "x*y~z"}, {"k", "é&="}})
	if got != "a+b=x*y%7Ez&k=%C3%A9%26%3D" {
		t.Fatalf("got %s", got)
	}
	if got := encodeURIComponent("a b!~*'()/é"); got != "a%20b!~*'()%2F%C3%A9" {
		t.Fatalf("encodeURIComponent: %s", got)
	}
}

func TestSubscribeAndPushCatalog(t *testing.T) {
	f := newFakeGobiz(t)
	c, ctx := NewClient(nil, nil), context.Background()
	if err := c.Subscribe(ctx, f.config(), "gofood.order.created", "https://pos.test/hook"); err != nil {
		t.Fatal(err)
	}
	if req := f.last(); req.Method != "POST" || req.Path != "/integrations/partner/v1/notification-subscriptions" ||
		req.Body != `{"event":"gofood.order.created","url":"https://pos.test/hook","active":true}` {
		t.Fatalf("subscribe request: %+v", req)
	}
	f.api = func(*http.Request, string) (int, string) {
		return 200, `{ "success": true, "data": {"request_id": "r-1"} }`
	}
	resp, err := c.PushCatalog(ctx, f.config(), map[string]any{"request_id": "r-1"})
	if err != nil || string(resp) != `{"success":true,"data":{"request_id":"r-1"}}` {
		t.Fatalf("push: %s %v", resp, err)
	}
	if req := f.last(); req.Method != "PUT" || req.Path != "/integrations/gofood/outlets/G123/v1/catalog" || req.Body != `{"request_id":"r-1"}` {
		t.Fatalf("push request: %+v", req)
	}
}

func str(s string) *string { return &s }

func TestConfigFromSettings(t *testing.T) {
	c := ConfigFromSettings(map[string]*string{})
	if c.Enabled || c.Environment != Sandbox || c.IsConfigured() ||
		c.APIBase != "https://api.partner-sandbox.gobiz.co.id" || c.OAuthURL != "https://integration-goauth.gojekapi.com/oauth2/token" {
		t.Fatalf("defaults: %+v", c)
	}
	c = ConfigFromSettings(map[string]*string{
		KeyEnabled: str("true"), KeyEnvironment: str("production"),
		KeyClientID: str(" cid "), KeyClientSecret: str("sec"), KeyOutletID: str("G1"),
		KeyAutoAccept: str("TRUE"), KeyAPIBaseURL: str(" https://x.test/ "), KeyOAuthURL: str("  "),
	})
	if !c.Enabled || c.Environment != Production || !c.IsConfigured() || c.ClientID != "cid" || c.AutoAccept ||
		c.APIBase != "https://x.test" || c.OAuthURL != "https://accounts.go-jek.com/oauth2/token" {
		t.Fatalf("overrides: %+v", c)
	}
	if NormalizeEnvironment("staging") != Sandbox {
		t.Fatal("unknown environment should be sandbox")
	}
}

func TestPadReason(t *testing.T) {
	for in, want := range map[string]string{" Habis ": "Habis", "a": "a..", "": "...", "ok ": "ok."} {
		if got := PadReason(in); got != want {
			t.Errorf("PadReason(%q) = %q, want %q", in, got, want)
		}
	}
}
