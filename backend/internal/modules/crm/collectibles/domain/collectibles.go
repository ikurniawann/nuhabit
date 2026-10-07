// Package domain holds the collectible rules the admin routes need
// (lib/crm/collectibles.ts and checkAvatarEligibility in
// collectibles-server.ts): the unlock gate, its member-facing reasons and
// the entitlement interval setting.
package domain

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/crm/internal/kit"
)

// DefaultCollectibleIntervalXP is used when crm_settings has no valid value.
const DefaultCollectibleIntervalXP = 5000

// ParseIntervalXP mirrors parseIntervalXp: Number(raw) floored when it is a
// positive finite number, else the default. raw is a decoded jsonb value.
func ParseIntervalXP(raw any) int {
	v := jsNumber(raw)
	if math.IsNaN(v) || math.IsInf(v, 0) || v <= 0 {
		return DefaultCollectibleIntervalXP
	}
	return int(math.Floor(v))
}

var jsDecimal = regexp.MustCompile(`^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$`)

// jsNumber is Number(v) for a decoded JSON value (Infinity is not finite
// either way, so it reads as NaN here).
func jsNumber(v any) float64 {
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
		if jsDecimal.MatchString(s) {
			n, _ := strconv.ParseFloat(s, 64)
			return n
		}
		if len(s) > 2 && s[0] == '0' && strings.ContainsRune("xXoObB", rune(s[1])) {
			if n, err := strconv.ParseInt(s, 0, 64); err == nil {
				return float64(n)
			}
		}
		return math.NaN()
	case []any:
		// Number([]) is 0, Number([x]) is Number(String(x)), longer is NaN.
		switch len(x) {
		case 0:
			return 0
		case 1:
			if s, ok := x[0].(string); ok {
				return jsNumber(s)
			}
			if f, ok := x[0].(float64); ok {
				return f
			}
			if x[0] == nil {
				return 0
			}
		}
	}
	return math.NaN()
}

// Gate is the input of EvaluateGate (CollectibleGate).
type Gate struct {
	IsActive         bool
	MinLifetimeXP    float64
	RequiredTierRank *int
	MemberTierRank   *int
	StockRemaining   *int
	StartsAt, EndsAt *time.Time
}

// EvaluateGate mirrors evaluateCollectibleGate: the one unlock rule for the
// portal, redeem and admin grants. blocker is "" when allowed.
func EvaluateGate(totalXP float64, g Gate, now time.Time) (allowed bool, blocker string) {
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

// BlockerMessage mirrors blockerMessage, the member-facing locked reason.
func BlockerMessage(blocker string, totalXP, minXP float64, tierName *string) string {
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
		return "Kurang " + kit.GroupThousands(int64(kit.JSRound(math.Max(0, minXP-totalXP)))) + " XP lagi"
	case "below_tier":
		if tierName != nil && *tierName != "" {
			return "Perlu tier " + *tierName
		}
		return "Tier belum cukup"
	}
	return ""
}

// Eligibility is one artwork joined with the member's XP
// (checkAvatarEligibility's row). Nil numbers are NULL.
type Eligibility struct {
	IsActive          bool
	StartsAt, EndsAt  *time.Time
	StockTotal        *int
	StockRedeemed     *int
	MinLifetimeXP     *int
	RequiredTierName  *string
	RequiredTierMinXP *int
	TotalXP           *int
}

func intOr0(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

// CheckEligibility mirrors checkAvatarEligibility once the row is loaded:
// the effective threshold is the higher of the tier's and the artwork's.
// reason is "" when allowed.
func CheckEligibility(row Eligibility, now time.Time) (allowed bool, reason string) {
	totalXP := float64(intOr0(row.TotalXP))
	requiredXP := float64(max(intOr0(row.RequiredTierMinXP), intOr0(row.MinLifetimeXP)))
	var stock *int
	if row.StockTotal != nil {
		n := max(0, *row.StockTotal-intOr0(row.StockRedeemed))
		stock = &n
	}
	ok, blocker := EvaluateGate(totalXP, Gate{
		IsActive: row.IsActive, MinLifetimeXP: requiredXP, StockRemaining: stock,
		StartsAt: row.StartsAt, EndsAt: row.EndsAt,
	}, now)
	if ok {
		return true, ""
	}
	return false, BlockerMessage(blocker, totalXP, requiredXP, row.RequiredTierName)
}

// catalogIDPattern is catalogId's loose check (36 hex digits or dashes).
var catalogIDPattern = regexp.MustCompile(`^(?i)[0-9a-f-]{36}$`)

// IsCatalogID reports whether raw passes catalogId.
func IsCatalogID(raw string) bool { return catalogIDPattern.MatchString(raw) }

// AvatarRarities are the rarity options of avatars and wallpapers.
var AvatarRarities = []string{"common", "rare", "epic", "legendary", "limited"}

// BadgeMetrics mirrors BADGE_METRICS.
var BadgeMetrics = []string{"lifetime_xp", "visits", "spend_idr", "streak_weeks", "manual"}
