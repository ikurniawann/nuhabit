package memberportal

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/testutil"
)

// fakeGoogle signs ID tokens with its own RSA key and serves the matching
// JWKS, so the verifier runs the real path against a local server.
type fakeGoogle struct {
	key    *rsa.PrivateKey
	server *httptest.Server
}

func newFakeGoogle(t *testing.T) *fakeGoogle {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	g := &fakeGoogle{key: key}
	g.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=3600")
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kty": "RSA", "kid": "k1", "alg": "RS256",
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	t.Cleanup(g.server.Close)
	return g
}

// token signs claims (iss, aud and exp filled in unless overridden).
func (g *fakeGoogle) token(t *testing.T, claims map[string]any) string {
	t.Helper()
	full := map[string]any{"iss": "https://accounts.google.com", "aud": "test-client", "exp": time.Now().Add(time.Hour).Unix(), "email_verified": true}
	for k, v := range claims {
		full[k] = v
	}
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "kid": "k1", "typ": "JWT"})
	payload, _ := json.Marshal(full)
	signing := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	digest := sha256.Sum256([]byte(signing))
	sig, err := rsa.SignPKCS1v15(rand.Reader, g.key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return signing + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func TestIntegrationGoogleSignIn(t *testing.T) {
	h := newHarness(t)
	google := newFakeGoogle(t)
	h.mod.handler.svc.google = newGoogleKeys(google.server.URL, google.server.Client(), time.Now)
	h.mod.handler.svc.googleAudience = "test-client"
	db := testutil.DB(t)

	member := newMember(t)
	email := "go-google-" + testutil.RandomHex(4) + "@test.local"
	if _, err := db.Exec(context.Background(), `UPDATE pos.pos_customers SET email = $2 WHERE id = $1`, member.CustomerID, strings.ToUpper(email)); err != nil {
		t.Fatal(err)
	}

	// Rejected tokens: wrong audience, expired, unverified email, garbage.
	for name, body := range map[string]map[string]any{
		"audience":   {"id_token": google.token(t, map[string]any{"aud": "other", "sub": "1", "email": email})},
		"expired":    {"id_token": google.token(t, map[string]any{"exp": time.Now().Add(-time.Minute).Unix(), "sub": "1", "email": email})},
		"unverified": {"id_token": google.token(t, map[string]any{"sub": "1", "email": email, "email_verified": false})},
		"garbage":    {"id_token": "abc.def"},
	} {
		if status, out, _ := h.do(testutil.Request("POST", "/api/member-portal/auth/google", body)); status != 401 {
			t.Fatalf("%s: %d %v", name, status, out)
		}
	}
	if status, out, _ := h.do(testutil.Request("POST", "/api/member-portal/auth/google", map[string]any{})); status != 400 || out["error"] != "Token Google wajib diisi" {
		t.Fatalf("empty: %d %v", status, out)
	}

	// A member with that verified email signs in and gets linked.
	req := testutil.Request("POST", "/api/member-portal/auth/google", map[string]any{
		"id_token": google.token(t, map[string]any{"sub": "sub-" + member.CustomerID, "email": email, "name": "Go Member"}),
	})
	req.Header.Set("x-app-client", "1")
	status, out, resp := h.do(req)
	data, _ := out["data"].(map[string]any)
	if status != 200 || data["status"] != "signed_in" || data["token"] == nil || resp.Header.Get("Set-Cookie") == "" {
		t.Fatalf("sign in: %d %v", status, out)
	}
	var linked string
	if err := db.QueryRow(context.Background(), `SELECT COALESCE(google_sub, '') FROM pos.pos_customers WHERE id = $1`, member.CustomerID).Scan(&linked); err != nil || linked != "sub-"+member.CustomerID {
		t.Fatalf("google_sub %q %v", linked, err)
	}
	// The link wins even when the email changes on the Google side.
	status, out, _ = h.do(testutil.Request("POST", "/api/member-portal/auth/google", map[string]any{
		"id_token": google.token(t, map[string]any{"sub": "sub-" + member.CustomerID, "email": "other-" + email}),
	}))
	if data, _ := out["data"].(map[string]any); status != 200 || data["status"] != "signed_in" {
		t.Fatalf("sign in by sub: %d %v", status, out)
	}

	// An unknown email gets a ticket; registration with the ticket, a phone
	// and its OTP creates the member with the Google email and link.
	newEmail := "go-new-" + testutil.RandomHex(4) + "@test.local"
	status, out, _ = h.do(testutil.Request("POST", "/api/member-portal/auth/google", map[string]any{
		"id_token": google.token(t, map[string]any{"sub": "sub-new", "email": strings.ToUpper(newEmail), "name": "Budi Baru"}),
	}))
	data, _ = out["data"].(map[string]any)
	if status != 200 || data["status"] != "needs_phone" || data["email"] != newEmail || data["name"] != "Budi Baru" || data["google_sub"] != "sub-new" || data["ticket"] == "" {
		t.Fatalf("needs phone: %d %v", status, out)
	}
	ticket := data["ticket"].(string)

	phone := randomLocalPhone()
	digits := digitsOf(phone)
	cleanupOTP(t, digits)
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), `DELETE FROM crm.crm_marketing_optouts WHERE customer_id IN (SELECT id FROM pos.pos_customers WHERE phone = $1)`, domain.LocalPhoneFormat(digits))
		_, _ = db.Exec(context.Background(), `DELETE FROM pos.pos_customers WHERE phone = $1`, domain.LocalPhoneFormat(digits))
	})
	h.do(testutil.Request("POST", "/api/member-portal/register/otp", map[string]any{"phone": phone}))
	status, out, _ = h.do(testutil.Request("POST", "/api/member-portal/register", map[string]any{
		"phone": phone, "name": "Budi Baru", "code": h.notifier.code(digits), "google_ticket": "forged.ticket",
	}))
	if status != 401 || out["field"] != "google_ticket" {
		t.Fatalf("forged ticket: %d %v", status, out)
	}
	status, out, _ = h.do(testutil.Request("POST", "/api/member-portal/register", map[string]any{
		"phone": phone, "name": "Budi Baru", "code": h.notifier.code(digits), "google_ticket": ticket, "email": "ignored@test.local",
	}))
	if status != 200 || out["success"] != true {
		t.Fatalf("register with ticket: %d %v", status, out)
	}
	var storedEmail, storedSub string
	if err := db.QueryRow(context.Background(), `SELECT email, google_sub FROM pos.pos_customers WHERE phone = $1`, domain.LocalPhoneFormat(digits)).Scan(&storedEmail, &storedSub); err != nil ||
		storedEmail != newEmail || storedSub != "sub-new" {
		t.Fatalf("stored %q %q %v", storedEmail, storedSub, err)
	}
	// The next Google sign-in finds the new member by its link.
	status, out, _ = h.do(testutil.Request("POST", "/api/member-portal/auth/google", map[string]any{
		"id_token": google.token(t, map[string]any{"sub": "sub-new", "email": newEmail}),
	}))
	if data, _ := out["data"].(map[string]any); status != 200 || data["status"] != "signed_in" {
		t.Fatalf("sign in after register: %d %v", status, out)
	}
}

func TestGoogleTicketRoundTrip(t *testing.T) {
	secret := []byte("s")
	now := time.Now()
	raw := domain.SignGoogleTicket(secret, domain.GoogleTicket{Sub: "1", Email: "a@b.c", Name: "A"}, now)
	got, err := domain.ParseGoogleTicket(secret, raw, now.Add(14*time.Minute))
	if err != nil || got.Sub != "1" || got.Email != "a@b.c" {
		t.Fatalf("round trip: %+v %v", got, err)
	}
	if _, err := domain.ParseGoogleTicket(secret, raw, now.Add(16*time.Minute)); err == nil {
		t.Fatal("expired ticket accepted")
	}
	if _, err := domain.ParseGoogleTicket([]byte("other"), raw, now); err == nil {
		t.Fatal("wrong secret accepted")
	}
}
