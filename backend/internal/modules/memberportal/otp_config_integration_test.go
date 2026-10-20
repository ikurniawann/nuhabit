package memberportal

import (
	"context"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/testutil"
)

// fakeMailer records the codes it is asked to email.
type fakeMailer struct {
	mu   sync.Mutex
	sent map[string]string // to -> html
}

func (*fakeMailer) Configured() bool { return true }

func (m *fakeMailer) Send(_ context.Context, to, _, html string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent[to] = html
	return true
}

func (m *fakeMailer) body(to string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sent[to]
}

func (h *harness) config() map[string]any {
	h.t.Helper()
	status, body, _ := h.do(testutil.Request("GET", "/api/member-portal/config", nil))
	if status != 200 || body["success"] != true {
		h.t.Fatalf("config: %d %v", status, body)
	}
	return body["data"].(map[string]any)
}

func wantConfig(t *testing.T, got map[string]any, enabled bool, channels ...string) {
	t.Helper()
	want := []any{}
	for _, c := range channels {
		want = append(want, c)
	}
	if got["otp_enabled"] != enabled || !reflect.DeepEqual(got["otp_channels"], want) {
		t.Fatalf("config %v, want enabled=%v channels=%v", got, enabled, channels)
	}
}

// OTP follows the configured channels at runtime; OTP_ENABLED=false still
// forces it off.
func TestIntegrationOTPAvailabilityFollowsChannels(t *testing.T) {
	h := newHarness(t)
	t.Setenv("OTP_ENABLED", "")
	wantConfig(t, h.config(), true, ChannelWhatsApp)

	t.Setenv("OTP_ENABLED", "false")
	wantConfig(t, h.config(), false, ChannelWhatsApp)
	t.Setenv("OTP_ENABLED", "")

	// No channel and no dev bypass: sign-up and code sign-in close.
	h.notifier.unconfigured = true
	wantConfig(t, h.config(), false)
	if status, _, _ := h.do(testutil.Request("POST", "/api/member-portal/register/otp", map[string]any{"phone": randomLocalPhone()})); status != 503 {
		t.Fatalf("register otp without a channel: %d", status)
	}
	if status, body, _ := h.do(testutil.Request("POST", "/api/member-portal/password/forgot", map[string]any{"username": "x@example.com"})); status != 200 ||
		body["data"].(map[string]any)["status"] != "front_desk" {
		t.Fatalf("forgot without a channel: %d %v", status, body)
	}

	// The local dev bypass opens it without a channel.
	h.devCode = "000000"
	wantConfig(t, h.config(), true)
	h.devCode = ""
}

// With email as the only channel, codes go to the email the visitor typed
// or the one on the account.
func TestIntegrationOTPByEmail(t *testing.T) {
	h := newHarness(t)
	t.Setenv("OTP_ENABLED", "")
	h.notifier.unconfigured = true
	mailer := &fakeMailer{sent: map[string]string{}}
	h.mod.handler.svc.mailer = mailer
	wantConfig(t, h.config(), true, ChannelEmail)

	phone := randomLocalPhone()
	cleanupOTP(t, digitsOf(phone))
	status, body, _ := h.do(testutil.Request("POST", "/api/member-portal/register/otp", map[string]any{"phone": phone}))
	if status != 400 || body["field"] != "email" {
		t.Fatalf("register otp without email: %d %v", status, body)
	}
	email := "otp-" + testutil.RandomHex(4) + "@example.com"
	status, body, _ = h.do(testutil.Request("POST", "/api/member-portal/register/otp", map[string]any{"phone": phone, "email": email}))
	if status != 200 || body["channel"] != ChannelEmail || body["wa_delivered"] != false {
		t.Fatalf("register otp by email: %d %v", status, body)
	}
	if !strings.Contains(mailer.body(email), "Kode masuk Portal Member") {
		t.Fatalf("mail %q", mailer.body(email))
	}

	member := newMember(t)
	cleanupOTP(t, digitsOf(member.Phone))
	status, body, _ = h.do(testutil.Request("POST", "/api/member-portal/otp", map[string]any{"phone": member.Phone}))
	if status != 409 || body["code"] != "otp_no_email" {
		t.Fatalf("login otp without an email on file: %d %v", status, body)
	}
	memberEmail := "m-" + testutil.RandomHex(4) + "@example.com"
	if _, err := testutil.DB(t).Exec(context.Background(), `UPDATE pos.pos_customers SET email = $2 WHERE id = $1`, member.CustomerID, memberEmail); err != nil {
		t.Fatal(err)
	}
	status, body, _ = h.do(testutil.Request("POST", "/api/member-portal/otp", map[string]any{"phone": member.Phone}))
	if status != 200 || body["channel"] != ChannelEmail || body["message"] != "Kode OTP dikirim ke email akun Anda" || mailer.body(memberEmail) == "" {
		t.Fatalf("login otp by email: %d %v", status, body)
	}
}

// A number gets at most 10 codes a day, whatever network asks.
func TestIntegrationOTPDailyCapPerNumber(t *testing.T) {
	h := newHarness(t)
	member := newMember(t)
	phone := digitsOf(member.Phone)
	cleanupOTP(t, phone)
	key := "member-otp-phone:" + phone
	t.Cleanup(func() {
		_, _ = testutil.DB(t).Exec(context.Background(), `DELETE FROM platform.rate_limits WHERE key = $1`, key)
	})
	svc := h.mod.handler.svc
	for range domain.PhoneRuleOTPDaily.Limit {
		if _, _, err := svc.limits.Sliding(context.Background(), key, domain.PhoneRuleOTPDaily.Limit, domain.PhoneRuleOTPDaily.Window, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	status, body, _ := h.do(testutil.Request("POST", "/api/member-portal/otp", map[string]any{"phone": member.Phone}))
	if status != 429 || body["error"] != domain.TooManyCodesToday {
		t.Fatalf("11th code today: %d %v", status, body)
	}
}
