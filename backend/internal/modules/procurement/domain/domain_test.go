package domain

import (
	"encoding/json"
	"testing"
	"time"
)

func TestPrAccessRules(t *testing.T) {
	if !CanEditPrOf("u1", "u1", "cashier") || !CanEditPrOf("u1", "u2", "purchasing_admin") || CanEditPrOf("u1", "u2", "purchasing_staff") {
		t.Fatal("CanEditPrOf")
	}
	if !IsAwaitingPrApproval("pending_head") || IsAwaitingPrApproval("pending_finance") {
		t.Fatal("IsAwaitingPrApproval")
	}
	po := "po-1"
	cases := []struct {
		status, requester string
		converted         *string
		grant             bool
		want              PrPermissions
	}{
		{"approved", "u1", nil, true, PrPermissions{CanCreatePO: true}},
		{"approved", "u1", &po, false, PrPermissions{}},
		{"draft", "u2", nil, false, PrPermissions{CanEdit: true}},
		{"pending_head", "u1", nil, true, PrPermissions{CanApprove: true}},
		{"pending_head", "u1", nil, false, PrPermissions{}},
	}
	for _, c := range cases {
		if got := BuildPrPermissions(c.status, c.requester, c.converted, "u2", "purchasing_staff", c.grant); got != c.want {
			t.Fatalf("%+v: got %+v", c, got)
		}
	}
	if !SeesOnlyOwnPrs("hiring_manager") || SeesOnlyOwnPrs("admin") {
		t.Fatal("SeesOnlyOwnPrs")
	}
}

func TestPrAmounts(t *testing.T) {
	line := NormalizePrLine(2.4, 1500.555)
	if line.Qty != 2 || line.EstimatedPrice != 1500.56 || line.Total != 3001.12 {
		t.Fatalf("line = %+v", line)
	}
	if l := NormalizePrLine(0, -5); l.Qty != 1 || l.EstimatedPrice != 0 {
		t.Fatalf("clamped = %+v", l)
	}
	if SumPrTotal([]PrLine{{Total: MaxNumeric152}, {Total: 1}}) != MaxNumeric152 {
		t.Fatal("total clamp")
	}
	if NextPrStatus("submit") != PrPendingHead || NextPrStatus("draft") != PrDraft {
		t.Fatal("NextPrStatus")
	}
	if *ApprovalLevelFor(PrPendingHead) != "head_dept" || ApprovalLevelFor(PrDraft) != nil {
		t.Fatal("ApprovalLevelFor")
	}
}

func TestParseLocaleNumber(t *testing.T) {
	cases := []struct {
		in   any
		want float64
		ok   bool
	}{
		{"1.500.000,50", 1500000.5, true},
		{"15.000", 15000, true},
		{"287985.600000", 287985.6, true},
		{"1.5", 1.5, true},
		{"-2.000", -2000, true},
		{"Rp 2.500", 2500, true},
		{"", 0, false},
		{"abc", 0, false},
		{",", 0, false},
		{json.Number("12.5"), 12.5, true},
		{true, 0, false},
	}
	for _, c := range cases {
		got, ok := ParseLocaleNumber(c.in)
		if ok != c.ok || got != c.want {
			t.Fatalf("ParseLocaleNumber(%v) = %v, %v", c.in, got, ok)
		}
	}
}

func TestMapPrPgErrorMessage(t *testing.T) {
	if MapPrPgErrorMessage(`insert or update on table "pr_items" violates foreign key constraint "pr_items_raw_material_id_fkey"`) != "Bahan baku pada item PR tidak valid." {
		t.Fatal("raw material fk")
	}
	if MapPrPgErrorMessage("numeric field overflow") != "Nilai qty atau harga estimasi terlalu besar. Periksa kembali angka pada item PR." {
		t.Fatal("overflow")
	}
	if MapPrPgErrorMessage("other") != "other" {
		t.Fatal("passthrough")
	}
}

func TestDocumentNumbers(t *testing.T) {
	now := time.Date(2026, 10, 4, 9, 0, 0, 0, time.UTC)
	if DailyPrefix("PR", now) != "PR-20261004" || MonthlyPrefix("PO", now) != "PO-202610" {
		t.Fatal("prefix")
	}
	last := "PO-202610-0041"
	if NextDocumentNumber("PO-202610", nil) != "PO-202610-0001" || NextDocumentNumber("PO-202610", &last) != "PO-202610-0042" {
		t.Fatal("next number")
	}
}

func TestPoTotals(t *testing.T) {
	if SumPoLines([]PoLine{{Qty: 2, Price: 15000, Discount: 1000}, {Qty: 3, Price: 5000}}) != 44000 {
		t.Fatal("SumPoLines")
	}
	got := ComputePoTotals(100000, Ptr(10.0), Ptr(5000.0), nil)
	if got != (PoTotals{Subtotal: 100000, DiskonNominal: 10000, PpnNominal: 9900, Total: 99900}) {
		t.Fatalf("percent discount, default PPN: %+v", got)
	}
	got = ComputePoTotals(10000, Ptr(0.0), Ptr(15000.0), Ptr(11.0))
	if got != (PoTotals{Subtotal: 10000, DiskonNominal: 15000, PpnNominal: 0, Total: 0}) {
		t.Fatalf("nominal discount floor: %+v", got)
	}
	// PPN 0% stays 0% (only a missing rate defaults to 11%).
	if got := ComputePoTotals(200000, Ptr(5.0), nil, Ptr(0.0)); got.Total != 190000 || got.PpnNominal != 0 {
		t.Fatalf("zero PPN: %+v", got)
	}
}

func TestPoStateMachine(t *testing.T) {
	if NormalizePoStatus("partial") != PoPartiallyReceived {
		t.Fatal("normalize")
	}
	if !CanTransitionPo("partially_received", PoClosed) || !CanTransitionPo("partial", PoClosed) || CanTransitionPo("sent", PoClosed) {
		t.Fatal("close transitions")
	}
	if PoTransitionError("sent", PoClosed) != "Invalid state transition: sent → closed. Allowed: partially_received, received, cancelled" {
		t.Fatal(PoTransitionError("sent", PoClosed))
	}
	if PoTransitionError("closed", PoClosed) != "Invalid state transition: closed → closed. Allowed: none" {
		t.Fatal(PoTransitionError("closed", PoClosed))
	}
	for _, s := range []string{"sent", "partial", "partially_received"} {
		if !HoldsOnOrderQty(s) {
			t.Fatal(s)
		}
	}
	for _, s := range []string{"draft", "approved", "received"} {
		if HoldsOnOrderQty(s) {
			t.Fatal(s)
		}
	}
	if OpenQty(10, 4) != 6 || OpenQty(3, 5) != 0 {
		t.Fatal("OpenQty")
	}
}

func TestValidatePoLinesAgainstSkus(t *testing.T) {
	skus := []SkuOwner{
		{ID: "sku-a", SourceProductID: "kaos-001", IsActive: true},
		{ID: "sku-b", SourceProductID: "kaos-001", IsActive: true},
		{ID: "sku-inactive", SourceProductID: "kaos-001"},
		{ID: "sku-other-product", SourceProductID: "kaos-002", IsActive: true},
	}
	variants := map[string]bool{"kaos-001": true, "kaos-002": true}
	line := func(product, sku string) SkuLine {
		if sku == "" {
			return SkuLine{ProductID: product}
		}
		return SkuLine{ProductID: product, PosSkuID: &sku}
	}
	cases := []struct {
		lines []SkuLine
		want  string
	}{
		{[]SkuLine{line("kaos-001", "sku-a"), line("kaos-001", "sku-b"), line("kaos-003", "")}, ""},
		{[]SkuLine{line("kaos-001", "")}, "Produk ber-varian wajib memilih SKU"},
		{[]SkuLine{line("kaos-001", "sku-other-product")}, "Varian tidak sesuai produk"},
		{[]SkuLine{line("kaos-001", "sku-inactive")}, "Varian tidak sesuai produk"},
		{[]SkuLine{line("kaos-001", "sku-does-not-exist")}, "Varian tidak sesuai produk"},
		{[]SkuLine{line("kaos-001", "sku-a"), line("kaos-001", "sku-a")}, "Baris SKU ganda"},
	}
	for i, c := range cases {
		if got := ValidatePoLinesAgainstSkus(c.lines, skus, variants); got != c.want {
			t.Fatalf("case %d: %q", i, got)
		}
	}
}

func TestInvoiceAndShortage(t *testing.T) {
	if ShortageAmount([]PoLine{{Qty: 25, Price: 1000}, {Qty: 10, Price: 500}}, []float64{17, 10}) != 8000 {
		t.Fatal("shortage")
	}
	if ShortageAmount([]PoLine{{Qty: 5, Price: 100}}, []float64{8}) != 0 {
		t.Fatal("over-received")
	}
	// An open PO still expects its remaining quantity: no credit until it closes.
	nothing := []PoLine{{Qty: 4, Price: 2500}}
	for status, want := range map[string]float64{PoSent: 0, PoPartiallyReceived: 0, PoClosed: 10000, PoCancelled: 10000} {
		if got := ShortageCredit(status, nothing, []float64{0}); got != want {
			t.Fatalf("shortage credit %s = %v, want %v", status, got, want)
		}
	}
	today := time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
	got := ComputePoInvoiceAmounts(1000, 100, 50, 300, "2026-10-01", today)
	if got.Payable != 850 || got.Outstanding != 550 || got.PaymentStatus != "partial" || got.PaymentProgress != 35.29 {
		t.Fatalf("partial: %+v", got)
	}
	if ComputePoInvoiceAmounts(1000, 0, 0, 0, "2026-10-01", today).PaymentStatus != "overdue" {
		t.Fatal("overdue")
	}
	if ComputePoInvoiceAmounts(1000, 0, 0, 0, "2026-10-04", today).PaymentStatus != "unpaid" {
		t.Fatal("due today is not overdue")
	}
	if p := ComputePoInvoiceAmounts(100, 0, 100, 0, "", today); p.PaymentStatus != "paid" || p.PaymentProgress != 100 {
		t.Fatalf("fully credited: %+v", p)
	}
	if RemainingSchedulable(1_000_000, []float64{400000, 250000, 0}) != 350000 || RemainingSchedulable(100, []float64{150}) != 0 {
		t.Fatal("schedulable")
	}
}

func TestFulfillment(t *testing.T) {
	f := ComputeFulfillment("sent", 50, 10, 5, 1)
	if f.Order != 100 || f.Receipt != 50 || f.QC != 50 || f.Return != 20 || f.Overall != 55 {
		t.Fatalf("%+v", f)
	}
	if f := ComputeFulfillment("approved", 0, 0, 0, 2); f.Order != 50 || f.Return != 100 {
		t.Fatalf("%+v", f)
	}
}

func TestPaymentTermDescriptions(t *testing.T) {
	cases := []struct {
		desc            string
		amount, payable float64
		termNo          int
		want            string
	}{
		{"Down payment", 100, 100, 2, "Paid in Full"},
		{"Payment term 3", 100, 100, 3, "Paid in Full"},
		{"Custom", 100, 100, 1, "Paid in Full"},
		{"Custom", 100, 100, 2, "Custom"},
		{"  ", 40, 100, 1, "Installment 1"},
		{"", 40, 100, 3, "Installment 3"},
		{"Termin", 40, 100, 1, "Termin"},
	}
	for _, c := range cases {
		if got := NormalizeTermDescription(c.desc, c.amount, c.payable, c.termNo); got != c.want {
			t.Fatalf("%+v: %q", c, got)
		}
	}
}

func TestPackFactor(t *testing.T) {
	m := &UnitMaterial{SatuanBesarID: "kg", SatuanKecilID: "g", KonversiFactor: 1000}
	if PackFactor(m, nil, "kg") != 1000 || PackFactor(m, nil, "g") != 1 || PackFactor(m, nil, "") != 1000 || PackFactor(m, nil, "box") != 1000 {
		t.Fatal("legacy packs")
	}
	packs := []Pack{{SatuanID: "box", QtyInBase: 24000}}
	if PackFactor(m, packs, "box") != 24000 || PackFactor(m, packs, "kg") != 1000 {
		t.Fatal("pack rows")
	}
	if PackFactor(nil, nil, "kg") != 1 || PackFactor(&UnitMaterial{SatuanBesarID: "pcs"}, nil, "pcs") != 1 {
		t.Fatal("defaults")
	}
}
