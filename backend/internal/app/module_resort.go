package app

import (
	"nuhabit/backend/internal/modules/resort"
	"nuhabit/backend/internal/platform/module"
)

// resort: room types and rooms, availability, reservations with folio, and
// the front office (/api/resort/**). Venue resolution reads the user's
// business scope and the CRM default venue through adapters_resort.go.
func init() {
	Register(resort.Name, func(d module.Deps) module.Module {
		return resort.New(d, resortVenues{db: d.DB})
	})
}
