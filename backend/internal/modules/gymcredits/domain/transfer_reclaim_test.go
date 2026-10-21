package domain

import "testing"

func TestPlanReclaim(t *testing.T) {
	lots := []TransferLotState{
		{ID: "tl-race", SourceLotID: "race", TargetLotID: "race-got", Credits: 3},
		{ID: "tl-open", SourceLotID: "open", TargetLotID: "open-got", Credits: 2, Reclaimed: 2},
		{ID: "tl-late", SourceLotID: "late", TargetLotID: "late-got", Credits: 1},
	}
	receiver := LotRemainders([]Lot{lot("race-got", 3, 30, "race"), lot("open-got", 2, 30, ""), lot("late-got", 1, -1, "")},
		[]Entry{entry(TransferIn, 3, "race-got"), entry(ClassDeduction, -1, "race-got"), entry(TransferIn, 2, "open-got"), entry(TransferIn, 1, "late-got")})

	t.Run("takes what is unused, skips lots already reclaimed or lapsed", func(t *testing.T) {
		plan := PlanReclaim(lots, receiver, now)
		eq(t, plan, []ReclaimLot{{TransferLotState: lots[0], Credits: 2}})
		eq(t, ReclaimTotal(plan), 2)
	})

	t.Run("a later reclaim takes only what came back since", func(t *testing.T) {
		again := []TransferLotState{{ID: "tl-race", SourceLotID: "race", TargetLotID: "race-got", Credits: 3, Reclaimed: 2}}
		back := LotRemainders([]Lot{lot("race-got", 3, 30, "race")},
			[]Entry{entry(TransferIn, 3, "race-got"), entry(ClassDeduction, -1, "race-got"), entry(TransferOut, -2, "race-got"), entry(Refund, 1, "race-got")})
		eq(t, PlanReclaim(again, back, now), []ReclaimLot{{TransferLotState: again[0], Credits: 1}})
	})

	t.Run("nothing unused plans nothing", func(t *testing.T) {
		used := LotRemainders([]Lot{lot("race-got", 3, 30, "race")}, []Entry{entry(TransferIn, 3, "race-got"), entry(ClassDeduction, -3, "race-got")})
		eq(t, len(PlanReclaim(lots[:1], used, now)), 0)
	})
}
