package settings

import (
	"io"
	"log/slog"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/testutil"
)

// The Notifikasi WA page (settings.wa_notifications) reads its settings
// behind the real IAM guard; a sibling settings menu does not.
func TestWaNotificationsGuard(t *testing.T) {
	deps := testutil.Deps(t, nil)
	page := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"settings.wa_notifications": nil}})
	sibling := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"settings.payment-gateways": nil}})
	tx := testutil.Tx(t)
	h := NewHandler(tx, deps.Auth, Ports{}, time.Now, slog.New(slog.NewTextHandler(io.Discard, nil)), func(string) string { return "" })
	mux := testutil.Mux(routes(h.Routes()))
	for s, want := range map[*testutil.Staff]int{&page: 200, &sibling: 403} {
		if rec, _ := testutil.Do(t, mux, testutil.AsStaff(testutil.Request("GET", "/api/settings/wa-notifications", nil), *s)); rec.Code != want {
			t.Errorf("GET /api/settings/wa-notifications = %d, want %d: %s", rec.Code, want, rec.Body.String())
		}
	}
}
