package app

import (
	"os"

	"nuhabit/backend/internal/modules/dataroom"
	"nuhabit/backend/internal/platform/module"
)

// dataroom: folders, files, department access and share links
// (/api/dataroom/**, /api/share/**); files live in STORAGE_DIR.
// HRIS departments and employees are read through adapters_dataroom.go;
// emails go out through Resend's HTTP API.
func init() {
	Register(dataroom.Name, func(d module.Deps) module.Module {
		return dataroom.New(d, dataroomPorts(d, os.Getenv, os.LookupEnv))
	})
}
