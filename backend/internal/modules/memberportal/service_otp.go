package memberportal

import (
	"context"
	"html"

	"nuhabit/backend/internal/platform/featureflags"
)

// Channels a sign-in code can go out on.
const (
	ChannelWhatsApp = "whatsapp"
	ChannelEmail    = "email"
)

// OTPChannels lists the configured code channels, WhatsApp first.
func (s *Service) OTPChannels(ctx context.Context) []string {
	var out []string
	if s.notifier != nil && s.notifier.Configured(ctx) {
		out = append(out, ChannelWhatsApp)
	}
	if s.mailer != nil && s.mailer.Configured() {
		out = append(out, ChannelEmail)
	}
	return out
}

// OTPAvailable decides at runtime whether code sign-in, self sign-up and the
// code password reset are open: OTP_ENABLED=false keeps them shut, otherwise
// a configured channel (or the local dev bypass) opens them.
func (s *Service) OTPAvailable(ctx context.Context) bool {
	if featureflags.OTPForcedOff() {
		return false
	}
	return len(s.OTPChannels(ctx)) > 0 || s.bypass().Active()
}

// otpChannel is the channel a new code goes out on, "" when none is set up.
func (s *Service) otpChannel(ctx context.Context) string {
	if channels := s.OTPChannels(ctx); len(channels) > 0 {
		return channels[0]
	}
	return ""
}

// PortalConfig is the public configuration the member app reads at runtime.
type PortalConfig struct {
	OTPEnabled  bool     `json:"otp_enabled"`
	OTPChannels []string `json:"otp_channels"`
}

// Config reports what the sign-in screens may offer.
func (s *Service) Config(ctx context.Context) PortalConfig {
	channels := s.OTPChannels(ctx)
	if channels == nil {
		channels = []string{}
	}
	return PortalConfig{OTPEnabled: s.OTPAvailable(ctx), OTPChannels: channels}
}

// otpEmail is the subject and body of a code sent by email.
func otpEmail(brand, code string) (subject, body string) {
	b := html.EscapeString(brand)
	return "Kode verifikasi " + brand,
		"<p>Kode masuk Portal Member " + b + " Anda:</p>" +
			"<p style=\"font-size:24px;font-weight:bold;letter-spacing:4px\">" + html.EscapeString(code) + "</p>" +
			"<p>Berlaku 5 menit. Jangan bagikan kode ini kepada siapa pun, termasuk yang mengaku staf " + b + ".</p>"
}
