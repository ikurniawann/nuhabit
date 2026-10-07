// Package configuration is the settings and identity-administration
// bounded context: IAM roles and menus, Open API tokens, staff accounts
// (admin users and employee-linked users), brands and sections, the audit
// trail, the business tree and the dashboard settings kept in
// configuration.app_settings. Each area lives in its own sub-package; this
// package mounts them as one module.
package configuration

import (
	"context"

	"nuhabit/backend/internal/modules/configuration/access"
	"nuhabit/backend/internal/modules/configuration/accounts"
	"nuhabit/backend/internal/modules/configuration/apitokens"
	"nuhabit/backend/internal/modules/configuration/kit"
	"nuhabit/backend/internal/modules/configuration/master"
	"nuhabit/backend/internal/modules/configuration/settings"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key of this module.
const Name = "configuration"

// AppSettings is the configuration.app_settings store (getSetting,
// getSettings, setSetting) on the caller's querier. Other modules reach it
// through a port that internal/app adapts to this type.
type AppSettings = kit.AppSettings

// TtsEndpoints are the speech API roots of Synthesize; zero values use
// production.
type TtsEndpoints = settings.Endpoints

// Synthesize is the configured text-to-speech (lib/tts/synthesize.ts): text
// as mp3 in the provider, voice and model stored in app settings, read on q.
func Synthesize(ctx context.Context, q database.Querier, urls TtsEndpoints, text string) ([]byte, error) {
	return settings.Synthesize(ctx, q, urls, text)
}

// Ports are the adapters internal/app wires from other bounded contexts.
type Ports struct {
	Accounts accounts.Ports
	Settings settings.Ports
	Master   master.Ports
}

type configurationModule struct{ routes []module.Route }

func (m configurationModule) Name() string           { return Name }
func (m configurationModule) Routes() []module.Route { return m.routes }

// New mounts the module on the shared pool.
func New(d module.Deps, p Ports) module.Module { return NewOn(d, d.DB, p) }

// NewOn mounts the module on db: the pool in production, a rolled-back
// transaction in tests. Sessions still resolve through d.Auth.
func NewOn(d module.Deps, db database.DB, p Ports) module.Module {
	var routes []module.Route
	for _, rs := range [][]module.Route{
		access.Routes(d, db),
		apitokens.Routes(d, db),
		accounts.Routes(d, db, p.Accounts),
		settings.Routes(d, db, p.Settings),
		master.Routes(d, db, p.Master),
	} {
		routes = append(routes, rs...)
	}
	return configurationModule{routes: routes}
}
