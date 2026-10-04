package app

import (
	"context"

	"nuhabit/backend/internal/modules/configuration/kit"
	"nuhabit/backend/internal/modules/configuration/master"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

func configurationMasterPorts(module.Deps) master.Ports {
	return master.Ports{Sections: configurationSectionsSQL{}}
}

// configurationSectionsSQL is hris.sections for /api/sections, with the SQL
// of the TS route. Stopgap adapter: hris has no exported sections service.
type configurationSectionsSQL struct{}

func (configurationSectionsSQL) List(ctx context.Context, q database.Querier, brandID *string) ([]*kit.Row, error) {
	return kit.Query(ctx, q, `SELECT s.*, CASE WHEN b.id IS NULL THEN NULL ELSE json_build_object('name', b.name) END AS brands
       FROM hris.sections s LEFT JOIN item.brands b ON b.id = s.brand_id
      WHERE $1::uuid IS NULL OR s.brand_id = $1
      ORDER BY s.name`, brandID)
}

func (configurationSectionsSQL) Create(ctx context.Context, q database.Querier, s master.Section) (*kit.Row, error) {
	return kit.QueryOne(ctx, q, `INSERT INTO hris.sections (brand_id, name, code, description, color)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`, s.BrandID, s.Name, s.Code, s.Description, s.Color)
}
