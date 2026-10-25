package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"nuhabit/backend/internal/platform/mail"
	"nuhabit/backend/internal/platform/testutil"
)

// recordingProvider accepts every message unless err is set.
type recordingProvider struct {
	err  error
	sent []mail.Message
}

func (p *recordingProvider) Name() string { return "fake" }

func (p *recordingProvider) Send(_ context.Context, m mail.Message) (string, error) {
	if p.err != nil {
		return "", p.err
	}
	p.sent = append(p.sent, m)
	return "id-" + m.To, nil
}

// mailHarness is a mailer on a rolled-back transaction with env-only
// configuration (no stored settings).
func mailHarness(t *testing.T, configured bool) (*mail.Service, *recordingProvider) {
	t.Helper()
	tx := testutil.Tx(t)
	if _, err := tx.Exec(context.Background(), `DELETE FROM configuration.app_settings WHERE key = ANY($1)`, mail.SettingKeys()); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{}
	if configured {
		env["RESEND_API_KEY"], env["FROM_EMAIL"] = "re_1", "noreply@nuhabit.id"
	}
	prov := &recordingProvider{}
	svc := mail.New(tx, func(k string) string { return env[k] }, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	svc.Providers = func(c mail.Config) (mail.Provider, error) {
		if c.Resolved() == "" {
			return nil, mail.ErrNotConfigured
		}
		return prov, nil
	}
	return svc, prov
}

func TestSplitAddress(t *testing.T) {
	for raw, want := range map[string][2]string{
		"Payroll <payroll@nuhabit.id>": {"payroll@nuhabit.id", "Payroll"},
		" gym@nuhabit.id ":             {"gym@nuhabit.id", ""},
		"":                             {"", ""},
	} {
		if addr, name := splitAddress(raw); addr != want[0] || name != want[1] {
			t.Errorf("splitAddress(%q) = %q, %q", raw, addr, name)
		}
	}
}

func TestPayslipMailerAttachesPDFOnce(t *testing.T) {
	svc, prov := mailHarness(t, true)
	id, err := mailPayslipMailer{svc: svc}.SendPayslip(context.Background(), "employee@example.com", "Payroll <payroll@nuhabit.id>", "Slip", "<p>Slip</p>", "slip.pdf", []byte("%PDF"))
	if err != nil || id != "id-employee@example.com" {
		t.Fatalf("id=%q err=%v", id, err)
	}
	m := prov.sent[0]
	if m.Kind != "payslip" || m.From != "payroll@nuhabit.id" || m.FromName != "Payroll" || !m.NoRetry ||
		len(m.Attachments) != 1 || m.Attachments[0].Filename != "slip.pdf" || m.Attachments[0].ContentType != "application/pdf" || string(m.Attachments[0].Content) != "%PDF" {
		t.Fatalf("message = %+v", m)
	}
	prov.err = mail.Transient(errors.New("Graph 503: ServiceUnavailable"))
	if _, err := (mailPayslipMailer{svc: svc}).SendPayslip(context.Background(), "e@example.com", "", "Slip", "<p>s</p>", "slip.pdf", []byte("%PDF")); err == nil || err.Error() != "Graph 503: ServiceUnavailable" {
		t.Fatalf("provider error must reach payroll verbatim: %v", err)
	}
	if _, sum, _ := svc.List(context.Background(), mail.Filter{}); sum.Queued != 0 || sum.Failed != 1 {
		t.Fatalf("a payslip is never queued for retry: %+v", sum)
	}
}

func TestMailSenderSkipsWhenUnconfigured(t *testing.T) {
	svc, prov := mailHarness(t, false)
	if (mailSender{svc: svc, kind: "gym"}).Send(context.Background(), "m@example.com", "", "Kelas", "<p>k</p>") {
		t.Fatal("unconfigured mailer must report false")
	}
	if (memberOTPMail{svc: svc}).Configured() {
		t.Fatal("OTP mail must report unconfigured")
	}
	if list, _, _ := svc.List(context.Background(), mail.Filter{}); len(list) != 0 || len(prov.sent) != 0 {
		t.Fatal("nothing may be logged or sent without a provider")
	}
}

func TestMemberOTPMailSendsOnce(t *testing.T) {
	svc, prov := mailHarness(t, true)
	m := memberOTPMail{svc: svc, from: "NüHabit <gym@nuhabit.id>"}
	if !m.Configured() || !m.Send(context.Background(), "member@example.com", "Kode", "<p>123456</p>") {
		t.Fatal("configured OTP mail must send")
	}
	if got := prov.sent[0]; got.Kind != "otp" || !got.NoRetry || got.From != "gym@nuhabit.id" || got.FromName != "NüHabit" {
		t.Fatalf("otp message = %+v", got)
	}
}
