package domain

import (
	"strings"
	"testing"
)

func sp(s string) *string   { return &s }
func fp(f float64) *float64 { return &f }

var receivePoItems = []PoItemForReceive{
	{ID: "poi-rm", RawMaterialID: "rm-1", QtyOrdered: 10, QtyReceived: 4, Label: "Gula"},
	{ID: "poi-p1", ProductID: "prod-1", PosSkuID: sp("sku-1"), QtyOrdered: 5},
	{ID: "poi-p2", ProductID: "prod-1", PosSkuID: sp("sku-2"), QtyOrdered: 5},
	{ID: "poi-sup", SupplyItemID: "sup-1", QtyOrdered: 3},
}

func TestGrnLineKeyAndQc(t *testing.T) {
	if (ReceiveLine{PurchaseOrderItemID: "poi", RawMaterialID: "rm"}).LineKey() != "poi" ||
		(ReceiveLine{ProductID: "p"}).LineKey() != "p" || (ReceiveLine{SupplyItemID: "s"}).LineKey() != "s" || (ReceiveLine{}).LineKey() != "" {
		t.Fatal("LineKey")
	}
	for _, c := range []struct {
		accepted, rejected *float64
		wantA, wantR       float64
	}{{nil, nil, 5, 0}, {fp(3), nil, 3, 2}, {fp(3), fp(1), 3, 1}} {
		if a, r := NormalizeQc(5, c.accepted, c.rejected); a != c.wantA || r != c.wantR {
			t.Fatalf("NormalizeQc = %v %v", a, r)
		}
	}
	if RemainingPoQty(receivePoItems[0]) != 6 || RemainingPoQty(receivePoItems[3]) != 3 || RemainingPoQty(PoItemForReceive{QtyOrdered: 1, QtyReceived: 4}) != 0 {
		t.Fatal("RemainingPoQty")
	}
}

func TestFindPoItemForLine(t *testing.T) {
	for line, want := range map[ReceiveLine]string{{PurchaseOrderItemID: "poi-p2"}: "poi-p2", {RawMaterialID: "rm-1"}: "poi-rm", {SupplyItemID: "sup-1"}: "poi-sup"} {
		if p, err := FindPoItemForLine(line, receivePoItems); err != nil || p.ID != want {
			t.Fatalf("%+v: %v %v", line, p.ID, err)
		}
	}
	if _, err := FindPoItemForLine(ReceiveLine{ProductID: "prod-1"}, receivePoItems); err == nil || err.Error() != "Item PO ber-varian harus dirujuk lewat purchase_order_item_id" {
		t.Fatal(err)
	}
	if _, err := FindPoItemForLine(ReceiveLine{RawMaterialID: "missing"}, receivePoItems); err == nil {
		t.Fatal("missing")
	}
}

func TestValidateReceiveLines(t *testing.T) {
	skus, err := ValidateReceiveLines([]ReceiveLine{
		{RawMaterialID: "rm-1", QtyDiterima: 6},
		{PurchaseOrderItemID: "poi-p2", ProductID: "prod-1", QtyDiterima: 5},
	}, receivePoItems)
	if err != nil || skus[0] != nil || *skus[1] != "sku-2" {
		t.Fatalf("skus = %v %v", skus, err)
	}
	_, err = ValidateReceiveLines([]ReceiveLine{{RawMaterialID: "rm-1", QtyDiterima: 4}, {RawMaterialID: "rm-1", QtyDiterima: 2, QtyDitolak: 1}}, receivePoItems)
	if err == nil || err.Error() != "Qty Gula melebihi sisa PO. Maksimal 6, tetapi diinput 7 (diterima + ditolak)." {
		t.Fatal(err)
	}
	if _, err := ValidateReceiveLines([]ReceiveLine{{PurchaseOrderItemID: "poi-p1", ProductID: "prod-1", PosSkuID: sp("sku-2"), QtyDiterima: 1}}, receivePoItems); err == nil || err.Error() != "SKU tidak sesuai item PO" {
		t.Fatal(err)
	}
}

func TestValidateAdditionalReceive(t *testing.T) {
	existing := map[string]ExistingGrnQty{"poi-rm": {QtyDiterima: 4}}
	if err := ValidateAdditionalReceive([]ReceiveLine{{PurchaseOrderItemID: "poi-rm", RawMaterialID: "rm-1", QtyDiterima: 10}}, receivePoItems, existing); err != nil {
		t.Fatal(err)
	}
	err := ValidateAdditionalReceive([]ReceiveLine{{PurchaseOrderItemID: "poi-rm", RawMaterialID: "rm-1", QtyDiterima: 10.5}}, receivePoItems, existing)
	if err == nil || !strings.Contains(err.Error(), "Maksimal 6 untuk penerimaan tambahan, tetapi diinput 6,5") {
		t.Fatal(err)
	}
}

func TestGrnStatuses(t *testing.T) {
	if StatusFromLines([]ReceiveLine{{QtyDitolak: 2}}) != GrnRejected || StatusFromLines([]ReceiveLine{{QtyDiterima: 1, QtyDitolak: 2}}) != GrnPending ||
		StatusFromLines([]ReceiveLine{{}}) != "" {
		t.Fatal("StatusFromLines")
	}
	if InitialGrnStatus("general", 3, 0) != GrnReceived || InitialGrnStatus("raw_material", 3, 0) != GrnPending ||
		InitialGrnStatus("product", 3, 0) != GrnPending || InitialGrnStatus("general", 0, 2) != GrnRejected {
		t.Fatal("InitialGrnStatus")
	}
	if GrnCreatedMessage("GRN-1", "rejected", "raw_material", nil) != "GRN GRN-1 berhasil dibuat — semua item ditolak" ||
		GrnCreatedMessage("GRN-1", "received", "general", sp("jurnal")) != "GRN GRN-1 berhasil dibuat (jurnal)" ||
		GrnCreatedMessage("GRN-1", "received", "product", nil) != "GRN GRN-1 berhasil dibuat — QC selesai dan stok sudah diperbarui" {
		t.Fatal("GrnCreatedMessage")
	}
	if GrnTransitionError("pending", "received") != "" || GrnTransitionError("received", "pending") != "Invalid GRN transition: received → pending" {
		t.Fatal("transitions")
	}
	if QcOverallStatus([]float64{0}, []float64{2}) != "rejected" || QcOverallStatus([]float64{3}, []float64{1}) != "partial" || QcOverallStatus([]float64{3}, []float64{0}) != "approved" {
		t.Fatal("QcOverallStatus")
	}
	if QcItemStatus(0, 1) != "rejected" || QcItemStatus(2, 1) != "partially_rejected" || QcItemStatus(2, 0) != "accepted" {
		t.Fatal("QcItemStatus")
	}
	if GrnItemReceivedQty(10, 7, "received", true) != 7 || GrnItemReceivedQty(10, 0, "pending", false) != 0 || GrnItemReceivedQty(5, 0, "received", false) != 5 {
		t.Fatal("GrnItemReceivedQty")
	}
	if PoStatusFromReceipts(10, 0) != PoSent || PoStatusFromReceipts(10, 10) != PoReceived || PoStatusFromReceipts(10, 3) != PoPartiallyReceived {
		t.Fatal("PoStatusFromReceipts")
	}
	if DeliveryStatusAfterGrn(GrnRejected) != DeliveryCancelled || DeliveryStatusAfterGrn(GrnPending) != "" {
		t.Fatal("DeliveryStatusAfterGrn")
	}
}

func TestGrnHelpers(t *testing.T) {
	if d := DefaultExpiryDate("2026-10-04", fp(30.7)); d == nil || *d != "2026-11-03" {
		t.Fatal(d)
	}
	if DefaultExpiryDate("2026-10-04", nil) != nil || DefaultExpiryDate("2026-10-04", fp(0)) != nil {
		t.Fatal("no shelf life")
	}
	if PackToBase(7, 1000) != 7000 || PackToBase(1.23456, 1) != 1.235 || PackPriceToBase(1000, 3) != 333.33 || PackPriceToBase(5, 0) != 5 {
		t.Fatal("packs")
	}
	for v, want := range map[float64]string{1234567.5: "1.234.567,5", 6: "6", 6.5: "6,5", 0.12345: "0,1235", -1000: "-1.000"} {
		if got := FormatNumberID(v, 4); got != want {
			t.Fatalf("FormatNumberID(%v) = %q", v, got)
		}
	}
	if DeliveryTransitionError("pending", "shipped") != "" || DeliveryTransitionError("delivered", "cancelled") != "Invalid delivery transition: delivered → cancelled. Allowed: none" {
		t.Fatal("delivery transitions")
	}
	if !IsOpenDeliveryStatus("IN_TRANSIT") || IsOpenDeliveryStatus("delivered") || !IsPoStatusEligibleForDelivery("Sent") {
		t.Fatal("delivery status")
	}
}
