package memberportal

import (
	"context"
	"log/slog"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/whatsapp"
)

// whatsappNotifier is the Notifier on platform/whatsapp: the provider of
// lib/whatsapp, every send logged to crm.wa_messages (OTP bodies never
// stored).
type whatsappNotifier struct {
	db database.Querier
	wa *whatsapp.Client
}

func newWhatsAppNotifier(db database.Querier, getenv func(string) string, log *slog.Logger) *whatsappNotifier {
	wa := whatsapp.New(log)
	wa.Getenv = getenv
	return &whatsappNotifier{db: db, wa: wa}
}

// SendOTP sends a login code: a Meta AUTHENTICATION template, or the
// fallback text on the gateway and Fonnte.
func (n *whatsappNotifier) SendOTP(ctx context.Context, target, code, fallbackText string) Delivery {
	return delivery(n.wa.SendOTP(ctx, n.db, target, code, fallbackText))
}

// SendText sends free text (only inside the 24 hour window on Meta).
func (n *whatsappNotifier) SendText(ctx context.Context, target, message, messageType string) Delivery {
	return delivery(n.wa.SendText(ctx, n.db, target, message, messageType, ""))
}

func delivery(r whatsapp.Result) Delivery {
	return Delivery{Delivered: r.Success, Reason: r.Reason, Provider: r.Provider, MessageID: r.MessageID, TimedOut: r.TimedOut}
}
