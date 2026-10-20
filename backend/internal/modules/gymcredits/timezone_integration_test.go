package gymcredits

import (
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/testutil"
)

// A sale at a Makassar branch dates its journals, receipt and pass revenue
// in WITA.
func TestWitaBranchBooks(t *testing.T) {
	e := setup(t)
	wita := localtime.Zone("Asia/Makassar")
	org := testutil.CreateOrg(t, e.tx)
	e.exec(`UPDATE configuration.branches SET timezone = 'Asia/Makassar' WHERE id = $1`, org.BranchID)

	pass := e.data(asStaff, "POST", "/api/gym/packages", map[string]any{
		"name": "Go Pass WITA", "kind": "pass", "price_idr": 2_800_000, "validity_days": 28,
	})["id"].(string)
	sale := e.data(asStaff, "POST", "/api/gym/credits/"+e.member.CustomerID+"/sell", map[string]any{
		"package_id": pass, "payment_method": "qris", "branch_id": org.BranchID,
	})
	purchaseID := sale["id"].(string)
	if j := e.journals(purchaseID)["GYM_SALE_QRIS"]; j.EntryDate != localtime.DayKey(e.svc.clock(), wita) {
		t.Fatalf("sale journal date %q", j.EntryDate)
	}
	var receipt, witaDay string
	e.scalar(&receipt, `SELECT receipt_number FROM gym.credit_purchases WHERE id = $1`, purchaseID)
	e.scalar(&witaDay, `SELECT to_char(paid_at AT TIME ZONE 'Asia/Makassar', 'YYYYMMDD') FROM gym.credit_purchases WHERE id = $1`, purchaseID)
	if !strings.HasPrefix(receipt, "GYM-"+witaDay+"-") {
		t.Fatalf("receipt %s, want WITA day %s", receipt, witaDay)
	}

	// 00.30 WITA is still 23.30 WIB the day before: the release is dated in WITA.
	at := time.Now().UTC().Truncate(24 * time.Hour).Add(16*time.Hour + 30*time.Minute)
	if at.Before(time.Now()) {
		at = at.AddDate(0, 0, 1)
	}
	if _, err := e.svc.SweepPassRevenue(e.ctx, at); err != nil {
		t.Fatal(err)
	}
	var day string
	e.scalar(&day, `SELECT max(r.release_date)::text FROM gym.pass_revenue_releases r
		JOIN gym.member_passes mp ON mp.id = r.pass_id WHERE mp.purchase_id = $1`, purchaseID)
	if want := localtime.DayKey(at, wita); day != want || day == localtime.DayKey(at, localtime.Jakarta) {
		t.Fatalf("release date %s, want %s", day, want)
	}
	var batch string
	e.scalar(&batch, `SELECT batch_id::text FROM gym.pass_revenue_releases r JOIN gym.member_passes mp ON mp.id = r.pass_id
		WHERE mp.purchase_id = $1 ORDER BY release_date DESC LIMIT 1`, purchaseID)
	if j := e.journals(batch)["GYM_PASS_REVENUE"]; j.EntryDate != day {
		t.Fatalf("pass revenue journal %+v", j)
	}
}
