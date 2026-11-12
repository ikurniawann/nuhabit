package settings_test

import "testing"

// The Notifikasi WA page (settings.wa_notifications) reads its order alert
// card; a sibling settings menu does not.
func TestOrderAlertsWaNotificationsGuard(t *testing.T) {
	page, sibling := staff(t, "settings.wa_notifications"), staff(t, "settings.wa_gateway")
	e := newEnv(t)
	expect(t, e.do(&page, "GET", "/api/settings/order-alerts", nil), 200, "")
	expect(t, e.do(&sibling, "GET", "/api/settings/order-alerts", nil), 403, forbidden)
}
