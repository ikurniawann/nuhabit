package mail

import "testing"

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestMergePrefersStoredOverEnv(t *testing.T) {
	cfg := merge(map[string]string{"mail_provider": "Microsoft", "mail_from_email": "gym@nuhabit.id", "mail_smtp_port": "25"},
		env(map[string]string{"MAIL_PROVIDER": "resend", "FROM_EMAIL": "env@x.id", "RESEND_API_KEY": "re_1", "SMTP_PORT": "587", "SMTP_HOST": "smtp.office365.com"}))
	if cfg.Provider != "microsoft" || cfg.FromEmail != "gym@nuhabit.id" || cfg.ResendAPIKey != "re_1" || cfg.SMTPPort != 25 || cfg.SMTPHost != "smtp.office365.com" {
		t.Fatalf("merge = %+v", cfg)
	}
}

func TestResolved(t *testing.T) {
	graph := Config{TenantID: "t", ClientID: "c", ClientSecret: "s", Sender: "ops@nuhabit.onmicrosoft.com"}
	smtp := Config{SMTPHost: "smtp.office365.com", SMTPUser: "ops@outlook.com", SMTPPassword: "app-pass"}
	cases := []struct {
		name string
		cfg  Config
		want string
	}{
		{"nothing", Config{}, ""},
		{"resend only", Config{ResendAPIKey: "re_1", FromEmail: "a@b.id"}, ProviderResend},
		{"graph wins over resend when both present", Config{ResendAPIKey: "re_1", TenantID: "t", ClientID: "c", ClientSecret: "s", FromEmail: "a@b.id"}, ProviderGraph},
		{"explicit resend", Config{Provider: ProviderResend, ResendAPIKey: "re_1", TenantID: "t", ClientID: "c", ClientSecret: "s", FromEmail: "a@b.id"}, ProviderResend},
		{"explicit resend without key", Config{Provider: ProviderResend, TenantID: "t", ClientID: "c", ClientSecret: "s", FromEmail: "a@b.id"}, ""},
		{"graph", graph, ProviderGraph},
		{"smtp auto", smtp, ProviderSMTP},
		{"smtp forced but incomplete", Config{Transport: TransportSMTP, TenantID: "t", ClientID: "c", ClientSecret: "s", FromEmail: "a@b.id"}, ""},
		{"graph forced but incomplete", Config{Transport: TransportGraph, SMTPHost: "h", SMTPUser: "u", SMTPPassword: "p"}, ""},
		{"microsoft explicit without creds", Config{Provider: ProviderMicrosoft, ResendAPIKey: "re_1"}, ""},
	}
	for _, c := range cases {
		if got := c.cfg.Resolved(); got != c.want {
			t.Errorf("%s: Resolved() = %q, want %q", c.name, got, c.want)
		}
	}
	if !smtp.Configured() || smtp.SenderAddress() != "ops@outlook.com" {
		t.Errorf("SMTP sender should default to the mailbox: %q", smtp.SenderAddress())
	}
	if (Config{ResendAPIKey: "re_1"}).Configured() {
		t.Error("Resend without a From address is not configured")
	}
	if !graph.Configured() || graph.Mailbox() != "ops@nuhabit.onmicrosoft.com" {
		t.Errorf("graph config: %+v", graph)
	}
}
