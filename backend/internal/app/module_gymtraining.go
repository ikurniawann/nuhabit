package app

import (
	"nuhabit/backend/internal/modules/gymscheduling"
	"nuhabit/backend/internal/modules/gymtraining"
	"nuhabit/backend/internal/platform/database"
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
// contacts from platform/members, paid incentives into HRIS payroll, PR
// notifications through the gym notifier, and the revenue and sessions
// revenue-share commission splits from gym-credits and gym-scheduling. The module's integration tests
// use it too.
func GymTrainingPorts(d module.Deps) gymtraining.Ports { return GymTrainingPortsOn(d, d.DB) }

// GymTrainingPortsOn is GymTrainingPorts with the gym-scheduling reads on
// q, a transaction in tests.
func GymTrainingPortsOn(d module.Deps, q database.Querier) gymtraining.Ports {
	return gymtraining.Ports{
		Scheduling: gymTrainingScheduling{r: gymscheduling.NewReader(q)},
		Customers:  gymtraining.CustomersSQL{DB: d.DB},
		Payroll:    gymTrainingPayroll{},
		Notifier:   gymTrainingNotifier{},
		Commission: gymTrainingCommission{},
		// Discipline incidents arrive with the coach discipline module.
		Discipline: gymtraining.NoDiscipline{},
	}
}
