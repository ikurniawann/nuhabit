package cogs_test

import (
	"context"
	"net/http"
	"slices"
	"testing"

	"nuhabit/backend/internal/modules/inventory/cogs"
	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit/kittest"
	"nuhabit/backend/internal/platform/database"
)

// Integration tests on TEST_DATABASE_URL in one rolled-back transaction.

func obj(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

// fakeReceipts stands in for procurement: received lines of raw materials
// and the PO/GRN numbers (the SQL adapter is tested in internal/app).
type fakeReceipts struct {
	lines   []domain.ReceiptLine
	totals  map[string]float64
	numbers map[string]string
}

func (f fakeReceipts) ReceivedValues(_ context.Context, _ database.Querier, ids []string) ([]domain.ReceiptLine, map[string]float64, error) {
	var out []domain.ReceiptLine
	for _, l := range f.lines {
		if slices.Contains(ids, l.MaterialID) {
			out = append(out, l)
		}
	}
	return out, f.totals, nil
}

func (f fakeReceipts) DocumentNumbers(_ context.Context, _ database.Querier, refs []cogs.DocRef) (map[string]string, error) {
	out := map[string]string{}
	for _, r := range refs {
		if n, ok := f.numbers[domain.DocKey(r.Type, r.ID)]; ok {
			out[domain.DocKey(r.Type, r.ID)] = n
		}
	}
	return out, nil
}

func TestProductCogs(t *testing.T) {
	e := kittest.Setup(t, kittest.Menus, nil)
	org := e.NewOrg()
	e.ScopeStaff("branch", org)
	e.Mount(cogs.Routes(e.Env, cogs.Ports{Receipts: fakeReceipts{}}))
	kg := e.Unit("KG", "Kilogram")
	rm := e.RawMaterial(org, "RMP-"+org.BranchID[:4], "Beras", kg, "", 1)
	e.Stock(org, rm, org.MainID, 10, 12000)
	product := e.Product(org, org.Stall1ID, "PRP-"+org.BranchID[:4], "Nasi", 5000)
	e.Exec(`INSERT INTO manufacturing.bom_items (product_id, raw_material_id, qty_required, waste_factor) VALUES ($1, $2, 0.2, 0.1)`, product, rm)

	c := obj(e.Call("GET", "/api/purchasing/cogs/product/"+product, nil, http.StatusOK)["data"])
	// 0.2 × 1.1 kg at 12000 = 2640, +10% overhead.
	if c["total_bom_cost"] != 2640.0 || c["hpp_per_unit"] != 2904.0 || c["margin_label"] != "Healthy" {
		t.Fatalf("cogs %v", c)
	}
	e.Fail("GET", "/api/purchasing/cogs/product/x", nil, http.StatusBadRequest, "Invalid product ID")
}

// Freight on a GRN raises the HPP of the products made from what it brought.
func TestAdditionalCostsInCogs(t *testing.T) {
	e := kittest.Setup(t, kittest.Menus, nil)
	org := e.NewOrg()
	kg := e.Unit("KG", "Kilogram")
	rm := e.RawMaterial(org, "RML-"+org.BranchID[:4], "Beras", kg, "", 1)
	e.Stock(org, rm, org.MainID, 10, 12000)
	product := e.Product(org, org.Stall1ID, "PRL-"+org.BranchID[:4], "Nasi", 5000)
	e.Exec(`INSERT INTO manufacturing.bom_items (product_id, raw_material_id, qty_required, waste_factor) VALUES ($1, $2, 0.2, 0.1)`, product, rm)
	po, grn := e.ID(`SELECT gen_random_uuid()::text`), e.ID(`SELECT gen_random_uuid()::text`)
	receipts := fakeReceipts{
		lines:   []domain.ReceiptLine{{GrnID: grn, PoID: po, MaterialID: rm, Value: 120000}},
		totals:  map[string]float64{"GRN:" + grn: 120000, "PO:" + po: 120000},
		numbers: map[string]string{"GRN:" + grn: "GRN-GO-1", "PO:" + po: "PO-GO-1"},
	}
	e.Mount(cogs.Routes(e.Env, cogs.Ports{Receipts: receipts}))
	base := "/api/purchasing/cogs/additional-cost"

	e.Fail("POST", base, map[string]any{"reference_type": "SO", "tipe_biaya": "freight", "jumlah": 1}, http.StatusBadRequest, "Validation failed")
	e.Fail("POST", base, map[string]any{"reference_type": "PO", "reference_id": grn, "tipe_biaya": "freight", "jumlah": 1}, http.StatusNotFound, "PO tidak ditemukan")
	out := e.Call("POST", base, map[string]any{"reference_type": "GRN", "reference_id": grn, "tipe_biaya": "freight", "jumlah": 10,
		"currency": "USD", "exchange_rate": 1200, "deskripsi": "Ongkir", "tanggal_transaksi": "2026-10-03"}, http.StatusCreated)
	cost := obj(out["data"])
	if out["message"] != "Biaya tambahan berhasil ditambahkan" || cost["reference_number"] != "GRN-GO-1" || cost["jumlah"] != "10.00" ||
		cost["jumlah_idr"] != "12000.00" || cost["currency"] != "USD" || cost["tanggal_transaksi"] != "2026-10-03" || cost["deskripsi"] != "Ongkir" {
		t.Fatalf("create %v", out)
	}
	list := e.Call("GET", base+"?reference_type=GRN&reference_id="+grn, nil, http.StatusOK)
	if rows := list["data"].([]any); len(rows) != 1 || obj(rows[0])["id"] != cost["id"] || obj(list["pagination"])["total"] != 1.0 {
		t.Fatalf("list %v", list)
	}
	if rows := e.Call("GET", base+"?reference_type=PO&reference_id="+po, nil, http.StatusOK)["data"].([]any); len(rows) != 0 {
		t.Fatalf("PO filter %v", rows)
	}

	// 12000 freight on 120000 of rice is a 10% landed cost: 0.22 kg × 12000 × 10% = 264 per unit.
	c := obj(e.Call("GET", "/api/purchasing/cogs/product/"+product, nil, http.StatusOK)["data"])
	line := obj(c["breakdown_bahan"].([]any)[0])
	if c["total_bom_cost"] != 2640.0 || c["total_additional_cost"] != 264.0 || c["total_overhead"] != 290.4 || c["hpp_per_unit"] != 3194.4 ||
		line["additional_cost"] != 264.0 || line["landed_cost_rate"] != 10.0 {
		t.Fatalf("cogs with landed cost %v", c)
	}

	e.Call("DELETE", base+"/"+cost["id"].(string), nil, http.StatusOK)
	e.Fail("DELETE", base+"/"+cost["id"].(string), nil, http.StatusNotFound, "Biaya tambahan tidak ditemukan")
	if c := obj(e.Call("GET", "/api/purchasing/cogs/product/"+product, nil, http.StatusOK)["data"]); c["hpp_per_unit"] != 2904.0 || c["total_additional_cost"] != 0.0 {
		t.Fatalf("cogs after delete %v", c)
	}
}
