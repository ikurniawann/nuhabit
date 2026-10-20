package domain

import (
	"testing"
	"time"
)

func TestCanCover(t *testing.T) {
	coverage := map[string][]string{"race": {"sim"}, "mixed": {"sim", "engine"}, "open": nil}
	classes := func(classType string, n, days int) []Demand {
		out := make([]Demand, n)
		for i := range out {
			out[i] = Demand{ClassTypeID: classType, Credits: 1, At: dayAt(days).Add(time.Duration(i) * time.Hour)}
		}
		return out
	}
	one := func(classType string, days int) Demand {
		return Demand{ClassTypeID: classType, Credits: 1, At: dayAt(days)}
	}

	t.Run("8 race sim credits and 1 general credit cover 8 race sims and 1 engine builder", func(t *testing.T) {
		rs := LotRemainders([]Lot{lot("race", 8, 60, "race"), lot("general", 1, 60, "")}, nil)
		booked := classes("sim", 8, 1)
		eq(t, CanCover(rs, coverage, append(booked, one("engine", 2)), now), true)
		eq(t, CanCover(rs, coverage, append(booked, one("engine", 2), one("engine", 3)), now), false)
	})

	t.Run("an earlier engine class still leaves the race lot to the sims", func(t *testing.T) {
		rs := LotRemainders([]Lot{lot("race", 8, 60, "race"), lot("general", 1, 60, "")}, nil)
		eq(t, CanCover(rs, coverage, append([]Demand{one("engine", 1)}, classes("sim", 8, 2)...), now), true)
	})

	t.Run("restricted credits do not pay for another class type", func(t *testing.T) {
		rs := LotRemainders([]Lot{lot("race", 5, 60, "race")}, nil)
		eq(t, CanCover(rs, coverage, []Demand{one("engine", 1)}, now), false)
	})

	t.Run("a lot that lapses before the class does not pay for it", func(t *testing.T) {
		rs := LotRemainders([]Lot{lot("soon", 2, 3, ""), lot("later", 1, 30, "")}, nil)
		eq(t, CanCover(rs, coverage, classes("sim", 2, 1), now), true)
		eq(t, CanCover(rs, coverage, classes("sim", 2, 5), now), false)
		eq(t, CanCover(rs, coverage, append(classes("sim", 2, 1), one("sim", 5)), now), true)
	})

	t.Run("earliest expiry is drawn first, leaving the later lot for a later class", func(t *testing.T) {
		rs := LotRemainders([]Lot{lot("late", 1, 30, ""), lot("early", 1, 10, "")}, nil)
		eq(t, CanCover(rs, coverage, []Demand{one("sim", 1), one("sim", 20)}, now), true)
		eq(t, CanCover(rs, coverage, []Demand{one("sim", 15), one("sim", 20)}, now), false)
	})

	t.Run("the ledger order decides", func(t *testing.T) {
		// mixed expires first and covers both class types; race covers sims
		// only. A sim first takes mixed, so the engine class after it finds
		// no lot it may use. The other way round both fit.
		rs := LotRemainders([]Lot{lot("mixed", 1, 20, "mixed"), lot("race", 1, 40, "race")}, nil)
		eq(t, CanCover(rs, coverage, []Demand{one("sim", 1), one("engine", 2)}, now), false)
		eq(t, CanCover(rs, coverage, []Demand{one("engine", 1), one("sim", 2)}, now), true)
	})

	t.Run("a class costing several credits splits over lots", func(t *testing.T) {
		rs := LotRemainders([]Lot{lot("a", 1, 30, ""), lot("b", 2, 40, "")}, nil)
		eq(t, CanCover(rs, coverage, []Demand{{ClassTypeID: "sim", Credits: 3, At: dayAt(1)}}, now), true)
		eq(t, CanCover(rs, coverage, []Demand{{ClassTypeID: "sim", Credits: 4, At: dayAt(1)}}, now), false)
	})

	t.Run("nothing to pay is always covered", func(t *testing.T) {
		eq(t, CanCover(nil, coverage, nil, now), true)
		eq(t, CanCover(nil, coverage, []Demand{{ClassTypeID: "sim", At: dayAt(1)}}, now), true)
	})
}
