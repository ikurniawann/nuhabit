package domain

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// central-cashier.test.ts
func TestCanSellMixedStall(t *testing.T) {
	cases := []struct {
		menu, flag bool
		mode       ActiveStallMode
		want       bool
	}{
		{true, true, StallAll, true},
		{true, false, StallAll, false},
		{true, true, StallOne, false},
		{false, true, StallAll, false},
		{true, true, StallUnset, false},
	}
	for _, c := range cases {
		if got := CanSellMixedStall(c.menu, c.flag, c.mode); got != c.want {
			t.Errorf("CanSellMixedStall(%v,%v,%q) = %v, want %v", c.menu, c.flag, c.mode, got, c.want)
		}
	}
}

func TestUniqueStallIDsAndShouldCreateCheckout(t *testing.T) {
	if got := UniqueStallIDs([]string{"w-a", "w-a", "w-b"}); !reflect.DeepEqual(got, []string{"w-a", "w-b"}) {
		t.Errorf("UniqueStallIDs = %v", got)
	}
	if got := UniqueStallIDs([]string{"", "w-b", "", "w-a", "w-b"}); !reflect.DeepEqual(got, []string{"w-b", "w-a"}) {
		t.Errorf("UniqueStallIDs drops empties in first-seen order, got %v", got)
	}
	if got := UniqueStallIDs(nil); len(got) != 0 {
		t.Errorf("UniqueStallIDs(nil) = %v", got)
	}
	cases := []struct {
		ids  []string
		want bool
	}{
		{[]string{"w-a"}, false},
		{[]string{"w-a", "w-b"}, true},
		{[]string{"w-a", "w-a"}, false},
		{[]string{"w-a", ""}, false},
		{nil, false},
	}
	for _, c := range cases {
		if got := ShouldCreateCheckout(c.ids); got != c.want {
			t.Errorf("ShouldCreateCheckout(%v) = %v, want %v", c.ids, got, c.want)
		}
	}
}

func TestResolveSingleStallSellFromAllMode(t *testing.T) {
	cases := []struct {
		name     string
		ws       []string
		canMixed bool
		want     string
	}{
		{"sole cart stall in all mode", []string{"w-a", "w-a"}, true, "w-a"},
		{"mixed cart", []string{"w-a", "w-b"}, true, ""},
		{"central gate closed", []string{"w-a"}, false, ""},
		{"blank warehouses ignored", []string{"", "w-a"}, true, "w-a"},
		{"empty cart", nil, true, ""},
	}
	for _, c := range cases {
		if got := ResolveSingleStallSellFromAllMode(c.ws, c.canMixed); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestAssertAllModeSellStallAssigned(t *testing.T) {
	if got := AssertAllModeSellStallAssigned("w-a", []string{"w-a", "w-b"}); got != "" {
		t.Errorf("allowed stall rejected: %q", got)
	}
	if got := AssertAllModeSellStallAssigned("w-x", []string{"w-a", "w-b"}); got != "Stall aktif di luar penempatan Anda" {
		t.Errorf("outside stall message = %q", got)
	}
}

func TestAllocateAmount(t *testing.T) {
	cases := []struct {
		name    string
		total   float64
		weights []float64
		want    []float64
	}{
		{"tender onto children", 27000, []float64{18000, 9000}, []float64{18000, 9000}},
		{"remainder to largest", 1000, []float64{20000, 10000, 10000}, []float64{500, 250, 250}},
		{"remainder to first largest on ties", 1001, []float64{10000, 10000, 5000}, []float64{401, 400, 200}},
		{"floor then remainder", 100, []float64{1, 1, 1}, []float64{34, 33, 33}},
		{"zero weights", 500, []float64{0, 0}, []float64{0, 0}},
		{"zero total", 0, []float64{1, 2}, []float64{0, 0}},
		{"no weights", 500, []float64{}, []float64{}},
	}
	for _, c := range cases {
		got := AllocateAmount(c.total, c.weights)
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: AllocateAmount(%v, %v) = %v, want %v", c.name, c.total, c.weights, got, c.want)
		}
	}
}

func sumCharges(rows []StallCharges, pick func(StallCharges) float64) float64 {
	s := 0.0
	for _, r := range rows {
		s += pick(r)
	}
	return s
}

func TestAllocateCheckoutCharges(t *testing.T) {
	rows := AllocateCheckoutCharges([]StallCharges{{WarehouseID: "w-a", Subtotal: 10000}, {WarehouseID: "w-b", Subtotal: 5000}}, 1500, 1350, 0, 0)
	if rows[0].Discount+rows[1].Discount != 1500 || rows[0].Tax+rows[1].Tax != 1350 {
		t.Errorf("split does not tie out: %+v", rows)
	}
	if rows[0].WarehouseID != "w-a" || rows[0].Discount != 1000 || rows[1].Discount != 500 {
		t.Errorf("pro rata discount wrong: %+v", rows)
	}

	zero := AllocateCheckoutCharges([]StallCharges{{WarehouseID: "w-a"}}, 0, 0, 0, 0)
	if zero[0].Total != 0 {
		t.Errorf("zero subtotal total = %v", zero[0].Total)
	}

	manual := AllocateCheckoutCharges([]StallCharges{{WarehouseID: "w-a", Subtotal: 75000}, {WarehouseID: "w-b", Subtotal: 25000}}, 10000, 0, 0, 0)
	if manual[0].Discount != 7500 || manual[1].Discount != 2500 {
		t.Errorf("manual discount split = %+v", manual)
	}
	if got := sumCharges(manual, func(r StallCharges) float64 { return r.Total }); got != 90000 {
		t.Errorf("manual discount totals = %v, want 90000", got)
	}

	three := AllocateCheckoutCharges([]StallCharges{{WarehouseID: "w-a", Subtotal: 20000}, {WarehouseID: "w-b", Subtotal: 10000}, {WarehouseID: "w-c", Subtotal: 10000}}, 1000, 0, 0, 0)
	if got := sumCharges(three, func(r StallCharges) float64 { return r.Discount }); got != 1000 {
		t.Errorf("rounding remainder lost: %v", got)
	}
	if three[0].Discount < three[1].Discount {
		t.Errorf("largest stall should carry the remainder: %+v", three)
	}

	mixed := AllocateCheckoutCharges([]StallCharges{{WarehouseID: "w-a", Subtotal: 20000}, {WarehouseID: "w-b", Subtotal: 10000}}, 3000, 2700, 0, 0)
	if got := mixed[0].Total + mixed[1].Total; got != 20000+10000-3000+2700 {
		t.Errorf("children totals = %v", got)
	}

	all := AllocateCheckoutCharges([]StallCharges{{WarehouseID: "w-a", Subtotal: 30000}, {WarehouseID: "w-b", Subtotal: 10000}}, 4000, 2000, 1000, 400)
	want := []StallCharges{
		{WarehouseID: "w-a", Subtotal: 30000, Discount: 3000, Tax: 1500, ServiceCharge: 750, OtherCharges: 300, Total: 29550},
		{WarehouseID: "w-b", Subtotal: 10000, Discount: 1000, Tax: 500, ServiceCharge: 250, OtherCharges: 100, Total: 9850},
	}
	if !reflect.DeepEqual(all, want) {
		t.Errorf("all charges = %+v, want %+v", all, want)
	}
}

// pos-sell-stall.test.ts
func TestResolvePosSellStall(t *testing.T) {
	cases := []struct {
		name     string
		mode     ActiveStallMode
		active   string
		assigned []string
		def      string
		want     SellStallResult
	}{
		{"active stall cookie", StallOne, "w-a", []string{"w-a", "w-b"}, "", SellStallResult{WarehouseID: "w-a"}},
		{"Semua Stall rejected", StallAll, "", []string{"w-a"}, "", SellStallResult{Reason: "all_stalls", Message: "Pilih satu stall aktif sebelum membuat transaksi POS"}},
		{"sole assignment", StallUnset, "", []string{"w-only"}, "", SellStallResult{WarehouseID: "w-only"}},
		{"default warehouse", StallUnset, "", []string{"w-1", "w-2"}, "w-1", SellStallResult{WarehouseID: "w-1"}},
		{"multi assignment", StallUnset, "", []string{"w-a", "w-b"}, "", SellStallResult{Reason: "multiple_unselected", Message: "Pilih satu stall aktif sebelum membuat transaksi POS"}},
		{"empty assignment", StallUnset, "", []string{}, "", SellStallResult{Reason: "no_stall", Message: "Tidak ada stall penempatan. Hubungi admin untuk assign stall"}},
		{"stall mode without id falls through", StallOne, "", []string{"w-a"}, "", SellStallResult{WarehouseID: "w-a"}},
		{"duplicate assignment counts once", StallUnset, "", []string{"w-a", "w-a", ""}, "", SellStallResult{WarehouseID: "w-a"}},
	}
	for _, c := range cases {
		got := ResolvePosSellStall(c.mode, c.active, c.assigned, c.def)
		if got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
		if got.OK() != (c.want.WarehouseID != "") {
			t.Errorf("%s: OK() mismatch", c.name)
		}
	}
}

func TestAssertProductWarehousesMatchStall(t *testing.T) {
	if got := AssertProductWarehousesMatchStall([]string{"w-a", "w-a"}, "w-a"); got != "" {
		t.Errorf("same stall rejected: %q", got)
	}
	if got := AssertProductWarehousesMatchStall([]string{"w-a", "w-b"}, "w-a"); got != "Keranjang berisi produk dari stall lain. Ganti stall atau kosongkan keranjang" {
		t.Errorf("foreign stall message = %q", got)
	}
	if got := AssertProductWarehousesMatchStall([]string{""}, "w-a"); got != "Ada produk tanpa stall — tidak bisa digabung ke transaksi stall ini" {
		t.Errorf("missing stall message = %q", got)
	}
}

// stall-assignment.test.ts
func TestComputeStallAllAccess(t *testing.T) {
	cases := []struct {
		role        string
		canSwitch   bool
		mainStorage bool
		want        bool
	}{
		{"pos", true, false, true},
		{"pos", false, false, false},
		{"super_admin", false, false, true},
		{"pos", false, true, true},
		{"", false, false, false},
	}
	for _, c := range cases {
		if got := ComputeStallAllAccess(c.role, c.canSwitch, c.mainStorage); got != c.want {
			t.Errorf("ComputeStallAllAccess(%q,%v,%v) = %v, want %v", c.role, c.canSwitch, c.mainStorage, got, c.want)
		}
	}
}

func TestIsSellStallAllowed(t *testing.T) {
	cases := []struct {
		name                string
		wid                 string
		assigned            []string
		canSwitch, unscoped bool
		def                 string
		want                bool
	}{
		{"switch on", "w-2", []string{"w-1"}, true, false, "", true},
		{"outside placement", "w-2", []string{"w-1"}, false, false, "", false},
		{"unscoped", "w-9", nil, false, true, "", true},
		{"assigned", "w-1", []string{"w-1"}, false, false, "", true},
		{"default stall", "w-3", []string{"w-1"}, false, false, "w-3", true},
	}
	for _, c := range cases {
		if got := IsSellStallAllowed(c.wid, c.assigned, c.canSwitch, c.unscoped, c.def); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

// sort-warehouses.test.ts plus orderings checked against node's Array.sort.
func codes(ws []Warehouse) string {
	out := make([]string, len(ws))
	for i, w := range ws {
		out[i] = w.Code
	}
	return strings.Join(out, " ")
}

func names(ws []Warehouse) string {
	out := make([]string, len(ws))
	for i, w := range ws {
		out[i] = w.Name
	}
	return strings.Join(out, " ")
}

func TestSortWarehouses(t *testing.T) {
	rows := []Warehouse{{}, {IsDefault: true, Code: "WH-01", Name: "Operasional"}, {Code: "STALL-02", Name: "Yakitori"}}
	if got := SortWarehouses(rows); got[0].Code != "WH-01" {
		t.Errorf("default first: got %q", codes(got))
	}

	ws := []Warehouse{
		{Code: "STALL-10", Name: "s10"},
		{Code: "WH-10", Name: "w10"},
		{Code: "STALL-2", Name: "s2"},
		{Code: "main", Name: "Main"},
		{Code: "WH-2", Name: "w2"},
		{IsDefault: true, Code: "ZZ", Name: "Default"},
		{Code: "stall-003", Name: "s3"},
	}
	if got := codes(SortWarehouses(ws)); got != "ZZ main WH-2 WH-10 STALL-2 stall-003 STALL-10" {
		t.Errorf("SortWarehouses = %q", got)
	}
	if ws[0].Code != "STALL-10" {
		t.Errorf("SortWarehouses must not mutate its input")
	}

	same := []Warehouse{{Code: "WH-01", Name: "b"}, {Code: "wh-1", Name: "a"}}
	if got := names(SortWarehouses(same)); got != "a b" {
		t.Errorf("numeric, case-insensitive code tie falls to name: %q", got)
	}

	// localeCompare(..., {sensitivity: "base"}) treats É as E.
	accents := []Warehouse{{Name: "Fries"}, {Name: "Éclair"}, {Name: "donut"}}
	if got := names(SortWarehouses(accents)); got != "donut Éclair Fries" {
		t.Errorf("accented names = %q, want %q", got, "donut Éclair Fries")
	}
}

// table-sale-target.test.ts
func TestResolveTableSaleTarget(t *testing.T) {
	cases := []struct {
		name     string
		kind     SaleKind
		checkout string
		want     string
	}{
		{"stall beside unpaid checkout", SaleStall, "chk-1", TargetCreateOrder},
		{"central mixed appends", SaleCentralMixed, "chk-1", TargetAppendCheckout},
		{"central mixed without checkout", SaleCentralMixed, "", TargetCreateCheckout},
		{"central single appends", SaleCentralSingle, "chk-1", TargetAppendCheckout},
		{"central single without checkout", SaleCentralSingle, "", TargetCreateOrder},
	}
	for _, c := range cases {
		if got := ResolveTableSaleTarget(c.kind, c.checkout); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestResolveUnpaidCheckoutForOpenBill(t *testing.T) {
	cases := []struct {
		name               string
		reuse              bool
		explicit, tableChk string
		want               string
	}{
		{"explicit wins", true, "chk-5", "chk-table", "chk-5"},
		{"table checkout", true, "", "chk-table", "chk-table"},
		{"blank explicit, no table", true, "  ", "", ""},
		{"QRIS instant sale does not reuse", false, "", "chk-table", ""},
		{"explicit still wins without reuse", false, " chk-7 ", "chk-table", "chk-7"},
		{"table id trimmed", true, "", " chk-t ", "chk-t"},
	}
	for _, c := range cases {
		if got := ResolveUnpaidCheckoutForOpenBill(c.reuse, c.explicit, c.tableChk); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestShouldReuseUnpaidOpenBillCheckout(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want bool
	}{
		{"false", false, false},
		{"undefined", Undefined{}, true},
		{"null", nil, true},
		{"true", true, true},
		{`"false"`, "false", false},
		{`"0"`, "0", false},
		{"number 0", json.Number("0"), false},
		{"float 0", 0.0, false},
		{"number 1", json.Number("1"), true},
		{`"no"`, "no", true},
		{`""`, "", true},
		// raw === 0 is strict: arrays are never === 0.
		{"empty array", []any{}, true},
		{`["0"]`, []any{"0"}, true},
		{"object", map[string]any{}, true},
	}
	for _, c := range cases {
		if got := ShouldReuseUnpaidOpenBillCheckout(c.in); got != c.want {
			t.Errorf("ShouldReuseUnpaidOpenBillCheckout(%s) = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestResolveOpenBillOfferDiscount(t *testing.T) {
	cases := []struct {
		name   string
		client any
		server float64
		want   float64
	}{
		{"client amount kept", json.Number("30000"), 0, 30000},
		{"null falls to server", nil, 15000, 15000},
		{"client 0 kept", json.Number("0"), 15000, 0},
		{"undefined falls to server", Undefined{}, 15000, 15000},
		{"empty string falls to server", "", 15000, 15000},
		{"non numeric falls to server", "abc", 15000, 15000},
		{"negative clamps", "-5", 15000, 0},
		{"numeric string", "1200", 0, 1200},
		{"negative server clamps", nil, -10, 0},
	}
	for _, c := range cases {
		if got := ResolveOpenBillOfferDiscount(c.client, c.server); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestCanAppendTransferItems(t *testing.T) {
	stall := BillFamily{SoldFrom: "stall"}
	central := BillFamily{CheckoutID: "chk-1", SoldFrom: "central"}
	if !CanAppendTransferItems(stall, stall) || !CanAppendTransferItems(central, central) {
		t.Errorf("same family must be allowed")
	}
	if CanAppendTransferItems(stall, central) {
		t.Errorf("stall into central must be rejected")
	}
	if !IsCentralBill(BillFamily{SoldFrom: "central"}) || !IsCentralBill(BillFamily{CheckoutID: "c"}) || IsCentralBill(BillFamily{}) {
		t.Errorf("IsCentralBill mismatch")
	}
}

func TestPlanCheckoutAppend(t *testing.T) {
	got := PlanCheckoutAppend([]string{"w-a"}, []AppendChild{{OrderID: "child-a", WarehouseID: "w-a"}})
	if !reflect.DeepEqual(got, []AppendChild{{OrderID: "child-a", WarehouseID: "w-a"}}) {
		t.Errorf("append onto existing child: %+v", got)
	}
	got = PlanCheckoutAppend([]string{"w-b"}, []AppendChild{{OrderID: "child-a", WarehouseID: "w-a"}})
	if !reflect.DeepEqual(got, []AppendChild{{WarehouseID: "w-b"}}) {
		t.Errorf("new child: %+v", got)
	}
	got = PlanCheckoutAppend([]string{"w-a", "w-c"}, []AppendChild{{OrderID: "child-a", WarehouseID: "w-a"}})
	if !reflect.DeepEqual(got, []AppendChild{{OrderID: "child-a", WarehouseID: "w-a"}, {WarehouseID: "w-c"}}) {
		t.Errorf("mixed append: %+v", got)
	}
	got = PlanCheckoutAppend([]string{"w-a"}, []AppendChild{{OrderID: "old", WarehouseID: "w-a"}, {OrderID: "new", WarehouseID: "w-a"}})
	if got[0].OrderID != "new" {
		t.Errorf("later rows win like new Map(...): %+v", got)
	}
}
