package domain

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

// create-mixed-checkout.test.ts: guardMixedCheckoutCart
func TestGuardMixedCheckoutCart(t *testing.T) {
	mixed := map[string]string{"p1": "w-a", "p2": "w-b"}
	single := map[string]string{"p1": "w-a", "p2": "w-a"}
	ids := []string{"p1", "p2"}
	cases := []struct {
		name     string
		wh       map[string]string
		canMixed bool
		splits   bool
		promo    string
		want     MixedGuard
	}{
		{"product without warehouse", map[string]string{"p1": "w-a"}, true, false, "", MixedGuard{Message: MsgMissingProductStall}},
		{"mixed without central gate", mixed, false, false, "", MixedGuard{Message: MsgMixedStallForbidden}},
		{"mixed with gate", mixed, true, false, "", MixedGuard{CreateCheckout: true, StallIDs: []string{"w-a", "w-b"}}},
		{"single stall order path", single, true, false, "", MixedGuard{CreateCheckout: false, StallIDs: []string{"w-a"}}},
		{"split bill on mixed", mixed, true, true, "", MixedGuard{Message: MsgMixedSplitUnsupported}},
		{"promo on mixed", mixed, true, false, "HEMAT10", MixedGuard{Message: MsgMixedPromoUnsupported}},
		{"blank promo ignored", mixed, true, false, "  ", MixedGuard{CreateCheckout: true, StallIDs: []string{"w-a", "w-b"}}},
		{"promo on single stall allowed", single, true, false, "HEMAT10", MixedGuard{StallIDs: []string{"w-a"}}},
		{"splits on single stall allowed", single, false, true, "", MixedGuard{StallIDs: []string{"w-a"}}},
	}
	for _, c := range cases {
		got := GuardMixedCheckoutCart(ids, c.wh, c.canMixed, c.splits, c.promo)
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
	if MsgMixedSplitUnsupported != "Split bill belum didukung untuk checkout multi-stall" {
		t.Errorf("split message changed")
	}
	if MsgMixedNfcGiftUnsupported != "Pembayaran NFC Tab / Gift Card belum didukung untuk checkout multi-stall" {
		t.Errorf("NFC/gift message changed")
	}
}

// rules.test.ts fixtures
var (
	ruleWarehouses = map[string]string{"kopi": "bar", "roti": "bakery", "teh": "bar"}
	ruleItems      = []Obj{
		{"product_id": "kopi", "quantity": json.Number("2"), "unit_price": json.Number("20000")},
		{"product_id": "roti", "quantity": json.Number("1"), "unit_price": json.Number("15000"), "modifier_price_adjustment": json.Number("2000")},
		{"product_id": "teh", "quantity": json.Number("3"), "unit_price": json.Number("8000"), "variant_price_adjustment": json.Number("1000")},
	}
)

func ruleInput(mod func(*MixedSaleInput)) MixedSaleInput {
	in := MixedSaleInput{Items: ruleItems, WarehouseByProduct: ruleWarehouses, CashierID: "kasir", SessionUserID: "user"}
	if mod != nil {
		mod(&in)
	}
	return in
}

func TestSliceLinesByStall(t *testing.T) {
	slices := SliceLinesByStall(BuildLines(ruleItems, ruleWarehouses))
	type row struct {
		id    string
		sub   float64
		lines int
	}
	var got []row
	for _, s := range slices {
		got = append(got, row{s.WarehouseID, s.Subtotal, len(s.Lines)})
	}
	want := []row{{"bar", 40000 + 27000, 2}, {"bakery", 17000, 1}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("slices = %+v, want %+v", got, want)
	}
	// groupItemsByStall drops lines without a stall.
	lines := []BuiltLine{{WarehouseID: "w-a", LineSubtotal: 1}, {WarehouseID: "", LineSubtotal: 5}, {WarehouseID: "w-b", LineSubtotal: 2}, {WarehouseID: "w-a", LineSubtotal: 3}}
	s := SliceLinesByStall(lines)
	if len(s) != 2 || s[0].WarehouseID != "w-a" || s[0].Subtotal != 4 || len(s[0].Lines) != 2 || s[1].WarehouseID != "w-b" {
		t.Errorf("grouping = %+v", s)
	}
}

func TestBuildLines(t *testing.T) {
	// resolveLineWarehouse: catalog warehouse, never the client's warehouse_id.
	got := BuildLines([]Obj{{"product_id": "p1", "warehouse_id": "client-spoof"}}, map[string]string{"p1": "catalog-w"})
	if got[0].WarehouseID != "catalog-w" {
		t.Errorf("warehouse = %q, want catalog-w", got[0].WarehouseID)
	}
	cases := []struct {
		name                          string
		item                          Obj
		qty, unit, sub, disc, lineTot float64
	}{
		{"defaults", Obj{"product_id": "p"}, 1, 0, 0, 0, 0},
		{"quantity 0 is 1", Obj{"quantity": json.Number("0"), "unit_price": json.Number("100")}, 1, 100, 100, 0, 100},
		{"quantity null is 1", Obj{"quantity": nil, "unit_price": "100"}, 1, 100, 100, 0, 100},
		{"quantity garbage is 1", Obj{"quantity": "abc", "unit_price": "100"}, 1, 100, 100, 0, 100},
		{"string prices", Obj{"quantity": "2", "unit_price": "1000", "variant_price_adjustment": "500", "modifier_price_adjustment": "250"}, 2, 1750, 3500, 0, 3500},
		{"discount clamps line total", Obj{"quantity": json.Number("1"), "unit_price": json.Number("1000"), "discount_amount": json.Number("1500")}, 1, 1000, 1000, 1500, 0},
		{"negative discount ignored", Obj{"quantity": json.Number("1"), "unit_price": json.Number("1000"), "discount_amount": json.Number("-5")}, 1, 1000, 1000, 0, 1000},
		{"non finite price is 0", Obj{"unit_price": "Infinity"}, 1, 0, 0, 0, 0},
	}
	for _, c := range cases {
		l := BuildLines([]Obj{c.item}, nil)[0]
		if l.Qty != c.qty || l.UnitPrice != c.unit || l.LineSubtotal != c.sub || l.LineDiscount != c.disc || l.LineTotal != c.lineTot {
			t.Errorf("%s: got qty=%v unit=%v sub=%v disc=%v total=%v", c.name, l.Qty, l.UnitPrice, l.LineSubtotal, l.LineDiscount, l.LineTotal)
		}
	}
}

func TestPlanMixedSale(t *testing.T) {
	t.Run("cash paid: server total and change", func(t *testing.T) {
		plan, err := PlanMixedSale(ruleInput(func(in *MixedSaleInput) {
			in.DiscountAmount = json.Number("4000")
			in.TaxAmount = json.Number("8000")
			in.AmountPaid = json.Number("100000")
		}))
		if err != nil {
			t.Fatalf("unexpected error %v", err)
		}
		if plan.ServerSubtotal != 84000 || plan.ServerTotal != 88000 || plan.PaymentMethod != "cash" ||
			plan.PaymentStatus != "paid" || !plan.InsertChildren || !plan.IsPaidSale || plan.ChangeAmount != 12000 || !plan.CanCreateFreshCheckout {
			t.Errorf("plan = %+v", plan)
		}
		want := map[string]any{"kopi": "bar", "roti": "bakery", "teh": "bar"}
		if !reflect.DeepEqual(plan.Snapshot["warehouseByProduct"], want) {
			t.Errorf("snapshot warehouseByProduct = %v", plan.Snapshot["warehouseByProduct"])
		}
	})

	t.Run("QRIS underpaid stays unpaid without children", func(t *testing.T) {
		plan, err := PlanMixedSale(ruleInput(func(in *MixedSaleInput) {
			in.PaymentMethod = "qris"
			in.AmountPaid = json.Number("0")
		}))
		if err != nil {
			t.Fatalf("unexpected error %v", err)
		}
		if plan.PaymentStatus != "unpaid" || plan.InsertChildren || plan.IsPaidSale {
			t.Errorf("plan = %+v", plan)
		}
	})

	t.Run("open bill: requested unpaid stays unpaid even when forcing children", func(t *testing.T) {
		plan, err := PlanMixedSale(ruleInput(func(in *MixedSaleInput) {
			in.PaymentStatus = "unpaid"
			in.ForceInsertChildren = true
			in.TableID = "t1"
		}))
		if err != nil {
			t.Fatalf("unexpected error %v", err)
		}
		if plan.PaymentStatus != "unpaid" || !plan.InsertChildren || !plan.RequestedUnpaid {
			t.Errorf("plan = %+v", plan)
		}
	})

	t.Run("one stall only when continuing a table or checkout", func(t *testing.T) {
		single := []Obj{ruleItems[0], ruleItems[2]}
		_, err := PlanMixedSale(ruleInput(func(in *MixedSaleInput) {
			in.Items = single
			in.AmountPaid = json.Number("1000000")
		}))
		assertCheckoutError(t, err, MsgMultiStallRequired)
		plan, err := PlanMixedSale(ruleInput(func(in *MixedSaleInput) {
			in.Items = single
			in.TableID = "t1"
			in.AmountPaid = json.Number("1000000")
		}))
		if err != nil || plan.CanCreateFreshCheckout {
			t.Errorf("table continuation: plan=%+v err=%v", plan, err)
		}
		for _, mod := range []func(*MixedSaleInput){
			func(in *MixedSaleInput) { in.ExistingCheckoutID = "chk-1" },
			func(in *MixedSaleInput) { in.ReuseUnpaidTableCheckout = true },
		} {
			if _, err := PlanMixedSale(ruleInput(func(in *MixedSaleInput) { in.Items = single; in.AmountPaid = 1e6; mod(in) })); err != nil {
				t.Errorf("continuation rejected: %v", err)
			}
		}
	})

	t.Run("ARK must cover the whole total", func(t *testing.T) {
		_, err := PlanMixedSale(ruleInput(func(in *MixedSaleInput) {
			in.PaymentMethod = "ark_coin"
			in.CustomerID = "c1"
			in.ArkCoinsUsed = json.Number("1000")
			in.PaymentStatus = "unpaid"
		}))
		assertCheckoutError(t, err, "Pembayaran ARK Coin harus menutup seluruh total order")
	})

	t.Run("failure order", func(t *testing.T) {
		cases := []struct {
			name string
			mod  func(*MixedSaleInput)
			want string
		}{
			{"missing stall", func(in *MixedSaleInput) {
				in.WarehouseByProduct = map[string]string{"kopi": "bar", "roti": "bakery"}
				in.PromoCode = "X"
			}, MsgMissingProductStall},
			{"promo before line discount", func(in *MixedSaleInput) {
				in.PromoCode = "X"
				in.Items = append([]Obj{{"product_id": "kopi", "unit_price": 1000, "discount_amount": 10}}, ruleItems[1:]...)
			}, MsgMixedPromoUnsupported},
			{"line discount", func(in *MixedSaleInput) {
				in.Items = append([]Obj{{"product_id": "kopi", "unit_price": 1000, "discount_amount": 10}}, ruleItems[1:]...)
			}, MsgMixedLineDiscountUnsupported},
			{"NFC tender", func(in *MixedSaleInput) { in.PaymentMethod = "nfc_tab" }, MsgMixedNfcGiftUnsupported},
			{"gift tender", func(in *MixedSaleInput) { in.PaymentMethod = "gift_card" }, MsgMixedNfcGiftUnsupported},
			{"insufficient cash", func(in *MixedSaleInput) { in.AmountPaid = json.Number("1000") }, "Payment insufficient"},
			{"ARK needs customer", func(in *MixedSaleInput) {
				in.PaymentMethod = "ark_coin"
				in.ArkCoinsUsed = json.Number("84000")
			}, "Pembayaran ARK Coin membutuhkan customer"},
		}
		for _, c := range cases {
			_, err := PlanMixedSale(ruleInput(c.mod))
			if !isCheckoutError(err, c.want) {
				t.Errorf("%s: err = %v, want %q", c.name, err, c.want)
			}
		}
	})

	t.Run("full ARK payment", func(t *testing.T) {
		plan, err := PlanMixedSale(ruleInput(func(in *MixedSaleInput) {
			in.PaymentMethod = "ark_coin"
			in.CustomerID = "c1"
			in.ArkCoinsUsed = json.Number("84000")
		}))
		if err != nil || plan.PaymentStatus != "paid" || plan.ArkUsed != 84000 || plan.ChangeAmount != 0 {
			t.Errorf("plan=%+v err=%v", plan, err)
		}
	})

	t.Run("transaction discount split, not rejected", func(t *testing.T) {
		plan, err := PlanMixedSale(ruleInput(func(in *MixedSaleInput) {
			in.DiscountAmount = "8400"
			in.ServiceChargeAmount = json.Number("1000")
			in.OtherChargesAmount = json.Number("500")
			in.AmountPaid = json.Number("77100")
		}))
		if err != nil || plan.ServerTotal != 84000-8400+1000+500 || plan.DiscountAmount != 8400 {
			t.Errorf("plan=%+v err=%v", plan, err)
		}
	})
}

func isCheckoutError(err error, msg string) bool {
	var ce *CheckoutError
	return errors.As(err, &ce) && ce.Status == 400 && ce.Message == msg
}

func assertCheckoutError(t *testing.T, err error, msg string) {
	t.Helper()
	if !isCheckoutError(err, msg) {
		t.Errorf("err = %v, want 400 %q", err, msg)
	}
}

func TestSnapshotFromInput(t *testing.T) {
	in := ruleInput(func(in *MixedSaleInput) {
		in.GuestCount = "3"
		in.ChargesBreakdown = []any{map[string]any{"name": "svc"}}
		in.ServerID = "srv"
		in.Notes = "n"
	})
	lines := BuildLines(in.Items, in.WarehouseByProduct)
	snap := SnapshotFromInput(in, lines)
	if snap["orderType"] != "dine_in" || snap["guestCount"] != 3 || snap["notes"] != "n" || snap["specialRequests"] != nil ||
		snap["serverId"] != "srv" || snap["discountReason"] != nil || snap["cashierId"] != "kasir" || snap["sessionUserId"] != "user" {
		t.Errorf("snapshot = %v", snap)
	}
	if got, _ := snap["chargesBreakdown"].([]any); len(got) != 1 {
		t.Errorf("chargesBreakdown = %v", snap["chargesBreakdown"])
	}
	items := SnapshotItems(snap)
	if len(items) != 3 {
		t.Fatalf("items = %v", items)
	}
	first := items[0]
	if first["warehouse_id"] != "bar" || first["warehouseId"] != "bar" || first["qty"] != 2.0 || first["unitPrice"] != 20000.0 ||
		first["lineSubtotal"] != 40000.0 || first["lineDiscount"] != 0.0 || first["lineTotal"] != 40000.0 || first["product_id"] != "kopi" {
		t.Errorf("first snapshot item = %v", first)
	}

	bare := SnapshotFromInput(MixedSaleInput{OrderType: "takeaway", ChargesBreakdown: "x"}, nil)
	if bare["orderType"] != "takeaway" || bare["guestCount"] != 1 || bare["serverId"] != nil {
		t.Errorf("bare snapshot = %v", bare)
	}
	if got, ok := bare["chargesBreakdown"].([]any); !ok || len(got) != 0 {
		t.Errorf("non-array chargesBreakdown must become [] , got %v", bare["chargesBreakdown"])
	}
}

func TestShouldInsertCheckoutChildren(t *testing.T) {
	cases := []struct {
		name          string
		method, state string
		paid, total   float64
		want          bool
	}{
		{"unpaid QRIS prepare", "qris", "unpaid", 0, 25000, false},
		{"paid cash", "cash", "paid", 25000, 25000, true},
		{"debit without status", "debit", "", 25000, 25000, true},
		{"QRIS underpaid", "qris", "", 1000, 25000, false},
		{"QRIS fully paid", "qris", "", 25000, 25000, true},
		{"UNPAID upper case", "cash", "UNPAID", 25000, 25000, false},
	}
	for _, c := range cases {
		if got := ShouldInsertCheckoutChildren(c.method, c.state, c.paid, c.total); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestChildOrderStatusAndSoldFrom(t *testing.T) {
	cases := []struct {
		status string
		open   bool
		want   string
	}{
		{"paid", false, "completed"},
		{"unpaid", true, "pending"},
		{"paid", true, "pending"},
		{"PAID", false, "completed"},
		{"", false, "pending"},
	}
	for _, c := range cases {
		if got := ChildOrderStatus(c.status, c.open); got != c.want {
			t.Errorf("ChildOrderStatus(%q,%v) = %q, want %q", c.status, c.open, got, c.want)
		}
	}
	if SoldFrom(true) != "central" || SoldFrom(false) != "stall" {
		t.Errorf("SoldFrom mismatch")
	}
}

func TestQrisAction(t *testing.T) {
	cases := []struct{ qr, ext, want string }{
		{"", "pos-chk-1", "lookup_external_id"},
		{"qr_1", "pos-chk-1", "reuse_qr_id"},
		{"qr_1", "", "reuse_qr_id"},
		{"", "", "create"},
	}
	for _, c := range cases {
		if got := QrisAction(c.qr, c.ext); got != c.want {
			t.Errorf("QrisAction(%q,%q) = %q, want %q", c.qr, c.ext, got, c.want)
		}
	}
}

func TestRejectUnsupportedMixedTender(t *testing.T) {
	cases := map[string]string{"nfc_tab": MsgMixedNfcGiftUnsupported, "gift_card": MsgMixedNfcGiftUnsupported, "cash": "", "qris": ""}
	for method, want := range cases {
		if got := RejectUnsupportedMixedTender(method); got != want {
			t.Errorf("RejectUnsupportedMixedTender(%q) = %q, want %q", method, got, want)
		}
	}
}

func TestResolveCheckoutBillTender(t *testing.T) {
	cases := []struct {
		name   string
		method string
		paid   *float64
		total  float64
		want   BillTender
		msg    string
	}{
		{"method required", "", nil, 27000, BillTender{}, "Metode pembayaran wajib"},
		{"blank method", "  ", ptr(27000), 27000, BillTender{}, "Metode pembayaran wajib"},
		{"amount required", "cash", nil, 27000, BillTender{}, "Nominal pembayaran wajib"},
		{"cash with change", "cash", ptr(30000), 27000, BillTender{PaymentMethod: "cash", AmountPaid: 30000, ChangeAmount: 3000}, ""},
		{"credit_card stored as credit", "credit_card", ptr(27000), 27000, BillTender{PaymentMethod: "credit", AmountPaid: 27000}, ""},
		{"qris exact", "qris", ptr(27000), 27000, BillTender{PaymentMethod: "qris", AmountPaid: 27000}, ""},
		{"debit", "debit", ptr(27000), 27000, BillTender{PaymentMethod: "debit", AmountPaid: 27000}, ""},
		{"nfc rejected", "nfc_tab", ptr(27000), 27000, BillTender{}, MsgMixedNfcGiftUnsupported},
		{"gift rejected", "gift_card", ptr(27000), 27000, BillTender{}, MsgMixedNfcGiftUnsupported},
		{"ark rejected", "ark_coin", ptr(27000), 27000, BillTender{}, MsgMixedArkUnsupported},
		{"unknown method", "bitcoin", ptr(27000), 27000, BillTender{}, "Metode pembayaran tidak didukung untuk tagihan checkout"},
		{"underpaid", "cash", ptr(1000), 27000, BillTender{}, "Nominal tunai kurang dari total tagihan"},
		{"trimmed method", " cash ", ptr(27000), 27000, BillTender{PaymentMethod: "cash", AmountPaid: 27000}, ""},
	}
	for _, c := range cases {
		got, msg := ResolveCheckoutBillTender(c.method, c.paid, c.total)
		if got != c.want || msg != c.msg {
			t.Errorf("%s: got %+v %q, want %+v %q", c.name, got, msg, c.want, c.msg)
		}
	}
}

func TestAssertCheckoutQrisReady(t *testing.T) {
	if got := AssertCheckoutQrisReady("", "", false); got != MsgCheckoutQrisMissing {
		t.Errorf("no QR = %q", got)
	}
	if got := AssertCheckoutQrisReady("qr_1", "pos-chk-1", false); got != MsgCheckoutQrisUnpaid {
		t.Errorf("unpaid QR = %q", got)
	}
	if got := AssertCheckoutQrisReady("qr_1", "pos-chk-1", true); got != "" {
		t.Errorf("paid QR = %q", got)
	}
	if got := AssertCheckoutQrisReady("", "pos-chk-1", true); got != "" {
		t.Errorf("external id only = %q", got)
	}
}

func TestCanCancelChildlessCheckout(t *testing.T) {
	cases := []struct {
		name     string
		status   string
		children int
		notes    string
		want     string
	}{
		{"unpaid childless", "unpaid", 0, "", ""},
		{"unpaid with children", "unpaid", 2, "", MsgCheckoutCancelHasChildren},
		{"paid", "paid", 0, "", MsgCheckoutCancelPaid},
		{"missing status is unpaid", "", 0, "", ""},
		{"already cancelled is idempotent", "paid", 3, "cancelled", ""},
		{"PAID upper case", "PAID", 0, "", MsgCheckoutCancelPaid},
	}
	for _, c := range cases {
		if got := CanCancelChildlessCheckout(c.status, c.children, c.notes); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
	if !IsCancelledCheckout(CheckoutCancelledNote) || IsCancelledCheckout("") || !IsCancelledCheckout("  Cancelled by kasir") {
		t.Errorf("IsCancelledCheckout mismatch")
	}
}

func TestCompleteTender(t *testing.T) {
	cases := []struct {
		name          string
		method        string
		paid          *float64
		stored        string
		total         float64
		wantMethod    string
		wantAmountPay float64
	}{
		{"stored QRIS tender", "", nil, "qris", 45000, "qris", 45000},
		{"explicit cashier tender wins", "cash", ptr(50000), "qris", 45000, "cash", 50000},
		{"nothing stored", "", nil, "", 1000, "", 1000},
		{"trimmed stored", "", nil, " qris ", 1000, "qris", 1000},
		// String(tender.paymentMethod || stored).trim(): a blank but truthy
		// tender method does not fall back to the stored method.
		{"blank tender method", "  ", nil, "qris", 1000, "", 1000},
	}
	for _, c := range cases {
		m, amt := CompleteTender(c.method, c.paid, c.stored, c.total)
		if m != c.wantMethod || amt != c.wantAmountPay {
			t.Errorf("%s: got (%q, %v), want (%q, %v)", c.name, m, amt, c.wantMethod, c.wantAmountPay)
		}
	}
}

// guest-count.test.ts
func TestNormalizeGuestCount(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want int
	}{
		{"undefined", Undefined{}, 1},
		{"null", nil, 1},
		{"empty", "", 1},
		{"blank", "   ", 1},
		{"number", json.Number("4"), 4},
		{"string", "6", 6},
		{"padded string", " 8 ", 8},
		{"zero", json.Number("0"), 1},
		{"negative", json.Number("-3"), 1},
		{"zero string", "0", 1},
		{"decimal floors", json.Number("2.9"), 2},
		{"decimal string floors", "3.7", 3},
		{"floors to zero", json.Number("0.4"), 1},
		{"words", "dua orang", 1},
		{"object", map[string]any{}, 1},
		{"Infinity", "Infinity", 1},
		{"cap", json.Number("500"), 500},
		{"over cap", json.Number("1000"), 500},
		{"over cap string", "99999", 500},
		{"true", true, 1},
		{"array", []any{json.Number("5")}, 5},
	}
	for _, c := range cases {
		if got := NormalizeGuestCount(c.in); got != c.want {
			t.Errorf("NormalizeGuestCount(%s) = %d, want %d", c.name, got, c.want)
		}
	}
}

func TestAllocateSliceCharges(t *testing.T) {
	slices := []StallSlice{{WarehouseID: "w-a", Subtotal: 20000}, {WarehouseID: "w-b", Subtotal: 10000}}
	got := AllocateSliceCharges(slices, 3000, 2700, 0, 0)
	if got[0].WarehouseID != "w-a" || got[0].Total+got[1].Total != 29700 || got[0].Discount != 2000 || got[1].Tax != 900 {
		t.Errorf("AllocateSliceCharges = %+v", got)
	}
}
