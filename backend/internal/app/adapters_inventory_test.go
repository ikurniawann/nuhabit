package app

import (
	"context"
	"testing"

	"nuhabit/backend/internal/modules/inventory/production"
	"nuhabit/backend/internal/platform/testutil"
)

// The COGS receipts adapter reads procurement's GRN and PO lines; this checks
// its SQL against the schema inside a rolled-back transaction.
func TestInventoryReceiptsAdapter(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	id := func(sql string, args ...any) string {
		t.Helper()
		var v string
		if err := tx.QueryRow(ctx, sql, args...).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return v
	}
	suffix := testutil.RandomHex(3)
	supplier := id(`INSERT INTO purchasing.suppliers (kode, nama_supplier) VALUES ('GS'||$1, 'Go Supplier') RETURNING id::text`, suffix)
	rice := id(`INSERT INTO item.raw_materials (kode, nama, kategori) VALUES ('GR'||$1, 'Beras', 'bahan') RETURNING id::text`, suffix)
	sugar := id(`INSERT INTO item.raw_materials (kode, nama, kategori) VALUES ('GG'||$1, 'Gula', 'bahan') RETURNING id::text`, suffix)
	po := id(`INSERT INTO purchasing.purchase_orders (nomor_po, supplier_id, status) VALUES ('PO-GO-'||$1, $2, 'partially_received') RETURNING id::text`, suffix, supplier)
	riceLine := id(`INSERT INTO purchasing.purchase_order_items (purchase_order_id, raw_material_id, qty_ordered, harga_satuan)
		VALUES ($1, $2, 20, 12000) RETURNING id::text`, po, rice)
	sugarLine := id(`INSERT INTO purchasing.purchase_order_items (purchase_order_id, raw_material_id, qty_ordered, harga_satuan)
		VALUES ($1, $2, 10, 15000) RETURNING id::text`, po, sugar)
	grn := id(`INSERT INTO purchasing.grn (nomor_grn, purchase_order_id, supplier_id) VALUES ('GRN-GO-'||$1, $2, $3) RETURNING id::text`, suffix, po, supplier)
	for _, l := range [][]any{{riceLine, rice, 10}, {sugarLine, sugar, 4}} {
		if _, err := tx.Exec(ctx, `INSERT INTO purchasing.grn_items (grn_id, purchase_order_item_id, raw_material_id, qty_diterima)
			VALUES ($1, $2, $3, $4)`, grn, l[0], l[1], l[2]); err != nil {
			t.Fatal(err)
		}
	}

	receipts := inventoryReceipts{}
	lines, totals, err := receipts.ReceivedValues(ctx, tx, []string{rice})
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 1 || lines[0].GrnID != grn || lines[0].PoID != po || lines[0].MaterialID != rice || lines[0].Value != 120000 {
		t.Fatalf("lines %+v", lines)
	}
	// Document totals cover every received line, sugar included.
	if len(totals) != 2 || totals["GRN:"+grn] != 180000 || totals["PO:"+po] != 180000 {
		t.Fatalf("totals %v", totals)
	}
	numbers, err := receipts.DocumentNumbers(ctx, tx, []production.DocRef{{Type: "PO", ID: po}, {Type: "GRN", ID: grn}, {Type: "GRN", ID: po}})
	if err != nil {
		t.Fatal(err)
	}
	if len(numbers) != 2 || numbers["PO:"+po] != "PO-GO-"+suffix || numbers["GRN:"+grn] != "GRN-GO-"+suffix {
		t.Fatalf("numbers %v", numbers)
	}
}
