package gymcredits

import (
	"testing"
	"time"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/testutil"
)

func (e *env) usableOf(customerID, classTypeID string) int {
	e.t.Helper()
	n, err := e.svc.UsableBalance(e.ctx, e.tx, customerID, classTypeID)
	if err != nil {
		e.t.Fatal(err)
	}
	return n
}

func TestCreditTransfers(t *testing.T) {
	// Created before setup so its cleanup runs after the rollback: the open
	// transaction holds rows that reference it.
	receiver := testutil.CreateMember(t)
	e := setup(t)
	c := e.member.CustomerID
	var sim, lift string
	e.scalar(&sim, `INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
		VALUES ('Go Transfer Sim', 60, 1, 10) RETURNING id::text`)
	e.scalar(&lift, `INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
		VALUES ('Go Transfer Lift', 60, 1, 10) RETURNING id::text`)
	race := e.pkg("Go Transfer Race", 4, 400_000, 60, nil)
	e.exec(`UPDATE gym.credit_packages SET applicable_class_type_ids = ARRAY[$2::uuid] WHERE id = $1`, race, sim)
	open := e.pkg("Go Transfer Open", 2, 200_000, 30, nil)
	raceLot, openLot := e.lotOf(e.buy(race).ID), e.lotOf(e.buy(open).ID)
	path := "/api/gym/credits/" + c + "/transfer"

	// Staff move 3 race credits; the same key again moves nothing.
	body := map[string]any{"to_customer_id": receiver.CustomerID, "lots": []any{map[string]any{"lot_id": raceLot, "credits": 3}},
		"note": "hadiah ulang tahun", "idempotency_key": "go-transfer-1"}
	first := e.data(asStaff, "POST", path, body)
	again := e.data(asStaff, "POST", path, body)
	if first["credits"] != 3.0 || first["replayed"] != false || again["replayed"] != true || again["transferId"] != first["transferId"] {
		t.Fatalf("transfer %v, again %v", first, again)
	}
	transferID := first["transferId"].(string)
	if e.balance() != 3 || e.remaining(raceLot) != 1 {
		t.Fatalf("sender balance %d race lot %d", e.balance(), e.remaining(raceLot))
	}

	// The receiver's lot keeps the package, so the class types, and the expiry.
	var lot, pkg, source string
	var expiresSame bool
	e.scalar(&lot, `SELECT target_lot_id::text FROM gym.credit_transfer_lots WHERE transfer_id = $1`, transferID)
	e.scalar(&pkg, `SELECT package_id::text FROM gym.credit_lots WHERE id = $1`, lot)
	e.scalar(&source, `SELECT source_lot_id::text FROM gym.credit_lots WHERE id = $1`, lot)
	e.scalar(&expiresSame, `SELECT r.expires_at = s.expires_at FROM gym.credit_lots r, gym.credit_lots s WHERE r.id = $1 AND s.id = $2`, lot, raceLot)
	if pkg != race || source != raceLot || !expiresSame {
		t.Fatalf("receiver lot package %s source %s same expiry %v", pkg, source, expiresSame)
	}
	if e.usableOf(receiver.CustomerID, sim) != 3 || e.usableOf(receiver.CustomerID, lift) != 0 {
		t.Fatalf("receiver usable sim %d lift %d", e.usableOf(receiver.CustomerID, sim), e.usableOf(receiver.CustomerID, lift))
	}
	var entries string
	e.scalar(&entries, `SELECT string_agg(type || ' ' || amount, ', ' ORDER BY amount) FROM gym.credit_ledger
		WHERE source_type = 'transfer' AND source_id = $1`, transferID)
	if entries != "transfer_out -3, transfer_in 3" {
		t.Fatalf("entries %q", entries)
	}
	var notices, journals int
	e.scalar(&notices, `SELECT count(*)::int FROM crm.member_notifications WHERE type = 'gym_credit_transfer' AND customer_id IN ($1, $2)`,
		c, receiver.CustomerID)
	e.scalar(&journals, `SELECT count(*)::int FROM platform.outbox_events WHERE topic = 'gym.credits.journal'
		AND payload->>'document_id' IN (SELECT id::text FROM gym.credit_ledger WHERE source_id = $1)`, transferID)
	if notices != 2 || journals != 0 {
		t.Fatalf("notices %d journals %d", notices, journals)
	}

	// Used by the receiver, a credit is worth what it was paid for.
	ok, _, err := e.svc.Deduct(e.ctx, e.tx, CreditMove{CustomerID: receiver.CustomerID, Amount: 1, ClassTypeID: sim,
		SourceType: "class_booking", SourceID: transferID, IdempotencyKey: "go-transfer-use-" + transferID})
	if err != nil || !ok {
		t.Fatalf("receiver deduct: %v %v", ok, err)
	}
	var usage float64
	e.scalar(&usage, `SELECT (payload->>'amount')::float FROM platform.outbox_events WHERE topic = 'gym.credits.journal'
		AND payload->>'document_id' = (SELECT id::text FROM gym.credit_ledger WHERE idempotency_key = $1)`, "go-transfer-use-"+transferID)
	if usage != 100_000 {
		t.Fatalf("usage journal %v", usage)
	}

	// A transfer entry is not reversed entry by entry.
	var outEntry string
	e.scalar(&outEntry, `SELECT id::text FROM gym.credit_ledger WHERE source_id = $1 AND type = 'transfer_out'`, transferID)
	_, err = e.svc.Reverse(e.ctx, e.tx, outEntry, "salah kirim", e.staff.UserID)
	wantErr(t, err, 409, domain.ReversalProblemMessages[domain.TransferEntry])

	// Members may not send until the rules allow it.
	memberPath := "/api/member-portal/gym/credits/transfer"
	local := "0" + receiver.Phone[3:]
	send := func(credits int, key string) map[string]any {
		return map[string]any{"phone": local, "credits": credits, "idempotency_key": key}
	}
	e.fail(asMember, "POST", memberPath, send(1, "go-member-1"), 403, domain.TransferProblemMessages[domain.TransferDisabled])
	e.exec(`UPDATE gym.business_rules SET rules = rules || '{"allowMemberCreditTransfer": true, "maxTransferCreditsPerMonth": 4}'::jsonb
		WHERE branch_id IS NULL`)
	wallet := e.data(asMember, "GET", "/api/member-portal/gym/credits", nil)
	if allowance := wallet["transfer"].(map[string]any); allowance["member_enabled"] != true || allowance["sent_this_month"] != 3.0 {
		t.Fatalf("allowance %v", allowance)
	}
	if res := e.data(asMember, "POST", memberPath, send(1, "go-member-1")); res["credits"] != 1.0 || res["toCustomerId"] != receiver.CustomerID {
		t.Fatalf("member transfer %v", res)
	}
	// Earliest expiry first: the open lot paid.
	if e.remaining(openLot) != 1 || e.remaining(raceLot) != 1 {
		t.Fatalf("open %d race %d", e.remaining(openLot), e.remaining(raceLot))
	}
	e.fail(asMember, "POST", memberPath, send(1, "go-member-2"), 409, domain.TransferProblemMessages[domain.TransferMonthlyCap]+" Sisa bulan ini: 0 kredit.")
	e.fail(asMember, "POST", memberPath, map[string]any{"phone": "081200000000", "credits": 1, "idempotency_key": "go-member-3"}, 404,
		"Tidak ada member dengan nomor HP itu")

	// Credits an upcoming booking needs stay with the sender.
	e.exec(`UPDATE gym.business_rules SET rules = rules || '{"maxTransferCreditsPerMonth": 0}'::jsonb WHERE branch_id IS NULL`)
	var session string
	startsAt := time.Now().Add(24 * time.Hour)
	e.scalar(&session, `INSERT INTO gym.class_sessions (class_type_id, starts_at, ends_at, capacity, credit_cost, booking_opens_at, booking_closes_at)
		VALUES ($1, $2, $2::timestamptz + interval '1 hour', 10, 1, now() - interval '1 day', $2) RETURNING id::text`, lift, startsAt)
	e.exec(`INSERT INTO gym.bookings (session_id, customer_id, status) VALUES ($1, $2, 'confirmed')`, session, c)
	e.fail(asStaff, "POST", path, map[string]any{"to_customer_id": receiver.CustomerID, "lots": []any{map[string]any{"lot_id": openLot, "credits": 1}},
		"idempotency_key": "go-transfer-2"}, 409, domain.TransferProblemMessages[domain.TransferReserved])
	if res := e.data(asStaff, "POST", path, map[string]any{"to_customer_id": receiver.CustomerID,
		"lots": []any{map[string]any{"lot_id": raceLot, "credits": 1}}, "idempotency_key": "go-transfer-3"}); res["credits"] != 1.0 {
		t.Fatalf("race credit not needed by the lift booking: %v", res)
	}

	e.fail(asStaff, "POST", path, map[string]any{"to_customer_id": c, "credits": 1, "idempotency_key": "go-transfer-4"}, 400,
		domain.TransferProblemMessages[domain.TransferToSelf])
	e.fail(asStaff, "POST", path, map[string]any{"to_customer_id": receiver.CustomerID, "idempotency_key": "go-transfer-5"}, 400,
		"Isi jumlah kredit atau pilih lot")
}
