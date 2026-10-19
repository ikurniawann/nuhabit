package production

import (
	"context"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/production/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	ps "nuhabit/backend/internal/platform/scope"
)

// Sub-orders: an order's intermediate materials (made in-house: their own
// recipe, or the recipe of the product they mirror as WIP) show their
// shortage in the flow; "Buat Sub-order" creates DRAFT orders for what open
// sub-orders do not cover yet, so pressing it twice creates nothing new.

// ChildOrder is a sub-order of an order.
type ChildOrder struct {
	ID, Number, Status, Context, OutputType string
	ProductID, OutputRawMaterialID          *string
	ItemKode, ItemNama                      string
	PlannedQty                              float64
	CreatedAt                               time.Time
}

// open is a sub-order that will still make its quantity.
func (c ChildOrder) open() bool {
	return c.Status == domain.StatusDraft || c.Status == domain.StatusReleased || c.Status == domain.StatusInProgress
}

// NewOrder is a DRAFT production order to insert.
type NewOrder struct {
	Number, Context, OutputType    string
	ProductID, OutputRawMaterialID *string
	PlannedQty, PlannedCost, Hpp   float64
	CompanyID, BranchID            *string
	ParentOrderID                  string
	Catatan                        string
	UserID                         string
	Materials                      []NewOrderMaterial
}

// NewOrderMaterial is a planned line of a NewOrder, in stock units.
type NewOrderMaterial struct {
	RawMaterialID              string
	SatuanID, RecipeSatuanID   *string
	QtyPlanned, UnitCost, Cost float64
	RecipeQty, UnitFactor      float64
}

// intermediate is a material line made in-house and what it still lacks.
type intermediate struct {
	line     MaterialLine
	material Material
	owner    RecipeOwner // the recipe a sub-order makes it with
	recipe   []domain.Component
	needed   float64
	covered  float64
	shortage float64
}

// intermediates finds the order's lines made in-house and their shortage
// net of stock and open sub-orders.
func (s *Service) intermediates(ctx context.Context, q database.Querier, lines []MaterialLine, materials map[string]Material,
	children []ChildOrder) ([]intermediate, error) {
	ids := make([]string, len(lines))
	var products []string
	for i, l := range lines {
		ids[i] = l.RawMaterialID
		if p := materials[l.RawMaterialID].SourceProductID; p != "" {
			products = append(products, p)
		}
	}
	own, err := s.repo.MaterialRecipes(ctx, q, unique(ids))
	if err != nil {
		return nil, err
	}
	viaProduct, err := s.repo.ProductRecipes(ctx, q, unique(products))
	if err != nil {
		return nil, err
	}
	covered := map[string]float64{} // raw material id → open sub-order quantity
	wipOf := map[string]string{}    // product id → its WIP material among the lines
	for _, l := range lines {
		if p := materials[l.RawMaterialID].SourceProductID; p != "" {
			wipOf[p] = l.RawMaterialID
		}
	}
	for _, c := range children {
		switch {
		case !c.open():
		case c.OutputRawMaterialID != nil:
			covered[*c.OutputRawMaterialID] += c.PlannedQty
		case c.ProductID != nil && c.OutputType == "WIP":
			covered[wipOf[*c.ProductID]] += c.PlannedQty
		}
	}
	var out []intermediate
	for _, l := range lines {
		m := materials[l.RawMaterialID]
		it := intermediate{line: l, material: m}
		switch {
		case len(own[l.RawMaterialID]) > 0:
			id := l.RawMaterialID
			it.owner, it.recipe = RecipeOwner{RawMaterialID: &id}, own[l.RawMaterialID]
		case m.SourceProductID != "" && len(viaProduct[m.SourceProductID]) > 0:
			pid := m.SourceProductID
			it.owner, it.recipe = RecipeOwner{ProductID: &pid}, viaProduct[pid]
		default:
			continue
		}
		it.needed = domain.RoundQty(math.Max(0, l.QtyPlanned-(l.QtyIssued-l.QtyReturned)))
		it.covered = domain.RoundQty(covered[l.RawMaterialID])
		it.shortage = domain.Shortage(it.needed, m.QtyOnHand, it.covered)
		out = append(out, it)
	}
	return out, nil
}

// SubOrderResult is POST /api/production/orders/{id}/sub-orders.
type SubOrderResult struct {
	Created []SubOrderView `json:"created"`
	Flow    *FlowView      `json:"flow"`
	Message string         `json:"-"`
}

// CreateSubOrders creates a DRAFT order for each short intermediate that
// open sub-orders do not cover: the shortage rounded up to the recipe's
// batch size, linked to the parent order.
func (s *Service) CreateSubOrders(ctx context.Context, scope *ps.Scope, orderID, userID string) (*SubOrderResult, error) {
	var res *SubOrderResult
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		o, err := s.order(ctx, tx, scope, orderID, true)
		if err != nil {
			return err
		}
		if !activeOrder(o.Status) {
			return httpx.BadRequest("Sub-order hanya bisa dibuat untuk order yang belum selesai atau batal")
		}
		lines, err := s.repo.Lines(ctx, tx, o.ID)
		if err != nil {
			return err
		}
		materials, err := s.ports.Catalog.Materials(ctx, tx, lineMaterialIDs(lines))
		if err != nil {
			return err
		}
		children, err := s.repo.ChildOrders(ctx, tx, o.ID)
		if err != nil {
			return err
		}
		its, err := s.intermediates(ctx, tx, lines, materials, children)
		if err != nil {
			return err
		}
		var created []SubOrderView
		for _, it := range its {
			if it.shortage <= 0 {
				continue
			}
			child, err := s.subOrder(ctx, tx, o, it, userID)
			if err != nil {
				return err
			}
			created = append(created, child)
		}
		flow, err := s.flow(ctx, tx, o)
		if err != nil {
			return err
		}
		res = &SubOrderResult{Created: created, Flow: flow}
		if len(created) == 0 {
			res.Created = []SubOrderView{}
			res.Message = "Tidak ada kekurangan bahan setengah jadi yang belum tercakup sub-order"
			return nil
		}
		numbers := make([]string, len(created))
		for i, c := range created {
			numbers[i] = c.NomorProduksi
		}
		res.Message = "Sub-order dibuat: " + strings.Join(numbers, ", ")
		return nil
	})
	return res, err
}

func activeOrder(status string) bool {
	return status == domain.StatusDraft || status == domain.StatusReleased || status == domain.StatusInProgress
}

func lineMaterialIDs(lines []MaterialLine) []string {
	ids := make([]string, len(lines))
	for i, l := range lines {
		ids[i] = l.RawMaterialID
	}
	return ids
}

// subOrder writes one DRAFT order for an intermediate, planned from its
// recipe in stock units at the current average costs.
func (s *Service) subOrder(ctx context.Context, tx pgx.Tx, parent *Order, it intermediate, userID string) (SubOrderView, error) {
	settings, err := s.repo.RecipeSettings(ctx, tx, it.owner)
	if err != nil {
		return SubOrderView{}, err
	}
	batch := 0.0
	if settings != nil && settings.BatchSize != nil {
		batch = *settings.BatchSize
	}
	qty := domain.SubOrderQty(it.shortage, batch)
	recipe := append([]domain.Component(nil), it.recipe...)
	if err := s.toStockUnits(ctx, tx, recipe, nil); err != nil {
		return SubOrderView{}, err
	}
	components, err := s.ports.Catalog.Materials(ctx, tx, componentIDs(recipe))
	if err != nil {
		return SubOrderView{}, err
	}
	n := NewOrder{Context: "raw_material", OutputType: "FINISHED_GOOD", PlannedQty: qty, CompanyID: parent.CompanyID,
		BranchID: parent.BranchID, ParentOrderID: parent.ID, UserID: userID,
		Catatan: "Sub-order untuk kekurangan " + label(it.material) + " di " + parent.Number}
	if it.owner.ProductID != nil {
		n.Context, n.OutputType, n.ProductID = "product", "WIP", it.owner.ProductID
	} else {
		n.OutputRawMaterialID = it.owner.RawMaterialID
	}
	for _, c := range recipe {
		m := components[c.RawMaterialID]
		recipeQty := c.QtyPer * (1 + c.WasteFactor) * qty
		line := NewOrderMaterial{RawMaterialID: c.RawMaterialID, QtyPlanned: domain.RoundQty(recipeQty * c.UnitFactor()),
			UnitCost: m.AvgCost, RecipeQty: domain.RoundQty(recipeQty), UnitFactor: c.UnitFactor()}
		line.Cost = round2(line.QtyPlanned * m.AvgCost)
		if c.SatuanID != "" {
			line.RecipeSatuanID = &c.SatuanID
		}
		line.SatuanID = line.RecipeSatuanID
		if m.UnitID != "" {
			unitID := m.UnitID
			line.SatuanID = &unitID
		}
		n.Materials = append(n.Materials, line)
		n.PlannedCost += line.Cost
	}
	n.PlannedCost = round2(n.PlannedCost)
	n.Hpp = round2(n.PlannedCost / qty)
	prefix := domain.OrderNumberPrefix(s.now())
	last, err := s.repo.LastOrderNumber(ctx, tx, prefix)
	if err != nil {
		return SubOrderView{}, err
	}
	n.Number = domain.NextOrderNumber(prefix, last)
	id, err := s.repo.InsertOrder(ctx, tx, n)
	if err != nil {
		return SubOrderView{}, err
	}
	return SubOrderView{ID: id, NomorProduksi: n.Number, Status: domain.StatusDraft, ProductionContext: n.Context,
		OutputType: n.OutputType, ItemKode: it.material.Kode, ItemNama: it.material.Nama, PlannedQty: qty,
		CreatedAt: httpx.JSTime(s.now())}, nil
}
