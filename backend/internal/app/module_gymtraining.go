package app

import (
	"nuhabit/backend/internal/modules/gymtraining"
	"nuhabit/backend/internal/platform/module"
)

// gym-training: exercise library, workouts, race calendar, coach incentives.
//
// The Scheduling and Customers ports point at SQL adapters inside the module
// (coaches, class types, class sessions, bookings; POS customers). Switch
// them to the gym-scheduling and POS/CRM modules once those expose the reads.
func init() {
	Register(gymtraining.Name, func(d module.Deps) module.Module {
		return gymtraining.New(d, gymtraining.Ports{
			Scheduling: gymtraining.SchedulingSQL{DB: d.DB},
			Customers:  gymtraining.CustomersSQL{DB: d.DB},
		})
	})
}
