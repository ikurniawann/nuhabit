// Package cogs serves the COGS estimates of product and raw material
// recipes and the additional purchase costs (landed costs) that feed them
// (/api/purchasing/cogs).
package cogs

import (
	"context"
	"net/http"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
)

// Ports are the other contexts COGS reaches; internal/app wires them.
type Ports struct {
	Receipts Receipts
}

// DocRef names a purchase document an additional cost points at: Type is
// "PO" or "GRN".
type DocRef struct{ Type, ID string }

// Receipts is what COGS reads from procurement.
type Receipts interface {
	// ReceivedValues lists the active GRN lines of the raw materials, valued
	// at quantity received × PO unit price, and the received value of every
	// GRN and PO those lines belong to (all lines), keyed by domain.DocKey.
	ReceivedValues(ctx context.Context, q database.Querier, rawMaterialIDs []string) ([]domain.ReceiptLine, map[string]float64, error)
	// DocumentNumbers maps the documents that exist among refs, keyed by
	// domain.DocKey, to their number (nomor_po / nomor_grn).
	DocumentNumbers(ctx context.Context, q database.Querier, refs []DocRef) (map[string]string, error)
}

type handler struct {
	env   kit.Env
	ports Ports
}

// Routes mounts the COGS routes.
func Routes(env kit.Env, ports Ports) []module.Route {
	h := &handler{env: env, ports: ports}
	return []module.Route{
		kit.Route("GET /api/purchasing/cogs/additional-cost", h.listAdditionalCosts),
		kit.Route("POST /api/purchasing/cogs/additional-cost", h.createAdditionalCost),
		kit.Route("DELETE /api/purchasing/cogs/additional-cost/{id}", h.deleteAdditionalCost),
		kit.Route("GET /api/purchasing/cogs/product/{produk_id}", h.productCogs),
		kit.Route("GET /api/purchasing/cogs/raw-material/{id}", h.rawMaterialCogs),
	}
}

// itemsStaff is requireIamMenuPrefix(IAM.items).
func (h *handler) itemsStaff(r *http.Request) (*auth.User, error) {
	return h.env.Auth.RequireMenuPrefix(r, iam.Items...)
}

func positive(msg string) func(float64) (string, string, bool) {
	return func(x float64) (string, string, bool) { return "too_small", msg, x > 0 }
}
