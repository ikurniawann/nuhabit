package domain

import "testing"

func TestPlanTransfer(t *testing.T) {
	lots := []Lot{lot("late", 5, 60, "race"), lot("early", 3, 10, ""), lot("gone", 4, -1, "")}
	rs := LotRemainders(lots, []Entry{entry(ClassDeduction, -1, "early")})

	t.Run("an amount draws live lots earliest expiry first", func(t *testing.T) {
		got, problem := PlanTransfer(rs, nil, 4, now)
		eq(t, problem, TransferProblem(""))
		eq(t, []any{len(got), got[0].Lot.ID, got[0].Credits, got[1].Lot.ID, got[1].Credits}, []any{2, "early", 2, "late", 2})
	})

	t.Run("picks keep the lot asked for, a lot named twice adds up", func(t *testing.T) {
		got, problem := PlanTransfer(rs, []TransferPick{{"late", 2}, {"late", 3}}, 0, now)
		eq(t, problem, TransferProblem(""))
		eq(t, []any{len(got), got[0].Lot.ID, got[0].Credits, got[0].Lot.PackageID}, []any{1, "late", 5, "race"})
	})

	t.Run("problems", func(t *testing.T) {
		cases := []struct {
			picks   []TransferPick
			credits int
			want    TransferProblem
		}{
			{nil, 0, TransferNoCredits},
			{nil, 8, TransferShort},
			{[]TransferPick{{"late", 0}}, 0, TransferNoCredits},
			{[]TransferPick{{"nope", 1}}, 0, TransferLotUnknown},
			{[]TransferPick{{"gone", 1}}, 0, TransferLotLapsed},
			{[]TransferPick{{"early", 3}}, 0, TransferLotShort},
		}
		for _, c := range cases {
			if _, got := PlanTransfer(rs, c.picks, c.credits, now); got != c.want {
				t.Errorf("%v/%d: got %q, want %q", c.picks, c.credits, got, c.want)
			}
		}
	})

	t.Run("after the transfer the sender keeps the rest", func(t *testing.T) {
		moved, _ := PlanTransfer(rs, []TransferPick{{"late", 2}}, 0, now)
		after := AfterTransfer(rs, moved)
		eq(t, RemainingIn(after, "late"), 3)
		eq(t, RemainingIn(rs, "late"), 5)
	})
}

func TestTransferEntriesOnTheLedger(t *testing.T) {
	// transfer_out cuts the sender's lot it names; transfer_in owns the
	// receiver's new lot, so its credits are not counted twice.
	eq(t, remaindersByID([]Lot{lot("a", 5, 30, "")}, []Entry{entry(TopUp, 5, "a"), entry(TransferOut, -2, "a")}), map[string]int{"a": 3})
	receiver := []Entry{entry(TransferIn, 2, "b")}
	eq(t, remaindersByID([]Lot{lot("b", 2, 30, "")}, receiver), map[string]int{"b": 2})
	eq(t, Balance(receiver), 2)

	_, problem := BuildReversal(entry(TransferIn, 2, "b"), "salah kirim", false, 2, 2)
	eq(t, problem, TransferEntry)
	_, problem = BuildReversal(entry(TransferOut, -2, "a"), "salah kirim", false, 3, 3)
	eq(t, problem, TransferEntry)
}

func TestWithinTransferCap(t *testing.T) {
	eq(t, WithinTransferCap(0, 500, 10), true)
	eq(t, WithinTransferCap(10, 6, 4), true)
	eq(t, WithinTransferCap(10, 6, 5), false)
}
