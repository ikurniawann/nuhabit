package memberportal

import (
	"context"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// activateReferrals switches the shared program on for the test and puts
// the stored settings back afterwards.
func activateReferrals(t *testing.T) {
	t.Helper()
	db := testutil.DB(t)
	ctx := context.Background()
	var saved []byte
	if err := db.QueryRow(ctx, `SELECT to_jsonb(s) FROM crm.referral_settings s WHERE id`).Scan(&saved); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), `UPDATE crm.referral_settings s SET
			is_active = o.is_active, referrer_credits = o.referrer_credits, referrer_ark_idr = o.referrer_ark_idr,
			referee_credits = o.referee_credits, referee_campaign_id = o.referee_campaign_id,
			credit_validity_days = o.credit_validity_days, hold_days = o.hold_days, monthly_cap = o.monthly_cap
			FROM jsonb_populate_record(NULL::crm.referral_settings, $1::jsonb) o WHERE s.id`, saved)
	})
	if _, err := db.Exec(ctx, `UPDATE crm.referral_settings SET is_active = true, referee_credits = 1, referee_campaign_id = NULL WHERE id`); err != nil {
		t.Fatal(err)
	}
}

func TestIntegrationReferralRoutes(t *testing.T) {
	h := newHarness(t)
	activateReferrals(t)
	db := testutil.DB(t)
	referrer := newMember(t)

	status, body, _ := h.do(testutil.AsMember(testutil.Request("GET", "/api/member-portal/app/referral", nil), referrer))
	data, _ := body["data"].(map[string]any)
	code, _ := data["code"].(string)
	program, _ := data["program"].(map[string]any)
	if status != 200 || len(code) != 8 || program["active"] != true || program["referee_credits"] != 1.0 {
		t.Fatalf("member referral: %d %v", status, body)
	}
	if cfg := h.config(); cfg["referral_active"] != true {
		t.Fatalf("config %v", cfg)
	}

	status, body, _ = h.do(testutil.Request("GET", "/api/member-portal/referral/"+code, nil))
	invite, _ := body["data"].(map[string]any)
	if status != 200 || invite["code"] != code || invite["referrer_name"] != "Go T." {
		t.Fatalf("lookup: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.Request("GET", "/api/member-portal/referral/NHZZZZZZ", nil))
	if status != 404 || body["code"] != "REFERRAL_INVALID" {
		t.Fatalf("unknown code: %d %v", status, body)
	}

	// Sign-up with the code records the referral.
	phone := randomLocalPhone()
	digits := digitsOf(phone)
	cleanupOTP(t, digits)
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = db.Exec(ctx, `DELETE FROM crm.crm_marketing_optouts WHERE customer_id IN (SELECT id FROM pos.pos_customers WHERE phone = '0' || substring($1 from 3))`, digits)
		_, _ = db.Exec(ctx, `DELETE FROM pos.pos_customers WHERE phone = '0' || substring($1 from 3)`, digits)
	})
	h.do(testutil.Request("POST", "/api/member-portal/register/otp", map[string]any{"phone": phone}))
	status, body, _ = h.do(testutil.Request("POST", "/api/member-portal/register", map[string]any{
		"phone": phone, "name": "Teman Baru", "code": h.notifier.code(digits), "referral_code": code, "device_id": "go-test-" + testutil.RandomHex(4),
	}))
	if status != 200 {
		t.Fatalf("register: %d %v", status, body)
	}
	var referralStatus string
	if err := db.QueryRow(context.Background(), `SELECT r.status FROM crm.referrals r JOIN pos.pos_customers c ON c.id = r.referee_id
		WHERE r.referrer_id = $1 AND c.phone = '0' || substring($2 from 3)`, referrer.CustomerID, digits).Scan(&referralStatus); err != nil || referralStatus != "joined" {
		t.Fatalf("referral row: %q %v", referralStatus, err)
	}

	staff := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"gym.referrals": {"read", "update"}}})
	status, body, _ = h.do(testutil.AsStaff(testutil.Request("GET", "/api/gym/referrals?q="+code, nil), staff))
	page, _ := body["data"].(map[string]any)
	if status != 200 || page["total"] != 1.0 {
		t.Fatalf("staff list: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.AsStaff(testutil.Request("PUT", "/api/gym/referrals/settings", map[string]any{
		"is_active": true, "credit_validity_days": 0,
	}), staff))
	if status != 400 {
		t.Fatalf("invalid settings: %d %v", status, body)
	}
	status, body, _ = h.do(testutil.AsStaff(testutil.Request("GET", "/api/gym/referrals/leaderboard?month=2026-13", nil), staff))
	if status != 400 {
		t.Fatalf("bad month: %d %v", status, body)
	}
}
