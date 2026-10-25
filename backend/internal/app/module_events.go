package app

import (
	"time"

	eventsc "nuhabit/backend/internal/contracts/events"
	"nuhabit/backend/internal/modules/events"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// events: the unified event calendar, conflict checks, checklist, ICS and
// CSV exports. The CRM engagement and site writers call the same service
// as their eventsc.Calendar port, on their own transactions.
func init() {
	Register(events.Name, func(d module.Deps) module.Module {
		return events.New(d, eventsPorts(d))
	})
	RegisterJob(events.Name, "events.reminders", 5*time.Minute, eventsService, (*events.Service).SendReminders)
}

func eventsPorts(d module.Deps) events.Ports {
	return events.Ports{Channels: newGymChannels(d)}
}

// eventsService is the calendar service on the pool.
func eventsService(d module.Deps) *events.Service { return eventsServiceOn(d, d.DB) }

// eventsServiceOn is eventsService on db, a transaction in tests.
func eventsServiceOn(d module.Deps, db database.DB) *events.Service {
	return events.NewService(db, eventsPorts(d), d.Now, d.Log)
}

// EventCalendar is the eventsc.Calendar port of the CRM and site event
// writers, on db; integration tests pass their rolled-back transaction.
func EventCalendar(d module.Deps, db database.DB) eventsc.Calendar { return eventsServiceOn(d, db) }
