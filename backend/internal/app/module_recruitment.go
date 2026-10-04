package app

import (
	"nuhabit/backend/internal/modules/recruitment"
	"nuhabit/backend/internal/platform/module"
)

// recruitment: candidates pipeline, psikotes, interview AI and offer
// portals, live monitoring, job openings, positions and promotion.
func init() {
	Register(recruitment.Name, func(d module.Deps) module.Module {
		return recruitment.New(d, RecruitmentPorts(d))
	})
}

// RecruitmentPorts wires the promotion ports to the stopgap HRIS SQL
// adapters. The module's integration tests use it too.
func RecruitmentPorts(d module.Deps) recruitment.Ports {
	return recruitment.Ports{
		Employees: recruitmentEmployees{},
		Contracts: recruitmentContracts{now: d.Now},
	}
}
