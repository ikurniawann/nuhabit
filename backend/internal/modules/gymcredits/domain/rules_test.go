package domain

import (
	"encoding/json"
	"testing"
)

func defaultsKV() []KV {
	return []KV{
		{"creditExpiryDays", 60.0}, {"cancellationDeadlineHours", 4.0}, {"lateCancelPolicy", "forfeit"},
		{"noShowPolicy", "forfeit"}, {"reEntryGraceMin", 15.0}, {"antiPassbackMin", 60.0}, {"qrTtlSec", 45.0},
		{"waitlistAutoPromote", true}, {"lowBalanceThreshold", 3.0}, {"expiryReminderDays", 7.0},
		{"bookingOpensDaysBefore", 7.0}, {"bookingClosesMinBefore", 0.0},
		{"maxConcurrentBookings", 10.0}, {"maxBookingsPerDay", 3.0}, {"strikeLimit", 3.0}, {"strikeWindowDays", 30.0},
		{"strikeSuspendDays", 7.0}, {"waitlistPromoteCutoffMin", 60.0}, {"waitlistOfferMinutes", 30.0},
		{"classReminderMinutes", 120.0},
		{"scheduleHorizonDays", 14.0},
		{"maxFreezeDaysPerYear", 30.0}, {"minFreezeDays", 7.0}, {"renewalLeadDays", 3.0},
		{"renewalRetryCount", 2.0}, {"renewalRetryHours", 24.0}, {"renewalGraceDays", 3.0},
		{"requireWaiver", true}, {"checkinOpensMinBefore", 45.0}, {"checkinClosesMinAfter", 15.0},
		{"openGymEnabled", false}, {"openGymCreditCost", 1.0}, {"correctionWindowDays", 7.0},
		{"allowMemberCreditTransfer", false}, {"maxTransferCreditsPerMonth", 0.0}, {"defaultCompanyId", ""},
	}
}

func with(kv []KV, key string, v any) []KV {
	out := append([]KV(nil), kv...)
	for i := range out {
		if out[i].Key == key {
			out[i].Value = v
			return out
		}
	}
	return append(out, KV{key, v})
}

func decode(t *testing.T, raw string) any {
	t.Helper()
	var v any
	if err := json.Unmarshal([]byte(raw), &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestRuleDefaultsContract(t *testing.T) {
	got, _ := json.Marshal(RuleDefaults)
	want := `{"creditExpiryDays":60,"cancellationDeadlineHours":4,"lateCancelPolicy":"forfeit","noShowPolicy":"forfeit","reEntryGraceMin":15,"antiPassbackMin":60,"qrTtlSec":45,"waitlistAutoPromote":true,"lowBalanceThreshold":3,"expiryReminderDays":7,"bookingOpensDaysBefore":7,"bookingClosesMinBefore":0,"maxConcurrentBookings":10,"maxBookingsPerDay":3,"strikeLimit":3,"strikeWindowDays":30,"strikeSuspendDays":7,"waitlistPromoteCutoffMin":60,"waitlistOfferMinutes":30,"classReminderMinutes":120,"scheduleHorizonDays":14,"maxFreezeDaysPerYear":30,"minFreezeDays":7,"renewalLeadDays":3,"renewalRetryCount":2,"renewalRetryHours":24,"renewalGraceDays":3,"requireWaiver":true,"checkinOpensMinBefore":45,"checkinClosesMinAfter":15,"openGymEnabled":false,"openGymCreditCost":1,"correctionWindowDays":7,"allowMemberCreditTransfer":false,"maxTransferCreditsPerMonth":0,"defaultCompanyId":""}`
	eq(t, string(got), want)
	eq(t, len(RuleKeys()), 36)
}

func TestGateRules(t *testing.T) {
	for key, v := range map[string]any{
		"requireWaiver": "ya", "checkinOpensMinBefore": -1.0, "checkinClosesMinAfter": 1441.0,
		"openGymEnabled": 1.0, "openGymCreditCost": 21.0, "correctionWindowDays": 91.0,
	} {
		if _, msg := ValidateRules(with(defaultsKV(), key, v)); msg == "" {
			t.Fatalf("%s=%v should be rejected", key, v)
		}
	}
	_, msg := ValidateRulesPatch([]KV{{"requireWaiver", "ya"}})
	eq(t, msg, "requireWaiver: Wajib waiver harus ya/tidak")
	_, msg = ValidateRulesPatch([]KV{{"openGymCreditCost", 21.0}})
	eq(t, msg, "openGymCreditCost: Kredit open gym maksimal 20")

	p, msg := ValidateRulesPatch([]KV{{"openGymEnabled", true}, {"openGymCreditCost", 0.0}, {"requireWaiver", false}})
	eq(t, msg, "")
	r := p.Over(RuleDefaults)
	eq(t, r.OpenGymEnabled, true)
	eq(t, r.OpenGymCreditCost, 0)
	eq(t, r.RequireWaiver, false)
	eq(t, r.CheckinOpensMinBefore, 45)
}

func TestResolveRules(t *testing.T) {
	t.Run("defaults, global, then branch override", func(t *testing.T) {
		rules := ResolveRules(decode(t, `{"qrTtlSec":30,"noShowPolicy":"free"}`), decode(t, `{"qrTtlSec":60}`))
		want := RuleDefaults
		want.QRTTLSec, want.NoShowPolicy = 60, "free"
		eq(t, rules, want)
	})

	t.Run("defaults when nothing is stored", func(t *testing.T) {
		eq(t, ResolveRules(nil, nil), RuleDefaults)
		eq(t, ResolveRules(nil, "garbage"), RuleDefaults)
	})

	t.Run("ignores unknown keys and invalid stored values", func(t *testing.T) {
		got, _ := json.Marshal(SanitizeStoredRules(decode(t, `{"qrTtlSec":5,"creditExpiryDays":"60","foo":1,"lateCancelPolicy":"free"}`)))
		eq(t, string(got), `{"lateCancelPolicy":"free"}`)
		eq(t, SanitizeStoredRules(decode(t, `[1,2]`)), RulesPatch{})
	})
}

func TestValidateRules(t *testing.T) {
	rules, msg := ValidateRules(defaultsKV())
	eq(t, msg, "")
	eq(t, rules, RuleDefaults)

	var partial []KV
	for _, kv := range defaultsKV() {
		if kv.Key != "qrTtlSec" {
			partial = append(partial, kv)
		}
	}
	_, msg = ValidateRules(partial)
	eq(t, msg, "qrTtlSec: Umur QR harus berupa angka")

	_, msg = ValidateRules(with(defaultsKV(), "qrTtlSec", 5.0))
	eq(t, msg, "qrTtlSec: Umur QR minimal 10")
	for key, v := range map[string]any{
		"creditExpiryDays": 0.0, "expiryReminderDays": 0.0, "cancellationDeadlineHours": 1.5, "lateCancelPolicy": "charge",
		"maxFreezeDaysPerYear": -1.0, "minFreezeDays": 0.0, "renewalLeadDays": 31.0,
		"renewalRetryCount": 11.0, "renewalRetryHours": 0.0, "renewalGraceDays": 31.0,
	} {
		if _, msg := ValidateRules(with(defaultsKV(), key, v)); msg == "" {
			t.Fatalf("%s=%v should be rejected", key, v)
		}
	}
	for key, v := range map[string]any{"maxConcurrentBookings": -1.0, "maxBookingsPerDay": 21.0, "strikeLimit": 51.0,
		"strikeWindowDays": 0.0, "strikeSuspendDays": 0.0, "waitlistPromoteCutoffMin": -5.0, "waitlistOfferMinutes": 4.0} {
		if _, msg := ValidateRules(with(defaultsKV(), key, v)); msg == "" {
			t.Fatalf("%s=%v should be rejected", key, v)
		}
	}
	_, msg = ValidateRules(with(defaultsKV(), "waitlistOfferMinutes", 4.0))
	eq(t, msg, "waitlistOfferMinutes: Masa tawaran kursi minimal 5")
	_, msg = ValidateRules(with(defaultsKV(), "cancellationDeadlineHours", 1.5))
	eq(t, msg, "cancellationDeadlineHours: Batas batal harus bilangan bulat")
	_, msg = ValidateRules(with(with(defaultsKV(), "foo", 1.0), "qrTtlSec", 5.0))
	eq(t, msg, "qrTtlSec: Umur QR minimal 10")
}

func TestValidateRulesPatch(t *testing.T) {
	p, msg := ValidateRulesPatch([]KV{{"antiPassbackMin", 30.0}})
	eq(t, msg, "")
	got, _ := json.Marshal(p)
	eq(t, string(got), `{"antiPassbackMin":30}`)

	p, msg = ValidateRulesPatch(nil)
	eq(t, msg, "")
	eq(t, p.IsEmpty(), true)

	_, msg = ValidateRulesPatch([]KV{{"antiPassback", 30.0}, {"zeta", 1.0}})
	eq(t, msg, "Kunci aturan tidak dikenal: antiPassback, zeta")

	_, msg = ValidateRulesPatch([]KV{{"waitlistAutoPromote", "yes"}})
	eq(t, msg, "waitlistAutoPromote: Promosi waitlist harus ya/tidak")

	_, msg = ValidateRulesPatch([]KV{{"allowMemberCreditTransfer", 1.0}})
	eq(t, msg, "allowMemberCreditTransfer: Transfer kredit oleh member harus ya/tidak")
	_, msg = ValidateRulesPatch([]KV{{"maxTransferCreditsPerMonth", 1001.0}})
	eq(t, msg, "maxTransferCreditsPerMonth: Batas transfer kredit per bulan maksimal 1000")
	p, msg = ValidateRulesPatch([]KV{{"allowMemberCreditTransfer", true}, {"maxTransferCreditsPerMonth", 10.0}})
	eq(t, msg, "")
	rules := p.Over(RuleDefaults)
	eq(t, rules.AllowMemberCreditTransfer && rules.MaxTransferCreditsPerMonth == 10, true)

	_, msg = ValidateRulesPatch([]KV{{"qrTtlSec", nil}})
	eq(t, msg, "qrTtlSec: Umur QR harus berupa angka")
}
