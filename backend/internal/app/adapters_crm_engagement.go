package app

import (
	"context"
	"html"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/crm/engagement"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/whatsapp"
)

// crmEngagementPorts wires the CRM engagement area's ports: POS order reads
// and member web push, both stopgap adapters in the engagement package, and
// the WhatsApp and email channels of gym notifications.
func crmEngagementPorts(d module.Deps) engagement.Ports {
	return engagement.Ports{
		Orders: engagement.OrdersSQL{},
		Push:   engagement.NewWebPush(d.DB, d.Log, d.Now),
		Gym:    newGymChannels(d),
	}
}

func newGymChannels(d module.Deps) gymChannels {
	return gymChannels{
		db:   d.DB,
		wa:   whatsapp.New(d.Log),
		mail: &resendMailer{apiKey: strings.TrimSpace(os.Getenv("RESEND_API_KEY")), log: d.Log, client: &http.Client{Timeout: 15 * time.Second}},
		from: strings.TrimSpace(firstNonEmptyStr(os.Getenv("GYM_FROM_EMAIL"), os.Getenv("FROM_EMAIL"))),
		log:  d.Log,
	}
}

type mailSender interface {
	Send(ctx context.Context, to, from, subject, html string) bool
}

// gymChannels sends a gym notification on WhatsApp when a provider is
// configured (services/wa-gateway, Meta or Fonnte) and by email when
// RESEND_API_KEY and a sender address (GYM_FROM_EMAIL or FROM_EMAIL) are set.
// The member's gym_whatsapp and gym_email switches (gym.athlete_settings,
// set in the member app) turn a channel off; no row means both on.
type gymChannels struct {
	db   database.Querier
	wa   *whatsapp.Client
	mail mailSender
	from string
	log  *slog.Logger
}

// gymSendTimeout bounds one member's WhatsApp and email sends.
const gymSendTimeout = time.Minute

func (c gymChannels) Send(customerID, title, body string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), gymSendTimeout)
		defer cancel()
		c.deliver(ctx, customerID, title, body)
	}()
}

func (c gymChannels) deliver(ctx context.Context, customerID, title, body string) {
	var phone, email *string
	var waOn, emailOn bool
	err := c.db.QueryRow(ctx, `
SELECT c.phone, c.email, COALESCE(s.gym_whatsapp, true), COALESCE(s.gym_email, true)
  FROM pos.pos_customers c LEFT JOIN gym.athlete_settings s ON s.customer_id = c.id
 WHERE c.id = $1`, customerID).Scan(&phone, &email, &waOn, &emailOn)
	if err != nil {
		if !database.IsNoRows(err) {
			c.log.Warn("[gym-notify] kontak member gagal dibaca", "customer", customerID, "error", err)
		}
		return
	}
	if !waOn {
		phone = nil
	}
	if !emailOn {
		email = nil
	}
	c.sendTo(ctx, phone, email, title, body)
}

// SendTo delivers a notice to a phone and an email address (nil skips a
// channel) in the background, for staff accounts with no member settings.
func (c gymChannels) SendTo(phone, email *string, title, body string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), gymSendTimeout)
		defer cancel()
		c.sendTo(ctx, phone, email, title, body)
	}()
}

func (c gymChannels) sendTo(ctx context.Context, phone, email *string, title, body string) {
	if phone != nil {
		if target := whatsapp.NormalizeRecipient(*phone); target != "" && c.wa.Configured(ctx, c.db) {
			if res := c.wa.SendText(ctx, c.db, target, "*"+title+"*\n"+body, "notification", ""); !res.Success {
				c.log.Warn("[gym-notify] WhatsApp gagal", "phone", target, "reason", res.Reason)
			}
		}
	}
	if email != nil && strings.Contains(*email, "@") && c.from != "" {
		c.mail.Send(ctx, strings.TrimSpace(*email), c.from, title, gymEmailHTML(title, body))
	}
}

func gymEmailHTML(title, body string) string {
	return `<p><strong>` + html.EscapeString(title) + `</strong></p><p>` + html.EscapeString(body) + `</p>` +
		`<p style="color:#6b7280;font-size:12px">Atur notifikasi di menu Pengaturan aplikasi member NüHabit.</p>`
}
