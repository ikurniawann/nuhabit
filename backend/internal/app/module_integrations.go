package app

import (
	"time"

	"nuhabit/backend/internal/modules/integrations"
	"nuhabit/backend/internal/modules/integrations/gobiz"
	"nuhabit/backend/internal/modules/integrations/settings"
	"nuhabit/backend/internal/modules/integrations/webhooks"
	"nuhabit/backend/internal/platform/mail"
	"nuhabit/backend/internal/platform/module"
)

// integrations: the integration settings pages and the inbound webhooks
// (Xendit, WhatsApp gateway, Telegram, loyalty partners, GoBiz), plus the
// retry of queued outbound emails.
func init() {
	Register(integrations.Name, func(d module.Deps) module.Module {
		return integrations.New(
			settings.New(d, integrationsSettingsPorts(d)),
			webhooks.New(d, integrationsWebhookPorts(d)),
			gobiz.New(d, newIntegrationsGobizPorts(d)),
		)
	})
	RegisterJob(integrations.Name, "integrations.mail-retry", time.Minute, newMailService, (*mail.Service).RetryDue)
}
