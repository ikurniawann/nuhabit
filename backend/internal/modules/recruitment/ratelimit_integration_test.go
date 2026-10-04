package recruitment

import (
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// replica is a second API process on the same database.
func (h *harness) replica() *harness {
	m := newModule(testutil.Deps(h.t, nil), h.tx, Ports{Employees: h.ports, Contracts: h.ports})
	other := *h
	other.svc, other.mux = m.h.svc, testutil.Mux(m)
	return &other
}

func TestRateLimitIsSharedAcrossReplicas(t *testing.T) {
	h := newHarness(t)
	other := h.replica()
	for i := range 100 {
		on := h
		if i%2 == 1 {
			on = other
		}
		if c := on.as(h.hr, "POST", "/api/candidates", map[string]any{}); c.status != 400 {
			t.Fatalf("request %d: %d %s", i+1, c.status, c.raw)
		}
	}
	expect(t, other.as(h.hr, "POST", "/api/candidates", map[string]any{}), 429, "")
	// A different key still has its own window, and the headers read the
	// shared count.
	c := h.as(h.hr, "GET", "/api/candidates", nil)
	if c.status != 200 || c.header.Get("X-RateLimit-Remaining") != "99" {
		t.Fatalf("list: %d remaining=%q", c.status, c.header.Get("X-RateLimit-Remaining"))
	}
	if c = other.as(h.hr, "GET", "/api/candidates", nil); c.header.Get("X-RateLimit-Remaining") != "98" {
		t.Fatalf("remaining on the other replica = %q", c.header.Get("X-RateLimit-Remaining"))
	}
}
