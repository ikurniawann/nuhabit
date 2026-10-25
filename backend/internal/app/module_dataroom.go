package app

import (
	"os"
	"time"

	"nuhabit/backend/internal/modules/dataroom"
	"nuhabit/backend/internal/platform/module"
)

// dataroom: folders, files, versions, trash, department and per-user
// access, comments and share links (/api/dataroom/**, /api/share/**);
// files live in STORAGE_DIR. HRIS departments and staff accounts are read
// through adapters_dataroom.go; emails go out through the mailer port (adapters_mail.go).
// The hourly job purges trash older than 30 days and expired upload
// sessions.
func init() {
	Register(dataroom.Name, func(d module.Deps) module.Module {
		return dataroom.New(d, dataroomPorts(d, os.Getenv, os.LookupEnv))
	})
	RegisterJob(dataroom.Name, "dataroom.housekeeping", time.Hour, dataroomService, (*dataroom.Service).Housekeeping)
}

// dataroomService is the Dataroom service for jobs and the filing port.
func dataroomService(d module.Deps) *dataroom.Service {
	return dataroom.NewService(d.DB, dataroomPorts(d, os.Getenv, os.LookupEnv), d.Now, d.Log, d.Config.IsProduction())
}

// dataroomFiler is the port other modules file documents through
// (payroll payslips today).
func dataroomFiler(d module.Deps) *dataroom.Filer { return dataroom.NewFiler(dataroomService(d)) }
