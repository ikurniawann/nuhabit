package domain

import (
	"reflect"
	"regexp"
	"testing"
	"time"
)

func at(s string) time.Time {
	for _, layout := range []string{time.RFC3339Nano, time.DateOnly} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	panic("bad time " + s)
}

func ptr[T any](v T) *T { return &v }

func TestGenerateCode(t *testing.T) {
	seen := map[string]bool{}
	ambiguous := regexp.MustCompile(`[0O1I]`)
	for range 200 {
		code := GenerateCode()
		if len(code) != 12 || !IsValidCodeFormat(code) || ambiguous.MatchString(code) {
			t.Fatalf("bad code %q", code)
		}
		seen[code] = true
	}
	if len(seen) != 200 {
		t.Fatalf("codes collided: %d unique", len(seen))
	}
}

func TestCodeFormatAndNormalize(t *testing.T) {
	for code, want := range map[string]bool{
		"ABCD2345EFGH": true, "AB12": false, "abcd2345efgh": false, "ABCD-2345-EFGH": false,
	} {
		if IsValidCodeFormat(code) != want {
			t.Errorf("IsValidCodeFormat(%q) != %v", code, want)
		}
	}
	if got := NormalizeCode(" gcabcd1234 \n"); got != "GCABCD1234" {
		t.Errorf("NormalizeCode = %q", got)
	}
}

func TestIsExpired(t *testing.T) {
	if IsExpired(nil, at("2027-01-01")) {
		t.Error("nil expiry expired")
	}
	exp := at("2026-08-01")
	for now, want := range map[string]bool{"2026-08-02": true, "2026-08-01": false, "2026-07-31": false} {
		if IsExpired(&exp, at(now)) != want {
			t.Errorf("IsExpired(%s) != %v", now, want)
		}
	}
}

func TestEvaluateRedeem(t *testing.T) {
	now := at("2026-08-01")
	card := func(status string, balance float64, exp *time.Time) State {
		return State{Status: status, Balance: balance, ExpiresAt: exp}
	}
	tests := []struct {
		name   string
		card   State
		amount float64
		want   RedeemResult
	}{
		{"full redeem exhausts", card("active", 50_000, nil), 50_000, RedeemResult{OK: true, BalanceAfter: 0, StatusAfter: "exhausted"}},
		{"partial stays active", card("active", 100_000, nil), 30_000, RedeemResult{OK: true, BalanceAfter: 70_000, StatusAfter: "active"}},
		{"low balance", card("active", 10_000, nil), 50_000, RedeemResult{Reason: "saldo-kurang"}},
		{"zero amount", card("active", 100_000, nil), 0, RedeemResult{Reason: "nominal-tidak-valid"}},
		{"negative amount", card("active", 100_000, nil), -1000, RedeemResult{Reason: "nominal-tidak-valid"}},
		{"disabled", card("disabled", 100_000, nil), 10_000, RedeemResult{Reason: "nonaktif"}},
		{"exhausted", card("exhausted", 100_000, nil), 10_000, RedeemResult{Reason: "nonaktif"}},
		{"pending", card("pending", 100_000, nil), 10_000, RedeemResult{Reason: "nonaktif"}},
		{"expired status", card("expired", 100_000, nil), 10_000, RedeemResult{Reason: "kedaluwarsa"}},
		{"expired date", card("active", 100_000, ptr(at("2026-07-01"))), 10_000, RedeemResult{Reason: "kedaluwarsa"}},
	}
	for _, tc := range tests {
		if got := EvaluateRedeem(tc.card, tc.amount, now); got != tc.want {
			t.Errorf("%s: got %+v, want %+v", tc.name, got, tc.want)
		}
	}
}

func TestBalanceMath(t *testing.T) {
	for _, c := range [][3]float64{{0, 100_000, 100_000}, {50_000, 25_000, 75_000}} {
		if got, err := BalanceAfterIssue(c[0], c[1]); err != nil || got != c[2] {
			t.Errorf("BalanceAfterIssue(%v, %v) = %v, %v", c[0], c[1], got, err)
		}
	}
	for _, amount := range []float64{0, -1} {
		if _, err := BalanceAfterIssue(0, amount); err == nil {
			t.Errorf("BalanceAfterIssue(0, %v) accepted", amount)
		}
	}
	for _, c := range [][3]float64{{50_000, 10_000, 60_000}, {50_000, -10_000, 40_000}} {
		if got, err := BalanceAfterCorrection(c[0], c[1]); err != nil || got != c[2] {
			t.Errorf("BalanceAfterCorrection(%v, %v) = %v, %v", c[0], c[1], got, err)
		}
	}
	if _, err := BalanceAfterCorrection(10_000, -20_000); err != ErrNegativeBalance {
		t.Errorf("negative correction: %v", err)
	}
}

func TestStatusAfterRefund(t *testing.T) {
	tests := []struct {
		status  string
		balance float64
		want    string
	}{
		{"exhausted", 50_000, "active"},
		{"active", 50_000, "active"},
		{"exhausted", 0, "exhausted"},
		{"active", 0, "exhausted"},
		{"disabled", 50_000, "disabled"},
		{"expired", 50_000, "expired"},
	}
	for _, tc := range tests {
		if got := StatusAfterRefund(tc.status, tc.balance); got != tc.want {
			t.Errorf("StatusAfterRefund(%s, %v) = %s, want %s", tc.status, tc.balance, got, tc.want)
		}
	}
}

func TestEvaluateReload(t *testing.T) {
	now := at("2026-10-04T05:00:00.000Z")
	card := State{Status: "active", Balance: 20_000}
	if got := EvaluateReload(card, 0, 50_000, now); got != (ReloadResult{OK: true, BalanceAfter: 70_000, ReloadedTotalAfter: 50_000, StatusAfter: "active"}) {
		t.Errorf("reload: %+v", got)
	}
	first := EvaluateReload(card, 0, 10_000, now)
	second := EvaluateReload(State{Status: "active", Balance: first.BalanceAfter}, first.ReloadedTotalAfter, 15_000, now)
	if !second.OK || second.BalanceAfter != 45_000 || second.ReloadedTotalAfter != 25_000 {
		t.Errorf("accumulated reload: %+v", second)
	}
	if got := EvaluateReload(State{Status: "exhausted"}, 0, 25_000, now); !got.OK || got.BalanceAfter != 25_000 || got.StatusAfter != "active" {
		t.Errorf("exhausted card reload: %+v", got)
	}
	for status, reason := range map[string]string{"disabled": "nonaktif", "pending": "nonaktif", "expired": "kedaluwarsa"} {
		if got := EvaluateReload(State{Status: status, Balance: 20_000}, 0, 10_000, now); got != (ReloadResult{Reason: reason}) {
			t.Errorf("status %s: %+v", status, got)
		}
	}
	past := at("2026-10-01T00:00:00.000Z")
	if got := EvaluateReload(State{Status: "active", Balance: 20_000, ExpiresAt: &past}, 0, 10_000, now); got.Reason != "kedaluwarsa" {
		t.Errorf("expired date: %+v", got)
	}
	for _, amount := range []float64{0, -5_000, 1_000.5} {
		if got := EvaluateReload(card, 0, amount, now); got != (ReloadResult{Reason: "nominal-tidak-valid"}) {
			t.Errorf("amount %v: %+v", amount, got)
		}
	}
	if got := EvaluateReload(State{Status: "active", Balance: MaxValue - 1_000}, 0, 2_000, now); got.Reason != "melebihi-plafon" {
		t.Errorf("ceiling: %+v", got)
	}
	if ReloadMessages[ReasonOverCeiling] != "Saldo setelah reload melebihi plafon Rp100.000.000" {
		t.Errorf("ceiling message: %q", ReloadMessages[ReasonOverCeiling])
	}
}

func TestParseConfig(t *testing.T) {
	def := DefaultConfig()
	months := func(c Config) any {
		if c.ExpiryMonths == nil {
			return nil
		}
		return *c.ExpiryMonths
	}
	if got := ParseConfig(nil); !reflect.DeepEqual(got, def) {
		t.Errorf("nil: %+v", got)
	}
	if got := ParseConfig(map[string]any{}); !reflect.DeepEqual(got, def) {
		t.Errorf("empty: %+v", got)
	}
	got := ParseConfig(map[string]any{"presets": []any{200_000.0, 50_000.0, 50_000.0, 0.0, -1000.0, 100_000.0}})
	if !reflect.DeepEqual(got.Presets, []float64{50_000, 100_000, 200_000}) {
		t.Errorf("presets cleanup: %v", got.Presets)
	}
	for _, raw := range []any{[]any{}, "banyak", []any{0.0, -5.0}} {
		if got := ParseConfig(map[string]any{"presets": raw}); !reflect.DeepEqual(got.Presets, def.Presets) {
			t.Errorf("presets %v: %v", raw, got.Presets)
		}
	}
	many := []any{}
	for i := 1; i <= 30; i++ {
		many = append(many, float64(i*10_000))
	}
	if got := ParseConfig(map[string]any{"presets": many}); len(got.Presets) != 12 {
		t.Errorf("presets cap: %d", len(got.Presets))
	}
	for raw, want := range map[any]any{nil: nil, 12.0: 12, 0.0: 1, 999.0: 120, "dua": nil, 1e300: 120} {
		if got := months(ParseConfig(map[string]any{"expiry_months": raw})); got != want {
			t.Errorf("expiry_months %v: %v, want %v", raw, got, want)
		}
	}
	for raw, want := range map[any]bool{true: true, false: false, "ya": true} {
		if got := ParseConfig(map[string]any{"allow_custom": raw}).AllowCustom; got != want {
			t.Errorf("allow_custom %v: %v", raw, got)
		}
	}
}

func TestIsAllowedNominal(t *testing.T) {
	custom := DefaultConfig()
	presetOnly := Config{Presets: []float64{50_000, 100_000}}
	tests := []struct {
		cfg     Config
		nominal float64
		want    bool
	}{
		{custom, 75_000, true},
		{presetOnly, 100_000, true},
		{presetOnly, 75_000, false},
		{custom, 0, false},
		{custom, -50_000, false},
		{custom, 50_000.5, false},
		{custom, 100_000_000, true},
		{custom, 100_000_001, false},
	}
	for _, tc := range tests {
		if got := IsAllowedNominal(tc.cfg, tc.nominal); got != tc.want {
			t.Errorf("IsAllowedNominal(%+v, %v) = %v", tc.cfg, tc.nominal, got)
		}
	}
	if got := NominalRejection(presetOnly); got != "Nominal gift card harus salah satu dari: Rp50.000, Rp100.000" {
		t.Errorf("NominalRejection = %q", got)
	}
}

func TestResolveExpiry(t *testing.T) {
	if ResolveExpiry(nil, at("2026-07-27T10:00:00.000Z")) != nil {
		t.Error("nil months must not expire")
	}
	tests := []struct {
		months int
		issued string
		want   string
	}{
		{6, "2026-07-27T10:00:00.000Z", "2027-01-27T10:00:00Z"},
		{12, "2026-07-27T10:00:00.000Z", "2027-07-27T10:00:00Z"},
		{1, "2026-01-31T00:00:00.000Z", "2026-02-28T00:00:00Z"},
		{1, "2028-01-31T00:00:00.000Z", "2028-02-29T00:00:00Z"},
	}
	for _, tc := range tests {
		if got := ResolveExpiry(&tc.months, at(tc.issued)).Format(time.RFC3339); got != tc.want {
			t.Errorf("ResolveExpiry(%d, %s) = %s, want %s", tc.months, tc.issued, got, tc.want)
		}
	}
}

func TestPhoneMatchKey(t *testing.T) {
	key := PhoneMatchKey("0812-3456-789")
	if key != "8123456789" || PhoneMatchKey("+62 812 3456 789") != key || PhoneMatchKey("62812345678 9") != key {
		t.Errorf("phone keys differ: %q", key)
	}
}

func TestLocaleID(t *testing.T) {
	for v, want := range map[float64]string{0: "0", 950: "950", 50_000: "50.000", 100_000_000: "100.000.000", 1500.5: "1.500,5", 2.12345: "2,123"} {
		if got := LocaleID(v); got != want {
			t.Errorf("LocaleID(%v) = %q, want %q", v, got, want)
		}
	}
}
