package hris

import (
	"context"

	"nuhabit/backend/internal/platform/database"
)

// Sections is the hris.sections service other contexts reach through a
// port (the configuration context's /api/sections). Every method runs on
// the caller's Querier. Rows come back as `SELECT *` renders them, with the
// SQL of the TS route.
type Sections struct{}

// NewSection is a validated section insert.
type NewSection struct {
	BrandID, Name, Code string
	Description         *string
	Color               string
}

// List is every section (of one brand when brandID is set) with its brand
// name embedded as `brands`, ordered by name.
func (Sections) List(ctx context.Context, q database.Querier, brandID *string) ([]*Row, error) {
	return queryRows(ctx, q, `SELECT s.*, CASE WHEN b.id IS NULL THEN NULL ELSE json_build_object('name', b.name) END AS brands
       FROM hris.sections s LEFT JOIN item.brands b ON b.id = s.brand_id
      WHERE $1::uuid IS NULL OR s.brand_id = $1
      ORDER BY s.name`, brandID)
}

// Create inserts a section and returns the row.
func (Sections) Create(ctx context.Context, q database.Querier, s NewSection) (*Row, error) {
	return queryRow(ctx, q, `INSERT INTO hris.sections (brand_id, name, code, description, color)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`, s.BrandID, s.Name, s.Code, s.Description, s.Color)
}
