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
	want := `{"creditExpiryDays":60,"cancellationDeadlineHours":4,"lateCancelPolicy":"forfeit","noShowPolicy":"forfeit","reEntryGraceMin":15,"antiPassbackMin":60,"qrTtlSec":45,"waitlistAutoPromote":true,"lowBalanceThreshold":3,"expiryReminderDays":7,"bookingOpensDaysBefore":7,"bookingClosesMinBefore":0}`
	eq(t, string(got), want)
	eq(t, len(RuleKeys()), 12)
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
	for key, v := range map[string]any{"creditExpiryDays": 0.0, "expiryReminderDays": 0.0, "cancellationDeadlineHours": 1.5, "lateCancelPolicy": "charge"} {
		if _, msg := ValidateRules(with(defaultsKV(), key, v)); msg == "" {
			t.Fatalf("%s=%v should be rejected", key, v)
		}
	}
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

	_, msg = ValidateRulesPatch([]KV{{"qrTtlSec", nil}})
	eq(t, msg, "qrTtlSec: Umur QR harus berupa angka")
}
