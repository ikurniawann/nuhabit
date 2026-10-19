package domain

import (
	"errors"
	"reflect"
	"testing"
)

func comp(id string, qty, waste float64) Component {
	return Component{RawMaterialID: id, QtyPer: qty, WasteFactor: waste}
}

// A cake: flour (bought) and a cream filling made in-house from milk and
// sugar; sugar syrup is itself made from sugar.
func cakeRecipe() ([]Component, Recipes, map[string]Material) {
	root := []Component{comp("flour", 0.5, 0), comp("cream", 0.2, 0.1)}
	recipes := Recipes{
		"cream": {comp("milk", 0.8, 0), comp("syrup", 0.5, 0)},
		"syrup": {comp("sugar", 0.6, 0)},
	}
	materials := map[string]Material{
		"flour": {ID: "flour", Kode: "F", Nama: "Tepung", QtyOnHand: 3, AvgCost: 10000},
		"cream": {ID: "cream", Kode: "C", Nama: "Krim", QtyOnHand: 0.2, AvgCost: 30000},
		"milk":  {ID: "milk", Kode: "M", Nama: "Susu", QtyOnHand: 1, AvgCost: 20000},
		"syrup": {ID: "syrup", Kode: "S", Nama: "Sirup", QtyOnHand: 0, AvgCost: 0},
		"sugar": {ID: "sugar", Kode: "G", Nama: "Gula", QtyOnHand: 0, AvgCost: 15000},
	}
	return root, recipes, materials
}

func TestExplodeLevels(t *testing.T) {
	root, recipes, materials := cakeRecipe()
	x, err := Explode(root, 10, recipes, materials)
	if err != nil {
		t.Fatal(err)
	}
	if x.Depth != 3 || len(x.Lines) != 2 {
		t.Fatalf("depth %d lines %d", x.Depth, len(x.Lines))
	}
	cream := x.Lines[1]
	// 10 × 0.2 × 1.1 = 2.2 kg cream; per kg: 0.8 milk (16000) + 0.5 syrup.
	// Syrup per kg: 0.6 sugar = 9000, so 0.5 syrup = 4500; cream = 20500/kg.
	if cream.QtyRequired != 2.2 || !cream.HasRecipe || *cream.RolledUnitCost != 20500 || cream.ShortageQty != 2 {
		t.Fatalf("cream %+v", cream)
	}
	syrup := cream.Children[1]
	if syrup.Level != 2 || syrup.QtyRequired != 1.1 || *syrup.RolledUnitCost != 9000 || syrup.Children[0].QtyRequired != 0.66 {
		t.Fatalf("syrup %+v", syrup)
	}
	// Stock cost: 5 flour × 10000 + 2.2 cream × 30000; rolled: cream at 20500.
	if x.StockCost != 116000 || x.RolledCost != 95100 {
		t.Fatalf("costs %v %v", x.StockCost, x.RolledCost)
	}
	// 0.2 cream in stock leaves 2 to make: 1.6 milk, 1 syrup -> 0.6 sugar.
	// Leaves sort by shortage, largest first; equal shortages keep walk order.
	want := []Leaf{
		{RawMaterialID: "flour", Kode: "F", Nama: "Tepung", QtyRequired: 5, QtyOnHand: 3, ShortageQty: 2, UnitCost: 10000, TotalCost: 50000},
		{RawMaterialID: "milk", Kode: "M", Nama: "Susu", QtyRequired: 1.6, QtyOnHand: 1, ShortageQty: 0.6, UnitCost: 20000, TotalCost: 32000},
		{RawMaterialID: "sugar", Kode: "G", Nama: "Gula", QtyRequired: 0.6, QtyOnHand: 0, ShortageQty: 0.6, UnitCost: 15000, TotalCost: 9000},
	}
	got := x.Leaves
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("leaves\n got %+v\nwant %+v", got, want)
	}
}

func TestExplodeCycleAndDepth(t *testing.T) {
	recipes := Recipes{"a": {comp("b", 1, 0)}, "b": {comp("a", 1, 0)}}
	materials := map[string]Material{"a": {ID: "a", Kode: "A", Nama: "Adonan"}, "b": {ID: "b", Kode: "B", Nama: "Bumbu"}}
	_, err := Explode([]Component{comp("a", 1, 0)}, 1, recipes, materials)
	var cycle *CycleError
	if !errors.As(err, &cycle) || err.Error() != "Resep berputar: A Adonan memakai dirinya sendiri lewat komponennya" {
		t.Fatalf("cycle %v", err)
	}

	deep := Recipes{}
	for i := 0; i < MaxDepth+1; i++ {
		deep[string(rune('a'+i))] = []Component{comp(string(rune('a'+i+1)), 1, 0)}
	}
	_, err = Explode([]Component{comp("a", 1, 0)}, 1, deep, map[string]Material{})
	var depth *DepthError
	if !errors.As(err, &depth) {
		t.Fatalf("depth %v", err)
	}
}

// A recipe line in the big unit counts Factor stock units: 0.25 kg of
// flour stocked in grams is 250 g per unit.
func TestExplodeStockUnits(t *testing.T) {
	root := []Component{{RawMaterialID: "flour", QtyPer: 0.25, SatuanID: "kg", RecipeUnit: "Kilogram", Factor: 1000}}
	materials := map[string]Material{"flour": {ID: "flour", Nama: "Tepung", Unit: "Gram", QtyOnHand: 600, AvgCost: 20}}
	x, err := Explode(root, 4, Recipes{}, materials)
	if err != nil {
		t.Fatal(err)
	}
	n := x.Lines[0]
	if n.QtyRequired != 1000 || n.QtyPer != 250 || n.RecipeQtyPer != 0.25 || n.RecipeUnit != "Kilogram" || n.Unit != "Gram" ||
		n.UnitFactor != 1000 || n.ShortageQty != 400 || n.TotalCost != 20000 || x.Leaves[0].QtyRequired != 1000 {
		t.Fatalf("stock units %+v", n)
	}
	if comp("x", 2, 0).UnitFactor() != 1 || comp("x", 2, 0).Gross(3) != 6 {
		t.Fatal("no factor is 1")
	}
}

func TestStepGuards(t *testing.T) {
	if CheckIssue(StatusDraft) == nil || CheckIssue(StatusReleased) != nil || CheckIssue(StatusInProgress) != nil {
		t.Fatal("issue guard")
	}
	cases := []struct {
		status      string
		issues      int
		good, scrap float64
		want        string
	}{
		{StatusReleased, 1, 1, 0, "Hasil produksi hanya bisa diterima saat order IN_PROGRESS"},
		{StatusInProgress, 0, 1, 0, "Keluarkan bahan ke produksi dulu sebelum menerima hasil"},
		{StatusInProgress, 1, 0, 0, "Isi jumlah hasil baik atau scrap"},
		{StatusInProgress, 1, 0, 2, ""},
	}
	for _, c := range cases {
		err := CheckReceipt(c.status, c.issues, c.good, c.scrap)
		if (err == nil) != (c.want == "") || (err != nil && err.Error() != c.want) {
			t.Errorf("%+v: %v", c, err)
		}
	}
	if IssueNumber("PROD-202610-0001", 2) != "PROD-202610-0001-I02" || BatchNumber("PROD-202610-0001", 1) != "PROD-202610-0001-B01" {
		t.Fatal("numbers")
	}
}

func TestCostReceipt(t *testing.T) {
	lines := []Line{{QtyPlanned: 10, UnitCost: 1000, QtyIssued: 10, IssuedCost: 12000}, {QtyPlanned: 2, UnitCost: 5000}}
	std := StdMaterialPerUnit(lines, 100) // (10 × 1200 + 2 × 5000) / 100
	if std != 220 {
		t.Fatalf("std %v", std)
	}
	base := ReceiptInput{PlannedQty: 100, StdMaterialPerUnit: std, IssuedCost: 20000, Conversion: 5000}

	// First batch: 40 good at the standard 220 and 40% of the conversion.
	first := base
	first.QtyGood, first.QtyScrap = 40, 5
	c1 := CostReceipt(first)
	if c1 != (ReceiptCost{Material: 8800, Conversion: 2000, Total: 10800, HppPerUnit: 270}) {
		t.Fatalf("first %+v", c1)
	}

	// The cap: 80 good would cost 17600 but only 11200 is left in WIP.
	capped := base
	capped.ReceivedMaterialCost, capped.AppliedConversion, capped.QtyGood = 8800, 2000, 80
	if c := CostReceipt(capped); c.Material != 11200 || c.Conversion != 3000 {
		t.Fatalf("capped %+v", c)
	}

	// Final batch: everything left, scrap raises the HPP.
	final := base
	final.ReceivedMaterialCost, final.AppliedConversion, final.QtyGood, final.QtyScrap, final.Final = 8800, 2000, 45, 10, true
	c2 := CostReceipt(final)
	if c2 != (ReceiptCost{Material: 11200, Conversion: 3000, Total: 14200, HppPerUnit: 315.56}) {
		t.Fatalf("final %+v", c2)
	}
	if got := c1.Material + c2.Material; got != base.IssuedCost {
		t.Fatalf("batches add up to %v", got)
	}

	// Final with nothing good: the WIP is scrap, conversion is not applied.
	lost := base
	lost.ReceivedMaterialCost, lost.QtyScrap, lost.Final = 8800, 3, true
	if c := CostReceipt(lost); c != (ReceiptCost{Scrap: 11200}) {
		t.Fatalf("lost %+v", c)
	}
}

// 5% of 100 planned is the normal scrap; the rest is abnormal, costed at
// the batch's unit cost and expensed.
func TestAbnormalScrap(t *testing.T) {
	allowance := ScrapAllowance(100, DefaultScrapTolerancePct)
	if allowance != 5 || ScrapAllowance(30, 2.5) != 0.75 {
		t.Fatalf("allowance %v", allowance)
	}
	if n, a := SplitScrap(0, 8, allowance); n != 5 || a != 3 {
		t.Fatalf("first split %v %v", n, a)
	}
	if n, a := SplitScrap(8, 2, allowance); n != 0 || a != 2 {
		t.Fatalf("allowance used up %v %v", n, a)
	}
	if n, a := SplitScrap(2, 2, allowance); n != 2 || a != 0 {
		t.Fatalf("within tolerance %v %v", n, a)
	}

	base := ReceiptInput{PlannedQty: 100, StdMaterialPerUnit: 220, IssuedCost: 20000, Conversion: 5000}
	// Non-final: 3 abnormal units at the standard 220 + 50 per unit.
	first := base
	first.QtyGood, first.QtyScrap, first.QtyAbnormal = 40, 8, 3
	c1 := CostReceipt(first)
	if c1 != (ReceiptCost{Material: 8800, Conversion: 2000, AbnormalMaterial: 660, AbnormalConversion: 150, Total: 10800, HppPerUnit: 270}) ||
		c1.Abnormal() != 810 {
		t.Fatalf("first %+v", c1)
	}
	// Final: what is left splits over 45 good and 2 abnormal units.
	final := base
	final.ReceivedMaterialCost, final.ScrapCost, final.AppliedConversion = 8800, 660, 2150
	final.QtyGood, final.QtyScrap, final.QtyAbnormal, final.Final = 45, 2, 2, true
	c2 := CostReceipt(final)
	if c2 != (ReceiptCost{Material: 10091.49, Conversion: 2728.72, AbnormalMaterial: 448.51, AbnormalConversion: 121.28, Total: 12820.21,
		HppPerUnit: 284.89}) {
		t.Fatalf("final %+v", c2)
	}
	if got := round2(c1.Material + c1.AbnormalMaterial + c2.Material + c2.AbnormalMaterial); got != base.IssuedCost {
		t.Fatalf("material adds up to %v", got)
	}
	// Final with nothing good: the abnormal third of the scrap is expensed,
	// the normal rest is written off as before.
	lost := base
	lost.ReceivedMaterialCost, lost.AppliedConversion, lost.QtyScrap, lost.QtyAbnormal, lost.Final = 8800, 2000, 3, 1, true
	if c := CostReceipt(lost); c != (ReceiptCost{Scrap: 7466.67, AbnormalMaterial: 3733.33, AbnormalConversion: 1000}) {
		t.Fatalf("lost %+v", c)
	}
}

// Returns go back at the issued average cost; the last one takes what is
// left of the issued value.
func TestReturns(t *testing.T) {
	if CheckReturn(StatusReleased) == nil || CheckReturn(StatusInProgress) != nil {
		t.Fatal("return guard")
	}
	if ReturnNumber("PROD-202610-0001", 1) != "PROD-202610-0001-R01" {
		t.Fatal("number")
	}
	l := Line{QtyPlanned: 3, QtyIssued: 3, IssuedCost: 10000}
	if l.Returnable() != 3 || l.ReturnValue(1) != 3333.33 {
		t.Fatalf("first return %v %v", l.Returnable(), l.ReturnValue(1))
	}
	l.QtyReturned, l.ReturnedCost = 1, 3333.33
	if l.Returnable() != 2 || l.ReturnValue(2) != 6666.67 {
		t.Fatalf("last return %v", l.ReturnValue(2))
	}
}

func TestYieldAndAllocate(t *testing.T) {
	if y := Yield(45, 5); *y != 90 {
		t.Fatalf("yield %v", *y)
	}
	if Yield(0, 0) != nil || PlannedYield(1, 0) != nil || *PlannedYield(85, 100) != 85 {
		t.Fatal("yield edges")
	}
	if got := Allocate(100, []float64{1, 1, 1}); !reflect.DeepEqual(got, []float64{33.33, 33.33, 33.34}) {
		t.Fatalf("allocate %v", got)
	}
	if got := Allocate(50, []float64{2, 0}); !reflect.DeepEqual(got, []float64{50, 0}) {
		t.Fatalf("allocate trailing zero %v", got)
	}
	if got := Allocate(50, []float64{0, 0}); !reflect.DeepEqual(got, []float64{0, 0}) {
		t.Fatalf("allocate no weight %v", got)
	}
	if WipBalance(100, 60, 50) != 0 || WipBalance(100, 60, 0) != 40 {
		t.Fatal("wip balance")
	}
}

func TestCheckVariants(t *testing.T) {
	skus := []string{"m", "l"}
	for _, c := range []struct {
		rows []Variant
		want string
	}{
		{nil, "Rincian varian wajib diisi"},
		{[]Variant{{"x", 1}}, "Varian tidak dikenal / tidak aktif"},
		{[]Variant{{"m", 1}, {"m", 1}}, "Varian ganda"},
		{[]Variant{{"m", 0}}, "Qty varian harus > 0"},
		{[]Variant{{"m", 1}}, "Rincian varian harus berjumlah sama dengan hasil baik (1 vs 2,5)"},
	} {
		if _, err := CheckVariants(2.5, c.rows, skus); err == nil || err.Error() != c.want {
			t.Errorf("%v: %v", c.rows, err)
		}
	}
	got, err := CheckVariants(2.5, []Variant{{"m", 1.499}, {"l", 1.001}}, skus)
	if err != nil || !reflect.DeepEqual(got, []Variant{{"m", 1.5}, {"l", 1}}) {
		t.Fatalf("%v %v", got, err)
	}
}
