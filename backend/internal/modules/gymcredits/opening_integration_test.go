package gymcredits

import (
	"bytes"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

func TestOpeningBalanceCommand(t *testing.T) {
	e := setup(t)
	org := testutil.CreateOrg(t, e.tx)
	c := e.member.CustomerID
	pkg := e.pkg("Go Opening", 3, 100_000, 60, nil)

	// A sale from before the journals: no sale event, a deduction that
	// never recorded its lot.
	legacy := e.sell(pkg, &org.BranchID)
	lot := e.lotOf(legacy.ID)
	e.exec(`DELETE FROM platform.outbox_events WHERE key = 'GYM_SALE_CASH:' || $1::text`, legacy.ID)
	var used string
	e.scalar(&used, `INSERT INTO gym.credit_ledger (customer_id, type, amount, source_type, idempotency_key)
		VALUES ($1, 'class_deduction', -1, 'class_booking', 'go-opening-legacy') RETURNING id::text`, c)
	// A sale with its journal is left alone.
	current := e.sell(pkg, &org.BranchID)

	var out bytes.Buffer
	if err := RunOpeningBalance(e.ctx, e.tx, OpeningOptions{DryRun: true, Now: e.svc.clock(), Out: &out}); err != nil {
		t.Fatal(err)
	}
	var pinned *string
	e.scalar(&pinned, `SELECT lot_id::text FROM gym.credit_ledger WHERE id = $1`, used)
	var opened int
	e.scalar(&opened, `SELECT count(*) FROM gym.credit_purchases WHERE opening_batch_id IS NOT NULL AND id IN ($1, $2)`, legacy.ID, current.ID)
	if pinned != nil || opened != 0 || !strings.Contains(out.String(), legacy.ID) || strings.Contains(out.String(), current.ID) {
		t.Fatalf("dry run wrote something, or listed the wrong purchases:\n%s", out.String())
	}

	out.Reset()
	if err := RunOpeningBalance(e.ctx, e.tx, OpeningOptions{UserID: e.staff.UserID, Now: e.svc.clock(), Out: &out}); err != nil {
		t.Fatal(err)
	}
	e.scalar(&pinned, `SELECT lot_id::text FROM gym.credit_ledger WHERE id = $1`, used)
	if pinned == nil || *pinned != lot {
		t.Fatalf("legacy deduction pinned to %v, want %s", pinned, lot)
	}
	var batch *string
	e.scalar(&batch, `SELECT opening_batch_id::text FROM gym.credit_purchases WHERE id = $1`, legacy.ID)
	if batch == nil {
		t.Fatal("the legacy purchase was not marked opened")
	}
	// Two unused credits of three at 100,000: 66,666.67.
	if j := e.journals(*batch)["GYM_OPENING_BALANCE"]; j.Amount != 66_666.67 || j.CompanyID == nil || *j.CompanyID != org.CompanyID || j.UserID != e.staff.UserID {
		t.Fatalf("opening journal %+v", j)
	}
	e.scalar(&opened, `SELECT count(*) FROM gym.credit_purchases WHERE opening_batch_id IS NOT NULL AND id = $1`, current.ID)
	if opened != 0 {
		t.Fatal("a purchase with a sale journal must not be opened")
	}

	// A second run finds nothing to open.
	out.Reset()
	if err := RunOpeningBalance(e.ctx, e.tx, OpeningOptions{Now: e.svc.clock(), Out: &out}); err != nil {
		t.Fatal(err)
	}
	var events int
	e.scalar(&events, `SELECT count(*) FROM platform.outbox_events WHERE payload->>'event_code' = 'GYM_OPENING_BALANCE'`)
	if events != 1 {
		t.Fatalf("%d opening journals after a second run", events)
	}
	// The next credit used is the lot's second: 33,333.34.
	if j := e.journals(e.deductOne(c, "go-opening-after"))["GYM_CREDIT_USAGE"]; j.Amount != 33_333.34 {
		t.Fatalf("usage after opening %+v", j)
	}
}
