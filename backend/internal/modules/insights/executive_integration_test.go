package insights

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/testutil"
)

// GET /api/dashboard/executive on the local database: section shapes, the
// overview port, the gagal list and the 60-second cache.

func TestExecutiveDashboard(t *testing.T) {
	boss := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"dashboard": nil}})
	none := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{}})
	f := &fakePorts{overviewGagal: []string{"stokMenipis"}}
	h := newPoolHarness(t, f)
	now := clock
	h.svc.now = func() time.Time { return now }

	if c := h.get("/api/dashboard/executive", none); c.status != http.StatusForbidden {
		t.Fatal(c.status, c.raw)
	}

	c := h.get("/api/dashboard/executive", boss)
	if c.status != http.StatusOK {
		t.Fatal(c.status, c.raw)
	}
	body := c.obj(t)
	data := body["data"].(map[string]any)
	if body["cached"] != false || data["overview"].(map[string]any)["dibuatPada"] != "x" || data["dibuatPada"] != "2026-10-07T05:00:00.000Z" {
		t.Fatal(c.raw)
	}
	gagal := data["gagal"].([]any)
	if len(gagal) == 0 || gagal[len(gagal)-1] != "overview:stokMenipis" {
		t.Fatal(gagal)
	}
	for _, g := range gagal[:len(gagal)-1] {
		t.Errorf("section failed on the local schema: %v", g)
	}
	trend := data["tren14Hari"].([]any)
	if len(trend) != 14 || trend[0].(map[string]any)["tanggal"] != "2026-09-24" || trend[13].(map[string]any)["tanggal"] != "2026-10-07" {
		t.Fatal(trend)
	}
	target := body["target"].(map[string]any)
	if _, ok := target["harianRp"].(float64); !ok {
		t.Fatal(body["target"])
	}
	order := []string{`"dibuatPada"`, `"overview"`, `"tren14Hari"`, `"topProduk7Hari"`, `"nilaiPersediaan"`, `"purchasingBulanIni"`, `"payrollTerakhir"`,
		`"kontrakHabis30Hari"`, `"omzetPerOutlet"`, `"bulanBerjalan"`, `"gym"`, `"gagal"`, `"target"`, `"cached"`}
	at := 0
	for _, k := range order {
		i := strings.Index(c.raw[at:], k)
		if i < 0 {
			t.Fatalf("key %s out of order: %s", k, c.raw)
		}
		at += i
	}

	// A result with failures is not cached.
	if c := h.get("/api/dashboard/executive", boss); c.obj(t)["cached"] != false {
		t.Fatal(c.raw)
	}
	// Without failures it is, for 60 seconds.
	f.overviewGagal = nil
	h.get("/api/dashboard/executive", boss)
	now = now.Add(59 * time.Second)
	if c := h.get("/api/dashboard/executive", boss); c.obj(t)["cached"] != true {
		t.Fatal(c.raw)
	}
	now = now.Add(2 * time.Second)
	if c := h.get("/api/dashboard/executive", boss); c.obj(t)["cached"] != false {
		t.Fatal(c.raw)
	}

	// Without the overview port the route is not mounted.
	h.svc.ports.Overview = nil
	for _, r := range (mod{s: h.svc}).Routes() {
		if strings.HasSuffix(r.Pattern, "/executive") {
			t.Fatal("executive mounted without its port")
		}
	}
}
