package domain

import (
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

// Ported from lib/wallet/ledger.test.ts, corrections.test.ts,
// lib/pos/member-bill.test.ts, card-unlink.test.ts, member-refund.test.ts.

var now = time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)

func dayAt(n int) time.Time { return now.Add(time.Duration(n) * 24 * time.Hour) }
func dayPtr(n int) *time.Time {
	t := dayAt(n)
	return &t
}

type ledger struct{ seq int }

func (l *ledger) row(kind string, amount float64, mod func(*LedgerRow)) LedgerRow {
	l.seq++
	r := LedgerRow{ID: "r" + string(rune('a'+l.seq)), Type: kind, Amount: amount, Status: "completed",
		CreatedAt: dayAt(-100 + l.seq), Metadata: map[string]any{}}
	if mod != nil {
		mod(&r)
	}
	return r
}

func remainderOf(rows []LedgerRow, id string) float64 {
	for _, r := range ComputeLotRemainders(rows) {
		if r.Lot.ID == id {
			return r.Remaining
		}
	}
	return -1
}

func expires(n int) func(*LedgerRow) { return func(r *LedgerRow) { r.ExpiresAt = dayPtr(n) } }

func TestSignedDelta(t *testing.T) {
	var l ledger
	cases := []struct {
		row  LedgerRow
		want float64
	}{
		{l.row("topup", 50_000, nil), 50_000},
		{l.row("payment", 35_000, nil), -35_000},
		{l.row("payment", -35_000, nil), -35_000},
		{l.row("withdrawal", 20_000, nil), -20_000},
		{l.row("adjustment", 10_000, func(r *LedgerRow) { r.BalanceBefore, r.BalanceAfter = 50_000, 40_000 }), -10_000},
		{l.row("reversal", -5_000, nil), -5_000},
	}
	for _, c := range cases {
		if got := SignedDelta(c.row); got != c.want {
			t.Errorf("%s %v: got %v want %v", c.row.Type, c.row.Amount, got, c.want)
		}
	}
	if !IsCreditEntry("topup", 1) || IsCreditEntry("adjustment", -1) || !IsCreditEntry("reversal", 5) || IsCreditEntry("expiration", -5) {
		t.Error("IsCreditEntry")
	}
}

func TestComputeLotRemainders(t *testing.T) {
	var l ledger
	legacy := l.row("topup", 100_000, nil)
	late := l.row("topup", 50_000, expires(60))
	soon := l.row("topup_bonus", 20_000, expires(10))
	pay := l.row("payment", 30_000, nil)
	rows := []LedgerRow{legacy, late, soon, pay}
	if remainderOf(rows, soon.ID) != 0 || remainderOf(rows, late.ID) != 40_000 || remainderOf(rows, legacy.ID) != 100_000 {
		t.Fatalf("FIFO by expiry: %+v", ComputeLotRemainders(rows))
	}

	lot := l.row("topup", 50_000, expires(5))
	pending := l.row("topup", 10_000, func(r *LedgerRow) { r.Status, r.ExpiresAt = "pending", dayPtr(1) })
	pendingPay := l.row("payment", 5_000, func(r *LedgerRow) { r.Status = "pending" })
	out := ComputeLotRemainders([]LedgerRow{lot, pending, pendingPay})
	if len(out) != 1 || out[0].Remaining != 50_000 {
		t.Fatalf("pending rows: %+v", out)
	}

	a := l.row("topup", 30_000, expires(5))
	b := l.row("topup", 30_000, expires(10))
	pinned := l.row("topup_refund", -40_000, func(r *LedgerRow) {
		r.Metadata = map[string]any{"lot_allocations": []any{map[string]any{"lot_id": b.ID, "amount": 40_000.0}}}
	})
	rows = []LedgerRow{a, b, pinned}
	if remainderOf(rows, b.ID) != 0 || remainderOf(rows, a.ID) != 20_000 {
		t.Fatal("pinned allocation spill")
	}

	lot = l.row("topup", 50_000, expires(5))
	pay = l.row("payment", 20_000, nil)
	back := l.row("reversal", 20_000, func(r *LedgerRow) { r.BalanceBefore, r.BalanceAfter = 30_000, 50_000 })
	if remainderOf([]LedgerRow{lot, pay, back}, lot.ID) != 50_000 {
		t.Fatal("reversed debit returns to pool")
	}

	plus := l.row("adjustment", 10_000, func(r *LedgerRow) { r.BalanceBefore, r.BalanceAfter, r.ExpiresAt = 0, 10_000, dayPtr(3) })
	minus := l.row("adjustment", -4_000, func(r *LedgerRow) { r.BalanceBefore, r.BalanceAfter = 10_000, 6_000 })
	if remainderOf([]LedgerRow{plus, minus}, plus.ID) != 6_000 {
		t.Fatal("adjustments")
	}

	lot = l.row("topup", 10_000, nil)
	ghost := l.row("expiration", -3_000, func(r *LedgerRow) {
		r.Metadata = map[string]any{"lot_allocations": []any{map[string]any{"lot_id": "gone", "amount": 3_000.0}}}
	})
	if remainderOf([]LedgerRow{lot, ghost}, lot.ID) != 7_000 {
		t.Fatal("unknown lot allocation")
	}
}

func TestPlanExpirySweep(t *testing.T) {
	var l ledger
	expired := l.row("topup", 50_000, expires(-1))
	spent := l.row("bonus", 10_000, expires(-2))
	live := l.row("topup", 30_000, expires(30))
	pay := l.row("payment", 15_000, nil)
	entries, processed := PlanExpirySweep([]LedgerRow{expired, spent, live, pay}, 75_000, now, nil)
	want := []ExpirationDraft{{LotID: expired.ID, Amount: 45_000, BalanceBefore: 75_000, BalanceAfter: 30_000}}
	if !reflect.DeepEqual(entries, want) {
		t.Fatalf("entries %+v", entries)
	}
	sort.Strings(processed)
	wantIDs := []string{expired.ID, spent.ID}
	sort.Strings(wantIDs)
	if !reflect.DeepEqual(processed, wantIDs) {
		t.Fatalf("processed %v", processed)
	}

	lot := l.row("topup", 50_000, expires(-1))
	entries, _ = PlanExpirySweep([]LedgerRow{lot}, 20_000, now, nil)
	if entries[0].Amount != 20_000 || entries[0].BalanceAfter != 0 {
		t.Fatal("capped by balance")
	}
	first, _ := PlanExpirySweep([]LedgerRow{lot}, 50_000, now, nil)
	written := l.row("expiration", -first[0].Amount, func(r *LedgerRow) {
		r.Metadata = map[string]any{"lot_id": lot.ID, "lot_allocations": []any{map[string]any{"lot_id": lot.ID, "amount": first[0].Amount}}}
	})
	if second, _ := PlanExpirySweep([]LedgerRow{lot, written}, 0, now, nil); len(second) != 0 {
		t.Fatal("not idempotent")
	}
	entries, processed = PlanExpirySweep([]LedgerRow{lot}, 50_000, now, map[string]bool{lot.ID: true})
	if len(entries) != 0 || !reflect.DeepEqual(processed, []string{lot.ID}) {
		t.Fatal("already expired lot")
	}
}

func TestExpiryRemindersAndNudges(t *testing.T) {
	var l ledger
	soon := l.row("topup", 20_000, expires(3))
	reminded := l.row("topup", 20_000, expires(4))
	far := l.row("topup", 20_000, expires(30))
	past := l.row("topup", 20_000, expires(-1))
	picked := SelectExpiryReminders([]LedgerRow{soon, reminded, far, past}, now, 7, map[string]bool{reminded.ID: true})
	if len(picked) != 1 || picked[0].LotID != soon.ID || picked[0].Remaining != 20_000 {
		t.Fatalf("picked %+v", picked)
	}
	pay := l.row("payment", 20_000, nil)
	if len(SelectExpiryReminders([]LedgerRow{soon, pay}, now, 7, nil)) != 0 || len(SelectExpiryReminders([]LedgerRow{soon}, now, 0, nil)) != 0 {
		t.Fatal("spent lot or zero window")
	}

	crossed := dayPtr(-1)
	if !ShouldNudgeLowBalance(50_000, 20_000, crossed, nil, now) {
		t.Fatal("fresh drop")
	}
	if ShouldNudgeLowBalance(0, 20_000, crossed, nil, now) || ShouldNudgeLowBalance(50_000, 50_000, crossed, nil, now) ||
		ShouldNudgeLowBalance(50_000, 20_000, nil, nil, now) {
		t.Fatal("disabled / above / no drop")
	}
	if ShouldNudgeLowBalance(50_000, 20_000, crossed, dayPtr(-3), now) || !ShouldNudgeLowBalance(50_000, 20_000, crossed, dayPtr(-8), now) ||
		ShouldNudgeLowBalance(50_000, 20_000, dayPtr(-9), dayPtr(-8), now) {
		t.Fatal("cooldown")
	}
	thirty := 30.0
	if got := ExpiresAtFor(&thirty, now); got == nil || !got.Equal(dayAt(30)) {
		t.Fatal("expiresAtFor 30")
	}
	zero := 0.0
	if ExpiresAtFor(nil, now) != nil || ExpiresAtFor(&zero, now) != nil {
		t.Fatal("no expiry")
	}
}

const reason = "Salah input kasir"

func entry(kind string, amount float64) LedgerRow {
	return LedgerRow{ID: "e1", Type: kind, Amount: amount, Status: "completed", Metadata: map[string]any{}}
}

func TestCorrections(t *testing.T) {
	if d, p := ValidateAdjustment(25_000, reason, 0); p != "" || d != 25_000 {
		t.Fatal("plus adjustment")
	}
	if d, p := ValidateAdjustment(-10_000, reason, 10_000); p != "" || d != -10_000 {
		t.Fatal("minus adjustment")
	}
	for _, c := range []struct {
		amount, balance float64
		reason          string
	}{{0, 0, reason}, {200_000_000, 0, reason}, {5_000, 0, " ok "}} {
		if _, p := ValidateAdjustment(c.amount, c.reason, c.balance); p == "" {
			t.Errorf("accepted %+v", c)
		}
	}
	if _, p := ValidateAdjustment(-10_001, reason, 10_000); !strings.Contains(p, "minus") {
		t.Fatal(p)
	}

	topup := entry("topup", 50_000)
	d, alloc, p := ValidateReversal(topup, reason, 60_000, false)
	if p != "" || d != -50_000 || !reflect.DeepEqual(alloc, []LotAllocation{{LotID: "e1", Amount: 50_000}}) {
		t.Fatal("reverse lot")
	}
	d, alloc, p = ValidateReversal(entry("payment", 35_000), reason, 0, false)
	if p != "" || d != 35_000 || len(alloc) != 0 {
		t.Fatal("reverse payment")
	}
	pendingTopup := topup
	pendingTopup.Status = "pending"
	refunded := entry("topup", 50_000)
	refunded.Metadata = map[string]any{"refunded_at": "x"}
	for i, c := range []struct {
		e       LedgerRow
		balance float64
		already bool
	}{{topup, 60_000, true}, {entry("reversal", 5), 9, false}, {pendingTopup, 60_000, false}, {topup, 40_000, false}, {refunded, 90_000, false}} {
		if _, _, p := ValidateReversal(c.e, reason, c.balance, c.already); p == "" {
			t.Errorf("case %d accepted", i)
		}
	}

	qris, foc, cash := "qris", "foc", "cash"
	bonus := entry("topup_bonus", 10_000)
	bonus.ID = "b1"
	r, p := ValidateTopupRefund(entry("topup", 100_000), &qris, &bonus, 150_000, false, false, "transfer", reason)
	want := TopupRefund{RemoveIdr: 110_000, RefundIdr: 100_000, Manual: true,
		Allocations: []LotAllocation{{LotID: "e1", Amount: 100_000}, {LotID: "b1", Amount: 10_000}}}
	if p != "" || !reflect.DeepEqual(r, want) {
		t.Fatalf("refund %+v %s", r, p)
	}
	rejects := []func() string{
		func() string {
			_, p := ValidateTopupRefund(entry("topup", 100_000), &foc, &bonus, 150_000, false, false, "transfer", reason)
			return p
		},
		func() string {
			_, p := ValidateTopupRefund(entry("topup", 100_000), &qris, &bonus, 150_000, true, false, "transfer", reason)
			return p
		},
		func() string {
			_, p := ValidateTopupRefund(entry("topup", 100_000), &qris, &bonus, 150_000, false, true, "transfer", reason)
			return p
		},
		func() string {
			_, p := ValidateTopupRefund(entry("topup", 100_000), &qris, &bonus, 150_000, false, false, "qris", reason)
			return p
		},
		func() string {
			_, p := ValidateTopupRefund(entry("topup", 100_000), &qris, &bonus, 109_999, false, false, "transfer", reason)
			return p
		},
		func() string {
			_, p := ValidateTopupRefund(entry("bonus", 100_000), &qris, &bonus, 150_000, false, false, "transfer", reason)
			return p
		},
	}
	for i, f := range rejects {
		if f() == "" {
			t.Errorf("refund reject %d accepted", i)
		}
	}
	r, p = ValidateTopupRefund(entry("topup", 100_000), &cash, nil, 150_000, false, false, "transfer", reason)
	if p != "" || r.RemoveIdr != 100_000 || r.Manual {
		t.Fatal("refund without bonus")
	}
}

func TestPackagesAndTopupRules(t *testing.T) {
	if PackageBonus(100_000, 115_000) != 15_000 {
		t.Fatal("bonus")
	}
	b1, b2 := "b1", "b2"
	if !PackageAvailableAt(true, nil, nil) || !PackageAvailableAt(true, []string{"b1"}, &b1) ||
		PackageAvailableAt(true, []string{"b1"}, &b2) || PackageAvailableAt(false, nil, &b1) {
		t.Fatal("availability")
	}
	for raw, want := range map[any]string{nil: "qris", "CASH": "cash", "foc": "foc", "credit_card": "credit", "transfer": "qris", 0.0: "qris"} {
		if got := ResolvePaymentMethod(raw); got != want {
			t.Errorf("method %v: %s", raw, got)
		}
	}
	s := DefaultLoyaltySettings()
	if CalculateTopupXP(55_000, s) != 5 {
		t.Fatal("per amount xp")
	}
	s.TopupXPMode, s.TopupXPValue = "fixed", 7.9
	if CalculateTopupXP(1, s) != 7 {
		t.Fatal("fixed xp")
	}
	if id, _, ok := PickPaidXenditPayment([]map[string]any{{"status": "PENDING", "id": "x"}, {"status": "succeeded", "payment_id": "p2"}}); !ok || id != "p2" {
		t.Fatal("pick paid")
	}
	if !IsXenditQrPaid(map[string]any{"payments": []any{map[string]any{"status": "COMPLETED"}}}) || IsXenditQrPaid(map[string]any{"status": "INACTIVE"}) {
		t.Fatal("qr paid")
	}
	if QRImageURL("a b&c") != "https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=a%20b%26c" {
		t.Fatal(QRImageURL("a b&c"))
	}
}

func TestMemberBill(t *testing.T) {
	got := ComputeMemberBillBalance(150_000, 100_000, 0)
	if got != (MemberBillBalance{OpenTotal: 150_000, Credit: 100_000, Outstanding: 50_000}) {
		t.Fatalf("%+v", got)
	}
	got = ComputeMemberBillBalance(100_000, 130_000, 0)
	if !got.CanSettle || got.Surplus != 30_000 || got.Outstanding != 0 {
		t.Fatalf("%+v", got)
	}
	if ComputeMemberBillBalance(0, 50_000, 50_000).CanSettle {
		t.Fatal("nothing open")
	}
	for _, c := range []struct {
		amount, outstanding float64
		want                string
	}{{0, 10, "Nominal bayar harus lebih dari 0"}, {10.5, 100, "Nominal bayar harus bilangan rupiah bulat"},
		{10, 0, "Tidak ada sisa tagihan untuk dibayar"}, {101, 100, "Nominal melebihi sisa tagihan"}, {100, 100, ""}} {
		if p := ValidateMemberBillAmount(c.amount, c.outstanding); p != c.want {
			t.Errorf("%+v: %q", c, p)
		}
	}
	if !IsMemberBillMethod("cash", "cash", "Tunai") || IsMemberBillMethod("cash", "foc", "FOC") || IsMemberBillMethod("ark_wallet", "ark_coin", "ARK") {
		t.Fatal("bill methods")
	}
	if MemberDepositEvent("credit_card") != "POS_MEMBER_DEPOSIT_CARD" || MemberDepositEvent("gift_card") != "" {
		t.Fatal("deposit events")
	}
}

func TestCardsAndRefunds(t *testing.T) {
	if r, n, p := ValidateCardUnlink("lost", nil); r != "lost" || n != nil || p != "" {
		t.Fatal("lost")
	}
	if _, n, p := ValidateCardUnlink("returned", "  "); n != nil || p != "" {
		t.Fatal("returned blank notes")
	}
	if _, _, p := ValidateCardUnlink("other", ""); p == "" {
		t.Fatal("other needs notes")
	}
	if _, n, p := ValidateCardUnlink("other", "Kartu rusak, diganti baru"); p != "" || *n != "Kartu rusak, diganti baru" {
		t.Fatal("other with notes")
	}
	for _, c := range []struct{ reason, notes any }{{"stolen", nil}, {nil, nil}, {"lost", strings.Repeat("x", 501)}} {
		if _, _, p := ValidateCardUnlink(c.reason, c.notes); p == "" {
			t.Errorf("accepted %+v", c)
		}
	}
	if n, p := NormalizeNotes("  transfer BCA 1234  "); p != "" || *n != "transfer BCA 1234" {
		t.Fatal("notes trim")
	}
	if n, p := NormalizeNotes(""); n != nil || p != "" {
		t.Fatal("empty notes")
	}
	if _, p := NormalizeNotes(strings.Repeat("x", 501)); p == "" {
		t.Fatal("long notes")
	}
	if !strings.Contains(BuildRefundWalletNotes("Budi", "abcdef12-0000"), "disetujui Budi") ||
		!strings.Contains(BuildRefundWalletNotes("", "abcdef12-0000"), "supervisor") {
		t.Fatal("wallet notes")
	}
	ani, phone := "Ani", "0812"
	if RefundCompletedMessage(&ani, nil, 67_350) != "Refund Ani selesai — Rp67.350 dikembalikan, saldo member kini Rp0" ||
		!strings.Contains(RefundCompletedMessage(nil, &phone, 0), "Refund 0812 selesai") {
		t.Fatal("completed message")
	}
	if NormalizeNfcUID(" 04:aa:bb ") != "04AABB" {
		t.Fatal("nfc uid")
	}
}

func TestReceiptsAndFormats(t *testing.T) {
	at := time.Date(2026, 10, 4, 3, 5, 0, 0, time.UTC)
	if JamWib(at) != "4 Okt 2026, 10.05" || FormatWib(at) != "Min, 4 Okt, 10.05" || TanggalWib(at) != "4 Okt 2026" {
		t.Fatal(JamWib(at), FormatWib(at))
	}
	if FormatRupiah(-1500) != "-Rp1.500" || FormatRupiah(1_250_000) != "Rp1.250.000" {
		t.Fatal("rupiah")
	}
	for raw, want := range map[string]string{"0812-3456-7890": "6281234567890", "+62 812 3456 7890": "6281234567890", "123": ""} {
		got := NormalizeWaPhone(&raw)
		if (got == nil && want != "") || (got != nil && *got != want) {
			t.Errorf("%s -> %v", raw, got)
		}
	}
	balance := 75_000.0
	msg := BuildTopupReceiptMessage(TopupReceipt{OutletName: "NüHabit", CustomerName: "Ani", Amount: 50_000, Method: "cash", BalanceAfter: &balance, At: at})
	want := "*NüHabit* — Bukti Top-Up\nPelanggan: Ani\nWaktu: 4 Okt 2026, 10.05 WIB\n\n*Top-up: Rp 50.000*\nMetode: Tunai\nSaldo sekarang: Rp 75.000\n\nTerima kasih 🙏"
	if msg != want {
		t.Fatalf("%q", msg)
	}
	orders := make([]BillReminderOrder, 17)
	for i := range orders {
		orders[i] = BillReminderOrder{OrderNumber: "POS-1", OrderedAt: at, Total: 10_000}
	}
	bill := BuildMemberBillReminderMessage(MemberBillReminder{OutletName: "NüHabit", CustomerName: "Ani", At: at, Orders: orders,
		OpenTotal: 170_000, Paid: 20_000, Outstanding: 150_000})
	if !strings.Contains(bill, "15. POS-1 · 4 Okt 2026 — Rp 10.000\n… dan 2 order lainnya") || !strings.Contains(bill, "Sudah dibayar: Rp 20.000") {
		t.Fatal(bill)
	}
}
