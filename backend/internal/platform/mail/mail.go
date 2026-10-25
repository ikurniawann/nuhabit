// Package mail is the outbound email port. Every module that emails (payslips,
// member sign-in codes, gym notifications, dataroom shares, recruitment) hands
// a Message to Service.Send; the service picks the provider from Settings →
// Integrasi → Email (configuration.app_settings, env as the fallback), logs
// the message in platform.mail_log and retries transient failures from the
// integrations.mail-retry job. Providers: Resend's HTTP API, Microsoft Graph
// sendMail (OAuth2 client credentials) and SMTP AUTH with STARTTLS.
package mail

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
)

// Attachment is one file on a message.
type Attachment struct {
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	Content     []byte `json:"content"`
}

// Message is one outbound email.
type Message struct {
	// Kind labels the message in the log (payslip, otp, gym, dataroom,
	// recruitment, test); empty is "generic".
	Kind string
	// To is the recipient address, bare (no display name).
	To string
	// From is the sender address; empty takes the configured sender. The
	// Microsoft providers always send from the configured mailbox.
	From string
	// FromName is the sender display name; empty takes the configured one.
	FromName    string
	Subject     string
	HTML        string
	Attachments []Attachment
	// NoRetry sends once: a sign-in code is useless minutes later.
	NoRetry bool
}

// Provider delivers a message and returns the provider's reference for it.
type Provider interface {
	Name() string
	Send(ctx context.Context, m Message) (messageID string, err error)
}

// TransientError marks a failure the retry job should try again: network
// trouble, a timeout, HTTP 408/429/5xx or an SMTP 4xx reply.
type TransientError struct{ Err error }

func (e *TransientError) Error() string { return e.Err.Error() }
func (e *TransientError) Unwrap() error { return e.Err }

// Transient wraps err as a TransientError (nil stays nil).
func Transient(err error) error {
	if err == nil {
		return nil
	}
	return &TransientError{Err: err}
}

// IsTransient reports whether err is worth retrying.
func IsTransient(err error) bool {
	var t *TransientError
	if errors.As(err, &t) {
		return true
	}
	var netErr net.Error
	return errors.Is(err, context.DeadlineExceeded) || errors.As(err, &netErr)
}

// transientStatus is the HTTP statuses a retry can fix.
func transientStatus(code int) bool {
	return code == http.StatusRequestTimeout || code == http.StatusTooManyRequests || code >= 500
}

// httpError builds the error of a non-2xx provider response, transient when
// the status says so.
func httpError(provider string, status int, detail string) error {
	err := fmt.Errorf("%s %d: %s", provider, status, detail)
	if transientStatus(status) {
		return Transient(err)
	}
	return err
}

// formatAddress renders "Name <addr>" (or the bare address).
func formatAddress(addr, name string) string {
	if name == "" {
		return addr
	}
	return fmt.Sprintf("%s <%s>", name, addr)
}
