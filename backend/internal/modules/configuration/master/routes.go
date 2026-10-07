// Package master holds the shared organization masters and the audit
// trail: brands (/api/brands), HR sections (/api/sections) and the audit log
// reader (/api/audit).
package master

import (
	"context"
	"encoding/json"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// Section is the insert of POST /api/sections after validation.
type Section struct {
	BrandID, Name, Code string
	Description         *string
	Color               string
}

// Sections is hris.sections, owned by the hris context. Rows come back as
// the JSON `SELECT *` renders, so the response follows the table.
type Sections interface {
	// List is every section (of one brand when brandID is set) with its
	// brand name embedded as `brands`, ordered by name.
	List(ctx context.Context, q database.Querier, brandID *string) ([]json.RawMessage, error)
	// Create inserts a section and returns the row.
	Create(ctx context.Context, q database.Querier, s Section) (json.RawMessage, error)
}

// Ports are the capabilities of other bounded contexts this area uses;
// internal/app/adapters_configuration_master.go provides them.
type Ports struct {
	Sections Sections
}

type handler struct {
	db       database.DB
	auth     *auth.Service
	sections Sections
}

// Routes mounts brands, sections and the audit reader.
func Routes(d module.Deps, db database.DB, p Ports) []module.Route {
	h := handler{db: db, auth: d.Auth, sections: p.Sections}
	return []module.Route{
		{Pattern: "GET /api/brands", Handler: httpx.Handle(h.listBrands)},
		{Pattern: "POST /api/brands", Handler: httpx.Handle(h.createBrand)},
		{Pattern: "PATCH /api/brands/{id}", Handler: httpx.Handle(h.patchBrand)},
		{Pattern: "GET /api/sections", Handler: httpx.Handle(h.listSections)},
		{Pattern: "POST /api/sections", Handler: httpx.Handle(h.createSection)},
		{Pattern: "GET /api/audit", Handler: httpx.Handle(h.audit)},
	}
}

// listBody is {data, count}: brand rows or section JSON.
type listBody struct {
	Data  any `json:"data"`
	Count int `json:"count"`
}

// dataBody is {data}.
type dataBody struct {
	Data any `json:"data"`
}
