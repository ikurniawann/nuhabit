package domain

import (
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Rules for rewards, collectibles (avatars and wallpapers) and badges
// (lib/crm/rewards.ts, collectibles.ts, collectibles-server.ts, badges.ts).
// XP is a lifetime score: redeeming never lowers it, min_xp is a gate.

// ── Rewards ───────────────────────────────────────────────────────────────

// QuotaPeriodLabels mirrors QUOTA_PERIOD_LABELS.
var QuotaPeriodLabels = map[string]string{
	"total":   "Total (seumur hidup)",
	"daily":   "Per hari",
	"monthly": "Per bulan",
	"yearly":  "Per tahun",
}

// ActiveRedemptionStatuses still hold quota and stock.
var ActiveRedemptionStatuses = []string{"pending", "approved", "fulfilled"}

var rewardBlockerMessages = map[string]string{
	"not_redeemable":  "Reward ini tidak bisa ditukar",
	"inactive":        "Reward sedang tidak tersedia",
	"not_started":     "Periode reward belum dimulai",
	"ended":           "Periode reward sudah berakhir",
	"out_of_stock":    "Stok reward habis",
	"insufficient_xp": "XP kamu belum mencukupi",
	"tier_too_low":    "Tier kamu belum memenuhi syarat",
	"quota_exhausted": "Jatah redeem kamu untuk reward ini sudah habis",
}

// RewardGate is the reward side of the eligibility check.
type RewardGate struct {
	IsActive                bool
	RewardType              string
	MinXP                   float64
	RequiredTierRank        *int
	StockTotal              *int
	StockRedeemed           int
	MaxRedemptionsPerMember *int
	StartsAt, EndsAt        *time.Time
}

// RewardMemberState is the member side of the eligibility check.
type RewardMemberState struct {
	TotalXP          float64
	TierRank         *int
	RedeemedInWindow int
}

// RewardEligibility mirrors EligibilityResult.
type RewardEligibility struct {
	Eligible       bool
	Blockers       []string
	Reason         *string
	XPNeeded       float64
	RemainingStock *int
	RemainingQuota *int
}

// EvaluateRewardEligibility mirrors evaluateRewardEligibility. Blockers are
// collected in a fixed order and the first one is the reason.
func EvaluateRewardEligibility(r RewardGate, m RewardMemberState, now time.Time) RewardEligibility {
	blockers := []string{}
	if r.RewardType == "avatar" {
		blockers = append(blockers, "not_redeemable")
	}
	if !r.IsActive {
		blockers = append(blockers, "inactive")
	}
	if r.StartsAt != nil && now.Before(*r.StartsAt) {
		blockers = append(blockers, "not_started")
	}
	if r.EndsAt != nil && now.After(*r.EndsAt) {
		blockers = append(blockers, "ended")
	}

	var remainingStock *int
	if r.StockTotal != nil {
		n := max(0, *r.StockTotal-r.StockRedeemed)
		remainingStock = &n
		if n <= 0 {
			blockers = append(blockers, "out_of_stock")
		}
	}

	xpNeeded := math.Max(0, math.Max(0, r.MinXP)-m.TotalXP)
	if xpNeeded > 0 {
		blockers = append(blockers, "insufficient_xp")
	}

	if r.RequiredTierRank != nil {
		rank := 0
		if m.TierRank != nil {
			rank = *m.TierRank
		}
		if rank < *r.RequiredTierRank {
			blockers = append(blockers, "tier_too_low")
		}
	}

	var remainingQuota *int
	if r.MaxRedemptionsPerMember != nil {
		n := max(0, *r.MaxRedemptionsPerMember-m.RedeemedInWindow)
		remainingQuota = &n
		if n <= 0 {
			blockers = append(blockers, "quota_exhausted")
		}
	}

	result := RewardEligibility{
		Eligible:       len(blockers) == 0,
		Blockers:       blockers,
		XPNeeded:       xpNeeded,
		RemainingStock: remainingStock,
		RemainingQuota: remainingQuota,
	}
	if len(blockers) > 0 {
		reason := rewardBlockerMessages[blockers[0]]
		result.Reason = &reason
	}
	return result
}

// wib is the venue clock (UTC+7, no DST).
var wib = time.FixedZone("WIB", 7*3600)

// QuotaWindowStart is the start of the quota window on the WIB calendar, or
// nil for "total". Any other period counts per month, like the TS fallback.
func QuotaWindowStart(period string, now time.Time) *time.Time {
	if period == "total" {
		return nil
	}
	local := now.In(wib)
	month, day := local.Month(), 1
	switch period {
	case "yearly":
		month = time.January
	case "daily":
		day = local.Day()
	}
	start := time.Date(local.Year(), month, day, 0, 0, 0, 0, wib)
	return &start
}

// Per-member redeem brake (checkRedeemRateLimit): a sliding window in which
// attempts count even when they fail, so a flood never reaches a pooled
// transaction.
const (
	RedeemRateLimitCount  = 10
	RedeemRateLimitWindow = time.Minute
)

// RetryAfterSeconds is String(Math.ceil(retryAfterMs / 1000)).
func RetryAfterSeconds(d time.Duration) string {
	return strconv.FormatInt(int64(math.Ceil(d.Seconds())), 10)
}

// ── Collectibles ──────────────────────────────────────────────────────────

// DefaultCollectibleIntervalXP is used when crm_settings has no valid value.
const DefaultCollectibleIntervalXP = 5000

// EntitlementQuota is one entitlement per full interval of lifetime XP.
func EntitlementQuota(totalXP, intervalXP float64) int {
	if math.IsNaN(totalXP) || math.IsInf(totalXP, 0) || math.IsNaN(intervalXP) || math.IsInf(intervalXP, 0) || intervalXP <= 0 {
		return 0
	}
	return int(math.Max(0, math.Floor(totalXP/intervalXP)))
}

// RemainingEntitlements is quota minus used, clamped at 0: an XP correction
// never takes back owned artwork.
func RemainingEntitlements(totalXP, intervalXP, used float64) int {
	usedCount := 0
	if !math.IsNaN(used) && !math.IsInf(used, 0) && used > 0 {
		usedCount = int(math.Floor(used))
	}
	return max(0, EntitlementQuota(totalXP, intervalXP)-usedCount)
}

// ParseIntervalXP reads crm_settings.collectible_interval_xp (a decoded
// jsonb value) with JS Number() semantics; invalid means the default.
func ParseIntervalXP(raw any) int {
	v := jsNumberOf(raw)
	if math.IsNaN(v) || math.IsInf(v, 0) || v <= 0 {
		return DefaultCollectibleIntervalXP
	}
	return int(math.Floor(v))
}

// jsNumberOf is Number(v) for a decoded JSON scalar.
func jsNumberOf(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case bool:
		if x {
			return 1
		}
		return 0
	case float64:
		return x
	case string:
		s := strings.TrimSpace(x)
		if s == "" {
			return 0
		}
		n, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return math.NaN()
		}
		return n
	}
	// Objects and arrays: NaN (JS gives 0 for [] and a number for ["5"],
	// neither of which the settings screen stores).
	return math.NaN()
}

// CollectibleGate is the input of EvaluateCollectibleGate.
type CollectibleGate struct {
	IsActive         bool
	MinLifetimeXP    float64
	RequiredTierRank *int
	MemberTierRank   *int
	StockRemaining   *int
	StartsAt, EndsAt *time.Time
}

// EvaluateCollectibleGate is the one unlock rule for the portal, redeem and
// admin grants. blocker is "" when allowed.
func EvaluateCollectibleGate(totalXP float64, g CollectibleGate, now time.Time) (allowed bool, blocker string) {
	switch {
	case !g.IsActive:
		return false, "inactive"
	case g.StartsAt != nil && now.Before(*g.StartsAt):
		return false, "not_started"
	case g.EndsAt != nil && now.After(*g.EndsAt):
		return false, "ended"
	case g.StockRemaining != nil && *g.StockRemaining <= 0:
		return false, "out_of_stock"
	case totalXP < g.MinLifetimeXP:
		return false, "below_min_xp"
	case g.RequiredTierRank != nil && (g.MemberTierRank == nil || *g.MemberTierRank < *g.RequiredTierRank):
		return false, "below_tier"
	}
	return true, ""
}

// CollectibleBlockerMessage is the member-facing locked reason.
func CollectibleBlockerMessage(blocker string, totalXP, minXP float64, tierName *string) string {
	switch blocker {
	case "inactive":
		return "Belum tersedia"
	case "not_started":
		return "Belum dirilis"
	case "ended":
		return "Periode sudah berakhir"
	case "out_of_stock":
		return "Stok habis"
	case "below_min_xp":
		return "Kurang " + FormatNumber(math.Max(0, minXP-totalXP), 0) + " XP lagi"
	case "below_tier":
		if tierName != nil && *tierName != "" {
			return "Perlu tier " + *tierName
		}
		return "Tier belum cukup"
	}
	return ""
}

// CollectibleCheck is one artwork plus the member's XP for a redeem check.
type CollectibleCheck struct {
	IsActive          bool
	StartsAt, EndsAt  *time.Time
	StockTotal        *int
	StockRedeemed     *int
	MinLifetimeXP     *int
	RequiredTierName  *string
	RequiredTierMinXP *int
	TotalXP           *int
}

// CheckCollectible mirrors checkAvatarEligibility and
// checkWallpaperEligibility once the row is loaded; reason is "" when allowed.
func CheckCollectible(row CollectibleCheck, now time.Time) (allowed bool, reason string) {
	totalXP := float64(intOr0(row.TotalXP))
	requiredXP := float64(max(intOr0(row.RequiredTierMinXP), intOr0(row.MinLifetimeXP)))
	ok, blocker := EvaluateCollectibleGate(totalXP, CollectibleGate{
		IsActive:       row.IsActive,
		MinLifetimeXP:  requiredXP,
		StockRemaining: remainingStock(row.StockTotal, row.StockRedeemed),
		StartsAt:       row.StartsAt,
		EndsAt:         row.EndsAt,
	}, now)
	if ok {
		return true, ""
	}
	return false, CollectibleBlockerMessage(blocker, totalXP, requiredXP, row.RequiredTierName)
}

func intOr0(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

func remainingStock(total, redeemed *int) *int {
	if total == nil {
		return nil
	}
	n := max(0, *total-intOr0(redeemed))
	return &n
}

// rarityRank orders the rarest first.
var rarityRank = map[string]int{"limited": 0, "legendary": 1, "epic": 2, "rare": 3, "common": 4}

// CatalogRow is one avatar or wallpaper joined with the member's inventory.
type CatalogRow struct {
	ID                string
	Code              string
	Name              string
	Rarity            string
	ImageURL          string
	ThumbnailURL      *string
	RequiredTierName  *string
	RequiredTierMinXP *int
	MinLifetimeXP     *int
	StockTotal        *int
	StockRedeemed     *int
	InventoryID       *string
	IsEquipped        *bool
	AcquiredAt        *time.Time
}

// MemberCollectible is one catalog item as the member sees it.
type MemberCollectible struct {
	ID               string  `json:"id"`
	Code             string  `json:"code"`
	Name             string  `json:"name"`
	Rarity           string  `json:"rarity"`
	ImageURL         string  `json:"image_url"`
	ThumbnailURL     *string `json:"thumbnail_url"`
	RequiredTierName *string `json:"required_tier_name"`
	RemainingStock   *int    `json:"remaining_stock"`
	Owned            bool    `json:"owned"`
	Equipped         bool    `json:"equipped"`
	AcquiredAt       *string `json:"acquired_at"`
	LockedReason     *string `json:"locked_reason"`
	XPNeeded         float64 `json:"xp_needed"`
}

// EvaluateCollectible mirrors evaluateCollectible. The catalog query already
// dropped inactive and out-of-window rows the member does not own.
func EvaluateCollectible(row CatalogRow, totalXP float64) MemberCollectible {
	owned := row.InventoryID != nil
	stock := remainingStock(row.StockTotal, row.StockRedeemed)
	tierXP := intOr0(row.RequiredTierMinXP)
	artXP := intOr0(row.MinLifetimeXP)
	requiredXP := float64(max(tierXP, artXP))

	var locked *string
	if !owned {
		reason := "Belum kamu miliki"
		allowed, blocker := EvaluateCollectibleGate(totalXP, CollectibleGate{
			IsActive:       true,
			MinLifetimeXP:  requiredXP,
			StockRemaining: stock,
		}, time.Time{})
		if !allowed {
			if blocker == "below_min_xp" && tierXP >= artXP && row.RequiredTierName != nil && *row.RequiredTierName != "" {
				reason = "Perlu tier " + *row.RequiredTierName
			} else {
				reason = CollectibleBlockerMessage(blocker, totalXP, requiredXP, row.RequiredTierName)
			}
		}
		locked = &reason
	}

	rarity := row.Rarity
	if _, known := rarityRank[rarity]; !known {
		rarity = "common"
	}
	var acquired *string
	if row.AcquiredAt != nil {
		s := row.AcquiredAt.UTC().Format("2006-01-02T15:04:05.000Z")
		acquired = &s
	}
	return MemberCollectible{
		ID:               row.ID,
		Code:             row.Code,
		Name:             row.Name,
		Rarity:           rarity,
		ImageURL:         row.ImageURL,
		ThumbnailURL:     row.ThumbnailURL,
		RequiredTierName: row.RequiredTierName,
		RemainingStock:   stock,
		Owned:            owned,
		Equipped:         row.IsEquipped != nil && *row.IsEquipped,
		AcquiredAt:       acquired,
		LockedReason:     locked,
		XPNeeded:         math.Max(0, requiredXP-totalXP),
	}
}

// SortCollectibles puts owned items first, then the rarest, then by name.
// JS uses localeCompare(name, "id"); this approximates it with a
// case-insensitive compare where lowercase wins a tie, as ICU does.
func SortCollectibles(items []MemberCollectible) {
	sort.SliceStable(items, func(i, j int) bool {
		a, b := items[i], items[j]
		if a.Owned != b.Owned {
			return a.Owned
		}
		if ra, rb := rarityRank[a.Rarity], rarityRank[b.Rarity]; ra != rb {
			return ra < rb
		}
		la, lb := strings.ToLower(a.Name), strings.ToLower(b.Name)
		if la != lb {
			return la < lb
		}
		return a.Name > b.Name
	})
}

// ── Badges ────────────────────────────────────────────────────────────────

// BadgeRule is the award rule of one badge. Threshold and MinLifetimeXP are
// nil when the column is NULL.
type BadgeRule struct {
	Metric        string
	Threshold     *float64
	MinLifetimeXP *float64
}

// BadgeStats are the member numbers badges are measured against.
type BadgeStats struct {
	LifetimeXP  float64
	Visits      float64 // distinct WIB days with a paid order
	SpendIdr    float64
	StreakWeeks float64 // longest run of weeks with a paid order
}

// BadgeThreshold is the effective threshold; ok is false for manual badges
// (never automatic) and invalid values.
func BadgeThreshold(rule BadgeRule) (threshold float64, ok bool) {
	if rule.Metric == "manual" {
		return 0, false
	}
	raw := rule.Threshold
	if rule.Metric == "lifetime_xp" {
		raw = rule.MinLifetimeXP
	}
	value := 0.0
	if raw != nil {
		value = *raw
	}
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return 0, false
	}
	return value, true
}

func badgeMetricValue(metric string, s BadgeStats) (float64, bool) {
	switch metric {
	case "lifetime_xp":
		return s.LifetimeXP, true
	case "visits":
		return s.Visits, true
	case "spend_idr":
		return s.SpendIdr, true
	case "streak_weeks":
		return s.StreakWeeks, true
	}
	return 0, false
}

// IsBadgeEarned reports whether the stats reach the badge threshold
// (inclusive).
func IsBadgeEarned(rule BadgeRule, s BadgeStats) bool {
	threshold, ok := BadgeThreshold(rule)
	if !ok {
		return false
	}
	value, ok := badgeMetricValue(rule.Metric, s)
	return ok && value >= threshold
}

// LongestWeeklyStreak is the longest run of consecutive week starts
// (YYYY-MM-DD). Duplicates and order do not matter.
func LongestWeeklyStreak(weekStarts []string) int {
	seen := map[int64]bool{}
	var days []int64
	for _, d := range weekStarts {
		if len(d) > 10 {
			d = d[:10]
		}
		t, err := time.Parse("2006-01-02", d)
		if err != nil {
			continue
		}
		key := t.Unix()
		if !seen[key] {
			seen[key] = true
			days = append(days, key)
		}
	}
	sort.Slice(days, func(i, j int) bool { return days[i] < days[j] })
	const week = 7 * 24 * 3600
	best, run := 0, 0
	for i := range days {
		if i > 0 && days[i]-days[i-1] == week {
			run++
		} else {
			run = 1
		}
		best = max(best, run)
	}
	return best
}

// ── Formatting ────────────────────────────────────────────────────────────

// FormatNumber mirrors formatNumber (toLocaleString "id-ID"): "." groups
// thousands, "," separates decimals, at most maxFractionDigits decimals
// rounded half away from zero, trailing zeros dropped.
func FormatNumber(v float64, maxFractionDigits int) string {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		v = 0
	}
	scale := math.Pow(10, float64(maxFractionDigits))
	rounded := math.Round(v*scale) / scale
	sign := ""
	if rounded < 0 {
		sign = "-"
		rounded = -rounded
	}
	text := strconv.FormatFloat(rounded, 'f', maxFractionDigits, 64)
	intPart, frac, _ := strings.Cut(text, ".")
	frac = strings.TrimRight(frac, "0")

	var b strings.Builder
	b.WriteString(sign)
	for i, c := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	if frac != "" {
		b.WriteByte(',')
		b.WriteString(frac)
	}
	return b.String()
}
