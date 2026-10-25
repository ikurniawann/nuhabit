package app

import (
	"context"
	stdmail "net/mail"
	"os"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/mail"
	"nuhabit/backend/internal/platform/module"
)

// Outbound email: every module port below ends in platform/mail, which
// reads Settings → Integrasi → Email (env as the fallback), logs each
// message in platform.mail_log and retries transient failures from the
// integrations.mail-retry job. Interactive sends (payslips, sign-in codes)
// go out once; the dashboard log offers a manual resend.

// newMailService builds the mailer on the pool. Each wiring builds its own;
// a settings save shows up in all of them within the 30 s config cache.
func newMailService(d module.Deps) *mail.Service {
	return mail.New(d.DB, os.Getenv, d.Log, d.Now)
}

// splitAddress parses "Name <addr>" (the FROM_EMAIL style) into its parts;
// a bare address comes back as is.
func splitAddress(raw string) (addr, name string) {
	raw = strings.TrimSpace(raw)
	if p, err := stdmail.ParseAddress(raw); err == nil {
		return p.Address, p.Name
	}
	return raw, ""
}

// mailSender is the Send(ctx, to, from, subject, html) bool port of the
// dataroom and the gym notification channels. Nothing is sent or logged
// while no provider is configured.
type mailSender struct {
	svc  *mail.Service
	kind string
}

func (m mailSender) Send(ctx context.Context, to, from, subject, html string) bool {
	if !m.svc.Configured(ctx) {
		return false
	}
	addr, name := splitAddress(from)
	return m.svc.Send(ctx, mail.Message{Kind: m.kind, To: to, From: addr, FromName: name, Subject: subject, HTML: html}).Sent()
}

// recruitmentMail is recruitment's Mailer: candidate and HRD emails from
// the configured sender.
type recruitmentMail struct{ svc *mail.Service }

func (m recruitmentMail) Send(ctx context.Context, to, subject, html string) bool {
	return mailSender{svc: m.svc, kind: "recruitment"}.Send(ctx, to, "", subject, html)
}

// mailPayslipMailer is payroll's PayslipMailer: the salary PDF attached,
// sent once (HR retries from the payroll page or the email log).
type mailPayslipMailer struct{ svc *mail.Service }

func (m mailPayslipMailer) SendPayslip(ctx context.Context, to, from, subject, html, filename string, pdf []byte) (string, error) {
	addr, name := splitAddress(from)
	res := m.svc.Send(ctx, mail.Message{Kind: "payslip", To: to, From: addr, FromName: name, Subject: subject, HTML: html, NoRetry: true,
		Attachments: []mail.Attachment{{Filename: filename, ContentType: "application/pdf", Content: pdf}}})
	if res.Err != nil {
		return "", res.Err
	}
	return res.MessageID, nil
}

// memberOTPMail emails member sign-in codes once: a code is expired by the
// time a retry would run.
type memberOTPMail struct {
	svc  *mail.Service
	from string
}

func (m memberOTPMail) Configured() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return m.svc.Configured(ctx)
}

func (m memberOTPMail) Send(ctx context.Context, to, subject, html string) bool {
	addr, name := splitAddress(m.from)
	return m.svc.Send(ctx, mail.Message{Kind: "otp", To: to, From: addr, FromName: name, Subject: subject, HTML: html, NoRetry: true}).Sent()
}
