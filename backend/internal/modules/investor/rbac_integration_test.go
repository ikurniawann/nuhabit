package investor

import (
	"net/http"
	"slices"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/accounting"
	"nuhabit/backend/internal/modules/gymdesk"
	"nuhabit/backend/internal/platform/testutil"
)

// Each portal page reads with its own menu; Ringkasan (investor.overview)
// covers every portal page (TestInvestorRouteGuards), and the editor menu
// reads none of them.
func TestInvestorPageGuards(t *testing.T) {
	deps := testutil.Deps(t, func() time.Time { return testNow })
	mux := testutil.Mux(New(deps, Ports{Gym: txGym{svc: gymdesk.NewService(deps.DB, gymdesk.Ports{}, deps.Now)},
		Accounting: txAccounting{svc: accounting.NewService(deps.DB, accounting.Ports{}, nil, deps.Now)}}))
	allowed := map[string][]string{
		"investor.performance": {"/api/investor/performance", "/api/investor/branches"},
		"investor.progress":    {"/api/investor/updates"},
		"investor.documents":   {"/api/investor/documents"},
		"investor.updates":     {},
	}
	paths := []string{"/api/investor/overview", "/api/investor/performance", "/api/investor/branches",
		"/api/investor/updates", "/api/investor/documents", "/api/investor/digest"}
	for code, own := range allowed {
		s := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{code: {"read"}}})
		for _, path := range paths {
			want := http.StatusForbidden
			if slices.Contains(own, path) {
				want = http.StatusOK
			}
			if rec, _ := testutil.Do(t, mux, testutil.AsStaff(testutil.Request("GET", path, nil), s)); rec.Code != want {
				t.Errorf("GET %s as %s = %d, want %d", path, code, rec.Code, want)
			}
		}
	}
}
