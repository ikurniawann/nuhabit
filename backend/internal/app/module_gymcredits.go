package app

import (
	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/platform/module"
)

func init() {
	Register(gymcredits.Name, func(d module.Deps) module.Module {
		return gymcredits.New(d, newGymVouchers(d))
	})
}
