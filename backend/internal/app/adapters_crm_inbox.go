package app

import (
	"os"

	"nuhabit/backend/internal/modules/crm/inbox"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/whatsapp"
)

// crmInboxPorts wires the CRM inbox area. Every adapter is a stopgap in the
// inbox package: WhatsApp send and owner notifications (configuration.*
// writes), Instagram Graph, OpenAI, Google Business and POS order reads.
func crmInboxPorts(d module.Deps) inbox.Ports {
	wa := whatsapp.New(d.Log)
	return inbox.Ports{
		WhatsApp:  &inbox.WhatsAppGateway{Client: wa},
		Instagram: inbox.InstagramGraph{Getenv: os.Getenv},
		AI:        inbox.OpenAIChat{Getenv: os.Getenv},
		Google:    &inbox.GoogleBusinessAPI{Getenv: os.Getenv, Log: d.Log},
		Notifier:  &inbox.OwnerNotifierWA{DB: d.DB, WhatsApp: wa, Log: d.Log},
		Orders:    inbox.PosOrdersSQL{},
	}
}
