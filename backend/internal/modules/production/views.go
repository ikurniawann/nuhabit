package production

import (
	"math"

	"nuhabit/backend/internal/modules/production/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// Response shapes. Money is rupiah with 2 decimals, quantities are numbers
// (not numeric strings: these routes are new and have no TS twin).

// ItemView is the item an explosion makes.
type ItemView struct {
	ID     string `json:"id"`
	Kode   string `json:"kode"`
	Nama   string `json:"nama"`
	Satuan string `json:"satuan"`
	Type   string `json:"type"` // product | raw_material
}

// ExplodeView is GET /api/production/bom/explode.
type ExplodeView struct {
	Item ItemView `json:"item"`
	domain.Explosion
}

// OrderView is the order header of the flow.
type OrderView struct {
	ID                  string        `json:"id"`
	NomorProduksi       string        `json:"nomor_produksi"`
	Status              string        `json:"status"`
	ProductionContext   string        `json:"production_context"`
	OutputType          string        `json:"output_type"`
	ProductID           *string       `json:"product_id"`
	OutputRawMaterialID *string       `json:"output_raw_material_id"`
	ItemKode            string        `json:"item_kode"`
	ItemNama            string        `json:"item_nama"`
	PlannedQty          float64       `json:"planned_qty"`
	ActualQty           float64       `json:"actual_qty"`
	PlannedMaterialCost float64       `json:"planned_material_cost"`
	OverheadCost        float64       `json:"overhead_cost"`
	LaborCost           float64       `json:"labor_cost"`
	PackagingCost       float64       `json:"packaging_cost"`
	WasteCost           float64       `json:"waste_cost"`
	ConversionCost      float64       `json:"conversion_cost"`
	HppPerUnit          float64       `json:"hpp_per_unit"`
	StartedAt           *httpx.JSTime `json:"started_at"`
	CompletedAt         *httpx.JSTime `json:"completed_at"`
	// The order this sub-order feeds, null for an order of its own.
	ParentOrderID       *string `json:"parent_order_id"`
	ParentNomorProduksi *string `json:"parent_nomor_produksi"`
}

// FlowMaterialView is one material line with its issue progress.
type FlowMaterialView struct {
	ID            string  `json:"id"`
	RawMaterialID string  `json:"raw_material_id"`
	Kode          string  `json:"kode"`
	Nama          string  `json:"nama"`
	Satuan        string  `json:"satuan"`
	QtyPlanned    float64 `json:"qty_planned"`
	QtyIssued     float64 `json:"qty_issued"`
	QtyReturned   float64 `json:"qty_returned"`
	QtyReturnable float64 `json:"qty_returnable"`
	QtyRemaining  float64 `json:"qty_remaining"`
	UnitCost      float64 `json:"unit_cost"`
	IssuedCost    float64 `json:"issued_cost"`
	ReturnedCost  float64 `json:"returned_cost"`
	QtyOnHand     float64 `json:"qty_onhand"`
	// The recipe line in its own unit; null on orders created before
	// recipe units were converted (their quantities are as stored).
	RecipeQty    *float64 `json:"recipe_qty"`
	RecipeSatuan *string  `json:"recipe_satuan"`
	UnitFactor   *float64 `json:"unit_factor"`
}

// IssueLineView is one issued material.
type IssueLineView struct {
	RawMaterialID string  `json:"raw_material_id"`
	Kode          string  `json:"kode"`
	Nama          string  `json:"nama"`
	Qty           float64 `json:"qty"`
	UnitCost      float64 `json:"unit_cost"`
	TotalCost     float64 `json:"total_cost"`
}

// ReturnView is one return of unused materials to stock.
type ReturnView struct {
	ID          string          `json:"id"`
	NomorReturn string          `json:"nomor_return"`
	TotalCost   float64         `json:"total_cost"`
	Catatan     *string         `json:"catatan"`
	CreatedAt   httpx.JSTime    `json:"created_at"`
	Lines       []IssueLineView `json:"lines"`
}

func returnView(r Return, materials map[string]Material) ReturnView {
	v := issueView(Issue(r), materials)
	return ReturnView{ID: v.ID, NomorReturn: v.NomorIssue, TotalCost: v.TotalCost, Catatan: v.Catatan, CreatedAt: v.CreatedAt, Lines: v.Lines}
}

// IssueView is one issue.
type IssueView struct {
	ID         string          `json:"id"`
	NomorIssue string          `json:"nomor_issue"`
	TotalCost  float64         `json:"total_cost"`
	Catatan    *string         `json:"catatan"`
	CreatedAt  httpx.JSTime    `json:"created_at"`
	Lines      []IssueLineView `json:"lines"`
}

// BatchView is one received batch.
type BatchView struct {
	ID               string  `json:"id"`
	BatchNumber      string  `json:"batch_number"`
	OutputType       string  `json:"output_type"`
	WipRawMaterialID *string `json:"wip_raw_material_id"`
	QtyGood          float64 `json:"qty_good"`
	QtyScrap         float64 `json:"qty_scrap"`
	MaterialCost     float64 `json:"material_cost"`
	ConversionCost   float64 `json:"conversion_cost"`
	ScrapCost        float64 `json:"scrap_cost"`
	TotalCost        float64 `json:"total_cost"`
	HppPerUnit       float64 `json:"hpp_per_unit"`
	// Scrap within the tolerance raises the HPP; the abnormal part is
	// costed like a good unit and expensed.
	QtyScrapNormal         float64      `json:"qty_scrap_normal"`
	QtyScrapAbnormal       float64      `json:"qty_scrap_abnormal"`
	AbnormalMaterialCost   float64      `json:"abnormal_material_cost"`
	AbnormalConversionCost float64      `json:"abnormal_conversion_cost"`
	AbnormalScrapCost      float64      `json:"abnormal_scrap_cost"`
	ScrapTolerancePct      *float64     `json:"scrap_tolerance_pct"`
	YieldPct               *float64     `json:"yield_pct"`
	PlannedYieldPct        *float64     `json:"planned_yield_pct"`
	IsFinal                bool         `json:"is_final"`
	Catatan                *string      `json:"catatan"`
	CreatedAt              httpx.JSTime `json:"created_at"`
}

// WipSummary is the WIP balance of one order. IssuedCost is gross;
// ReturnedCost went back to stock. ScrapAllowance is the
// normal scrap quantity (ScrapTolerancePct of the planned quantity).
type WipSummary struct {
	IssuedCost           float64  `json:"issued_cost"`
	ReturnedCost         float64  `json:"returned_cost"`
	ReceivedMaterialCost float64  `json:"received_material_cost"`
	ScrapCost            float64  `json:"scrap_cost"`
	AbnormalScrapCost    float64  `json:"abnormal_scrap_cost"`
	ScrapTolerancePct    float64  `json:"scrap_tolerance_pct"`
	ScrapAllowance       float64  `json:"scrap_allowance"`
	QtyScrapAbnormal     float64  `json:"qty_scrap_abnormal"`
	WipValue             float64  `json:"wip_value"`
	ConversionCost       float64  `json:"conversion_cost"`
	ConversionApplied    float64  `json:"conversion_applied"`
	StdMaterialPerUnit   float64  `json:"std_material_per_unit"`
	QtyGood              float64  `json:"qty_good"`
	QtyScrap             float64  `json:"qty_scrap"`
	QtyRemaining         float64  `json:"qty_remaining"`
	YieldPct             *float64 `json:"yield_pct"`
	PlannedYieldPct      *float64 `json:"planned_yield_pct"`
}

// FlowView is GET /api/production/orders/{id}/flow.
type FlowView struct {
	Order      OrderView          `json:"order"`
	Materials  []FlowMaterialView `json:"materials"`
	Issues     []IssueView        `json:"issues"`
	Returns    []ReturnView       `json:"returns"`
	Batches    []BatchView        `json:"batches"`
	Wip        WipSummary         `json:"wip"`
	CanIssue   bool               `json:"can_issue"`
	CanReceive bool               `json:"can_receive"`
	// CanReturn: the order runs and some issued material is not returned.
	CanReturn bool `json:"can_return"`
	// Stepped is true once materials were issued here: the order then
	// finishes with receipts only.
	Stepped     bool  `json:"stepped"`
	VariantSkus []Sku `json:"variant_skus"`
	// Intermediates are the lines made in-house with their shortage;
	// SubOrders the orders created for them.
	Intermediates      []IntermediateView `json:"intermediates"`
	SubOrders          []SubOrderView     `json:"sub_orders"`
	CanCreateSubOrders bool               `json:"can_create_sub_orders"`
}

// IntermediateView is an order line made in-house: what the order still
// needs, stock, what open sub-orders make and the shortage left, in the
// stock unit.
type IntermediateView struct {
	MaterialLineID string  `json:"material_id"`
	RawMaterialID  string  `json:"raw_material_id"`
	Kode           string  `json:"kode"`
	Nama           string  `json:"nama"`
	Satuan         string  `json:"satuan"`
	QtyNeeded      float64 `json:"qty_needed"`
	QtyOnHand      float64 `json:"qty_onhand"`
	QtyOnSubOrders float64 `json:"qty_on_sub_orders"`
	ShortageQty    float64 `json:"shortage_qty"`
}

// SubOrderView is a sub-order of the order.
type SubOrderView struct {
	ID                string       `json:"id"`
	NomorProduksi     string       `json:"nomor_produksi"`
	Status            string       `json:"status"`
	ProductionContext string       `json:"production_context"`
	OutputType        string       `json:"output_type"`
	ItemKode          string       `json:"item_kode"`
	ItemNama          string       `json:"item_nama"`
	PlannedQty        float64      `json:"planned_qty"`
	CreatedAt         httpx.JSTime `json:"created_at"`
}

func intermediateViews(its []intermediate) []IntermediateView {
	out := make([]IntermediateView, len(its))
	for i, it := range its {
		out[i] = IntermediateView{MaterialLineID: it.line.ID, RawMaterialID: it.line.RawMaterialID, Kode: it.material.Kode,
			Nama: it.material.Nama, Satuan: it.material.Unit, QtyNeeded: it.needed, QtyOnHand: it.material.QtyOnHand,
			QtyOnSubOrders: it.covered, ShortageQty: it.shortage}
	}
	return out
}

func subOrderViews(children []ChildOrder) []SubOrderView {
	out := make([]SubOrderView, len(children))
	for i, c := range children {
		out[i] = SubOrderView{ID: c.ID, NomorProduksi: c.Number, Status: c.Status, ProductionContext: c.Context,
			OutputType: c.OutputType, ItemKode: c.ItemKode, ItemNama: c.ItemNama, PlannedQty: c.PlannedQty,
			CreatedAt: httpx.JSTime(c.CreatedAt)}
	}
	return out
}

func orderView(o *Order) OrderView {
	return OrderView{
		ID: o.ID, NomorProduksi: o.Number, Status: o.Status, ProductionContext: o.Context, OutputType: o.OutputType,
		ProductID: o.ProductID, OutputRawMaterialID: o.OutputRawMaterialID, ItemKode: o.ItemKode, ItemNama: o.ItemNama,
		PlannedQty: o.PlannedQty, ActualQty: o.ActualQty, PlannedMaterialCost: o.PlannedMaterialCost,
		OverheadCost: o.Overhead, LaborCost: o.Labor, PackagingCost: o.Packaging, WasteCost: o.Waste,
		ConversionCost: round2(o.Conversion()), HppPerUnit: o.HppPerUnit,
		StartedAt: httpx.NewJSTime(o.StartedAt), CompletedAt: httpx.NewJSTime(o.CompletedAt),
		ParentOrderID: o.ParentOrderID, ParentNomorProduksi: o.ParentNumber,
	}
}

func issueView(i Issue, materials map[string]Material) IssueView {
	v := IssueView{ID: i.ID, NomorIssue: i.Number, TotalCost: i.TotalCost, Catatan: i.Catatan, CreatedAt: httpx.JSTime(i.CreatedAt),
		Lines: make([]IssueLineView, len(i.Lines))}
	for k, l := range i.Lines {
		m := materials[l.RawMaterialID]
		v.Lines[k] = IssueLineView{RawMaterialID: l.RawMaterialID, Kode: m.Kode, Nama: m.Nama, Qty: l.Qty,
			UnitCost: l.UnitCost, TotalCost: l.TotalCost}
	}
	return v
}

func batchView(b Batch, plannedQty float64) BatchView {
	return BatchView{
		ID: b.ID, BatchNumber: b.Number, OutputType: b.OutputType, WipRawMaterialID: b.WipRawMaterialID,
		QtyGood: b.QtyGood, QtyScrap: b.QtyScrap, MaterialCost: b.MaterialCost, ConversionCost: b.ConversionCost,
		ScrapCost: b.ScrapCost, TotalCost: b.TotalCost, HppPerUnit: b.HppPerUnit,
		QtyScrapNormal: domain.RoundQty(b.QtyScrap - b.QtyAbnormal), QtyScrapAbnormal: b.QtyAbnormal,
		AbnormalMaterialCost: b.AbnormalMaterial, AbnormalConversionCost: b.AbnormalConversion, AbnormalScrapCost: b.AbnormalCost(),
		ScrapTolerancePct: b.ScrapTolerancePct,
		YieldPct:          domain.Yield(b.QtyGood, b.QtyScrap), PlannedYieldPct: domain.PlannedYield(b.QtyGood, plannedQty),
		IsFinal: b.IsFinal, Catatan: b.Catatan, CreatedAt: httpx.JSTime(b.CreatedAt),
	}
}

func buildFlow(o *Order, lines []MaterialLine, issues []Issue, returns []Return, batches []Batch, materials map[string]Material, units map[string]string,
	skus []Sku, tolerancePct float64) *FlowView {
	f := &FlowView{Order: orderView(o), Materials: make([]FlowMaterialView, len(lines)), Issues: make([]IssueView, len(issues)),
		Returns: make([]ReturnView, len(returns)), Batches: make([]BatchView, len(batches)), VariantSkus: skus, Stepped: len(issues) > 0}
	if f.VariantSkus == nil {
		f.VariantSkus = []Sku{}
	}
	dl := make([]domain.Line, len(lines))
	abnormalMaterial := 0.0
	for i, l := range lines {
		m := materials[l.RawMaterialID]
		f.Materials[i] = FlowMaterialView{ID: l.ID, RawMaterialID: l.RawMaterialID, Kode: m.Kode, Nama: m.Nama, Satuan: m.Unit,
			QtyPlanned: l.QtyPlanned, QtyIssued: l.QtyIssued, QtyReturned: l.QtyReturned, QtyReturnable: l.domain().Returnable(),
			QtyRemaining: domain.RoundQty(math.Max(0, l.QtyPlanned-l.QtyIssued+l.QtyReturned)),
			UnitCost:     l.UnitCost, IssuedCost: l.IssuedCost, ReturnedCost: l.ReturnedCost, QtyOnHand: m.QtyOnHand,
			RecipeQty: l.RecipeQty, UnitFactor: l.UnitFactor}
		if l.RecipeUnitID != nil {
			name := units[*l.RecipeUnitID]
			f.Materials[i].RecipeSatuan = &name
		}
		dl[i] = l.domain()
		f.Wip.IssuedCost += l.IssuedCost
		f.Wip.ReturnedCost += l.ReturnedCost
		f.CanReturn = f.CanReturn || l.domain().Returnable() > 0
	}
	for i, is := range issues {
		f.Issues[i] = issueView(is, materials)
	}
	for i, r := range returns {
		f.Returns[i] = returnView(r, materials)
	}
	for i, b := range batches {
		f.Batches[i] = batchView(b, o.PlannedQty)
		f.Wip.ReceivedMaterialCost += b.MaterialCost
		f.Wip.ScrapCost += b.ScrapCost
		f.Wip.AbnormalScrapCost += b.AbnormalCost()
		abnormalMaterial += b.AbnormalMaterial
		f.Wip.QtyScrapAbnormal += b.QtyAbnormal
		f.Wip.ConversionApplied += b.Applied()
		f.Wip.QtyGood += b.QtyGood
		f.Wip.QtyScrap += b.QtyScrap
	}
	w := &f.Wip
	w.IssuedCost, w.ReturnedCost, w.ReceivedMaterialCost = round2(w.IssuedCost), round2(w.ReturnedCost), round2(w.ReceivedMaterialCost)
	w.ScrapCost, w.ConversionApplied = round2(w.ScrapCost), round2(w.ConversionApplied)
	w.AbnormalScrapCost, w.QtyScrapAbnormal = round2(w.AbnormalScrapCost), domain.RoundQty(w.QtyScrapAbnormal)
	w.WipValue = domain.WipBalance(w.IssuedCost-w.ReturnedCost, w.ReceivedMaterialCost, w.ScrapCost+abnormalMaterial)
	w.ScrapTolerancePct, w.ScrapAllowance = tolerancePct, domain.ScrapAllowance(o.PlannedQty, tolerancePct)
	w.ConversionCost = round2(o.Conversion())
	w.StdMaterialPerUnit = round2(domain.StdMaterialPerUnit(dl, o.PlannedQty))
	w.QtyRemaining = domain.RoundQty(math.Max(0, o.PlannedQty-w.QtyGood-w.QtyScrap))
	w.YieldPct = domain.Yield(w.QtyGood, w.QtyScrap)
	w.PlannedYieldPct = domain.PlannedYield(w.QtyGood, o.PlannedQty)
	f.CanIssue = domain.CheckIssue(o.Status) == nil
	f.CanReceive = o.Status == domain.StatusInProgress && len(issues) > 0
	f.CanReturn = f.CanReturn && domain.CheckReturn(o.Status) == nil
	return f
}

/* ── WIP list ────────────────────────────────────────────────────────── */

// WipOrderView is one open order with WIP.
type WipOrderView struct {
	ID                   string        `json:"id"`
	NomorProduksi        string        `json:"nomor_produksi"`
	Status               string        `json:"status"`
	ProductionContext    string        `json:"production_context"`
	OutputType           string        `json:"output_type"`
	ItemKode             string        `json:"item_kode"`
	ItemNama             string        `json:"item_nama"`
	PlannedQty           float64       `json:"planned_qty"`
	StartedAt            *httpx.JSTime `json:"started_at"`
	IssuedCost           float64       `json:"issued_cost"`
	ReturnedCost         float64       `json:"returned_cost"`
	ReceivedMaterialCost float64       `json:"received_material_cost"`
	ScrapCost            float64       `json:"scrap_cost"`
	WipValue             float64       `json:"wip_value"`
	ConversionCost       float64       `json:"conversion_cost"`
	ConversionApplied    float64       `json:"conversion_applied"`
	QtyGood              float64       `json:"qty_good"`
	QtyScrap             float64       `json:"qty_scrap"`
	Batches              int           `json:"batches"`
	YieldPct             *float64      `json:"yield_pct"`
	LastIssueAt          httpx.JSTime  `json:"last_issue_at"`
	LastReceiptAt        *httpx.JSTime `json:"last_receipt_at"`
}

// WipTotals sums the WIP list.
type WipTotals struct {
	Orders   int     `json:"orders"`
	WipValue float64 `json:"wip_value"`
	Issued   float64 `json:"issued_cost"`
}

// WipView is GET /api/production/wip.
type WipView struct {
	Orders  []WipOrderView `json:"orders"`
	Summary WipTotals      `json:"summary"`
}

func wipView(rows []WipRow) *WipView {
	v := &WipView{Orders: make([]WipOrderView, len(rows))}
	for i, r := range rows {
		wip := domain.WipBalance(r.IssuedCost-r.ReturnedCost, r.ReceivedMaterialCost, r.ScrapCost+r.AbnormalMaterialCost)
		v.Orders[i] = WipOrderView{
			ID: r.ID, NomorProduksi: r.Number, Status: r.Status, ProductionContext: r.Context, OutputType: r.OutputType,
			ItemKode: r.ItemKode, ItemNama: r.ItemNama, PlannedQty: r.PlannedQty, StartedAt: httpx.NewJSTime(r.StartedAt),
			IssuedCost: round2(r.IssuedCost), ReturnedCost: round2(r.ReturnedCost), ReceivedMaterialCost: round2(r.ReceivedMaterialCost),
			ScrapCost: round2(r.ScrapCost),
			WipValue:  wip, ConversionCost: round2(r.ConversionCost), ConversionApplied: round2(r.ConversionApplied),
			QtyGood: r.QtyGood, QtyScrap: r.QtyScrap, Batches: r.Batches, YieldPct: domain.Yield(r.QtyGood, r.QtyScrap),
			LastIssueAt: httpx.JSTime(r.LastIssueAt), LastReceiptAt: httpx.NewJSTime(r.LastReceiptAt),
		}
		v.Summary.Orders++
		v.Summary.WipValue += wip
		v.Summary.Issued += r.IssuedCost
	}
	v.Summary.WipValue, v.Summary.Issued = round2(v.Summary.WipValue), round2(v.Summary.Issued)
	return v
}

/* ── batches ─────────────────────────────────────────────────────────── */

// BatchListView is one row of GET /api/production/batches.
type BatchListView struct {
	BatchView
	ProductionOrderID string `json:"production_order_id"`
	NomorProduksi     string `json:"nomor_produksi"`
	ProductionContext string `json:"production_context"`
	OrderStatus       string `json:"order_status"`
	ItemKode          string `json:"item_kode"`
	ItemNama          string `json:"item_nama"`
	// Stepped is false for a batch of the one-shot completion, whose cost
	// is not split.
	Stepped bool `json:"stepped"`
}

func batchListView(r BatchRow) BatchListView {
	return BatchListView{BatchView: batchView(r.Batch, r.PlannedQty), ProductionOrderID: r.OrderID, NomorProduksi: r.OrderNumber,
		ProductionContext: r.Context, OrderStatus: r.OrderStatus, ItemKode: r.ItemKode, ItemNama: r.ItemNama,
		Stepped: r.MaterialCost+r.ConversionCost+r.ScrapCost+r.AbnormalCost() > 0 || r.TotalCost == 0}
}

// BatchMaterialView is a material's share of a batch's material cost.
type BatchMaterialView struct {
	RawMaterialID string  `json:"raw_material_id"`
	Kode          string  `json:"kode"`
	Nama          string  `json:"nama"`
	Satuan        string  `json:"satuan"`
	IssuedQty     float64 `json:"issued_qty"`
	IssuedCost    float64 `json:"issued_cost"`
	ShareCost     float64 `json:"share_cost"`
	SharePct      float64 `json:"share_pct"`
}

// BatchVariantView is a SKU's share of a finished goods batch.
type BatchVariantView struct {
	PosSkuID string  `json:"pos_sku_id"`
	Sku      string  `json:"sku"`
	Name     string  `json:"name"`
	Qty      float64 `json:"qty"`
}

// BatchDetailView is GET /api/production/batches/{id}.
type BatchDetailView struct {
	BatchListView
	PlannedQty float64             `json:"planned_qty"`
	Materials  []BatchMaterialView `json:"materials"`
	Variants   []BatchVariantView  `json:"variants"`
}

func batchDetailView(b BatchRow, lines []MaterialLine, materials map[string]Material, variants []domain.Variant, skus []Sku) *BatchDetailView {
	v := &BatchDetailView{BatchListView: batchListView(b), PlannedQty: b.PlannedQty,
		Materials: make([]BatchMaterialView, len(lines)), Variants: make([]BatchVariantView, len(variants))}
	weights := make([]float64, len(lines))
	total := 0.0
	for i, l := range lines {
		weights[i] = l.IssuedCost - l.ReturnedCost
		total += weights[i]
	}
	// The material cost of the batch, plus what it wrote off, follows the
	// issued value of each material.
	shares := domain.Allocate(b.MaterialCost+b.WrittenOff(), weights)
	for i, l := range lines {
		m := materials[l.RawMaterialID]
		pct := 0.0
		if total > 0 {
			pct = round2(weights[i] / total * 100)
		}
		v.Materials[i] = BatchMaterialView{RawMaterialID: l.RawMaterialID, Kode: m.Kode, Nama: m.Nama, Satuan: m.Unit,
			IssuedQty: domain.RoundQty(l.QtyIssued - l.QtyReturned), IssuedCost: round2(weights[i]), ShareCost: shares[i], SharePct: pct}
	}
	labels := map[string]Sku{}
	for _, s := range skus {
		labels[s.ID] = s
	}
	for i, x := range variants {
		v.Variants[i] = BatchVariantView{PosSkuID: x.SkuID, Sku: labels[x.SkuID].Sku, Name: labels[x.SkuID].Name, Qty: x.Qty}
	}
	return v
}
