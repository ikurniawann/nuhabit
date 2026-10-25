package app

import (
	"time"

	"nuhabit/backend/internal/modules/gymsop"
	"nuhabit/backend/internal/platform/module"
)

// gym-sop: coach SOPs with read confirmations and reminders. The WhatsApp
// copy of a reminder goes through the gym notification channels.
func init() {
	Register(gymsop.Name, func(d module.Deps) module.Module { return gymsop.New(d, sopMessenger{newGymChannels(d)}) })
	RegisterJob(gymsop.Name, "gym-sop.reminders", time.Hour, sopService, (*gymsop.Service).RemindOverdue)
}

// sopService is the SOP service for the reminder job.
func sopService(d module.Deps) *gymsop.Service {
	return gymsop.NewService(d.DB, nil, sopMessenger{newGymChannels(d)}, d.Now, d.Log)
}

// sopMessenger sends a SOP reminder to a staff phone on WhatsApp only.
type sopMessenger struct{ channels gymChannels }

var _ gymsop.Messenger = sopMessenger{}

func (m sopMessenger) WhatsApp(phone, title, body string) {
	m.channels.SendTo(&phone, nil, title, body)
}
