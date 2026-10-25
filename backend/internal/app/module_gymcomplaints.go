package app

import (
	"context"
	"os"
	"time"

	"nuhabit/backend/internal/modules/gymcomplaints"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/whatsapp"
)

// gym-complaints: complaint tickets from the inbox, the desk and the member
// app, their SLA escalation and report. Escalations go out on WhatsApp
// through the configured provider.
func init() {
	Register(gymcomplaints.Name, func(d module.Deps) module.Module {
		return gymcomplaints.New(d, complaintsPorts(d))
	})
	RegisterJob(gymcomplaints.Name, "gym-complaints.escalate", 5*time.Minute, complaintsService, (*gymcomplaints.Service).Escalate)
}

func complaintsPorts(d module.Deps) gymcomplaints.Ports {
	return gymcomplaints.Ports{
		WhatsApp:  complaintsWhatsApp{db: d.DB, wa: whatsapp.New(d.Log)},
		AppOrigin: ticketingAppOrigin(os.Getenv),
	}
}

func complaintsService(d module.Deps) *gymcomplaints.Service {
	return gymcomplaints.NewService(d.DB, complaintsPorts(d), d.Now, d.Log)
}

// complaintsWhatsApp sends staff escalations as notification messages.
type complaintsWhatsApp struct {
	db database.Querier
	wa *whatsapp.Client
}

func (c complaintsWhatsApp) SendWhatsApp(ctx context.Context, phone, text string) bool {
	if !c.wa.Configured(ctx, c.db) {
		return false
	}
	return c.wa.SendText(ctx, c.db, phone, text, "notification", "").Success
}
