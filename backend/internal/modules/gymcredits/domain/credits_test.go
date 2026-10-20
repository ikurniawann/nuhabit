package domain

import (
	"fmt"
	"reflect"
	"testing"
	"time"
)

var now = time.Date(2026, 10, 4, 3, 0, 0, 0, time.UTC) // 10:00 WIB

func dayAt(n int) time.Time { return now.Add(time.Duration(n) * day) }

func lot(id string, credits, expiresInDays int, packageID string) Lot {
	return Lot{ID: id, PackageID: packageID, Credits: credits, ExpiresAt: dayAt(expiresInDays), CreatedAt: dayAt(-30)}
}

var seq int

func entry(t EntryType, amount int, lotID string) Entry {
	seq++
	return Entry{ID: fmt.Sprintf("e%d", seq), Type: t, Amount: amount, LotID: lotID, CreatedAt: now}
}

func remaindersByID(lots []Lot, entries []Entry) map[string]int {
	out := map[string]int{}
	for _, r := range LotRemainders(lots, entries) {
		out[r.Lot.ID] = r.Remaining
	}
	return out
}

func eq(t *testing.T, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestBalance(t *testing.T) {
	eq(t, Balance([]Entry{entry(TopUp, 10, "a"), entry(ClassDeduction, -2, ""), entry(Refund, 1, "")}), 9)
	eq(t, Balance(nil), 0)
}

func TestLotRemainders(t *testing.T) {
	t.Run("earliest expiring lot first regardless of insertion order", func(t *testing.T) {
		lots := []Lot{lot("late", 10, 60, ""), lot("early", 5, 10, "")}
		entries := []Entry{entry(TopUp, 10, "late"), entry(TopUp, 5, "early"), entry(ClassDeduction, -7, "")}
		eq(t, remaindersByID(lots, entries), map[string]int{"early": 0, "late": 8})
	})

	t.Run("sorted by expiry", func(t *testing.T) {
		rs := LotRemainders([]Lot{lot("b", 1, 20, ""), lot("a", 1, 5, "")}, nil)
		eq(t, []string{rs[0].Lot.ID, rs[1].Lot.ID}, []string{"a", "b"})
	})

	t.Run("refund and positive reversal give credits back to the earliest lot", func(t *testing.T) {
		lots := []Lot{lot("a", 5, 10, ""), lot("b", 5, 40, "")}
		deduction := entry(ClassDeduction, -6, "")
		reversal := entry(Reversal, 1, "")
		reversal.ReversesEntryID = deduction.ID
		entries := []Entry{entry(TopUp, 5, "a"), entry(TopUp, 5, "b"), deduction, entry(Refund, 2, ""), reversal}
		eq(t, remaindersByID(lots, entries), map[string]int{"a": 2, "b": 5})
		eq(t, Balance(entries), 7)
	})

	t.Run("expiration and top-up reversal are pinned to their lot", func(t *testing.T) {
		lots := []Lot{lot("a", 5, -1, ""), lot("b", 4, 30, "")}
		entries := []Entry{entry(TopUp, 5, "a"), entry(TopUp, 4, "b"), entry(Expiration, -5, "a"), entry(Reversal, -4, "b")}
		eq(t, remaindersByID(lots, entries), map[string]int{"a": 0, "b": 0})
	})

	t.Run("negative adjustment consumes, positive adjustment owns a lot", func(t *testing.T) {
		lots := []Lot{lot("a", 3, 10, ""), lot("adj", 2, 60, "")}
		entries := []Entry{entry(TopUp, 3, "a"), entry(Adjustment, 2, "adj"), entry(Adjustment, -4, "")}
		eq(t, remaindersByID(lots, entries), map[string]int{"a": 0, "adj": 1})
		eq(t, Balance(entries), 1)
	})

	t.Run("sum of remainders matches the balance in a mixed history", func(t *testing.T) {
		lots := []Lot{lot("a", 10, -2, ""), lot("b", 5, 3, ""), lot("c", 8, 50, "")}
		entries := []Entry{
			entry(TopUp, 10, "a"), entry(TopUp, 5, "b"), entry(Bonus, 8, "c"), entry(ClassDeduction, -4, ""),
			entry(Expiration, -6, "a"), entry(ClassDeduction, -2, ""), entry(Refund, 1, ""),
		}
		total := 0
		for _, r := range LotRemainders(lots, entries) {
			total += r.Remaining
		}
		eq(t, total, Balance(entries))
		eq(t, remaindersByID(lots, entries), map[string]int{"a": 0, "b": 4, "c": 8})
	})
}

func TestExpirationEntries(t *testing.T) {
	t.Run("expires only the unused part of lapsed lots", func(t *testing.T) {
		lots := []Lot{lot("old", 5, -1, ""), lot("new", 5, 30, "")}
		entries := []Entry{entry(TopUp, 5, "old"), entry(TopUp, 5, "new"), entry(ClassDeduction, -2, "")}
		eq(t, ExpirationEntries(lots, entries, now), []ExpirationDraft{
			{Amount: -3, LotID: "old", IdempotencyKey: "gym-expire:old:0", Note: "3 kredit kedaluwarsa"},
		})
	})

	t.Run("expiry exactly at now is expired", func(t *testing.T) {
		eq(t, len(ExpirationEntries([]Lot{lot("x", 2, 0, "")}, []Entry{entry(TopUp, 2, "x")}, now)), 1)
	})

	t.Run("idempotent once written", func(t *testing.T) {
		got := ExpirationEntries([]Lot{lot("old", 5, -1, "")}, []Entry{entry(TopUp, 5, "old"), entry(Expiration, -5, "old")}, now)
		eq(t, len(got), 0)
	})

	t.Run("fresh key when refunded credits in an expired lot expire again", func(t *testing.T) {
		entries := []Entry{entry(TopUp, 5, "old"), entry(ClassDeduction, -2, ""), entry(Expiration, -3, "old"), entry(Refund, 2, "")}
		got := ExpirationEntries([]Lot{lot("old", 5, -1, "")}, entries, now)
		if len(got) != 1 || got[0].Amount != -2 || got[0].IdempotencyKey != "gym-expire:old:1" {
			t.Fatalf("got %#v", got)
		}
	})

	t.Run("skips fully used lots", func(t *testing.T) {
		got := ExpirationEntries([]Lot{lot("old", 2, -1, "")}, []Entry{entry(TopUp, 2, "old"), entry(ClassDeduction, -2, "")}, now)
		eq(t, len(got), 0)
	})
}

func TestExpiringLots(t *testing.T) {
	lots := []Lot{lot("past", 3, -1, ""), lot("soon", 4, 5, ""), lot("edge", 2, 7, ""), lot("later", 6, 8, "")}
	entries := []Entry{entry(TopUp, 3, "past"), entry(TopUp, 4, "soon"), entry(TopUp, 2, "edge"), entry(TopUp, 6, "later"), entry(ClassDeduction, -4, "")}

	// past absorbs 3, soon absorbs 1 -> soon 3 + edge 2.
	var got [][2]any
	for _, r := range ExpiringLots(lots, entries, now, 7) {
		got = append(got, [2]any{r.Lot.ID, r.Remaining})
	}
	eq(t, got, [][2]any{{"soon", 3}, {"edge", 2}})
	eq(t, len(ExpiringLots(lots, entries, now, 1)), 0)
}

func TestCoveredClassTypeIDs(t *testing.T) {
	coverage := map[string][]string{"race": {"sim"}, "open": nil}

	t.Run("restricts to the union of restricted packages", func(t *testing.T) {
		rs := LotRemainders([]Lot{lot("r", 8, 30, "race")}, []Entry{entry(TopUp, 8, "r")})
		eq(t, CoveredClassTypeIDs(rs, coverage, now), []string{"sim"})
		eq(t, IsClassTypeCovered([]string{"sim"}, "fundamentals"), false)
	})

	t.Run("an unrestricted live lot lifts the restriction", func(t *testing.T) {
		rs := LotRemainders([]Lot{lot("r", 8, 30, "race"), lot("o", 2, 30, "open")}, []Entry{entry(TopUp, 8, "r"), entry(TopUp, 2, "o")})
		eq(t, CoveredClassTypeIDs(rs, coverage, now) == nil, true)
	})

	t.Run("bonus credits without a package are unrestricted, used-up lots ignored", func(t *testing.T) {
		rs := LotRemainders([]Lot{lot("r", 1, 30, "race"), lot("b", 1, 30, "")},
			[]Entry{entry(TopUp, 1, "r"), entry(Bonus, 1, "b"), entry(ClassDeduction, -1, "")})
		// FIFO ties on createdAt: "r" is consumed first, the bonus lot remains.
		eq(t, CoveredClassTypeIDs(rs, coverage, now) == nil, true)
		eq(t, IsClassTypeCovered(nil, "anything"), true)
	})
}

func TestPinnedEntries(t *testing.T) {
	t.Run("deductions and refunds move their own lot, the pool still goes FIFO", func(t *testing.T) {
		lots := []Lot{lot("a", 5, 10, ""), lot("b", 5, 40, "")}
		entries := []Entry{
			entry(TopUp, 5, "a"), entry(TopUp, 5, "b"),
			entry(ClassDeduction, -3, "b"), entry(Refund, 1, "b"), entry(ClassDeduction, -2, ""),
		}
		eq(t, remaindersByID(lots, entries), map[string]int{"a": 3, "b": 3})
	})

	t.Run("a refund into a lapsed lot expires again", func(t *testing.T) {
		lots := []Lot{lot("old", 4, -1, "")}
		entries := []Entry{entry(TopUp, 4, "old"), entry(ClassDeduction, -1, "old"), entry(Expiration, -3, "old"), entry(Refund, 1, "old")}
		got := ExpirationEntries(lots, entries, now)
		eq(t, [2]any{len(got), got[0].Amount}, [2]any{1, -1})
	})
}

func TestAllocateDeduction(t *testing.T) {
	coverage := map[string][]string{"race": {"sim"}, "strength": {"lift"}, "open": nil}
	lots := []Lot{
		lot("open-early", 2, 5, "open"), lot("race", 3, 20, "race"),
		lot("strength", 4, 1, "strength"), lot("bonus", 1, 3, ""), lot("gone", 9, -1, ""),
	}
	entries := []Entry{
		entry(TopUp, 2, "open-early"), entry(TopUp, 3, "race"), entry(TopUp, 4, "strength"),
		entry(Bonus, 1, "bonus"), entry(TopUp, 9, "gone"),
	}
	rs := LotRemainders(lots, entries)

	t.Run("restricted lots that cover the class go first, then unrestricted by expiry", func(t *testing.T) {
		got, ok := AllocateDeduction(rs, coverage, "sim", 5, now)
		eq(t, ok, true)
		eq(t, got, []Allocation{{"race", 3}, {"bonus", 1}, {"open-early", 1}})
	})

	t.Run("lots restricted to other classes and lapsed lots never pay", func(t *testing.T) {
		eq(t, UsableBalance(rs, coverage, "sim", now), 6)
		eq(t, UsableBalance(rs, coverage, "lift", now), 7)
		eq(t, UsableBalance(rs, coverage, "yoga", now), 3)
		_, ok := AllocateDeduction(rs, coverage, "yoga", 4, now)
		eq(t, ok, false)
	})

	t.Run("unknown class takes any live lot by expiry", func(t *testing.T) {
		got, ok := AllocateDeduction(rs, coverage, "", 6, now)
		eq(t, ok, true)
		eq(t, got, []Allocation{{"strength", 4}, {"bonus", 1}, {"open-early", 1}})
	})
}

func TestAllocateClassRefund(t *testing.T) {
	d1 := entry(ClassDeduction, -2, "a")
	d1.SourceID = "booking"
	d2 := entry(ClassDeduction, -1, "b")
	d2.SourceID = "booking"
	other := entry(ClassDeduction, -4, "a")
	other.SourceID = "other"

	t.Run("returns credits to the lots drawn, last lot first", func(t *testing.T) {
		eq(t, AllocateClassRefund([]Entry{d1, d2, other}, "booking", 3), []Allocation{{"b", 1}, {"a", 2}})
	})

	t.Run("nets earlier refunds and reversals; the rest goes to the pool", func(t *testing.T) {
		refund := entry(Refund, 1, "b")
		refund.SourceID = "booking"
		reversal := entry(Reversal, 1, "a")
		reversal.ReversesEntryID = d1.ID
		eq(t, AllocateClassRefund([]Entry{d1, d2, other, refund, reversal}, "booking", 3), []Allocation{{"a", 1}, {"", 2}})
	})
}

func TestPurchaseRefundIdr(t *testing.T) {
	eq(t, PurchaseRefundIdr(1_500_000, 10, 9), 1_350_000.0)
	eq(t, PurchaseRefundIdr(100_000, 3, 1), 33_333.0)
	eq(t, PurchaseRefundIdr(400_000.5, 5, 5), 400_000.5)
	eq(t, PurchaseRefundIdr(400_000, 5, 0), 0.0)
}

func TestBuildReversal(t *testing.T) {
	t.Run("reverses a bonus against its own lot", func(t *testing.T) {
		original := entry(Bonus, 5, "lotA")
		original.SourceType, original.SourceID = "promo", "p1"
		draft, problem := BuildReversal(original, " salah input ", false, 5, 5)
		eq(t, problem, ReversalProblem(""))
		eq(t, draft, ReversalDraft{Amount: -5, LotID: "lotA", ReversesEntryID: original.ID, SourceType: "promo", SourceID: "p1", Note: "salah input"})
	})

	t.Run("purchase top-ups go through the purchase refund", func(t *testing.T) {
		_, p := BuildReversal(entry(TopUp, 5, "lotA"), "x", false, 5, 5)
		eq(t, p, PurchaseTopUp)
	})

	t.Run("reverses a deduction back into the pool", func(t *testing.T) {
		draft, problem := BuildReversal(entry(ClassDeduction, -2, ""), "kelas batal", false, 0, 0)
		eq(t, problem, ReversalProblem(""))
		eq(t, [2]any{draft.Amount, draft.LotID}, [2]any{2, ""})
	})

	t.Run("reverses a deduction back into the lot it drew from", func(t *testing.T) {
		draft, problem := BuildReversal(entry(ClassDeduction, -2, "lotA"), "kelas batal", false, 0, 0)
		eq(t, problem, ReversalProblem(""))
		eq(t, [2]any{draft.Amount, draft.LotID}, [2]any{2, "lotA"})
	})

	t.Run("refuses to cut more than the lot still holds", func(t *testing.T) {
		_, p := BuildReversal(entry(Bonus, 5, "l"), "x", false, 20, 3)
		eq(t, p, LotPartlyUsed)
	})

	t.Run("rejects reversal, expiration, reversed entry, negative balance", func(t *testing.T) {
		_, p := BuildReversal(entry(Reversal, 1, ""), "x", false, 9, 0)
		eq(t, p, CannotReverseReversal)
		_, p = BuildReversal(entry(Expiration, -1, "l"), "x", false, 9, 0)
		eq(t, p, CannotReverseExpiration)
		_, p = BuildReversal(entry(Bonus, 1, "l"), "x", true, 9, 1)
		eq(t, p, AlreadyReversed)
		_, p = BuildReversal(entry(Bonus, 5, "l"), "x", false, 4, 5)
		eq(t, p, InsufficientBalance)
	})
}

func TestValidateAdjustment(t *testing.T) {
	eq(t, ValidateAdjustment(0, "koreksi", 3), "Jumlah penyesuaian harus bilangan bulat dan tidak nol.")
	eq(t, ValidateAdjustment(2, "  ", 3), "Alasan penyesuaian wajib diisi.")
	eq(t, ValidateAdjustment(-4, "koreksi", 3), "Saldo kredit tidak boleh minus.")
	eq(t, ValidateAdjustment(5000, "koreksi", 3), "Jumlah penyesuaian maksimal 1.000 kredit.")
	eq(t, ValidateAdjustment(-3, "koreksi", 3), "")
}

func TestCheckPackagePurchase(t *testing.T) {
	one := 1
	pkg := PurchasablePackage{ID: "p", Status: "active", PurchaseLimitPerMember: &one}

	eq(t, CheckPackagePurchase(pkg, 0, true, ""), PurchaseProblem(""))
	eq(t, CheckPackagePurchase(pkg, 1, true, ""), PurchaseLimitReached)
	unlimited := pkg
	unlimited.PurchaseLimitPerMember = nil
	eq(t, CheckPackagePurchase(unlimited, 50, true, ""), PurchaseProblem(""))

	archived := pkg
	archived.Status = "archived"
	eq(t, CheckPackagePurchase(archived, 0, true, ""), PurchaseArchived)
	eq(t, CheckPackagePurchase(pkg, 0, false, ""), PurchaseMemberInactive)

	branch := pkg
	branch.BranchID = "b1"
	eq(t, CheckPackagePurchase(branch, 0, true, "b2"), PurchaseBranchMismatch)
	eq(t, CheckPackagePurchase(branch, 0, true, "b1"), PurchaseProblem(""))
	eq(t, CheckPackagePurchase(branch, 0, true, ""), PurchaseProblem(""))
}

func TestPurchaseTotalAndLotExpiry(t *testing.T) {
	d, total := PurchaseTotal(800_000, 100_000)
	eq(t, [2]float64{d, total}, [2]float64{100_000, 700_000})
	d, total = PurchaseTotal(800_000, 900_000)
	eq(t, [2]float64{d, total}, [2]float64{800_000, 0})
	d, total = PurchaseTotal(800_000, -5)
	eq(t, [2]float64{d, total}, [2]float64{0, 800_000})
	d, _ = PurchaseTotal(800_000, 10.5)
	eq(t, d, 11.0)

	eq(t, LotExpiry(now, 14).Sub(now), 14*day)
}
