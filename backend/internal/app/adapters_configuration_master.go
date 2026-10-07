package app

import (
	"context"
	"encoding/json"

	"nuhabit/backend/internal/modules/configuration/master"
	"nuhabit/backend/internal/modules/hris"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

func configurationMasterPorts(module.Deps) master.Ports {
	return master.Ports{Sections: configurationSections{}}
}

// configurationSections adapts the hris.sections service to /api/sections.
type configurationSections struct{ hris hris.Sections }

func (s configurationSections) List(ctx context.Context, q database.Querier, brandID *string) ([]json.RawMessage, error) {
	rows, err := s.hris.List(ctx, q, brandID)
	if err != nil {
		return nil, err
	}
	out := make([]json.RawMessage, len(rows))
	for i, row := range rows {
		if out[i], err = json.Marshal(row); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s configurationSections) Create(ctx context.Context, q database.Querier, in master.Section) (json.RawMessage, error) {
	row, err := s.hris.Create(ctx, q, hris.NewSection(in))
	if err != nil || row == nil {
		return nil, err
	}
	return json.Marshal(row)
}
