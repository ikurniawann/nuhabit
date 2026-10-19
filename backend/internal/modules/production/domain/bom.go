// Package domain holds the production rules: multi-level BOM explosion,
// order step guards, batch costing, yield and document numbers. Pure Go,
// no database or HTTP.
package domain

import (
	"fmt"
	"math"
	"sort"

	"nuhabit/backend/internal/platform/jsmath"
)

// MaxDepth is how many recipe levels an explosion follows below the root.
const MaxDepth = 8

// Component is one line of a recipe: QtyPer of a raw material per unit of
// the parent in the recipe unit, plus WasteFactor (0.1 = 10% extra).
// Factor converts the recipe unit into the material's stock unit (0 = 1);
// RecipeUnit names the recipe unit.
type Component struct {
	RawMaterialID string
	QtyPer        float64
	WasteFactor   float64
	SatuanID      string
	RecipeUnit    string
	Factor        float64
}

// UnitFactor is Factor, 1 when unset.
func (c Component) UnitFactor() float64 {
	if c.Factor > 0 {
		return c.Factor
	}
	return 1
}

// StockQtyPer is QtyPer in the stock unit.
func (c Component) StockQtyPer() float64 { return c.QtyPer * c.UnitFactor() }

// Gross is the stock quantity of a component needed for parentQty units.
func (c Component) Gross(parentQty float64) float64 {
	return RoundQty(float64(parentQty*c.StockQtyPer()) * (1 + c.WasteFactor))
}

// Material is what the explosion knows about a raw material.
type Material struct {
	ID        string
	Kode      string
	Nama      string
	Unit      string
	QtyOnHand float64
	AvgCost   float64
}

// Recipes answers the components of a raw material that is made in-house
// (its own recipe, or the recipe of the product it mirrors as WIP). A
// bought material has none.
type Recipes map[string][]Component

// Node is one exploded line. Quantities are in the stock unit (Unit):
// QtyRequired is gross for the requested quantity, QtyPer per parent unit.
// RecipeQtyPer and RecipeUnit are the recipe line as written, UnitFactor
// the conversion between them. RolledUnitCost is the cost of making one
// unit from its children and is nil for a bought material.
type Node struct {
	RawMaterialID  string   `json:"raw_material_id"`
	Kode           string   `json:"kode"`
	Nama           string   `json:"nama"`
	Unit           string   `json:"satuan"`
	Level          int      `json:"level"`
	QtyPer         float64  `json:"qty_per_parent"`
	RecipeQtyPer   float64  `json:"recipe_qty_per"`
	RecipeUnit     string   `json:"recipe_satuan"`
	UnitFactor     float64  `json:"unit_factor"`
	WasteFactor    float64  `json:"waste_factor"`
	QtyRequired    float64  `json:"qty_required"`
	QtyOnHand      float64  `json:"qty_onhand"`
	ShortageQty    float64  `json:"shortage_qty"`
	UnitCost       float64  `json:"unit_cost"`
	TotalCost      float64  `json:"total_cost"`
	RolledUnitCost *float64 `json:"rolled_unit_cost"`
	HasRecipe      bool     `json:"has_recipe"`
	Children       []Node   `json:"children"`
}

// Leaf is a bought material to cover the whole tree when every
// intermediate is made in-house, net of intermediates already in stock.
type Leaf struct {
	RawMaterialID string  `json:"raw_material_id"`
	Kode          string  `json:"kode"`
	Nama          string  `json:"nama"`
	Unit          string  `json:"satuan"`
	QtyRequired   float64 `json:"qty_required"`
	QtyOnHand     float64 `json:"qty_onhand"`
	ShortageQty   float64 `json:"shortage_qty"`
	UnitCost      float64 `json:"unit_cost"`
	TotalCost     float64 `json:"total_cost"`
}

// Explosion is the result for Qty units of the root recipe.
type Explosion struct {
	Qty    float64 `json:"qty"`
	Lines  []Node  `json:"lines"`
	Leaves []Leaf  `json:"leaves"`
	// StockCost values every first-level line at its stock average cost;
	// RolledCost values intermediates at the cost of making them.
	StockCost  float64 `json:"stock_cost"`
	RolledCost float64 `json:"rolled_cost"`
	Depth      int     `json:"depth"`
}

// CycleError names the material that uses itself through its recipe.
type CycleError struct{ Kode, Nama string }

func (e *CycleError) Error() string {
	return fmt.Sprintf("Resep berputar: %s memakai dirinya sendiri lewat komponennya", label(e.Kode, e.Nama))
}

// DepthError reports a recipe deeper than MaxDepth.
type DepthError struct{ Kode, Nama string }

func (e *DepthError) Error() string {
	return fmt.Sprintf("Resep lebih dari %d tingkat di bawah %s", MaxDepth, label(e.Kode, e.Nama))
}

func label(kode, nama string) string {
	if kode == "" {
		return nama
	}
	return kode + " " + nama
}

// Explode walks root (the components of the item to make) for qty units.
func Explode(root []Component, qty float64, recipes Recipes, materials map[string]Material) (Explosion, error) {
	x := explosion{recipes: recipes, materials: materials, onPath: map[string]bool{}}
	out := Explosion{Qty: qty, Lines: []Node{}}
	for _, c := range root {
		n, err := x.node(c, qty, 1)
		if err != nil {
			return Explosion{}, err
		}
		out.Lines = append(out.Lines, n)
		out.StockCost += n.TotalCost
		out.RolledCost += float64(n.QtyRequired * n.effectiveUnitCost())
	}
	out.StockCost = jsmath.RoundTo(out.StockCost, 2)
	out.RolledCost = jsmath.RoundTo(out.RolledCost, 2)
	out.Depth = x.depth
	out.Leaves = netLeaves(root, qty, recipes, materials)
	return out, nil
}

type explosion struct {
	recipes   Recipes
	materials map[string]Material
	onPath    map[string]bool
	depth     int
}

func (n Node) effectiveUnitCost() float64 {
	if n.RolledUnitCost != nil {
		return *n.RolledUnitCost
	}
	return n.UnitCost
}

func (x *explosion) node(c Component, parentQty float64, level int) (Node, error) {
	m := x.materials[c.RawMaterialID]
	if m.ID == "" {
		m.ID, m.Nama = c.RawMaterialID, c.RawMaterialID
	}
	if x.onPath[c.RawMaterialID] {
		return Node{}, &CycleError{m.Kode, m.Nama}
	}
	if level > MaxDepth {
		return Node{}, &DepthError{m.Kode, m.Nama}
	}
	if level > x.depth {
		x.depth = level
	}
	qty := c.Gross(parentQty)
	n := Node{
		RawMaterialID: m.ID, Kode: m.Kode, Nama: m.Nama, Unit: m.Unit, Level: level,
		QtyPer: RoundQty(c.StockQtyPer()), RecipeQtyPer: c.QtyPer, RecipeUnit: firstNonEmpty(c.RecipeUnit, m.Unit), UnitFactor: c.UnitFactor(),
		WasteFactor: c.WasteFactor, QtyRequired: qty, QtyOnHand: m.QtyOnHand,
		ShortageQty: RoundQty(math.Max(0, qty-m.QtyOnHand)), UnitCost: m.AvgCost,
		TotalCost: jsmath.RoundTo(float64(qty*m.AvgCost), 2), Children: []Node{},
	}
	children := x.recipes[c.RawMaterialID]
	if len(children) == 0 {
		return n, nil
	}
	n.HasRecipe = true
	x.onPath[c.RawMaterialID] = true
	defer delete(x.onPath, c.RawMaterialID)
	rolled := 0.0
	for _, child := range children {
		cn, err := x.node(child, qty, level+1)
		if err != nil {
			return Node{}, err
		}
		n.Children = append(n.Children, cn)
		rolled += float64(child.Gross(1) * cn.effectiveUnitCost())
	}
	r := jsmath.RoundTo(rolled, 2)
	n.RolledUnitCost = &r
	return n, nil
}

// netLeaves walks the tree depth first, using the stock of an intermediate
// before exploding what is still missing. Each material's stock is used
// once, wherever it first appears. The tree is already free of cycles.
func netLeaves(root []Component, qty float64, recipes Recipes, materials map[string]Material) []Leaf {
	stock := map[string]float64{}
	for id, m := range materials {
		stock[id] = m.QtyOnHand
	}
	need := map[string]float64{}
	var order []string
	var walk func(cs []Component, parentQty float64)
	walk = func(cs []Component, parentQty float64) {
		for _, c := range cs {
			qty := c.Gross(parentQty)
			if children := recipes[c.RawMaterialID]; len(children) > 0 {
				used := math.Min(stock[c.RawMaterialID], qty)
				stock[c.RawMaterialID] -= used
				if rest := RoundQty(qty - used); rest > 0 {
					walk(children, rest)
				}
				continue
			}
			if _, seen := need[c.RawMaterialID]; !seen {
				order = append(order, c.RawMaterialID)
			}
			need[c.RawMaterialID] = RoundQty(need[c.RawMaterialID] + qty)
		}
	}
	walk(root, qty)
	leaves := make([]Leaf, 0, len(order))
	for _, id := range order {
		m := materials[id]
		q := need[id]
		leaves = append(leaves, Leaf{
			RawMaterialID: id, Kode: m.Kode, Nama: firstNonEmpty(m.Nama, id), Unit: m.Unit, QtyRequired: q,
			QtyOnHand: m.QtyOnHand, ShortageQty: RoundQty(math.Max(0, q-m.QtyOnHand)), UnitCost: m.AvgCost,
			TotalCost: jsmath.RoundTo(float64(q*m.AvgCost), 2),
		})
	}
	sort.SliceStable(leaves, func(i, j int) bool { return leaves[i].ShortageQty > leaves[j].ShortageQty })
	return leaves
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// RoundQty rounds a quantity to 4 decimals, the scale of the order lines.
func RoundQty(v float64) float64 { return jsmath.RoundTo(v, 4) }
