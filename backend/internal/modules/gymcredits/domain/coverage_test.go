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

	t.Run("an assignment that exists counts whatever the class order", func(t *testing.T) {
		// mixed expires first and covers both class types; race covers sims
		// only. The sim can take race and leave mixed to the engine class,
		// so both orders fit.
		rs := LotRemainders([]Lot{lot("mixed", 1, 20, "mixed"), lot("race", 1, 40, "race")}, nil)
		eq(t, CanCover(rs, coverage, []Demand{one("sim", 1), one("engine", 2)}, now), true)
		eq(t, CanCover(rs, coverage, []Demand{one("engine", 1), one("sim", 2)}, now), true)
		eq(t, CanCover(rs, coverage, []Demand{one("sim", 1), one("sim", 2), one("engine", 3)}, now), false)
	})

	t.Run("the order the demands are listed in does not matter", func(t *testing.T) {
		rs := LotRemainders([]Lot{lot("race", 8, 60, "race"), lot("general", 1, 60, "")}, nil)
		late := append(classes("sim", 8, 2), one("engine", 1))
		eq(t, CanCover(rs, coverage, late, now), true)
		eq(t, CanCover(rs, coverage, append([]Demand{one("engine", 1)}, classes("sim", 8, 2)...), now), true)
		// Booked in the other order: the engine class last in the list, first to start.
		eq(t, CanCover(rs, coverage, append(classes("sim", 8, 2), one("engine", 1), one("engine", 3)), now), false)
	})

	t.Run("check-in order differing from start order changes nothing", func(t *testing.T) {
		// The later class was booked (listed) first; the soon lot can only
		// pay for the earlier class.
		rs := LotRemainders([]Lot{lot("soon", 1, 3, ""), lot("later", 1, 30, "")}, nil)
		eq(t, CanCover(rs, coverage, []Demand{one("sim", 10), one("sim", 1)}, now), true)
		eq(t, CanCover(rs, coverage, []Demand{one("sim", 1), one("sim", 10)}, now), true)
		eq(t, CanCover(rs, coverage, []Demand{one("sim", 10), one("sim", 5)}, now), false)
	})

	t.Run("overlapping restricted lots need a matching, not a priority", func(t *testing.T) {
		// {a,b} and {b,c}, one credit each: a and c fit only when b is not
		// booked; b plus either one fits; all three do not.
		over := map[string][]string{"ab": {"a", "b"}, "bc": {"b", "c"}}
		rs := LotRemainders([]Lot{lot("ab", 1, 20, "ab"), lot("bc", 1, 40, "bc")}, nil)
		eq(t, CanCover(rs, over, []Demand{one("b", 1), one("a", 2)}, now), true)
		eq(t, CanCover(rs, over, []Demand{one("b", 1), one("c", 2)}, now), true)
		eq(t, CanCover(rs, over, []Demand{one("a", 1), one("c", 2)}, now), true)
		eq(t, CanCover(rs, over, []Demand{one("b", 1), one("a", 2), one("c", 3)}, now), false)
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
