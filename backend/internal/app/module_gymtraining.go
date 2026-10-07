package app

import (
	"nuhabit/backend/internal/modules/gymscheduling"
	"nuhabit/backend/internal/modules/gymtraining"
	"nuhabit/backend/internal/platform/module"
)

// gym-training: exercise library, workouts, race calendar, coach incentives.
func init() {
	Register(gymtraining.Name, func(d module.Deps) module.Module {
		return gymtraining.New(d, GymTrainingPorts(d))
	})
}

// GymTrainingPorts wires gym-training's ports: coaches, class types,
// completed classes and attendance from gym-scheduling's Reader, member
// contacts from platform/members. The module's integration tests use it too.
func GymTrainingPorts(d module.Deps) gymtraining.Ports {
	return gymtraining.Ports{
		Scheduling: gymTrainingScheduling{r: gymscheduling.NewReader(d.DB)},
		Customers:  gymtraining.CustomersSQL{DB: d.DB},
	}
}
