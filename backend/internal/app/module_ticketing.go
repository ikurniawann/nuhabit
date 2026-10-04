package app

import (
	"os"
	"strings"

	"nuhabit/backend/internal/modules/ticketing"
	"nuhabit/backend/internal/platform/module"
)

// ticketing: tickets, visits and tabs, gate taps, website booking admin,
// season passes and venue settings (/api/ticketing/**).
//
// Venue resolution reads the user's business scope and the CRM default
// venue; staff bands read HRIS employees; the booking resend sends through
// the WhatsApp gateway. All three are SQL/HTTP adapters below until the
// owning modules expose them.
func init() {
	Register(ticketing.Name, func(d module.Deps) module.Module {
		return ticketing.New(d, ticketing.Ports{
			Venues:    ticketingVenues{db: d.DB},
			Employees: ticketingEmployees{},
			Messenger: ticketingMessenger{wa: newPosOpsWhatsApp(d.DB, os.Getenv, d.Log)},
			AppOrigin: ticketingAppOrigin(os.Getenv),
		})
	})
}

// ticketingAppOrigin is appOrigin() without a request: NEXT_PUBLIC_APP_URL (or the
// legacy NEXT_PUBLIC_BASE_URL) without trailing slashes, else "".
func ticketingAppOrigin(getenv func(string) string) string {
	origin := strings.TrimSpace(getenv("NEXT_PUBLIC_APP_URL"))
	if origin == "" {
		origin = strings.TrimSpace(getenv("NEXT_PUBLIC_BASE_URL"))
	}
	return strings.TrimRight(origin, "/")
}
