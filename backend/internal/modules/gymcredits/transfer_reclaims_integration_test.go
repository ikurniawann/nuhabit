package gymcredits

import (
	"strings"
	"testing"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/testutil"
)

// Transferred credits are not refunded to the sender, and both the quote
// and the refund say so. Staff can take the unused part of a transfer back
// first, which the credits page lists per transfer.
func TestTransferReclaimAndRefundVisibility(t *testing.T) {
	receiver := testutil.CreateMember(t)
	e := setup(t)
	c := e.member.CustomerID
	var sim string
	e.scalar(&sim, `INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
		VALUES ('Go Reclaim Sim', 60, 1, 10) RETURNING id::text`)
	race := e.pkg("Go Reclaim Race", 4, 400_000, 60, nil)
	e.exec(`UPDATE gym.credit_packages SET applicable_class_type_ids = ARRAY[$2::uuid] WHERE id = $1`, race, sim)
	purchase := e.buy(race)
	raceLot := e.lotOf(purchase.ID)

	sent := e.data(asStaff, "POST", "/api/gym/credits/"+c+"/transfer", map[string]any{
		"to_customer_id": receiver.CustomerID, "lots": []any{map[string]any{"lot_id": raceLot, "credits": 3}}, "idempotency_key": "go-reclaim-1"})
	transferID := sent["transferId"].(string)
	if ok, _, err := e.svc.Deduct(e.ctx, e.tx, CreditMove{CustomerID: receiver.CustomerID, Amount: 1, ClassTypeID: sim,
		SourceType: "class_booking", SourceID: transferID, IdempotencyKey: "go-reclaim-use"}); err != nil || !ok {
		t.Fatalf("receiver deduct: %v %v", ok, err)
	}

	// The quote leaves the transferred credits out and names the receiver.
	quotePath := "/api/gym/credits/purchases/" + purchase.ID + "/refund-quote"
	quote := e.data(asStaff, "GET", quotePath, nil)
	transferred := quote["transferred"].([]any)
	note, _ := quote["transferred_note"].(string)
	if quote["unused_credits"] != 1.0 || quote["prorated_idr"] != 100_000.0 || len(transferred) != 1 ||
		transferred[0].(map[string]any)["credits"] != 3.0 || !strings.HasPrefix(note, "3 kredit sudah ditransfer ke ") {
		t.Fatalf("quote %v", quote)
	}

	// The credits page lists the transfer with what a reclaim can take back.
	history := e.data(asStaff, "GET", "/api/gym/credits/"+c, nil)["transfers"].([]any)
	if len(history) != 1 {
		t.Fatalf("transfers %v", history)
	}
	if row := history[0].(map[string]any); row["id"] != transferID || row["direction"] != "out" || row["reclaimable_credits"] != 2.0 ||
		row["reclaimed_credits"] != 0.0 || row["counterparty"].(map[string]any)["id"] != receiver.CustomerID {
		t.Fatalf("transfer row %v", row)
	}
	if row := e.data(asStaff, "GET", "/api/gym/credits/"+receiver.CustomerID, nil)["transfers"].([]any)[0].(map[string]any); row["direction"] != "in" ||
		row["counterparty"].(map[string]any)["id"] != c {
		t.Fatalf("receiver's row %v", row)
	}

	// Reclaim: the two unused credits go back to the sender's lot, even
	// from a receiver whose membership has lapsed.
	e.exec(`UPDATE pos.pos_customers SET is_active = false WHERE id = $1`, receiver.CustomerID)
	reclaimPath := "/api/gym/credits/transfers/" + transferID + "/reclaim"
	e.fail(asStaff, "POST", reclaimPath, map[string]any{"reason": ""}, 400, "Alasan penarikan wajib diisi")
	if res := e.data(asStaff, "POST", reclaimPath, map[string]any{"reason": "refund paket pengirim"}); res["credits"] != 2.0 {
		t.Fatalf("reclaim %v", res)
	}
	if e.remaining(raceLot) != 3 || e.balance() != 3 {
		t.Fatalf("sender race lot %d balance %d", e.remaining(raceLot), e.balance())
	}
	if got := e.usableOf(receiver.CustomerID, sim); got != 0 {
		t.Fatalf("receiver usable %d", got)
	}
	var entries string
	e.scalar(&entries, `SELECT string_agg(type || ' ' || amount || ' ' || customer_id::text, ', ' ORDER BY amount) FROM gym.credit_ledger
		WHERE source_type = 'transfer_reclaim' AND source_id = $1`, transferID)
	if entries != "transfer_out -2 "+receiver.CustomerID+", refund 2 "+c {
		t.Fatalf("entries %q", entries)
	}
	var reclaimed, notices int
	e.scalar(&reclaimed, `SELECT reclaimed_credits FROM gym.credit_transfer_lots WHERE transfer_id = $1`, transferID)
	e.scalar(&notices, `SELECT count(*)::int FROM crm.member_notifications WHERE type = 'gym_credit_transfer_reclaimed' AND customer_id IN ($1, $2)`,
		c, receiver.CustomerID)
	if reclaimed != 2 || notices != 2 {
		t.Fatalf("reclaimed %d notices %d", reclaimed, notices)
	}
	e.fail(asStaff, "POST", reclaimPath, map[string]any{"reason": "sekali lagi"}, 409, domain.TransferReclaimNothing)
	e.fail(asStaff, "POST", "/api/gym/credits/transfers/"+anyID+"/reclaim", map[string]any{"reason": "tidak ada"}, 404, "Transfer kredit tidak ditemukan")

	// The refund now pays for three credits and notes the one still away.
	quote = e.data(asStaff, "GET", quotePath, nil)
	if quote["unused_credits"] != 3.0 || quote["transferred_note"] == "" || !strings.HasPrefix(quote["transferred_note"].(string), "1 kredit sudah ditransfer ke ") {
		t.Fatalf("quote after reclaim %v", quote)
	}
	refunded := e.data(asStaff, "POST", "/api/gym/credits/purchases/"+purchase.ID+"/refund", map[string]any{"reason": "batal beli"})
	refundNote, _ := refunded["note"].(string)
	if refunded["refunded_idr"] != 300_000.0 || !strings.Contains(refundNote, "1 kredit sudah ditransfer ke ") {
		t.Fatalf("refund %v", refunded)
	}
	var meta int
	e.scalar(&meta, `SELECT (payment_meta->>'transferred_credits')::int FROM gym.credit_purchases WHERE id = $1`, purchase.ID)
	if meta != 1 {
		t.Fatalf("transferred_credits meta %d", meta)
	}
	if row := e.data(asStaff, "GET", "/api/gym/credits/"+c, nil)["transfers"].([]any)[0].(map[string]any); row["reclaimed_credits"] != 2.0 || row["reclaimable_credits"] != 0.0 {
		t.Fatalf("transfer row after refund %v", row)
	}
}
