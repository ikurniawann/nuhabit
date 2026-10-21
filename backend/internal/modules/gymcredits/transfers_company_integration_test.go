package gymcredits

import (
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

func TestCrossCompanyTransferJournals(t *testing.T) {
	receiver := testutil.CreateMember(t)
	e := setup(t)
	home := testutil.CreateOrg(t, e.tx)
	away := testutil.CreateOrg(t, e.tx)
	pkg := e.pkg("Go Interco", 3, 100_000, 60, nil)
	lot := e.lotOf(e.sell(pkg, &home.BranchID).ID)

	// Inside the company nothing moves in the books.
	same, err := e.svc.Transfer(e.ctx, e.tx, TransferInput{FromCustomerID: e.member.CustomerID, ToCustomerID: receiver.CustomerID,
		Credits: 1, IdempotencyKey: "go-interco-same", Channel: TransferByStaff, ActorID: e.staff.UserID, BranchID: &home.BranchID})
	if err != nil {
		t.Fatal(err)
	}
	var count int
	e.scalar(&count, `SELECT count(*) FROM platform.outbox_events WHERE payload->>'event_code' LIKE 'GYM_TRANSFER_%'`)
	if count != 0 {
		t.Fatal("a transfer inside one company posts nothing")
	}
	var sameCompany *string
	e.scalar(&sameCompany, `SELECT company_id::text FROM gym.credit_lots WHERE source_lot_id = $1`, lot)
	if sameCompany == nil || *sameCompany != home.CompanyID {
		t.Fatalf("receiver lot company %v after %v", sameCompany, same)
	}

	// To a member served by another company: the value moves between the
	// two companies' deferred revenue, and the receiver's lot books there.
	res, err := e.svc.Transfer(e.ctx, e.tx, TransferInput{FromCustomerID: e.member.CustomerID, ToCustomerID: receiver.CustomerID,
		Credits: 1, IdempotencyKey: "go-interco-away", Channel: TransferByStaff, ActorID: e.staff.UserID, BranchID: &away.BranchID})
	if err != nil {
		t.Fatal(err)
	}
	var outID, inID, note string
	e.scalar(&outID, `SELECT id::text FROM gym.credit_ledger WHERE source_id = $1 AND type = 'transfer_out'`, res.TransferID)
	e.scalar(&inID, `SELECT id::text FROM gym.credit_ledger WHERE source_id = $1 AND type = 'transfer_in'`, res.TransferID)
	e.scalar(&note, `SELECT note FROM gym.credit_ledger WHERE id = $1`, inID)
	out, in := e.journals(outID)["GYM_TRANSFER_OUT"], e.journals(inID)["GYM_TRANSFER_IN"]
	// Second credit out of the lot: 33,333.34.
	if out.Amount != 33_333.34 || in.Amount != 33_333.34 || *out.CompanyID != home.CompanyID || *in.CompanyID != away.CompanyID {
		t.Fatalf("transfer journals out %+v in %+v", out, in)
	}
	if !strings.Contains(note, "Transfer "+res.TransferID) || !strings.Contains(note, "Rp 33.333,34") {
		t.Fatalf("ledger note %q", note)
	}
	var valueSen int64
	var company string
	e.scalar(&valueSen, `SELECT value_sen FROM gym.credit_lots l JOIN gym.credit_ledger e ON e.lot_id = l.id WHERE e.id = $1`, inID)
	e.scalar(&company, `SELECT company_id::text FROM gym.credit_lots l JOIN gym.credit_ledger e ON e.lot_id = l.id WHERE e.id = $1`, inID)
	if valueSen != 3_333_334 || company != away.CompanyID {
		t.Fatalf("receiver lot value %d company %s", valueSen, company)
	}

	// The receiver's usage draws the away company's deferred revenue at the
	// original unit price.
	used := e.deductOne(receiver.CustomerID, "go-interco-use")
	if j := e.journals(used)["GYM_CREDIT_USAGE"]; j.Amount != 33_333.33 || *j.CompanyID != home.CompanyID {
		// The first credit the receiver uses comes from the same-company lot.
		t.Fatalf("receiver usage %+v", j)
	}
}
