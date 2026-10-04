package app

import (
	"nuhabit/backend/internal/modules/configuration"
	"nuhabit/backend/internal/modules/crm/marketing"
	"nuhabit/backend/internal/platform/module"
)

// configuration.AppSettings is the owner's service for app_settings; the
// CRM campaign-config port can switch from its stopgap SQL to it.
var _ marketing.Settings = configuration.AppSettings{}

// configuration: IAM roles and menus, Open API tokens, staff accounts,
// brands, sections, the audit trail, the business tree and app settings.
func init() {
	Register(configuration.Name, func(d module.Deps) module.Module {
		return configuration.New(d, ConfigurationPorts(d))
	})
}

// ConfigurationPorts wires the configuration ports to the adapters in
// adapters_configuration*.go. The module's integration tests use it too.
func ConfigurationPorts(d module.Deps) configuration.Ports {
	return configuration.Ports{
		Accounts: configurationAccountsPorts(d),
		Settings: configurationSettingsPorts(d),
		Master:   configurationMasterPorts(d),
	}
}
