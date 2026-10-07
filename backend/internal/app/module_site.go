package app

import (
	"nuhabit/backend/internal/modules/site"
	"nuhabit/backend/internal/platform/module"
)

func init() {
	Register(site.Name, func(deps module.Deps) module.Module {
		return site.New(deps, SitePorts(deps))
	})
}
