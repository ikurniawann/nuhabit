// Package production is the production bounded context: multi-level BOM
// explosion, material issue into WIP, output receipt in batches with scrap,
// and the HPP of every batch. Orders are created, released and started by
// the routes ported from TS (package legacy, same module); once materials
// are issued here, the order finishes here. Stock moves through
// Ports.Stock, journals follow from the events in
// internal/contracts/production.
package production

import (
	"context"
	"errors"
	"log/slog"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	contracts "nuhabit/backend/internal/contracts/production"
	"nuhabit/backend/internal/modules/production/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/jsmath"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/pdfgen"
	ps "nuhabit/backend/internal/platform/scope"
)

/* ── records ─────────────────────────────────────────────────────────── */

// Order is a production order with its item names.
type Order struct {
	ID, Number, Status, Context, OutputType string
	ProductID, OutputRawMaterialID          *string
	ItemKode, ItemNama                      string
	PlannedQty, ActualQty                   float64
	PlannedMaterialCost, ActualMaterialCost float64
	Overhead, Labor, Packaging, Waste       float64
	HppPerUnit                              float64
	CompanyID, BranchID                     *string
	StartedAt, CompletedAt                  *time.Time
	CreatedAt                               time.Time
}

// Conversion is the order's overhead, labor, packaging and waste cost.
func (o Order) Conversion() float64 { return o.Overhead + o.Labor + o.Packaging + o.Waste }

// MaterialLine is one planned material with what was issued so far, in
// the material's stock unit. RecipeQty, RecipeUnitID and UnitFactor keep
// the recipe line it came from; they are nil on orders created before
// recipe units were converted.
type MaterialLine struct {
	ID, RawMaterialID string
	QtyPlanned        float64
	UnitCost          float64
	QtyIssued         float64
	IssuedCost        float64
	RecipeQty         *float64
	RecipeUnitID      *string
	UnitFactor        *float64
}

func (l MaterialLine) domain() domain.Line {
	return domain.Line{QtyPlanned: l.QtyPlanned, UnitCost: l.UnitCost, QtyIssued: l.QtyIssued, IssuedCost: l.IssuedCost}
}

// Issue is one material issue.
type Issue struct {
	ID, Number string
	TotalCost  float64
	Catatan    *string
	CreatedAt  time.Time
	Lines      []IssueLine
}

// IssueLine is one material of an issue.
type IssueLine struct {
	MaterialLineID, RawMaterialID string
	Qty, UnitCost, TotalCost      float64
	MovementID, WarehouseID       *string
}

// Batch is one output receipt (manufacturing.production_batches).
// QtyAbnormal is the part of QtyScrap above the order's tolerance; its cost
// (AbnormalMaterial + AbnormalConversion) is expensed.
type Batch struct {
	ID, OrderID, Number, OutputType         string
	WipRawMaterialID                        *string
	QtyGood, QtyScrap, QtyAbnormal          float64
	HppPerUnit, TotalCost                   float64
	MaterialCost, ConversionCost, ScrapCost float64
	AbnormalMaterial, AbnormalConversion    float64
	ScrapTolerancePct                       *float64
	IsFinal                                 bool
	Catatan                                 *string
	CreatedAt                               time.Time
}

// AbnormalCost is the expensed cost of the batch's abnormal scrap.
func (b Batch) AbnormalCost() float64 { return round2(b.AbnormalMaterial + b.AbnormalConversion) }

// WrittenOff is the material the batch took out of WIP without putting it
// into stock: normal scrap of a final batch with no good units plus the
// material of abnormal scrap.
func (b Batch) WrittenOff() float64 { return b.ScrapCost + b.AbnormalMaterial }

// Applied is the conversion cost the batch applied to WIP.
func (b Batch) Applied() float64 { return b.ConversionCost + b.AbnormalConversion }

// BatchRow is a batch with its order, for the batch list.
type BatchRow struct {
	Batch
	OrderNumber, Context, OrderStatus string
	ItemKode, ItemNama                string
	PlannedQty                        float64
	CompanyID, BranchID, ProductID    *string
}

// WipRow is an open order with materials in production.
type WipRow struct {
	ID, Number, Status, Context, OutputType string
	ItemKode, ItemNama                      string
	PlannedQty                              float64
	StartedAt                               *time.Time
	IssuedCost                              float64
	LastIssueAt                             time.Time
	ReceivedMaterialCost, ScrapCost         float64
	AbnormalMaterialCost                    float64
	ConversionApplied, ConversionCost       float64
	QtyGood, QtyScrap                       float64
	Batches                                 int
	LastReceiptAt                           *time.Time
}

// Outcome is what a receipt writes back on the order.
type Outcome struct {
	ActualQty, HppPerUnit             float64
	Overhead, Labor, Packaging, Waste float64
	Complete                          bool
	UserID                            string
	Now                               time.Time
}

// RecipeOwner names a recipe: a product or a raw material (one of them).
type RecipeOwner struct{ ProductID, RawMaterialID *string }

// RecipeSettings are per recipe settings (manufacturing.recipe_settings).
type RecipeSettings struct {
	ScrapTolerancePct *float64
	UpdatedAt         *time.Time
}

// ListFilter narrows the WIP and batch lists.
type ListFilter struct {
	CompanyID, BranchID      *string
	Context, Search, OrderID string
	Limit                    int
}

// Repository is the module's storage (postgres.go).
type Repository interface {
	Order(ctx context.Context, q database.Querier, id string, lock bool) (*Order, error)
	Lines(ctx context.Context, q database.Querier, orderID string) ([]MaterialLine, error)
	Issues(ctx context.Context, q database.Querier, orderID string) ([]Issue, error)
	Batches(ctx context.Context, q database.Querier, orderID string) ([]Batch, error)
	InsertIssue(ctx context.Context, q database.Querier, orderID, number string, catatan *string, userID string) (Issue, error)
	InsertIssueLine(ctx context.Context, q database.Querier, issueID string, l IssueLine) error
	SetIssueTotal(ctx context.Context, q database.Querier, issueID string, total float64) error
	MarkIssued(ctx context.Context, q database.Querier, orderID, userID string, start bool, now time.Time) error
	InsertBatch(ctx context.Context, q database.Querier, o *Order, b Batch, userID string) (Batch, error)
	InsertVariants(ctx context.Context, q database.Querier, orderID, batchID, userID string, rows []domain.Variant) error
	Variants(ctx context.Context, q database.Querier, batchID string) ([]domain.Variant, error)
	SaveOutcome(ctx context.Context, q database.Querier, orderID string, o Outcome) error
	ProductRecipes(ctx context.Context, q database.Querier, productIDs []string) (map[string][]domain.Component, error)
	MaterialRecipes(ctx context.Context, q database.Querier, ids []string) (map[string][]domain.Component, error)
	// RecipeSettings is the settings row of a product or raw material
	// recipe, nil when it has none.
	RecipeSettings(ctx context.Context, q database.Querier, owner RecipeOwner) (*RecipeSettings, error)
	SaveRecipeSettings(ctx context.Context, q database.Querier, owner RecipeOwner, tolerancePct *float64, userID string) error
	WipOrders(ctx context.Context, q database.Querier, f ListFilter) ([]WipRow, error)
	ListBatches(ctx context.Context, q database.Querier, f ListFilter) ([]BatchRow, error)
	Batch(ctx context.Context, q database.Querier, id string) (*BatchRow, error)
}

/* ── service ─────────────────────────────────────────────────────────── */

// Service runs the production use cases on db (the pool, or a test
// transaction).
type Service struct {
	db    database.DB
	repo  Repository
	ports Ports
	now   func() time.Time
	log   *slog.Logger
}

// NewService builds the service.
func NewService(db database.DB, repo Repository, ports Ports, now func() time.Time, log *slog.Logger) *Service {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{db: db, repo: repo, ports: ports, now: now, log: log}
}

var errOrderNotFound = httpx.NotFound("Order produksi tidak ditemukan")

// jakarta is the calendar of journal entry dates.
var jakarta = func() *time.Location {
	if loc, err := time.LoadLocation("Asia/Jakarta"); err == nil {
		return loc
	}
	return time.FixedZone("WIB", 7*3600)
}()

func (s *Service) entryDate() string { return s.now().In(jakarta).Format("2006-01-02") }

func rule(err error) error {
	var r domain.RuleError
	if errors.As(err, &r) {
		return httpx.BadRequest(r.Error())
	}
	return err
}

func round2(v float64) float64 { return jsmath.RoundTo(v, 2) }

// order loads an order the user may see.
func (s *Service) order(ctx context.Context, q database.Querier, scope *ps.Scope, id string, lock bool) (*Order, error) {
	o, err := s.repo.Order(ctx, q, id, lock)
	if err != nil {
		return nil, err
	}
	if o == nil || !ps.OperationalRowInScope(scope, o.CompanyID, o.BranchID) {
		return nil, errOrderNotFound
	}
	return o, nil
}

/* ── explosion ───────────────────────────────────────────────────────── */

// ExplodeInput names the item to make: a product or a raw material.
type ExplodeInput struct {
	ProductID, RawMaterialID string
	Qty                      float64
}

// Explode walks the recipe of the item for Qty units.
func (s *Service) Explode(ctx context.Context, in ExplodeInput) (*ExplodeView, error) {
	q := s.db
	view := &ExplodeView{}
	var root []domain.Component
	if in.ProductID != "" {
		p, err := s.ports.Catalog.Product(ctx, q, in.ProductID)
		if err != nil {
			return nil, err
		}
		if p == nil {
			return nil, httpx.NotFound("Produk tidak ditemukan")
		}
		view.Item = ItemView{ID: p.ID, Kode: p.Kode, Nama: p.Nama, Satuan: p.Unit, Type: "product"}
		recipes, err := s.repo.ProductRecipes(ctx, q, []string{p.ID})
		if err != nil {
			return nil, err
		}
		root = recipes[p.ID]
	} else {
		m, err := s.ports.Catalog.Materials(ctx, q, []string{in.RawMaterialID})
		if err != nil {
			return nil, err
		}
		rm, ok := m[in.RawMaterialID]
		if !ok {
			return nil, httpx.NotFound("Bahan baku tidak ditemukan")
		}
		view.Item = ItemView{ID: rm.ID, Kode: rm.Kode, Nama: rm.Nama, Satuan: rm.Unit, Type: "raw_material"}
		recipes, err := s.repo.MaterialRecipes(ctx, q, []string{rm.ID})
		if err != nil {
			return nil, err
		}
		root = recipes[rm.ID]
	}
	if len(root) == 0 {
		return nil, httpx.BadRequest("Item ini belum memiliki resep (BOM)")
	}
	recipes, materials, err := s.loadGraph(ctx, q, root)
	if err != nil {
		return nil, err
	}
	if err := s.toStockUnits(ctx, q, root, recipes); err != nil {
		return nil, err
	}
	x, err := domain.Explode(root, in.Qty, recipes, materials)
	var cycle *domain.CycleError
	var depth *domain.DepthError
	if errors.As(err, &cycle) || errors.As(err, &depth) {
		return nil, httpx.BadRequest(err.Error())
	}
	if err != nil {
		return nil, err
	}
	view.Explosion = x
	return view, nil
}

// loadGraph loads materials and their recipes level by level: a material's
// own recipe, else the recipe of the product it mirrors as WIP. It stops one
// level past MaxDepth so the explosion can report the depth.
func (s *Service) loadGraph(ctx context.Context, q database.Querier, root []domain.Component) (domain.Recipes, map[string]domain.Material, error) {
	recipes := domain.Recipes{}
	materials := map[string]domain.Material{}
	frontier := componentIDs(root)
	for level := 0; level <= domain.MaxDepth+1 && len(frontier) > 0; level++ {
		found, err := s.ports.Catalog.Materials(ctx, q, frontier)
		if err != nil {
			return nil, nil, err
		}
		own, err := s.repo.MaterialRecipes(ctx, q, frontier)
		if err != nil {
			return nil, nil, err
		}
		var products []string
		owner := map[string][]string{}
		for _, id := range frontier {
			m := found[id]
			materials[id] = domain.Material{ID: id, Kode: m.Kode, Nama: m.Nama, Unit: m.Unit, QtyOnHand: m.QtyOnHand, AvgCost: m.AvgCost}
			if len(own[id]) > 0 {
				recipes[id] = own[id]
			} else if m.SourceProductID != "" {
				products = append(products, m.SourceProductID)
				owner[m.SourceProductID] = append(owner[m.SourceProductID], id)
			}
		}
		viaProduct, err := s.repo.ProductRecipes(ctx, q, products)
		if err != nil {
			return nil, nil, err
		}
		for pid, cs := range viaProduct {
			for _, id := range owner[pid] {
				recipes[id] = cs
			}
		}
		var next []string
		for _, id := range frontier {
			for _, c := range recipes[id] {
				if _, seen := materials[c.RawMaterialID]; !seen {
					next = append(next, c.RawMaterialID)
				}
			}
		}
		frontier = unique(next)
	}
	return recipes, materials, nil
}

// toStockUnits sets the stock unit factor and the recipe unit name of every
// component of root and recipes.
func (s *Service) toStockUnits(ctx context.Context, q database.Querier, root []domain.Component, recipes domain.Recipes) error {
	lists := [][]domain.Component{root}
	for _, cs := range recipes {
		lists = append(lists, cs)
	}
	var materialIDs, unitIDs []string
	for _, cs := range lists {
		for _, c := range cs {
			materialIDs = append(materialIDs, c.RawMaterialID)
			unitIDs = append(unitIDs, c.SatuanID)
		}
	}
	factors, err := s.ports.Catalog.RecipeFactors(ctx, q, materialIDs, unitIDs)
	if err != nil {
		return err
	}
	names, err := s.ports.Catalog.UnitNames(ctx, q, unique(unitIDs))
	if err != nil {
		return err
	}
	i := 0
	for _, cs := range lists {
		for k := range cs {
			cs[k].Factor, cs[k].RecipeUnit = factors[i], names[cs[k].SatuanID]
			i++
		}
	}
	return nil
}

func componentIDs(cs []domain.Component) []string {
	ids := make([]string, len(cs))
	for i, c := range cs {
		ids[i] = c.RawMaterialID
	}
	return unique(ids)
}

func unique(ids []string) []string {
	seen := map[string]bool{}
	out := ids[:0:0]
	for _, id := range ids {
		if id != "" && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

/* ── flow ────────────────────────────────────────────────────────────── */

// Flow is the step view of an order.
func (s *Service) Flow(ctx context.Context, scope *ps.Scope, id string) (*FlowView, error) {
	o, err := s.order(ctx, s.db, scope, id, false)
	if err != nil {
		return nil, err
	}
	return s.flow(ctx, s.db, o)
}

func (s *Service) flow(ctx context.Context, q database.Querier, o *Order) (*FlowView, error) {
	lines, err := s.repo.Lines(ctx, q, o.ID)
	if err != nil {
		return nil, err
	}
	issues, err := s.repo.Issues(ctx, q, o.ID)
	if err != nil {
		return nil, err
	}
	batches, err := s.repo.Batches(ctx, q, o.ID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(lines))
	for i, l := range lines {
		ids[i] = l.RawMaterialID
	}
	materials, err := s.ports.Catalog.Materials(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	var unitIDs []string
	for _, l := range lines {
		if l.RecipeUnitID != nil {
			unitIDs = append(unitIDs, *l.RecipeUnitID)
		}
	}
	units, err := s.ports.Catalog.UnitNames(ctx, q, unique(unitIDs))
	if err != nil {
		return nil, err
	}
	var skus []Sku
	if o.Context == "product" && o.OutputType == "FINISHED_GOOD" && o.ProductID != nil {
		if _, skus, err = s.ports.Pos.Variants(ctx, q, *o.ProductID); err != nil {
			return nil, err
		}
	}
	tolerance, err := s.tolerance(ctx, q, o)
	if err != nil {
		return nil, err
	}
	return buildFlow(o, lines, issues, batches, materials, units, skus, tolerance), nil
}

// owner is the recipe an order makes.
func (o *Order) owner() RecipeOwner {
	if o.Context == "raw_material" {
		return RecipeOwner{RawMaterialID: o.OutputRawMaterialID}
	}
	return RecipeOwner{ProductID: o.ProductID}
}

// tolerance is the scrap tolerance of the order's recipe, else the default.
func (s *Service) tolerance(ctx context.Context, q database.Querier, o *Order) (float64, error) {
	settings, err := s.repo.RecipeSettings(ctx, q, o.owner())
	if err != nil || settings == nil || settings.ScrapTolerancePct == nil {
		return domain.DefaultScrapTolerancePct, err
	}
	return *settings.ScrapTolerancePct, nil
}

/* ── issue ───────────────────────────────────────────────────────────── */

// IssueLineInput is one requested material: an order line and a quantity.
type IssueLineInput struct {
	MaterialLineID string
	Qty            float64
	WarehouseID    *string
}

// IssueInput is POST /api/production/orders/{id}/issues.
type IssueInput struct {
	Lines   []IssueLineInput
	Catatan *string
}

// IssueResult is the issue written and the order's flow after it.
type IssueResult struct {
	Issue   IssueView `json:"issue"`
	Flow    *FlowView `json:"flow"`
	Message string    `json:"-"`
}

// shortage is one material the stock does not cover.
type shortage struct {
	RawMaterialID string  `json:"raw_material_id"`
	Kode          string  `json:"kode"`
	Nama          string  `json:"nama"`
	RequiredQty   float64 `json:"required_qty"`
	QtyOnHand     float64 `json:"qty_onhand"`
	ShortageQty   float64 `json:"shortage_qty"`
}

// Issue takes materials out of stock into the order's WIP.
func (s *Service) Issue(ctx context.Context, scope *ps.Scope, orderID, userID string, in IssueInput) (*IssueResult, error) {
	var res *IssueResult
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		o, err := s.order(ctx, tx, scope, orderID, true)
		if err != nil {
			return err
		}
		if err := domain.CheckIssue(o.Status); err != nil {
			return rule(err)
		}
		lines, err := s.repo.Lines(ctx, tx, o.ID)
		if err != nil {
			return err
		}
		byID := map[string]MaterialLine{}
		for _, l := range lines {
			byID[l.ID] = l
		}
		seen := map[string]bool{}
		var ids []string
		for _, l := range in.Lines {
			line, ok := byID[l.MaterialLineID]
			switch {
			case !ok:
				return httpx.BadRequest("Bahan tidak ada di order ini")
			case seen[l.MaterialLineID]:
				return httpx.BadRequest("Bahan yang sama muncul dua kali")
			}
			seen[l.MaterialLineID] = true
			ids = append(ids, line.RawMaterialID)
		}
		materials, err := s.ports.Catalog.Materials(ctx, tx, ids)
		if err != nil {
			return err
		}
		var short []shortage
		for _, l := range in.Lines {
			m := materials[byID[l.MaterialLineID].RawMaterialID]
			if m.QtyOnHand < l.Qty {
				short = append(short, shortage{m.ID, m.Kode, m.Nama, l.Qty, m.QtyOnHand, domain.RoundQty(l.Qty - m.QtyOnHand)})
			}
		}
		if len(short) > 0 {
			return httpx.BadRequest("Stok bahan belum cukup untuk dikeluarkan", map[string]any{"shortages": short})
		}
		existing, err := s.repo.Issues(ctx, tx, o.ID)
		if err != nil {
			return err
		}
		issue, err := s.repo.InsertIssue(ctx, tx, o.ID, domain.IssueNumber(o.Number, len(existing)+1), in.Catatan, userID)
		if err != nil {
			return err
		}
		total := 0.0
		for _, l := range in.Lines {
			line := byID[l.MaterialLineID]
			m := materials[line.RawMaterialID]
			got, err := s.ports.Stock.Issue(ctx, tx, StockIssue{RawMaterialID: line.RawMaterialID, Qty: l.Qty, WarehouseID: l.WarehouseID,
				BranchID: o.BranchID, IssueID: issue.ID, IssueNumber: issue.Number, UserID: userID})
			var se *ShortageError
			switch {
			case errors.As(err, &se):
				return httpx.BadRequest("Stok " + label(m) + " di satu gudang tidak cukup. Sisa " + pdfgen.Thousands(se.Available) +
					", butuh " + pdfgen.Thousands(l.Qty) + ". Pilih gudang lain atau pindahkan stok dulu.")
			case errors.Is(err, ErrNoStock):
				return httpx.BadRequest("Stok " + label(m) + " tidak ditemukan di gudang yang dipilih")
			case err != nil:
				return err
			}
			unit := got.UnitCost
			if unit == 0 {
				unit = line.UnitCost
			}
			il := IssueLine{MaterialLineID: line.ID, RawMaterialID: line.RawMaterialID, Qty: l.Qty, UnitCost: round2(unit),
				TotalCost: round2(float64(l.Qty * unit)), MovementID: &got.MovementID, WarehouseID: got.WarehouseID}
			if err := s.repo.InsertIssueLine(ctx, tx, issue.ID, il); err != nil {
				return err
			}
			issue.Lines = append(issue.Lines, il)
			total += il.TotalCost
		}
		issue.TotalCost = round2(total)
		if err := s.repo.SetIssueTotal(ctx, tx, issue.ID, issue.TotalCost); err != nil {
			return err
		}
		if err := s.repo.MarkIssued(ctx, tx, o.ID, userID, o.Status == domain.StatusReleased, s.now()); err != nil {
			return err
		}
		if err := outbox.Publish(ctx, tx, contracts.TopicMaterialsIssued, issue.ID, contracts.MaterialsIssued{
			IssueID: issue.ID, IssueNumber: issue.Number, OrderID: o.ID, OrderNumber: o.Number, CompanyID: o.CompanyID,
			UserID: userID, EntryDate: s.entryDate(), Total: issue.TotalCost,
		}); err != nil {
			return err
		}
		if o, err = s.repo.Order(ctx, tx, o.ID, false); err != nil {
			return err
		}
		flow, err := s.flow(ctx, tx, o)
		if err != nil {
			return err
		}
		res = &IssueResult{Issue: issueView(issue, materials), Flow: flow,
			Message: "Bahan dikeluarkan ke produksi (" + issue.Number + "), nilai " + pdfgen.Rupiah(issue.TotalCost)}
		return nil
	})
	return res, err
}

func label(m Material) string {
	if m.Kode == "" {
		return m.Nama
	}
	return m.Kode + " " + m.Nama
}

/* ── receipt ─────────────────────────────────────────────────────────── */

// ReceiptInput is POST /api/production/orders/{id}/receipts. The conversion
// costs replace the order's on the final receipt only.
type ReceiptInput struct {
	QtyGood, QtyScrap                 float64
	Final                             bool
	Catatan                           *string
	Variants                          []domain.Variant
	Overhead, Labor, Packaging, Waste *float64
}

// ReceiptResult is the batch written and the order's flow after it.
type ReceiptResult struct {
	Batch   BatchView `json:"batch"`
	Flow    *FlowView `json:"flow"`
	PosSync *PosSync  `json:"pos_sync"`
	Message string    `json:"-"`
}

// PosSync reports the HPP sync after the final receipt.
type PosSync struct {
	HppPerUnit       float64  `json:"hpp_per_unit"`
	MarginPercentage *float64 `json:"margin_percentage"`
}

// Receive costs a batch, puts its good units into stock and completes the
// order on the final receipt. The POS HPP sync runs after commit.
func (s *Service) Receive(ctx context.Context, scope *ps.Scope, orderID, userID string, in ReceiptInput) (*ReceiptResult, error) {
	var res *ReceiptResult
	var syncProduct string
	var syncHpp float64
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		o, err := s.order(ctx, tx, scope, orderID, true)
		if err != nil {
			return err
		}
		issues, err := s.repo.Issues(ctx, tx, o.ID)
		if err != nil {
			return err
		}
		if err := domain.CheckReceipt(o.Status, len(issues), in.QtyGood, in.QtyScrap); err != nil {
			return rule(err)
		}
		lines, err := s.repo.Lines(ctx, tx, o.ID)
		if err != nil {
			return err
		}
		batches, err := s.repo.Batches(ctx, tx, o.ID)
		if err != nil {
			return err
		}
		if in.Final {
			for _, c := range []struct {
				src *float64
				dst *float64
			}{{in.Overhead, &o.Overhead}, {in.Labor, &o.Labor}, {in.Packaging, &o.Packaging}, {in.Waste, &o.Waste}} {
				if c.src != nil {
					*c.dst = *c.src
				}
			}
		}
		dl := make([]domain.Line, len(lines))
		issued := 0.0
		for i, l := range lines {
			dl[i] = l.domain()
			issued += l.IssuedCost
		}
		tolerance, err := s.tolerance(ctx, tx, o)
		if err != nil {
			return err
		}
		cin := domain.ReceiptInput{PlannedQty: o.PlannedQty, StdMaterialPerUnit: domain.StdMaterialPerUnit(dl, o.PlannedQty),
			IssuedCost: issued, Conversion: o.Conversion(), QtyGood: in.QtyGood, QtyScrap: in.QtyScrap, Final: in.Final}
		good := in.QtyGood
		total, earlierScrap := 0.0, 0.0
		for _, b := range batches {
			cin.ReceivedMaterialCost += b.MaterialCost
			cin.ScrapCost += b.WrittenOff()
			cin.AppliedConversion += b.Applied()
			good += b.QtyGood
			total += b.TotalCost
			earlierScrap += b.QtyScrap
		}
		_, cin.QtyAbnormal = domain.SplitScrap(earlierScrap, in.QtyScrap, domain.ScrapAllowance(o.PlannedQty, tolerance))
		cost := domain.CostReceipt(cin)

		finishedGood := o.Context == "product" && o.OutputType == "FINISHED_GOOD" && o.ProductID != nil
		var posProduct string
		var variants []domain.Variant
		if finishedGood && in.QtyGood > 0 {
			pid, skus, err := s.ports.Pos.Variants(ctx, tx, *o.ProductID)
			if err != nil {
				return err
			}
			if len(skus) > 0 {
				active := make([]string, len(skus))
				for i, k := range skus {
					active[i] = k.ID
				}
				if variants, err = domain.CheckVariants(in.QtyGood, in.Variants, active); err != nil {
					return httpx.BadRequest(err.Error(), map[string]any{"available_skus": skus})
				}
				posProduct = pid
			}
		}

		b := Batch{Number: domain.BatchNumber(o.Number, len(batches)+1), OutputType: o.OutputType, QtyGood: in.QtyGood,
			QtyScrap: in.QtyScrap, QtyAbnormal: cin.QtyAbnormal, HppPerUnit: cost.HppPerUnit, TotalCost: cost.Total,
			MaterialCost: cost.Material, ConversionCost: cost.Conversion, ScrapCost: cost.Scrap,
			AbnormalMaterial: cost.AbnormalMaterial, AbnormalConversion: cost.AbnormalConversion, ScrapTolerancePct: &tolerance,
			IsFinal: in.Final, Catatan: in.Catatan}
		if o.Context == "raw_material" {
			b.OutputType = "FINISHED_GOOD"
		}
		if o.Context == "product" && o.OutputType == "WIP" && o.ProductID != nil {
			wip, err := s.ports.Stock.WipMaterial(ctx, tx, *o.ProductID, userID)
			if err != nil {
				return err
			}
			b.WipRawMaterialID = &wip
		}
		if b, err = s.repo.InsertBatch(ctx, tx, o, b, userID); err != nil {
			return err
		}
		if in.QtyGood > 0 {
			if err := s.stockIn(ctx, tx, o, b, userID, posProduct, variants); err != nil {
				return err
			}
		}
		total += cost.Total
		hpp := o.HppPerUnit
		if good > 0 {
			hpp = round2(total / good)
		}
		if err := s.repo.SaveOutcome(ctx, tx, o.ID, Outcome{ActualQty: good, HppPerUnit: hpp, Overhead: o.Overhead, Labor: o.Labor,
			Packaging: o.Packaging, Waste: o.Waste, Complete: in.Final, UserID: userID, Now: s.now()}); err != nil {
			return err
		}
		if err := outbox.Publish(ctx, tx, contracts.TopicOutputReceived, b.ID, contracts.OutputReceived{
			BatchID: b.ID, BatchNumber: b.Number, OrderID: o.ID, OrderNumber: o.Number, CompanyID: o.CompanyID, UserID: userID,
			EntryDate: s.entryDate(), MaterialCost: b.MaterialCost, ConversionCost: b.ConversionCost, ScrapCost: b.ScrapCost,
			AbnormalScrapCost: b.AbnormalCost(), AbnormalConversionCost: b.AbnormalConversion,
		}); err != nil {
			return err
		}
		if in.Final && finishedGood && good > 0 {
			syncProduct, syncHpp = *o.ProductID, hpp
		}
		if o, err = s.repo.Order(ctx, tx, o.ID, false); err != nil {
			return err
		}
		flow, err := s.flow(ctx, tx, o)
		if err != nil {
			return err
		}
		res = &ReceiptResult{Batch: batchView(b, o.PlannedQty), Flow: flow, Message: receiptMessage(b, o)}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if syncProduct != "" {
		margin, err := s.ports.Pos.SyncHpp(ctx, s.db, syncProduct, syncHpp)
		if err != nil {
			// Stock and batch are committed; the next completion syncs again.
			s.log.WarnContext(ctx, "production: POS HPP sync failed", "product_id", syncProduct, "error", err)
		} else {
			res.PosSync = &PosSync{HppPerUnit: syncHpp, MarginPercentage: margin}
			if margin != nil {
				res.Message += ". Margin POS " + pdfgen.Thousands(*margin) + "%"
			}
		}
	}
	return res, nil
}

// stockIn puts a batch's good units into stock: the output raw material,
// the product's WIP material, or finished goods with the variant split.
func (s *Service) stockIn(ctx context.Context, tx pgx.Tx, o *Order, b Batch, userID, posProduct string, variants []domain.Variant) error {
	switch {
	case o.Context == "raw_material" && o.OutputRawMaterialID != nil:
		return s.ports.Stock.ReceiveMaterial(ctx, tx, MaterialReceipt{RawMaterialID: *o.OutputRawMaterialID, Qty: b.QtyGood,
			UnitCost: b.HppPerUnit, BatchID: b.ID, BatchNumber: b.Number, UserID: userID})
	case b.WipRawMaterialID != nil:
		return s.ports.Stock.ReceiveMaterial(ctx, tx, MaterialReceipt{RawMaterialID: *b.WipRawMaterialID, Qty: b.QtyGood,
			UnitCost: b.HppPerUnit, BatchID: b.ID, BatchNumber: b.Number, UserID: userID})
	case o.ProductID != nil:
		var posted []PostedVariant
		if len(variants) > 0 {
			if err := s.repo.InsertVariants(ctx, tx, o.ID, b.ID, userID, variants); err != nil {
				return err
			}
			for _, v := range variants {
				after, ok, err := s.ports.Pos.AddSkuStock(ctx, tx, v.SkuID, posProduct, v.Qty)
				if err != nil {
					return err
				}
				if !ok {
					return httpx.BadRequest("SKU " + v.SkuID + " tidak ditemukan untuk produk ini")
				}
				posted = append(posted, PostedVariant{SkuID: v.SkuID, Before: after - v.Qty, After: after})
			}
		}
		return s.ports.Stock.ReceiveGoods(ctx, tx, GoodsReceipt{ProductID: *o.ProductID, Qty: b.QtyGood, UnitCost: b.HppPerUnit,
			TotalCost: b.TotalCost, OrderID: o.ID, BatchNumber: b.Number, UserID: userID, Variants: posted})
	}
	return nil
}

func receiptMessage(b Batch, o *Order) string {
	msg := "Batch " + b.Number + " diterima: " + pdfgen.Thousands(b.QtyGood) + " baik"
	if b.QtyScrap > 0 {
		msg += ", " + pdfgen.Thousands(b.QtyScrap) + " scrap"
	}
	if b.QtyAbnormal > 0 {
		msg += " (" + pdfgen.Thousands(b.QtyAbnormal) + " di atas toleransi, " + pdfgen.Rupiah(b.AbnormalCost()) + " dibebankan sebagai kerugian)"
	}
	if b.QtyGood > 0 {
		msg += ", HPP " + pdfgen.Rupiah(b.HppPerUnit)
	}
	if b.ScrapCost > 0 {
		msg += ", sisa WIP " + pdfgen.Rupiah(b.ScrapCost) + " dibebankan sebagai scrap"
	}
	if b.IsFinal {
		msg += ". Produksi " + o.Number + " selesai, HPP rata-rata " + pdfgen.Rupiah(o.HppPerUnit)
	}
	return msg
}

/* ── lists ───────────────────────────────────────────────────────────── */

// scoped narrows f to the user's business scope.
func scoped(scope *ps.Scope, f ListFilter) ListFilter {
	f.CompanyID, f.BranchID = ps.CompanyFilter(scope), ps.BranchFilter(scope)
	return f
}

// Wip lists open orders with materials in production.
func (s *Service) Wip(ctx context.Context, scope *ps.Scope, f ListFilter) (*WipView, error) {
	rows, err := s.repo.WipOrders(ctx, s.db, scoped(scope, f))
	if err != nil {
		return nil, err
	}
	return wipView(rows), nil
}

// Batches lists batches with cost and yield, newest first.
func (s *Service) Batches(ctx context.Context, scope *ps.Scope, f ListFilter) ([]BatchListView, error) {
	f.Limit = int(math.Max(1, math.Min(float64(f.Limit), 200)))
	rows, err := s.repo.ListBatches(ctx, s.db, scoped(scope, f))
	if err != nil {
		return nil, err
	}
	out := make([]BatchListView, len(rows))
	for i, r := range rows {
		out[i] = batchListView(r)
	}
	return out, nil
}

// Batch is one batch with its material cost split over the order's
// materials by issued value.
func (s *Service) Batch(ctx context.Context, scope *ps.Scope, id string) (*BatchDetailView, error) {
	b, err := s.repo.Batch(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if b == nil || !ps.OperationalRowInScope(scope, b.CompanyID, b.BranchID) {
		return nil, httpx.NotFound("Batch produksi tidak ditemukan")
	}
	lines, err := s.repo.Lines(ctx, s.db, b.OrderID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(lines))
	for i, l := range lines {
		ids[i] = l.RawMaterialID
	}
	materials, err := s.ports.Catalog.Materials(ctx, s.db, ids)
	if err != nil {
		return nil, err
	}
	variants, err := s.repo.Variants(ctx, s.db, b.ID)
	if err != nil {
		return nil, err
	}
	var skus []Sku
	if len(variants) > 0 && b.ProductID != nil {
		if _, skus, err = s.ports.Pos.Variants(ctx, s.db, *b.ProductID); err != nil {
			return nil, err
		}
	}
	return batchDetailView(*b, lines, materials, variants, skus), nil
}
