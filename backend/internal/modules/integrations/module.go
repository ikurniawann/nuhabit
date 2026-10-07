// Package integrations is the third-party integrations context (module name
// "integrations"): the integration settings pages (AI providers, GoBiz,
// Google Business, Instagram, payment gateways, WhatsApp gateway and owner
// notifications) and the inbound webhooks (Xendit QRIS, GoBiz, Telegram,
// loyalty partners, WhatsApp gateway). Ports of
// frontend/src/app/api/settings/{gobiz,google-business,instagram,
// integrations,payment-gateways,wa-gateway,wa-notifications},
// integrations/**, payments/xendit/webhook and wa/inbound. Each family lives
// in a sub-package; internal/app builds them with their ports.
package integrations

import "nuhabit/backend/internal/platform/module"

// Name is the MODULES key.
const Name = "integrations"

type integrationsModule struct{ routes []module.Route }

func (m integrationsModule) Name() string           { return Name }
func (m integrationsModule) Routes() []module.Route { return m.routes }

// Subroutes is a sub-package handler mounted by the module.
type Subroutes interface{ Routes() []module.Route }

// New mounts the sub-package handlers.
func New(subs ...Subroutes) module.Module {
	var routes []module.Route
	for _, s := range subs {
		routes = append(routes, s.Routes()...)
	}
	return integrationsModule{routes: routes}
}
