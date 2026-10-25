package settings

import (
	"context"
	"errors"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/mail"
)

// fakeMailProvider accepts every message unless err is set.
type fakeMailProvider struct {
	err  error
	sent []mail.Message
}

func (f *fakeMailProvider) Name() string { return "fake" }

func (f *fakeMailProvider) Send(_ context.Context, m mail.Message) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	f.sent = append(f.sent, m)
	return "fake-" + m.To, nil
}

func TestEmailSettings(t *testing.T) {
	f := newFixture(t)
	expect(t, f.do("GET", "/api/settings/email", nil, "admin", false), 403, `{"success":false,"error":"Insufficient permissions"}`)
	res := f.staff("GET", "/api/settings/email", nil)
	if res.Status != 200 || res.data()["configured"] != false || res.data()["resolved"] != "" {
		t.Fatalf("empty GET = %s", res.Raw)
	}

	// Env fills the gaps and is reported as such.
	f.env["RESEND_API_KEY"] = "re_env_1234567890"
	f.env["FROM_EMAIL"] = "env@nuhabit.id"
	res = f.staff("GET", "/api/settings/email", nil)
	d := res.data()
	if d["resolved"] != "resend" || d["configured"] != true || d["from_email"] != "env@nuhabit.id" || d["resend_api_key_masked"] != "re_e••••••••7890" ||
		strings.Join(toStrings(d["from_env"]), ",") != "mail_from_email,mail_resend_api_key" {
		t.Fatalf("env GET = %s", res.Raw)
	}

	// Saving Microsoft Graph credentials switches the provider; the secret
	// comes back masked and the stored From wins over env.
	res = f.staff("PUT", "/api/settings/email", map[string]any{
		"provider": "microsoft", "transport": "graph", "from_email": " ops@nuhabit.onmicrosoft.com ", "from_name": "NüHabit",
		"ms_tenant_id": "tenant", "ms_client_id": "client", "ms_client_secret": "very-secret-value", "ms_sender": "",
	})
	d = res.data()
	if res.Status != 200 || d["resolved"] != "microsoft-graph" || d["from_email"] != "ops@nuhabit.onmicrosoft.com" ||
		d["ms_client_secret_masked"] != "very••••••••alue" || d["has_ms_client_secret"] != true || d["ms_sender"] != "" ||
		strings.Join(toStrings(d["from_env"]), ",") != "mail_resend_api_key" {
		t.Fatalf("PUT = %s", res.Raw)
	}
	if v := f.setting("mail_ms_client_secret"); v == nil || *v != "very-secret-value" {
		t.Fatal("secret must be stored")
	}

	// A masked or empty secret keeps the stored one; null deletes it.
	f.staff("PUT", "/api/settings/email", map[string]any{"ms_client_secret": "very••••••••alue", "from_name": ""})
	if v := f.setting("mail_ms_client_secret"); v == nil || *v != "very-secret-value" {
		t.Fatal("masked secret must keep the stored one")
	}
	if v := f.setting("mail_from_name"); v != nil {
		t.Fatalf("empty from_name must clear the row, got %q", *v)
	}
	f.staff("PUT", "/api/settings/email", map[string]any{"ms_client_secret": nil})
	if v := f.setting("mail_ms_client_secret"); v != nil {
		t.Fatal("null must delete the secret")
	}
	if f.staff("GET", "/api/settings/email", nil).data()["resolved"] != "" {
		t.Error("microsoft without a secret must not resolve")
	}

	expect(t, f.staff("PUT", "/api/settings/email", map[string]any{"provider": "gmail"}), 400, "")
	expect(t, f.staff("PUT", "/api/settings/email", map[string]any{"from_email": "not an email"}), 400, "")
	expect(t, f.staff("PUT", "/api/settings/email", map[string]any{"smtp_port": 70000}), 400, "")
	res = f.staff("PUT", "/api/settings/email", map[string]any{"transport": "smtp", "smtp_host": "smtp.office365.com", "smtp_port": 587,
		"smtp_user": "ops@outlook.com", "smtp_password": "app-password-123"})
	if d := res.data(); res.Status != 200 || d["resolved"] != "microsoft-smtp" || d["smtp_port"] != float64(587) || d["smtp_password_masked"] != "app-••••••••-123" {
		t.Fatalf("SMTP PUT = %s", res.Raw)
	}
}

func TestEmailTestSendAndLog(t *testing.T) {
	f := newFixture(t)
	// A user without an email cannot receive the test message.
	expect(t, f.staff("POST", "/api/settings/email/test", nil), 400, `{"success":false,"error":"Akun Anda belum punya alamat email; isi email di profil dulu"}`)
	f.email = "owner@nuhabit.id"
	expect(t, f.staff("POST", "/api/settings/email/test", nil), 400, `{"success":false,"error":"`+mail.ErrNotConfigured.Error()+`"}`)

	f.env["RESEND_API_KEY"] = "re_1"
	f.env["FROM_EMAIL"] = "noreply@nuhabit.id"
	f.mailer.Invalidate()
	res := f.staff("POST", "/api/settings/email/test", nil)
	if res.Status != 200 || res.data()["to"] != "owner@nuhabit.id" || res.data()["message_id"] != "fake-owner@nuhabit.id" {
		t.Fatalf("test send = %s", res.Raw)
	}
	if len(f.mail.sent) != 1 || f.mail.sent[0].Kind != "test" || f.mail.sent[0].From != "noreply@nuhabit.id" || f.mail.sent[0].NoRetry != true {
		t.Fatalf("sent = %+v", f.mail.sent)
	}

	// The provider's error reaches the UI verbatim.
	f.mail.err = errors.New("Graph 403 ErrorSendAsDenied: The user account does not have the right to send mail")
	expect(t, f.staff("POST", "/api/settings/email/test", nil), 502,
		`{"success":false,"error":"Graph 403 ErrorSendAsDenied: The user account does not have the right to send mail"}`)
	f.mail.err = nil

	expect(t, f.do("GET", "/api/settings/email/log", nil, "admin", false), 403, "")
	res = f.staff("GET", "/api/settings/email/log?status=failed", nil)
	entries := res.data()["entries"].([]any)
	summary := res.data()["summary"].(map[string]any)
	if res.Status != 200 || len(entries) != 1 || summary["failed"] != float64(1) || summary["sent"] != float64(1) {
		t.Fatalf("log = %s", res.Raw)
	}
	row := entries[0].(map[string]any)
	if row["status"] != "failed" || row["to"] != "owner@nuhabit.id" || !strings.HasPrefix(row["error"].(string), "Graph 403") || row["attempts"] != float64(1) {
		t.Fatalf("row = %v", row)
	}
	if _, hasBody := row["body_html"]; hasBody {
		t.Error("the log list must not carry message bodies")
	}

	id := row["id"].(string)
	expect(t, f.staff("POST", "/api/settings/email/log/not-a-uuid/resend", nil), 400, `{"success":false,"error":"ID tidak valid"}`)
	expect(t, f.staff("POST", "/api/settings/email/log/00000000-0000-4000-8000-000000000000/resend", nil), 404, `{"success":false,"error":"Email tidak ditemukan"}`)
	res = f.staff("POST", "/api/settings/email/log/"+id+"/resend", nil)
	if res.Status != 200 || res.data()["status"] != "sent" || len(f.mail.sent) != 2 {
		t.Fatalf("resend = %s (sent %d)", res.Raw, len(f.mail.sent))
	}
	if after := f.staff("GET", "/api/settings/email/log?q=owner", nil).data()["summary"].(map[string]any); after["failed"] != float64(0) || after["sent"] != float64(2) {
		t.Fatalf("summary after resend = %v", after)
	}

	// Sign-in codes are never resent from the dashboard.
	f.exec(`INSERT INTO platform.mail_log (kind, to_address, from_address, subject, body_html, provider, status, attempts, max_attempts, error)
		VALUES ('otp', 'm@x.id', 'noreply@nuhabit.id', 'Kode', '<p>1</p>', 'fake', 'failed', 1, 1, 'timeout')`)
	var otpID string
	if err := f.tx.QueryRow(context.Background(), `SELECT id::text FROM platform.mail_log WHERE kind = 'otp' AND to_address = 'm@x.id'`).Scan(&otpID); err != nil {
		t.Fatal(err)
	}
	expect(t, f.staff("POST", "/api/settings/email/log/"+otpID+"/resend", nil), 409, "")
}

func toStrings(v any) []string {
	list, _ := v.([]any)
	out := make([]string, len(list))
	for i, s := range list {
		out[i], _ = s.(string)
	}
	return out
}
