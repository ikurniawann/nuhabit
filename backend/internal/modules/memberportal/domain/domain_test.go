package domain

import (
	"encoding/json"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestNormalizePhoneDigits(t *testing.T) {
	cases := map[string]string{
		"0812-3456-789":      "628123456789",
		"+62 812 3456 789":   "628123456789",
		"":                   "",
		"0812":               "",
		"628123456789012345": "",
	}
	for in, want := range cases {
		if got := NormalizePhoneDigits(in); got != want {
			t.Errorf("NormalizePhoneDigits(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestOTPCodeAndHash(t *testing.T) {
	re := regexp.MustCompile(`^\d{6}$`)
	for i := 0; i < 50; i++ {
		code, err := GenerateOTPCode()
		if err != nil || !re.MatchString(code) {
			t.Fatalf("code %q err %v", code, err)
		}
	}
	if HashSecret("123456") != HashSecret("123456") || strings.Contains(HashSecret("123456"), "123456") {
		t.Fatal("hash must be deterministic and not plaintext")
	}
	// Same digest Node's createHash("sha256") produces.
	if HashSecret("abc") != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
		t.Fatal("unexpected sha256")
	}
}

func TestSafeEqual(t *testing.T) {
	if !SafeEqual("a", "a") || SafeEqual("a", "b") || SafeEqual("", "") || SafeEqual("a", "") {
		t.Fatal("SafeEqual mismatch")
	}
}

func TestBearerToken(t *testing.T) {
	cases := map[string]string{
		"Bearer abc123":     "abc123",
		"bearer abc123":     "abc123",
		"BEARER   abc123":   "abc123",
		"  Bearer abc123  ": "abc123",
		"Basic abc123":      "",
		"abc123":            "",
		"Bearer ":           "",
		"":                  "",
	}
	for in, want := range cases {
		if got := BearerToken(in); got != want {
			t.Errorf("BearerToken(%q) = %q, want %q", in, got, want)
		}
	}
}

const (
	localDB  = "postgresql://ilham@localhost:5432/arkiv"
	remoteDB = "postgresql://user:pw@db.suluinwounderland.com:5432/arkiv"
)

func TestIsLocalDatabase(t *testing.T) {
	if !IsLocalDatabase(localDB) || !IsLocalDatabase("postgresql://u@127.0.0.1:5432/db") {
		t.Fatal("local not detected")
	}
	if IsLocalDatabase(remoteDB) || IsLocalDatabase("") || IsLocalDatabase("bukan-url") {
		t.Fatal("non-local accepted")
	}
}

func TestDevBypassGuards(t *testing.T) {
	on := DevBypass{Code: "000000", DatabaseURL: localDB}
	if on.ActiveCode() != "000000" || !on.CanBypass("") || !on.CanBypass("000000") || on.CanBypass("000001") {
		t.Fatal("bypass should be active for local dev")
	}
	off := []DevBypass{
		{Production: true, Code: "000000", DatabaseURL: localDB},
		{Code: "", DatabaseURL: localDB},
		{Code: "   ", DatabaseURL: localDB},
		{Code: "000000", DatabaseURL: remoteDB},
	}
	for _, d := range off {
		if d.Active() || d.CanBypass("") || d.CanBypass("000000") {
			t.Fatalf("bypass must be off: %+v", d)
		}
	}
}

var today = time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)

func TestValidateRegistration(t *testing.T) {
	reg, err := ValidateRegistration(RegistrationInput{
		Phone: "0812-3456-7890", Name: "  Sari   Dewi ", Email: " Sari@Mail.COM ", WAConsent: true,
	}, today)
	if err != nil {
		t.Fatal(err)
	}
	if reg.PhoneDigits != "6281234567890" || reg.PhoneLocal != "081234567890" || reg.Name != "Sari Dewi" ||
		reg.Email == nil || *reg.Email != "sari@mail.com" || reg.BirthDate != nil || !reg.WAConsent {
		t.Fatalf("unexpected %+v", reg)
	}

	reg, err = ValidateRegistration(RegistrationInput{Phone: "+62 812 3456 7890", Name: "Budi", Email: "", BirthDate: ""}, today)
	if err != nil || reg.Email != nil || reg.BirthDate != nil || reg.WAConsent {
		t.Fatalf("optional fields: %+v %v", reg, err)
	}

	bad := []struct {
		in    RegistrationInput
		field string
	}{
		{RegistrationInput{Phone: "0812", Name: "Budi"}, "phone"},
		{RegistrationInput{Phone: "081234567890", Name: " B "}, "name"},
		{RegistrationInput{Phone: "081234567890", Name: strings.Repeat("x", 101)}, "name"},
		{RegistrationInput{Phone: "081234567890", Name: "Budi", Email: "budi@"}, "email"},
		{RegistrationInput{Phone: "081234567890", Name: "Budi", BirthDate: "2026-02-30"}, "birth_date"},
		{RegistrationInput{Phone: 812345678.0, Name: "Budi"}, "phone"},
		{RegistrationInput{Phone: "081234567890", Name: nil}, "name"},
	}
	for _, c := range bad {
		if _, err := ValidateRegistration(c.in, today); err == nil || err.Field != c.field {
			t.Errorf("%+v: got %v, want field %s", c.in, err, c.field)
		}
	}
}

func TestIsValidBirthDate(t *testing.T) {
	if !IsValidBirthDate("1990-05-17", today) {
		t.Fatal("valid date rejected")
	}
	for _, v := range []string{"2024-01-01", "1890-01-01", "1990-13-01", "17-05-1990"} {
		if IsValidBirthDate(v, today) {
			t.Errorf("%s accepted", v)
		}
	}
	if LocalPhoneFormat("6281234567890") != "081234567890" || LocalPhoneFormat("6512345678") != "6512345678" {
		t.Fatal("LocalPhoneFormat")
	}
}

func str(s string) *string { return &s }

func TestComputeProfileCompletion(t *testing.T) {
	no := false
	full := ProfileFields{
		Name: str("Wahyu"), Phone: str("628123456789"), Email: str("w@x.id"), BirthDate: str("2000-01-01"),
		Gender: str("male"), City: str("Bandung"), PhotoURL: str("/foto.jpg"), WAConsent: &no,
	}
	if c := ComputeProfileCompletion(full); c.Percent != 100 || !c.Complete {
		t.Fatalf("full: %+v", c)
	}
	partial := full
	partial.City = str("")
	partial.PhotoURL = nil
	partial.WAConsent = nil
	c := ComputeProfileCompletion(partial)
	if c.Complete || c.Percent != 63 || !reflect.DeepEqual(c.Missing, []string{"city", "photo_url", "wa_consent"}) {
		t.Fatalf("partial: %+v", c)
	}
	if got := MissingLabels(c.Missing); !reflect.DeepEqual(got, []string{"Kota/domisili", "Foto profil", "Pilihan promo WA"}) {
		t.Fatalf("labels %v", got)
	}
}

func TestResolveTierByXP(t *testing.T) {
	tiers := []Tier{{Code: "regular", MinLifetimeXP: 0}, {Code: "silver", MinLifetimeXP: 100}, {Code: "gold", MinLifetimeXP: 300}}
	if ResolveTierByXP(tiers, 150).Code != "silver" || ResolveTierByXP(tiers, 0).Code != "regular" ||
		ResolveTierByXP(tiers, 999).Code != "gold" || ResolveTierByXP(nil, 5) != nil {
		t.Fatal("tier resolution")
	}
	shifted := []Tier{{Code: "bronze", MinLifetimeXP: 50}}
	if ResolveTierByXP(shifted, 0).Code != "bronze" {
		t.Fatal("below first tier keeps the first tier")
	}
	if NextTier(tiers, 150).Code != "gold" || NextTier(tiers, 300) != nil {
		t.Fatal("next tier")
	}
}

func TestPortalLinks(t *testing.T) {
	if l := ParsePortalLink("events"); l == nil || l.Tab != "events" {
		t.Fatal("tab")
	}
	if l := ParsePortalLink(" promo:kopi-10 "); l == nil || l.Promo != "KOPI-10" {
		t.Fatal("promo")
	}
	for _, v := range []string{"https://example.com", "admin", "promo:", "promo:a b"} {
		if ParsePortalLink(v) != nil {
			t.Errorf("%q accepted", v)
		}
	}
	if PortalURL("challenges") != "/member?go=challenges" || PortalURL("javascript:alert(1)") != "/member" {
		t.Fatal("portal url")
	}
	if LinkForNotificationType("booking_waitlist") != "events" || LinkForNotificationType("challenge_completed") != "challenges" ||
		LinkForNotificationType("announcement") != "" {
		t.Fatal("notification link")
	}
	if h := GoLinkHref(str("promo:hemat")); h == nil || *h != "/member/promos/HEMAT" {
		t.Fatal("go link promo")
	}
	if GoLinkHref(str("home")) != nil || GoLinkHref(nil) != nil {
		t.Fatal("home has no route")
	}
	if h := GoLinkHref(str("credits")); h == nil || *h != "/member/wallet" {
		t.Fatal("credits route")
	}
}

func i64(v int64) *int64     { return &v }
func f64(v float64) *float64 { return &v }

func promoRow(mod func(*PromoRow)) PromoRow {
	r := PromoRow{
		CampaignID: "c1", Name: "Diskon Oktober", DiscountType: "percent", Value: 10, MaxDiscount: f64(20_000),
		MinPurchase: 50_000, ValidFrom: str("2026-10-01"), ValidUntil: str("2026-10-31"), PerPhoneLimit: i64(1),
		Scope: "pos", IsActive: true, ShowInMemberPortal: true, Code: "OKT10", CodeIsActive: true,
	}
	if mod != nil {
		mod(&r)
	}
	return r
}

func TestMemberPromos(t *testing.T) {
	const day = "2026-10-04"
	if !IsMemberVisiblePromo(promoRow(nil), day) {
		t.Fatal("visible")
	}
	hidden := []func(*PromoRow){
		func(r *PromoRow) { r.ShowInMemberPortal = false },
		func(r *PromoRow) { r.IsActive = false },
		func(r *PromoRow) { r.CodeIsActive = false },
		func(r *PromoRow) { r.ValidFrom = str("2026-10-05") },
		func(r *PromoRow) { r.ValidUntil = str("2026-10-03") },
		func(r *PromoRow) { r.CodeUsageLimit = i64(1) },
		func(r *PromoRow) { r.CodeUsageLimit = i64(50); r.CodeUsageCount = 50 },
		func(r *PromoRow) { r.UsageLimit = i64(5); r.CampaignUsedCount = 5 },
	}
	for i, mod := range hidden {
		if IsMemberVisiblePromo(promoRow(mod), day) {
			t.Errorf("case %d should be hidden", i)
		}
	}
	if !IsMemberVisiblePromo(promoRow(func(r *PromoRow) {
		r.CodeUsageLimit = i64(50)
		r.CodeUsageCount = 10
		r.UsageLimit = i64(5)
		r.CampaignUsedCount = 5
	}), day) {
		t.Fatal("code limit wins over campaign limit")
	}

	promos := SelectMemberPromos([]PromoRow{
		promoRow(func(r *PromoRow) { r.MyUsedCount = 1 }),
		promoRow(func(r *PromoRow) { r.Code = "OKT10B" }),
		promoRow(func(r *PromoRow) {
			r.CampaignID, r.Code, r.DiscountType, r.Value, r.MaxDiscount, r.PerPhoneLimit = "c2", "HEMAT", "fixed", 15_000, f64(99), nil
		}),
		promoRow(func(r *PromoRow) { r.CampaignID, r.Code, r.ShowInMemberPortal = "c3", "RAHASIA", false }),
	}, day)
	if len(promos) != 2 || promos[0].Code != "OKT10" || promos[1].Code != "HEMAT" || !promos[0].UsedUp ||
		promos[1].UsedUp || promos[1].MaxDiscount != nil || promos[1].PerMemberLimit != nil {
		t.Fatalf("select: %+v", promos)
	}
}

func TestEvaluateBooking(t *testing.T) {
	now := time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
	ev := BookableEvent{Status: "published", StartsAt: now.Add(48 * time.Hour), Capacity: 2, BookingClosesHours: 2}
	if d := EvaluateBooking(ev, 0, 0, false, now); d.Kind != "confirm" {
		t.Fatal(d)
	}
	if d := EvaluateBooking(ev, 2, 3, false, now); d.Kind != "waitlist" || d.Position != 4 {
		t.Fatal(d)
	}
	if d := EvaluateBooking(ev, 0, 0, true, now); d.Reason != "already_booked" {
		t.Fatal(d)
	}
	closed := ev
	closed.StartsAt = now.Add(time.Hour)
	if d := EvaluateBooking(closed, 0, 0, false, now); d.Reason != "booking_closed" {
		t.Fatal(d)
	}
	started := ev
	started.StartsAt = now
	if d := EvaluateBooking(started, 0, 0, false, now); d.Reason != "event_started" {
		t.Fatal(d)
	}
	draft := ev
	draft.Status = "draft"
	if d := EvaluateBooking(draft, 0, 0, false, now); d.Reason != "event_not_open" {
		t.Fatal(d)
	}
	b, _ := json.Marshal(BookingDecision{Kind: "confirm"})
	if string(b) != `{"kind":"confirm"}` {
		t.Fatal(string(b))
	}
}

func TestChallengeAndReviewRules(t *testing.T) {
	if p := Progress(5, 10); p.Pct != 50 || p.Completed {
		t.Fatal(p)
	}
	if p := Progress(15, 10); p.Pct != 100 || !p.Completed {
		t.Fatal(p)
	}
	if LeaderboardName(str("Sari Dewi Putri")) != "Sari P." || LeaderboardName(nil) != "Member" || LeaderboardName(str("  ")) != "Member" {
		t.Fatal("leaderboard name")
	}
	now := time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
	cust := "c1"
	order := &ReviewableOrder{CustomerID: &cust, PaymentStatus: "paid", Status: "completed", PaidAt: now.Add(-24 * time.Hour)}
	if r := ReviewEligibility(order, "c1", now, false); r != "" {
		t.Fatal(r)
	}
	if r := ReviewEligibility(order, "c2", now, false); r != "bukan-order-member" {
		t.Fatal(r)
	}
	if r := ReviewEligibility(order, "c1", now, true); r != "sudah-diulas" {
		t.Fatal(r)
	}
	old := *order
	old.PaidAt = now.Add(-15 * 24 * time.Hour)
	if r := ReviewEligibility(&old, "c1", now, false); r != "lewat-batas-waktu" {
		t.Fatal(r)
	}
	if CleanReviewText(str("   "), 10) != nil || *CleanReviewText(str(" halo dunia panjang "), 4) != "halo" {
		t.Fatal("clean text")
	}
	if got := FormatWIB(time.Date(2026, 10, 5, 8, 0, 0, 0, time.UTC)); got != "Sen, 5 Okt, 15.00" {
		t.Fatal(got)
	}
}

func TestRateLimiter(t *testing.T) {
	l := NewRateLimiter()
	rule := RateRule{Limit: 2, Window: time.Minute}
	now := time.Now()
	if !l.Allow("k", rule, now) || !l.Allow("k", rule, now) || l.Allow("k", rule, now) {
		t.Fatal("limit not enforced")
	}
	if !l.Allow("k", rule, now.Add(61*time.Second)) {
		t.Fatal("window did not slide")
	}
}

func TestWalletRules(t *testing.T) {
	if FormatRupiah(10000) != "Rp10.000" || FormatRupiah(-1500) != "-Rp1.500" || FormatRupiah(999) != "Rp999" {
		t.Fatal(FormatRupiah(10000))
	}
	if CheckFreeAmount(5000, 10000, 0) != "Minimal top-up Rp10.000" || CheckFreeAmount(10.5, 1, 0) != "Nominal top-up tidak valid" ||
		CheckFreeAmount(20_000_000, 10000, 10_000_000) != "Maksimal top-up Rp10.000.000" || CheckFreeAmount(50000, 10000, 0) != "" {
		t.Fatal("free amount")
	}
	if !reflect.DeepEqual(NormalizeTopupPresets(json.RawMessage(`[100000, "50000", 0, 100000]`)), []float64{50000, 100000}) {
		t.Fatal("presets")
	}
	if !reflect.DeepEqual(NormalizeTopupPresets(json.RawMessage(`"[20000]"`)), []float64{20000}) {
		t.Fatal("string presets")
	}
	if len(NormalizeTopupPresets(nil)) != 5 {
		t.Fatal("default presets")
	}
	s := DefaultLoyaltySettings()
	if CalculateTopupXP(25000, s) != 2 {
		t.Fatal("per amount xp")
	}
	s.TopupXPMode, s.TopupXPValue = "fixed", 7
	if CalculateTopupXP(25000, s) != 7 {
		t.Fatal("fixed xp")
	}
	if !ParseFeatureFlag(nil, true) || ParseFeatureFlag(json.RawMessage(`false`), true) || ParseFeatureFlag(json.RawMessage(`"0"`), true) {
		t.Fatal("feature flag")
	}
	id, amount, ok := PickPaidXenditPayment([]map[string]any{{"status": "PENDING", "id": "a"}, {"status": "succeeded", "id": "b", "amount": 5000.0}})
	if !ok || id != "b" || amount != 5000 {
		t.Fatal("paid payment")
	}
	if !IsXenditQrPaid(map[string]any{"payments": []any{map[string]any{"status": "PAID"}}}) || IsXenditQrPaid(map[string]any{"status": "ACTIVE"}) {
		t.Fatal("qr paid")
	}
}
