package adapters

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/testutil"
)

// newTabVisit creates a band bound to an open visit; returns band uid and visit id.
func newTabVisit(t *testing.T, tx pgx.Tx, mode string, creditLimit any) (string, string) {
	t.Helper()
	sfx := testutil.RandomHex(4)
	product := mustID(t, tx, `INSERT INTO ticketing.ticket_products (company_id, branch_id, code, name) VALUES ($1, $2, $3, 'Tiket') RETURNING id::text`, seedCompany, seedBranch, "TP-"+sfx)
	variant := mustID(t, tx, `INSERT INTO ticketing.ticket_product_variants (company_id, branch_id, ticket_product_id, code, name) VALUES ($1, $2, $3, $4, 'Dewasa') RETURNING id::text`, seedCompany, seedBranch, product, "TV-"+sfx)
	uid := strings.ToUpper("AB" + sfx + "CD")
	band := mustID(t, tx, `INSERT INTO ticketing.ticket_bands (company_id, branch_id, nfc_uid, status) VALUES ($1, $2, $3, 'dipakai') RETURNING id::text`, seedCompany, seedBranch, uid)
	visit := mustID(t, tx, `INSERT INTO ticketing.ticket_visits (company_id, branch_id, contact_name, payment_mode, credit_limit) VALUES ($1, $2, 'Andi', $3, $4) RETURNING id::text`, seedCompany, seedBranch, mode, creditLimit)
	mustExec(t, tx, `INSERT INTO ticketing.ticket_visit_bands (company_id, branch_id, visit_id, band_id, variant_id) VALUES ($1, $2, $3, $4, $5)`, seedCompany, seedBranch, visit, band, variant)
	return uid, visit
}

func TestTabsChargeAndVoid(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	tabs := Tabs{}
	uid, visit := newTabVisit(t, tx, "postpaid", 100000)
	order := newOrder(t, tx, nil)
	charge := func(o, band string, amount float64) ports.TabOutcome {
		out, err := tabs.Charge(ctx, tx, ports.TabCharge{OrderID: o, OrderNumber: "A-7", Amount: amount, BandUID: band, CompanyID: seedCompany, BranchID: seedBranch})
		if err != nil {
			t.Fatal(err)
		}
		return out
	}

	if out := charge(order, "FFFFFFFF", 1000); out.Status != 404 || out.Reason != "Gelang tidak terikat kunjungan aktif — daftar di loket dulu" {
		t.Fatalf("unknown band = %+v", out)
	}
	if out := charge(order, uid, 150000); out.Status != 402 || out.Reason != "Melewati plafon tagihan Rp100.000 — silakan bayar parsial di kasir" {
		t.Fatalf("limit = %+v", out)
	}
	// Lower-case uid with separators normalizes to the stored one.
	if out := charge(order, "ab:"+strings.ToLower(uid[2:]), 60000); !out.OK {
		t.Fatalf("charge = %+v", out)
	}
	var desc, amount string
	_ = tx.QueryRow(ctx, `SELECT description, amount::text FROM ticketing.ticket_visit_charges WHERE pos_order_id = $1`, order).Scan(&desc, &amount)
	if desc != "F&B Order A-7" || amount != "60000.00" {
		t.Fatalf("row = %q %s", desc, amount)
	}
	if out := charge(order, uid, 1000); out.Status != 409 || out.Reason != "Order ini sudah ter-charge ke tab" {
		t.Fatalf("dup = %+v", out)
	}
	if out := charge(newOrder(t, tx, nil), uid, 0); out.Status != 402 || out.Reason != "Nominal charge harus > 0" {
		t.Fatalf("zero = %+v", out)
	}

	if ok, err := tabs.Void(ctx, tx, order, "salah input", ""); !ok || err != nil {
		t.Fatalf("void = %v %v", ok, err)
	}
	if ok, _ := tabs.Void(ctx, tx, order, "salah input", ""); !ok {
		t.Fatal("second void")
	}
	var n int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM ticketing.ticket_visit_charges WHERE visit_id = $1 AND charge_type = 'koreksi'
		AND description = 'Void POS: F&B Order A-7 — salah input' AND amount = 60000`, visit).Scan(&n)
	if n != 1 {
		t.Fatalf("koreksi rows = %d", n)
	}
	if ok, _ := tabs.Void(ctx, tx, newOrder(t, tx, nil), "x", ""); ok {
		t.Fatal("void without charge")
	}

	mustExec(t, tx, `UPDATE ticketing.ticket_visits SET status = 'settled' WHERE id = $1`, visit)
	if out := charge(newOrder(t, tx, nil), uid, 1000); out.Status != 409 || out.Reason != "Kunjungan sudah ditutup — tidak bisa menerima charge" {
		t.Fatalf("closed = %+v", out)
	}
}

func TestTabsPrepaid(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	uid, visit := newTabVisit(t, tx, "prepaid", nil)
	mustExec(t, tx, `INSERT INTO ticketing.ticket_visit_charges (company_id, branch_id, visit_id, charge_type, direction, description, amount)
		VALUES ($1, $2, $3, 'deposit', 'kredit', 'Deposit', 50000)`, seedCompany, seedBranch, visit)
	out, err := Tabs{}.Charge(ctx, tx, ports.TabCharge{OrderID: newOrder(t, tx, nil), OrderNumber: "B-1", Amount: 50000.4, BandUID: uid, CompanyID: seedCompany, BranchID: seedBranch})
	if err != nil || out.Status != 402 || out.Reason != "Saldo tidak cukup (saldo Rp50.000) — silakan top-up dulu" {
		t.Fatalf("prepaid = %+v %v", out, err)
	}
}

func TestCanCharge(t *testing.T) {
	s := computeTabSummary([]float64{10.005, 20}, []float64{5})
	if s.Debit != 30.01 || s.Kredit != 5 || s.Outstanding != 25.01 || s.Saldo != -25.01 {
		t.Fatalf("summary = %+v", s)
	}
	limit := 30.0
	if canCharge("postpaid", s, 4.99, &limit) != "" || canCharge("postpaid", s, 5, &limit) == "" || canCharge("postpaid", s, 1e9, nil) != "" {
		t.Fatal("postpaid guard")
	}
}
