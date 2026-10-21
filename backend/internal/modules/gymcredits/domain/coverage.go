package domain

import (
	"time"
)

// Demand is what one booking will draw from the ledger at check-in: Credits
// for a class of ClassTypeID that starts At.
type Demand struct {
	ClassTypeID string
	Credits     int
	At          time.Time
}

// CanCover reports whether some assignment of lots to demands pays for
// every demand: each credit of a demand comes from a lot that covers its
// class type and is still live when the class starts, and no lot gives
// more than it has left. The answer does not depend on the order the
// demands are listed or booked in: it is a maximum flow from the demands
// to the lots, not a replay of the ledger.
//
// The ledger itself still deducts greedily at check-in, one class at a
// time, with the priority of AllocateDeduction (narrowest coverage first,
// then earliest expiry, unrestricted lots last). Check-ins happen at class
// start, so the ledger sees the classes in start order. For unrestricted
// lots that greedy is exact: taking the earliest expiry that is still live
// never strands a later class. Restrictions are where the two can still
// part ways: two restricted lots of the same width whose lists overlap
// (say {a,b} and {b,c}, one credit each) pay for classes b, a, c in that
// order only when b draws {b,c}; the expiry tie-break may pick {a,b} and
// leave a without a lot. CanCover says yes to that set because an
// assignment exists. A later deduction then fails at check-in, as it did
// before, and booking does not reserve that outcome.
func CanCover(remainders []LotRemainder, coverage map[string][]string, demands []Demand, now time.Time) bool {
	var lots []LotRemainder
	for _, r := range remainders {
		if r.Remaining > 0 && r.Lot.ExpiresAt.After(now) {
			lots = append(lots, r)
		}
	}
	var need []Demand
	total := 0
	for _, d := range demands {
		if d.Credits > 0 {
			need = append(need, d)
			total += d.Credits
		}
	}
	if total == 0 {
		return true
	}
	// Nodes: source, one per demand, one per lot, sink.
	source, sink := 0, 1+len(need)+len(lots)
	g := newFlow(sink + 1)
	for i, d := range need {
		g.add(source, 1+i, d.Credits)
		at := d.At
		if at.Before(now) {
			at = now
		}
		for j, r := range lots {
			if !r.Lot.ExpiresAt.After(at) {
				continue
			}
			if d.ClassTypeID != "" {
				if covers, _ := lotCoverage(r.Lot, coverage, d.ClassTypeID); !covers {
					continue
				}
			}
			g.add(1+i, 1+len(need)+j, d.Credits)
		}
	}
	for j, r := range lots {
		g.add(1+len(need)+j, sink, r.Remaining)
	}
	return g.maxFlow(source, sink) == total
}

// flow is a small residual graph for CanCover (Edmonds-Karp). The graphs
// are tiny: a member's bookings against their lots.
type flow struct {
	cap [][]int
}

func newFlow(n int) *flow {
	g := &flow{cap: make([][]int, n)}
	for i := range g.cap {
		g.cap[i] = make([]int, n)
	}
	return g
}

func (g *flow) add(from, to, capacity int) { g.cap[from][to] += capacity }

func (g *flow) maxFlow(source, sink int) int {
	n := len(g.cap)
	total := 0
	for {
		parent := make([]int, n)
		for i := range parent {
			parent[i] = -1
		}
		parent[source] = source
		queue := []int{source}
		for len(queue) > 0 && parent[sink] < 0 {
			u := queue[0]
			queue = queue[1:]
			for v := range n {
				if parent[v] < 0 && g.cap[u][v] > 0 {
					parent[v] = u
					queue = append(queue, v)
				}
			}
		}
		if parent[sink] < 0 {
			return total
		}
		push := -1
		for v := sink; v != source; v = parent[v] {
			if c := g.cap[parent[v]][v]; push < 0 || c < push {
				push = c
			}
		}
		for v := sink; v != source; v = parent[v] {
			g.cap[parent[v]][v] -= push
			g.cap[v][parent[v]] += push
		}
		total += push
	}
}
