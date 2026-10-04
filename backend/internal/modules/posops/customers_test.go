package posops_test

import (
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

func TestPosCustomers(t *testing.T) {
	h := newHarness(t, nil)
	h.anon("GET", "/api/pos/customers", nil, 401)
	digits := "8129" + strings.Map(func(r rune) rune { return '0' + r%10 }, testutil.RandomHex(4))
	phone := "+62" + digits
	uid := "gt" + testutil.RandomHex(4)

	var gold float64
	_ = h.tx.QueryRow(h.ctx, `SELECT COALESCE((SELECT discount_percent::float8 FROM crm.crm_membership_tiers WHERE lower(code) = 'gold' AND is_active LIMIT 1), 0)`).Scan(&gold)

	r := h.call("POST", "/api/pos/customers", map[string]any{"name": "x"}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Nomor HP wajib diisi"}`)
	r = h.call("POST", "/api/pos/customers", "null", 500)
	jsonEq(t, r.body, `{"success":false,"error":"Gagal menyimpan customer"}`)

	r = h.call("POST", "/api/pos/customers", map[string]any{
		"phone": "+62 " + digits[:3] + "-" + digits[3:], "name": " Sari ", "nfc_uid": " " + uid + " ", "is_kol": true,
		"enroll_member": true, "membership_tier": " GOLD ",
	}, 201)
	c := data(r)
	id := c["id"].(string)
	if c["phone"] != phone || c["name"] != "Sari" || c["email"] != nil || c["membership_tier"] != "gold" ||
		c["member_type"] != "card" || c["nfc_uid"] != strings.ToUpper(uid) || c["is_kol"] != true ||
		c["ark_coin_balance"] != "0.00" || c["discount_percent"] != gold || r.body["message"] != "Customer created" {
		t.Fatalf("created = %s", r.raw)
	}
	keysInOrder(t, r.raw, "success", "data", "id", "name", "phone", "email", "membership_tier", "member_type",
		"ark_coin_balance", "total_xp", "visit_count", "is_active", "nfc_uid", "is_kol", "discount_percent", "message")
	var events int
	h.scalar(&events, `SELECT count(*) FROM platform.outbox_events WHERE topic = 'pos.customer.enrolled' AND key = $1
		AND payload->>'tier_code' = 'gold' AND payload->>'enrolled_by' = $2`, id, h.staff.UserID)
	if events != 1 {
		t.Fatalf("enrollment events = %d", events)
	}

	r = h.call("POST", "/api/pos/customers", map[string]any{"phone": phone, "email": " sari@test.local ", "is_kol": "yes"}, 200)
	if data(r)["id"] != id || data(r)["name"] != "Sari" || data(r)["email"] != "sari@test.local" || data(r)["is_kol"] != true ||
		data(r)["membership_tier"] != "regular" || r.body["message"] != "Customer updated" {
		t.Fatalf("updated = %s", r.raw)
	}

	r = h.call("POST", "/api/pos/customers", map[string]any{"phone": "+6280000" + digits[4:], "nfc_uid": uid}, 409)
	jsonEq(t, r.body, `{"success":false,"error":"Card ID sudah terdaftar pada member lain"}`)

	r = h.call("GET", "/api/pos/customers?search="+digits[2:], nil, 200)
	if len(list(r.body["data"])) == 0 || obj(list(r.body["data"])[0])["discount_percent"] == nil {
		t.Fatalf("search = %s", r.raw)
	}
	r = h.call("GET", "/api/pos/customers?nfc_uid="+uid, nil, 200)
	if rows := list(r.body["data"]); len(rows) != 1 || obj(rows[0])["id"] != id {
		t.Fatalf("by card = %s", r.raw)
	}
	r = h.call("GET", "/api/pos/customers?phone="+strings.Replace(phone, "+", "%2B", 1), nil, 200)
	if len(list(r.body["data"])) != 1 {
		t.Fatalf("by phone = %s", r.raw)
	}
	// A comma splits the .or() expression like the QueryBuilder: SQL error.
	r = h.call("GET", "/api/pos/customers?search=a,b", nil, 500)
	jsonEq(t, r.body, `{"success":false,"error":"Gagal memuat data customer"}`)
}
