package app

import (
	"nuhabit/backend/internal/modules/crm/reports"
	"nuhabit/backend/internal/platform/module"
)

// crmReportsPorts wires the CRM reports area: POS and wallet aggregates
// through the stopgap SQL adapter until pos-sales/stored-value expose them.
func crmReportsPorts(module.Deps) reports.Ports {
	return reports.Ports{Pos: reports.PosReportsSQL{}}
}
