package memberportal

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/testutil"
)

// setPassword stores a bcrypt hash on the member, as the front desk would.
func setPassword(t *testing.T, customerID, password string) {
	t.Helper()
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := testutil.DB(t).Exec(context.Background(), `UPDATE pos.pos_customers SET password_hash = $2 WHERE id = $1`, customerID, hash); err != nil {
		t.Fatal(err)
	}
}

// cleanupLoginLimit removes the per-account budget of a username.
func cleanupLoginLimit(t *testing.T, username string) {
	t.Cleanup(func() {
		_, _ = testutil.DB(t).Exec(context.Background(), `DELETE FROM platform.rate_limits WHERE key = $1`, "member-login-account:"+domain.LoginKey(username))
	})
}

func sessionCount(t *testing.T, customerID string) int {
	t.Helper()
	var n int
	if err := testutil.DB(t).QueryRow(context.Background(), `SELECT count(*) FROM crm.member_portal_sessions WHERE customer_id = $1`, customerID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (h *harness) login(username, password string) (int, map[string]any, *http.Response) {
	h.t.Helper()
	req := testutil.Request("POST", "/api/member-portal/login", map[string]any{"username": username, "password": password})
	req.Header.Set("x-app-client", "1")
	return h.do(req)
}

func TestIntegrationPasswordLogin(t *testing.T) {
	h := newHarness(t)
	member := newMember(t)
	digits := digitsOf(member.Phone)
	local := domain.LocalPhoneFormat(digits)
	email := "go-" + testutil.RandomHex(4) + "@example.test"
	cleanupLoginLimit(t, digits)
	cleanupLoginLimit(t, email)
	if _, err := testutil.DB(t).Exec(context.Background(), `UPDATE pos.pos_customers SET email = $2 WHERE id = $1`, member.CustomerID, email); err != nil {
		t.Fatal(err)
	}

	status, body, _ := h.login("", "x")
	if status != 400 || body["field"] != "username" || body["error"] != "Username is required" {
		t.Fatalf("empty username: %d %v", status, body)
	}
	status, body, _ = h.login(local, "")
	if status != 400 || body["field"] != "password" || body["error"] != "Password is required" {
		t.Fatalf("empty password: %d %v", status, body)
	}

	// An enrolled member without a password is told so.
	status, body, _ = h.login(local, "whatever1")
	if status != 403 || body["error"] != domain.LoginNoPasswordMessage {
		t.Fatalf("no password: %d %v", status, body)
	}

	setPassword(t, member.CustomerID, "Secret123")
	status, body, _ = h.login(local, "Wrong1234")
	if status != 401 || body["error"] != "Incorrect username or password" {
		t.Fatalf("wrong password: %d %v", status, body)
	}
	unknown := randomLocalPhone()
	cleanupLoginLimit(t, unknown)
	status, unknownBody, _ := h.login(unknown, "Wrong1234")
	if status != 401 || unknownBody["error"] != body["error"] || len(unknownBody) != len(body) {
		t.Fatalf("unknown account: %d %v, want the wrong-password body %v", status, unknownBody, body)
	}

	for _, username := range []string{local, digits, "+" + digits, strings.ToUpper(email)} {
		status, body, resp := h.login(username, "Secret123")
		data, _ := body["data"].(map[string]any)
		if status != 200 || data["name"] != "Go Test Member" || data["token"] == nil {
			t.Fatalf("login as %q: %d %v", username, status, body)
		}
		var cookie *http.Cookie
		for _, c := range resp.Cookies() {
			if c.Name == "member_session" {
				cookie = c
			}
		}
		if cookie == nil || !cookie.HttpOnly || cookie.Value != data["token"] || cookie.MaxAge != 30*24*3600 || cookie.SameSite != http.SameSiteLaxMode {
			t.Fatalf("cookie %+v", cookie)
		}
		me := testutil.Request("GET", "/api/member-portal/me", nil)
		me.Header.Set("Authorization", "Bearer "+cookie.Value)
		status, body, _ = h.do(me)
		if data, _ := body["data"].(map[string]any); status != 200 || data["has_password"] != true {
			t.Fatalf("me after login: %d %v", status, body)
		}
	}

	// Without x-app-client the token stays in the cookie only.
	status, body, _ = h.do(testutil.Request("POST", "/api/member-portal/login", map[string]any{"username": local, "password": "Secret123"}))
	if data, _ := body["data"].(map[string]any); status != 200 || data["token"] != nil {
		t.Fatalf("browser login: %d %v", status, body)
	}
}

func TestIntegrationPasswordLoginAccountLimit(t *testing.T) {
	h := newHarness(t)
	member := newMember(t)
	digits := digitsOf(member.Phone)
	cleanupLoginLimit(t, digits)
	setPassword(t, member.CustomerID, "Secret123")

	// 10 tries per 15 minutes, counted on the number whichever way it is
	// spelled; the 11th is refused even with the right password.
	for i := range domain.LoginAccountRule.Limit {
		username := domain.LocalPhoneFormat(digits)
		if i%2 == 1 {
			username = digits
		}
		if status, body, _ := h.login(username, "Wrong1234"); status != 401 {
			t.Fatalf("try %d: %d %v", i+1, status, body)
		}
	}
	status, body, _ := h.login(domain.LocalPhoneFormat(digits), "Secret123")
	if status != 429 || body["error"] != domain.LoginTooManyForAccount {
		t.Fatalf("11th try: %d %v", status, body)
	}
}

func TestIntegrationChangePassword(t *testing.T) {
	h := newHarness(t)
	member := newMember(t)
	put := func(token string, body map[string]any) (int, map[string]any) {
		t.Helper()
		req := testutil.Request("PUT", "/api/member-portal/password", body)
		req.Header.Set("Authorization", "Bearer "+token)
		status, out, _ := h.do(req)
		return status, out
	}
	if status, body, _ := h.do(testutil.Request("PUT", "/api/member-portal/password", map[string]any{"new_password": "Secret123"})); status != 401 {
		t.Fatalf("without session: %d %v", status, body)
	}

	// A second device.
	other := testutil.RandomHex(32)
	if _, err := testutil.DB(t).Exec(context.Background(), `INSERT INTO crm.member_portal_sessions (token_hash, customer_id, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
		auth.HashToken(other), member.CustomerID); err != nil {
		t.Fatal(err)
	}

	status, body := put(member.Token, map[string]any{"new_password": "short1"})
	if status != 400 || body["field"] != "new_password" || body["error"] != "Password must be 8 to 72 characters" {
		t.Fatalf("short: %d %v", status, body)
	}
	status, body = put(member.Token, map[string]any{"new_password": "lettersonly"})
	if status != 400 || body["field"] != "new_password" {
		t.Fatalf("no digit: %d %v", status, body)
	}

	// First password: no current password needed, the other device is out.
	status, body = put(member.Token, map[string]any{"new_password": "Secret123"})
	if status != 200 || body["success"] != true {
		t.Fatalf("first password: %d %v", status, body)
	}
	if n := sessionCount(t, member.CustomerID); n != 1 {
		t.Fatalf("sessions after first password: %d, want 1", n)
	}
	me := testutil.Request("GET", "/api/member-portal/me", nil)
	me.Header.Set("Authorization", "Bearer "+member.Token)
	if status, body, _ := h.do(me); status != 200 {
		t.Fatalf("current session revoked: %d %v", status, body)
	}

	status, body = put(member.Token, map[string]any{"new_password": "Secret456"})
	if status != 400 || body["field"] != "current_password" || body["error"] != "Current password is required" {
		t.Fatalf("missing current: %d %v", status, body)
	}
	status, body = put(member.Token, map[string]any{"current_password": "Nope1234", "new_password": "Secret456"})
	if status != 401 || body["error"] != "Current password is incorrect" {
		t.Fatalf("wrong current: %d %v", status, body)
	}
	status, body = put(member.Token, map[string]any{"current_password": "Secret123", "new_password": "Secret456"})
	if status != 200 {
		t.Fatalf("change: %d %v", status, body)
	}
	cleanupLoginLimit(t, member.Phone)
	if status, body, _ := h.login(member.Phone, "Secret456"); status != 200 {
		t.Fatalf("login with the new password: %d %v", status, body)
	}
}

func TestIntegrationForgotAndResetPassword(t *testing.T) {
	h := newHarness(t)
	member := newMember(t)
	digits := digitsOf(member.Phone)
	cleanupOTP(t, digits)
	cleanupLoginLimit(t, digits)
	setPassword(t, member.CustomerID, "Secret123")
	forgot := func(username string) (int, map[string]any) {
		t.Helper()
		status, body, _ := h.do(testutil.Request("POST", "/api/member-portal/password/forgot", map[string]any{"username": username}))
		return status, body
	}
	reset := func(username, code, password string) (int, map[string]any) {
		t.Helper()
		status, body, _ := h.do(testutil.Request("POST", "/api/member-portal/password/reset",
			map[string]any{"username": username, "code": code, "new_password": password}))
		return status, body
	}

	status, body := forgot(domain.LocalPhoneFormat(digits))
	data, _ := body["data"].(map[string]any)
	if status != 200 || data["status"] != "otp_sent" || data["phone_masked"] != domain.MaskPhone(digits) {
		t.Fatalf("forgot: %d %v", status, body)
	}
	code := h.notifier.code(digits)
	if code == "" {
		t.Fatal("no code sent")
	}

	// An unknown number gets the same answer and no message.
	unknown := randomLocalPhone()
	status, body = forgot(unknown)
	data, _ = body["data"].(map[string]any)
	if status != 200 || data["status"] != "otp_sent" || data["phone_masked"] != domain.MaskPhone(digitsOf(unknown)) {
		t.Fatalf("forgot unknown: %d %v", status, body)
	}
	if h.notifier.code(digitsOf(unknown)) != "" {
		t.Fatal("a code was sent to an unknown number")
	}
	if status, body := reset(unknown, "123456", "Secret456"); status != 400 || body["field"] != "code" {
		t.Fatalf("reset unknown: %d %v", status, body)
	}

	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	if status, body := reset(member.Phone, wrong, "Secret456"); status != 400 || body["error"] != "Incorrect or expired code. Request a new one." {
		t.Fatalf("wrong code: %d %v", status, body)
	}
	if status, body := reset(member.Phone, code, "weak"); status != 400 || body["field"] != "new_password" {
		t.Fatalf("weak password: %d %v", status, body)
	}
	if status, body := reset(member.Phone, code, "Secret456"); status != 200 || body["success"] != true {
		t.Fatalf("reset: %d %v", status, body)
	}
	if n := sessionCount(t, member.CustomerID); n != 0 {
		t.Fatalf("sessions after reset: %d, want 0", n)
	}
	if status, body := reset(member.Phone, code, "Secret789"); status != 400 {
		t.Fatalf("code reuse: %d %v", status, body)
	}
	if status, body, _ := h.login(member.Phone, "Secret456"); status != 200 {
		t.Fatalf("login after reset: %d %v", status, body)
	}

	// Without OTP the member is sent to the front desk.
	t.Setenv("OTP_ENABLED", "false")
	status, body = forgot(member.Phone)
	data, _ = body["data"].(map[string]any)
	if status != 200 || data["status"] != "front_desk" || data["phone_masked"] != nil {
		t.Fatalf("forgot without OTP: %d %v", status, body)
	}
	if status, body := reset(member.Phone, code, "Secret789"); status != 503 {
		t.Fatalf("reset without OTP: %d %v", status, body)
	}
}
