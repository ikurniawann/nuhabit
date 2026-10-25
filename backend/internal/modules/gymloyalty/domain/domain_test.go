package domain

import (
	"reflect"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/localtime"
)

func ptr[T any](v T) *T { return &v }

var ladder = []Tier{
	{ID: "gold", Name: "Gold", MinSpend: 10_000_000, DiscountPercent: 10, EarlyBookingDays: 2, CancelWindowHours: ptr(2), WaitlistPriority: true},
	{ID: "bronze", Name: "Bronze", MinSpend: 1_000_000, DiscountPercent: 3},
	{ID: "silver", Name: "Silver", MinSpend: 5_000_000, DiscountPercent: 5, EarlyBookingDays: 1, WaitlistPriority: true},
}

func TestSpendWindowAndDates(t *testing.T) {
	from, to := SpendWindow("2026-10-28")
	if from != "2025-10-29" || to != "2026-10-28" {
		t.Fatalf("window = %s..%s", from, to)
	}
	// 365 days, so a window holding 29 Feb starts a day later in the year.
	if from, _ := SpendWindow("2024-03-01"); from != "2023-03-03" {
		t.Fatalf("leap window from = %s", from)
	}
	for _, c := range []struct {
		day    Day
		months int
		want   Day
	}{
		{"2026-01-31", 1, "2026-02-28"},
		{"2024-02-29", 12, "2025-02-28"},
		{"2026-10-28", 12, "2027-10-28"},
		{"2026-10-28", 0, "2026-10-28"},
		{"2026-12-15", 3, "2027-03-15"},
	} {
		if got := c.day.AddMonths(c.months); got != c.want {
			t.Errorf("%s + %d months = %s, want %s", c.day, c.months, got, c.want)
		}
	}
	if got := DayOf(time.Date(2026, 10, 27, 18, 30, 0, 0, time.UTC), localtime.Jakarta); got != "2026-10-28" {
		t.Fatalf("Jakarta day of 18:30 UTC = %s", got)
	}
}

func TestTierAssignmentWithHold(t *testing.T) {
	const today Day = "2026-10-28"
	id := func(s string) *string { return &s }
	name := func(t *Tier) string {
		if t == nil {
			return "-"
		}
		return t.Name
	}
	cases := []struct {
		label      string
		spend      float64
		state      State
		tier       string
		validUntil Day
		change     string
	}{
		{"below the ladder", 500_000, State{}, "-", "", ""},
		{"first tier", 1_000_000, State{}, "Bronze", "2027-10-28", "up:-:Bronze"},
		{"jumps two tiers", 12_000_000, State{TierID: id("bronze"), ValidUntil: ptr[Day]("2027-01-01")}, "Gold", "2027-10-28", "up:Bronze:Gold"},
		{"still qualifies, hold renews", 6_000_000, State{TierID: id("silver"), ValidUntil: ptr[Day]("2026-11-01")}, "Silver", "2027-10-28", ""},
		{"spend drops inside the hold", 2_000_000, State{TierID: id("gold"), ValidUntil: ptr[Day]("2026-10-28")}, "Gold", "2026-10-28", ""},
		{"hold over, drops to what spend earns", 2_000_000, State{TierID: id("gold"), ValidUntil: ptr[Day]("2026-10-27")}, "Bronze", "2027-10-28", "down:Gold:Bronze"},
		{"hold over, no tier left", 0, State{TierID: id("silver"), ValidUntil: ptr[Day]("2026-01-01")}, "-", "", "down:Silver:-"},
		{"stored tier removed from the ladder", 0, State{TierID: id("gone"), ValidUntil: ptr[Day]("2027-01-01")}, "-", "", ""},
	}
	for _, c := range cases {
		ev := Evaluate(ladder, c.spend, c.state, today, 12)
		var until Day
		if ev.ValidUntil != nil {
			until = *ev.ValidUntil
		}
		change := ""
		if ev.Change != nil {
			change = ev.Change.Direction + ":" + name(ev.Change.From) + ":" + name(ev.Change.To)
		}
		if name(ev.Tier) != c.tier || until != c.validUntil || change != c.change {
			t.Errorf("%s: tier %s until %q change %q", c.label, name(ev.Tier), until, change)
		}
	}
	// A hold of 0 months keeps the tier for today only.
	if ev := Evaluate(ladder, 1_000_000, State{}, today, 0); *ev.ValidUntil != today {
		t.Fatalf("hold 0 valid until %s", *ev.ValidUntil)
	}
}

func TestNextKeepRankAndPerks(t *testing.T) {
	silver := EarnedTier(ladder, 7_000_000)
	if silver == nil || silver.ID != "silver" || Rank(ladder, "silver") != 2 || Rank(ladder, "nope") != 0 {
		t.Fatalf("earned %v rank %d", silver, Rank(ladder, "silver"))
	}
	if n := NextTier(ladder, silver, 7_000_000); n == nil || n.Tier.ID != "gold" || n.SpendNeeded != 3_000_000 {
		t.Fatalf("next = %+v", n)
	}
	if n := NextTier(ladder, nil, 0); n == nil || n.Tier.ID != "bronze" || n.SpendNeeded != 1_000_000 {
		t.Fatalf("next from nothing = %+v", n)
	}
	gold := &ladder[0]
	if n := NextTier(ladder, gold, 0); n != nil {
		t.Fatalf("next above the top = %+v", n)
	}
	if k := KeepTier(gold, 4_000_000, ptr[Day]("2027-01-01")); k == nil || k.SpendNeeded != 6_000_000 || *k.By != "2027-01-01" {
		t.Fatalf("keep = %+v", k)
	}
	if k := KeepTier(gold, 10_000_000, nil); k != nil {
		t.Fatalf("keep when qualified = %+v", k)
	}
	if p := TierPerks(&ladder[1], 1); p.WaitlistRank != 0 || p.DiscountPercent != 3 {
		t.Fatalf("bronze perks = %+v", p)
	}
	if p := TierPerks(gold, 3); p.WaitlistRank != 3 || p.EarlyBookingDays != 2 || *p.CancelWindowHours != 2 {
		t.Fatalf("gold perks = %+v", p)
	}
	if !reflect.DeepEqual(CleanPerks([]string{"  Guest  pass ", "guest pass", "", "Merch"}), []string{"Guest pass", "Merch"}) {
		t.Fatal("clean perks")
	}
}

func TestPerksMergeTakesTheBetter(t *testing.T) {
	xp := Perks{DiscountPercent: 15}
	spend := Perks{DiscountPercent: 10, EarlyBookingDays: 2, CancelWindowHours: ptr(6), WaitlistRank: 2}
	got := xp.Merge(spend)
	if got.DiscountPercent != 15 || got.EarlyBookingDays != 2 || *got.CancelWindowHours != 6 || got.WaitlistRank != 2 {
		t.Fatalf("merge = %+v", got)
	}
	// The shorter window is the better one, whichever side has it.
	if got := spend.Merge(Perks{CancelWindowHours: ptr(1)}); *got.CancelWindowHours != 1 {
		t.Fatalf("shorter window = %d", *got.CancelWindowHours)
	}
	if got := (Perks{}).Merge(Perks{}); got.CancelWindowHours != nil {
		t.Fatal("no window stays nil")
	}
}

func TestStatusEffects(t *testing.T) {
	now := time.Date(2026, 10, 28, 10, 0, 0, 0, time.UTC)
	later := now.Add(48 * time.Hour)
	earlier := now.Add(-time.Hour)
	cases := []struct {
		s              Standing
		frozen, banned bool
	}{
		{Standing{}, false, false},
		{Standing{Status: StatusActive}, false, false},
		{Standing{Status: StatusSuspended, SuspendedUntil: &later}, true, false},
		{Standing{Status: StatusSuspended, SuspendedUntil: &earlier}, false, false},
		{Standing{Status: StatusBanned}, true, true},
	}
	for i, c := range cases {
		if c.s.Frozen(now) != c.frozen || c.s.Banned(now) != c.banned {
			t.Errorf("case %d: frozen %v banned %v", i, c.s.Frozen(now), c.s.Banned(now))
		}
	}
	for _, c := range []struct {
		change StatusChange
		want   string
	}{
		{StatusChange{Status: StatusActive}, ""},
		{StatusChange{Status: StatusBanned, Reason: "  "}, "Alasan wajib diisi"},
		{StatusChange{Status: StatusBanned, Reason: "Merusak alat"}, ""},
		{StatusChange{Status: StatusSuspended, Reason: "Tunggakan"}, "Tanggal akhir penangguhan harus di masa depan"},
		{StatusChange{Status: StatusSuspended, Reason: "Tunggakan", SuspendedUntil: &earlier}, "Tanggal akhir penangguhan harus di masa depan"},
		{StatusChange{Status: StatusSuspended, Reason: "Tunggakan", SuspendedUntil: &later}, ""},
		{StatusChange{Status: "frozen", Reason: "x"}, "Status tidak dikenal"},
	} {
		if got := c.change.Validate(now); got != c.want {
			t.Errorf("%+v: %q, want %q", c.change, got, c.want)
		}
	}
	n := StatusChange{Status: StatusBanned, Reason: " Merusak alat ", SuspendedUntil: &later}.Normalized()
	if *n.Reason != "Merusak alat" || n.SuspendedUntil != nil {
		t.Fatalf("normalized ban = %+v", n)
	}
	if n := (StatusChange{Status: StatusActive, Reason: "x"}).Normalized(); n.Reason != nil {
		t.Fatalf("normalized active keeps no reason: %+v", n)
	}
}

func TestXPRules(t *testing.T) {
	zone := localtime.Jakarta
	window := OffPeak{Start: 10 * 60, End: 16 * 60}
	at := func(day, hour, minute int) time.Time { return time.Date(2026, 10, day, hour, minute, 0, 0, zone) }
	for _, c := range []struct {
		t    time.Time
		want bool
	}{
		{at(28, 9, 59), false}, {at(28, 10, 0), true}, {at(28, 15, 59), true}, {at(28, 16, 0), false},
	} {
		if window.Contains(c.t, zone) != c.want {
			t.Errorf("off-peak %s = %v", c.t, !c.want)
		}
	}
	// 10:00 WITA is 09:00 WIB: the branch zone decides.
	if !window.Contains(time.Date(2026, 10, 28, 3, 0, 0, 0, time.UTC), localtime.Zone("Asia/Makassar")) {
		t.Fatal("off-peak reads the branch zone")
	}

	s := Settings{XPPurchasePerStep: 1, PurchaseStepIdr: 10_000}
	if PurchaseXP(1_250_000, s) != 125 || PurchaseXP(9_999, s) != 0 || PurchaseXP(0, s) != 0 {
		t.Fatal("purchase XP")
	}

	// Weeks of 26 Oct, 19 Oct, 12 Oct 2026 (Mondays). Two sessions in the
	// week of 5 Oct break nothing because the week of 12 Oct is short.
	attended := []time.Time{
		at(26, 7, 0), at(27, 7, 0), at(28, 7, 0),
		at(19, 7, 0), at(21, 7, 0), at(25, 20, 0),
		at(12, 7, 0), at(13, 7, 0),
		at(5, 7, 0), at(6, 7, 0), at(7, 7, 0),
	}
	if got := StreakWeeks(attended, at(28, 12, 0), zone, 3); got != 2 {
		t.Fatalf("streak = %d", got)
	}
	if got := StreakWeeks(attended, at(28, 12, 0), zone, 2); got != 4 {
		t.Fatalf("streak with 2 a week = %d", got)
	}
	if got := StreakWeeks(attended[:2], at(28, 12, 0), zone, 3); got != 0 {
		t.Fatalf("short week = %d", got)
	}
	if FourWeekStreak(0) || FourWeekStreak(3) || !FourWeekStreak(4) || !FourWeekStreak(8) {
		t.Fatal("4-week streak")
	}

	paid := at(28, 9, 0)
	if (Renewal{PaidAt: paid}).Early() || (Renewal{PaidAt: paid, PassRunsUntil: ptr(at(27, 9, 0))}).Early() {
		t.Fatal("no running package is not early")
	}
	if !(Renewal{PaidAt: paid, PassRunsUntil: ptr(at(30, 9, 0))}).Early() || !(Renewal{PaidAt: paid, CreditsLeft: 2}).Early() {
		t.Fatal("running pass or credits left is early")
	}
}

func TestLeaderboardHelpers(t *testing.T) {
	for in, want := range map[string]string{"Maya Kartika Sari": "Maya K.", "budi": "budi", "  ": "Atlet", "ana  ëlse": "ana Ë."} {
		if got := LeaderboardAlias(in); got != want {
			t.Errorf("alias(%q) = %q, want %q", in, got, want)
		}
	}
	if got := CompetitionRanks([]int{9, 9, 7, 5, 5, 1}); !reflect.DeepEqual(got, []int{1, 1, 3, 4, 4, 6}) {
		t.Fatalf("ranks = %v", got)
	}
}
