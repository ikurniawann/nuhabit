package memberportal

import (
	"context"
	"math"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/database"
)

// CollectionRepository is badges, rewards, collectibles and wallpapers
// (lib/crm/rewards-server.ts, collectibles-server.ts).
type CollectionRepository interface {
	RewardMember(ctx context.Context, customerID string) (*RewardMember, error)

	BadgeCandidates(ctx context.Context, customerID string) ([]BadgeCandidate, error)
	OrderBadgeStats(ctx context.Context, customerID string) (BadgeOrderStats, error)
	InsertMemberBadges(ctx context.Context, customerID string, memberProfileID *string, badgeIDs []string) ([]string, error)
	BadgeNoticePhone(ctx context.Context, customerID string) (string, error)
	MemberBadges(ctx context.Context, customerID string) ([]MemberBadge, error)
	ShowcasedBadgeCount(ctx context.Context, customerID string) (int, error)
	SetBadgeShowcase(ctx context.Context, customerID, badgeID string, showcased bool) (bool, error)

	RedeemableRewards(ctx context.Context) ([]RewardRow, error)
	RewardForUpdate(ctx context.Context, rewardID string) (*RewardRow, error)
	ActiveRedemptionTimes(ctx context.Context, customerID string, rewardIDs []string) (map[string][]time.Time, error)
	CountActiveRedemptions(ctx context.Context, customerID, rewardID string, since *time.Time) (int, error)
	InsertRedemption(ctx context.Context, r NewRedemption) (*Redemption, error)
	IncrementRewardStock(ctx context.Context, rewardID string) error
	RedemptionHistory(ctx context.Context, customerID string) ([]RedemptionHistoryRow, error)

	CollectibleCatalog(ctx context.Context, asset string, memberProfileID *string) ([]domain.CatalogRow, error)
	CollectibleIntervalSetting(ctx context.Context) (any, error)
	CountEntitlements(ctx context.Context, customerID string) (int, error)
	LockCustomerXP(ctx context.Context, customerID string) (totalXP int, found bool, err error)
	LockCollectible(ctx context.Context, asset, id string) (bool, error)
	OwnsCollectible(ctx context.Context, asset, memberProfileID, id string) (bool, error)
	CollectibleCheck(ctx context.Context, asset, id, customerID string) (*domain.CollectibleCheck, error)
	ClaimCollectibleStock(ctx context.Context, asset, id string) (bool, error)
	InsertEntitlement(ctx context.Context, customerID, memberProfileID, asset, id string) error
	InsertCollectibleInventory(ctx context.Context, asset, memberProfileID, id string) error
	LockAvatarInventory(ctx context.Context, memberProfileID, avatarID string) (bool, error)
	EquipAvatar(ctx context.Context, memberProfileID, avatarID string) error
}

// RewardMember is getMemberContext: the customer, the CRM profile (nil until
// enrolled), lifetime XP from pos_customers and the tier that XP reaches.
type RewardMember struct {
	CustomerID      string
	MemberProfileID *string
	Name            *string
	TotalXP         float64
	TierRank        *int
	TierName        *string
}

// memberSummary is the {name, total_xp, tier_name} block of the catalogs.
type memberSummary struct {
	Name     *string `json:"name"`
	TotalXP  float64 `json:"total_xp"`
	TierName *string `json:"tier_name"`
}

func (m *RewardMember) summary() memberSummary {
	return memberSummary{Name: m.Name, TotalXP: m.TotalXP, TierName: m.TierName}
}

func loadRewardMember(ctx context.Context, repo CollectionRepository, customerID string) (*RewardMember, error) {
	m, err := repo.RewardMember(ctx, customerID)
	if err == nil && m == nil {
		err = fail(404, "Member tidak ditemukan")
	}
	return m, err
}

// ── Badges ────────────────────────────────────────────────────────────────

// BadgeCandidate is an active automatic badge the member has neither earned
// nor had revoked.
type BadgeCandidate struct {
	ID      string
	Code    string
	Name    string
	Rule    domain.BadgeRule
	BonusXP int
}

// BadgeOrderStats are the paid-order numbers behind non-XP badges.
type BadgeOrderStats struct {
	Visits float64
	Spend  float64
	Weeks  []string
}

// MemberBadge is one row of GET /badges.
type MemberBadge struct {
	ID            string   `json:"id"`
	Code          string   `json:"code"`
	Name          string   `json:"name"`
	ImageURL      *string  `json:"image_url"`
	MinLifetimeXP int      `json:"min_lifetime_xp"`
	Metric        string   `json:"metric"`
	Threshold     *float64 `json:"threshold"`
	Owned         bool     `json:"owned"`
	AwardedAt     jsTime   `json:"awarded_at"`
	IsShowcased   bool     `json:"is_showcased"`
}

// BadgesView is GET /badges.
type BadgesView struct {
	TotalXP float64       `json:"total_xp"`
	Badges  []MemberBadge `json:"badges"`
}

// MaxShowcasedBadges is how many badges a member may pin.
const MaxShowcasedBadges = 3

// Badges awards every badge the member now qualifies for, then lists the
// catalog. New badges trigger a best-effort WhatsApp notice.
func (s *Service) Badges(ctx context.Context, customerID string) (*BadgesView, error) {
	member, err := loadRewardMember(ctx, s.repo, customerID)
	if err != nil {
		return nil, err
	}
	awarded, err := s.awardEligibleBadges(ctx, member)
	if err != nil {
		return nil, err
	}
	if len(awarded) > 0 {
		phone, err := s.repo.BadgeNoticePhone(ctx, customerID)
		if err != nil {
			return nil, err
		}
		if phone != "" {
			names := make([]string, len(awarded))
			for i, b := range awarded {
				names[i] = b.Name
			}
			s.notifyBadges(phone, "Selamat! Kamu baru saja meraih badge: "+strings.Join(names, ", ")+". Lihat di portal member ya 🏅")
		}
	}
	badges, err := s.repo.MemberBadges(ctx, customerID)
	if err != nil {
		return nil, err
	}
	return &BadgesView{TotalXP: member.TotalXP, Badges: badges}, nil
}

func (s *Service) notifyBadges(phone, message string) {
	if s.notifier == nil {
		return
	}
	go func() {
		d := s.notifier.SendText(context.Background(), phone, message, "notification")
		if !d.Delivered {
			s.log.Warn("[badges] notif WA gagal", "reason", d.Reason)
		}
	}()
}

// awardEligibleBadges grants every candidate the stats reach (idempotent on
// UNIQUE (customer, badge)) and posts their bonus XP. Order stats are only
// loaded when a non-XP badge is in play.
func (s *Service) awardEligibleBadges(ctx context.Context, member *RewardMember) ([]BadgeCandidate, error) {
	candidates, err := s.repo.BadgeCandidates(ctx, member.CustomerID)
	if err != nil || len(candidates) == 0 {
		return nil, err
	}
	stats := domain.BadgeStats{LifetimeXP: member.TotalXP}
	for _, b := range candidates {
		if b.Rule.Metric != "lifetime_xp" {
			orders, err := s.repo.OrderBadgeStats(ctx, member.CustomerID)
			if err != nil {
				return nil, err
			}
			stats.Visits = orders.Visits
			stats.SpendIdr = orders.Spend
			stats.StreakWeeks = float64(domain.LongestWeeklyStreak(orders.Weeks))
			break
		}
	}
	var earned []BadgeCandidate
	var ids []string
	for _, b := range candidates {
		if domain.IsBadgeEarned(b.Rule, stats) {
			earned = append(earned, b)
			ids = append(ids, b.ID)
		}
	}
	if len(earned) == 0 {
		return nil, nil
	}
	insertedIDs, err := s.repo.InsertMemberBadges(ctx, member.CustomerID, member.MemberProfileID, ids)
	if err != nil {
		return nil, err
	}
	inserted := make(map[string]bool, len(insertedIDs))
	for _, id := range insertedIDs {
		inserted[id] = true
	}
	var awarded []BadgeCandidate
	for _, b := range earned {
		if inserted[b.ID] {
			awarded = append(awarded, b)
		}
	}
	return awarded, s.grantBadgeBonuses(ctx, member.CustomerID, awarded)
}

// grantBadgeBonuses posts each badge's bonus XP once per member per badge.
func (s *Service) grantBadgeBonuses(ctx context.Context, customerID string, badges []BadgeCandidate) error {
	var withBonus []BadgeCandidate
	for _, b := range badges {
		if b.BonusXP > 0 {
			withBonus = append(withBonus, b)
		}
	}
	if len(withBonus) == 0 || s.loyalty == nil {
		return nil
	}
	venue := s.repo.DefaultVenue(ctx)
	for _, b := range withBonus {
		_, err := s.loyalty.AwardFlatXP(ctx, XPAward{
			CustomerID:     customerID,
			XPAmount:       float64(b.BonusXP),
			CompanyID:      venue.CompanyID,
			BranchID:       venue.BranchID,
			SourceType:     "badge_bonus",
			SourceID:       b.ID,
			ReferenceTable: "crm_badges",
			IdempotencyKey: "badge:" + b.ID + ":" + customerID,
			Description:    "Bonus badge: " + b.Name,
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// ShowcaseBadge pins or unpins an owned badge, at most three pinned.
func (s *Service) ShowcaseBadge(ctx context.Context, customerID, badgeID string, showcased bool) error {
	if showcased {
		n, err := s.repo.ShowcasedBadgeCount(ctx, customerID)
		if err != nil {
			return err
		}
		if n >= MaxShowcasedBadges {
			return fail(409, "Maksimal 3 badge dipamerkan — sembunyikan salah satu dulu.")
		}
	}
	updated, err := s.repo.SetBadgeShowcase(ctx, customerID, badgeID, showcased)
	if err != nil {
		return err
	}
	if !updated {
		return fail(404, "Badge belum kamu miliki")
	}
	return nil
}

// ── Rewards ───────────────────────────────────────────────────────────────

// RewardRow is a crm_rewards row with its required tier.
type RewardRow struct {
	ID                      string
	Code                    string
	Name                    string
	RewardType              string
	MinXP                   int
	RequiredTierRank        *int
	RequiredTierName        *string
	StockTotal              *int
	StockRedeemed           int
	MaxRedemptionsPerMember *int
	QuotaPeriod             string
	ImageURL                *string
	StartsAt, EndsAt        *time.Time
	IsActive                bool
}

func (r *RewardRow) gate() domain.RewardGate {
	return domain.RewardGate{
		IsActive:                r.IsActive,
		RewardType:              r.RewardType,
		MinXP:                   float64(r.MinXP),
		RequiredTierRank:        r.RequiredTierRank,
		StockTotal:              r.StockTotal,
		StockRedeemed:           r.StockRedeemed,
		MaxRedemptionsPerMember: r.MaxRedemptionsPerMember,
		StartsAt:                r.StartsAt,
		EndsAt:                  r.EndsAt,
	}
}

func (m *RewardMember) state(redeemedInWindow int) domain.RewardMemberState {
	return domain.RewardMemberState{TotalXP: m.TotalXP, TierRank: m.TierRank, RedeemedInWindow: redeemedInWindow}
}

// RewardView is one catalog entry of GET /rewards.
type RewardView struct {
	ID                      string  `json:"id"`
	Code                    string  `json:"code"`
	Name                    string  `json:"name"`
	RewardType              string  `json:"reward_type"`
	MinXP                   int     `json:"min_xp"`
	RequiredTierName        *string `json:"required_tier_name"`
	ImageURL                *string `json:"image_url"`
	QuotaPeriod             string  `json:"quota_period"`
	QuotaPeriodLabel        string  `json:"quota_period_label"`
	MaxRedemptionsPerMember *int    `json:"max_redemptions_per_member"`
	Eligible                bool    `json:"eligible"`
	Reason                  *string `json:"reason"`
	XPNeeded                float64 `json:"xp_needed"`
	RemainingStock          *int    `json:"remaining_stock"`
	RemainingQuota          *int    `json:"remaining_quota"`
}

// RedemptionHistoryRow is one of the member's 20 latest redemptions.
type RedemptionHistoryRow struct {
	ID               string `json:"id"`
	RedemptionNumber string `json:"redemption_number"`
	Status           string `json:"status"`
	RequestedAt      jsTime `json:"requested_at"`
	FulfilledAt      jsTime `json:"fulfilled_at"`
	RewardName       string `json:"reward_name"`
	RewardType       string `json:"reward_type"`
}

// RewardsView is GET /rewards.
type RewardsView struct {
	Member  memberSummary          `json:"member"`
	Rewards []RewardView           `json:"rewards"`
	History []RedemptionHistoryRow `json:"history"`
}

// Rewards is the redeemable catalog with the member's eligibility per
// reward, evaluated from one query of their active redemptions.
func (s *Service) Rewards(ctx context.Context, customerID string) (*RewardsView, error) {
	member, err := loadRewardMember(ctx, s.repo, customerID)
	if err != nil {
		return nil, err
	}
	rewards, err := s.repo.RedeemableRewards(ctx)
	if err != nil {
		return nil, err
	}
	history := map[string][]time.Time{}
	if len(rewards) > 0 {
		ids := make([]string, len(rewards))
		for i, r := range rewards {
			ids[i] = r.ID
		}
		if history, err = s.repo.ActiveRedemptionTimes(ctx, customerID, ids); err != nil {
			return nil, err
		}
	}
	now := s.now()
	views := make([]RewardView, len(rewards))
	for i, r := range rewards {
		used := len(history[r.ID])
		if start := domain.QuotaWindowStart(r.QuotaPeriod, now); start != nil {
			used = 0
			for _, at := range history[r.ID] {
				if !at.Before(*start) {
					used++
				}
			}
		}
		check := domain.EvaluateRewardEligibility(r.gate(), member.state(used), now)
		views[i] = RewardView{
			ID:                      r.ID,
			Code:                    r.Code,
			Name:                    r.Name,
			RewardType:              r.RewardType,
			MinXP:                   r.MinXP,
			RequiredTierName:        r.RequiredTierName,
			ImageURL:                r.ImageURL,
			QuotaPeriod:             r.QuotaPeriod,
			QuotaPeriodLabel:        domain.QuotaPeriodLabels[r.QuotaPeriod],
			MaxRedemptionsPerMember: r.MaxRedemptionsPerMember,
			Eligible:                check.Eligible,
			Reason:                  check.Reason,
			XPNeeded:                check.XPNeeded,
			RemainingStock:          check.RemainingStock,
			RemainingQuota:          check.RemainingQuota,
		}
	}
	rows, err := s.repo.RedemptionHistory(ctx, customerID)
	if err != nil {
		return nil, err
	}
	return &RewardsView{Member: member.summary(), Rewards: views, History: rows}, nil
}

// AllowRedeemAttempt counts one redeem attempt against the member's brake,
// shared by every replica; when refused it returns the Retry-After value in
// seconds.
func (s *Service) AllowRedeemAttempt(ctx context.Context, customerID string) (bool, string, error) {
	allowed, retry, err := s.limits.Sliding(ctx, "member-redeem:"+customerID, domain.RedeemRateLimitCount, domain.RedeemRateLimitWindow, s.now())
	return allowed, domain.RetryAfterSeconds(retry), err
}

// NewRedemption is the crm_redemptions row a portal request inserts.
type NewRedemption struct {
	MemberProfileID *string
	CustomerID      string
	RewardID        string
	MinXP           int
	TotalXP         int
}

// Redemption is the RETURNING row of a new redemption.
type Redemption struct {
	ID               string `json:"id"`
	RedemptionNumber string `json:"redemption_number"`
	Status           string `json:"status"`
	Channel          string `json:"channel"`
	RequestedAt      jsTime `json:"requested_at"`
	FulfilledAt      jsTime `json:"fulfilled_at"`
}

// RedeemReward files a pending portal redemption (createRedemption with
// channel "portal"). The reward row is locked and eligibility re-checked in
// the transaction so concurrent requests cannot break stock or quota. XP is
// never deducted.
func (s *Service) RedeemReward(ctx context.Context, customerID, rewardID string) (*Redemption, error) {
	now := s.now()
	var out *Redemption
	err := s.repo.InTx(ctx, func(tx Repository) error {
		reward, err := tx.RewardForUpdate(ctx, rewardID)
		if err != nil {
			return err
		}
		if reward == nil {
			return fail(404, "Reward tidak ditemukan")
		}
		member, err := loadRewardMember(ctx, tx, customerID)
		if err != nil {
			return err
		}
		used, err := tx.CountActiveRedemptions(ctx, customerID, reward.ID, domain.QuotaWindowStart(reward.QuotaPeriod, now))
		if err != nil {
			return err
		}
		if check := domain.EvaluateRewardEligibility(reward.gate(), member.state(used), now); !check.Eligible {
			return fail(409, *check.Reason)
		}
		out, err = tx.InsertRedemption(ctx, NewRedemption{
			MemberProfileID: member.MemberProfileID,
			CustomerID:      member.CustomerID,
			RewardID:        reward.ID,
			MinXP:           reward.MinXP,
			TotalXP:         int(math.Floor(member.TotalXP + 0.5)), // Math.round
		})
		if err != nil {
			return err
		}
		// Pending requests hold stock too, so it cannot be oversold.
		if reward.StockTotal != nil {
			return tx.IncrementRewardStock(ctx, reward.ID)
		}
		return nil
	})
	return out, err
}

// ── Collectibles and wallpapers ───────────────────────────────────────────

// EntitlementSummary is the member's redeem allowance: one per interval of
// lifetime XP, minus what was used.
type EntitlementSummary struct {
	IntervalXP int `json:"interval_xp"`
	Quota      int `json:"quota"`
	Used       int `json:"used"`
	Remaining  int `json:"remaining"`
}

func entitlementSummary(ctx context.Context, repo CollectionRepository, customerID string, totalXP float64) (EntitlementSummary, error) {
	raw, err := repo.CollectibleIntervalSetting(ctx)
	if err != nil {
		return EntitlementSummary{}, err
	}
	used, err := repo.CountEntitlements(ctx, customerID)
	if err != nil {
		return EntitlementSummary{}, err
	}
	interval := domain.ParseIntervalXP(raw)
	return EntitlementSummary{
		IntervalXP: interval,
		Quota:      domain.EntitlementQuota(totalXP, float64(interval)),
		Used:       used,
		Remaining:  domain.RemainingEntitlements(totalXP, float64(interval), float64(used)),
	}, nil
}

// collectibleKind is the asset a catalog or redeem works on.
type collectibleKind struct {
	asset string // crm_member_entitlements.asset_type
	noun  string // subject of the member-facing messages
}

var (
	avatarKind    = collectibleKind{asset: "avatar", noun: "Artwork"}
	wallpaperKind = collectibleKind{asset: "wallpaper", noun: "Wallpaper"}
)

// CollectiblesView is GET /collectibles.
type CollectiblesView struct {
	Member      memberSummary              `json:"member"`
	Entitlement EntitlementSummary         `json:"entitlement"`
	OwnedCount  int                        `json:"owned_count"`
	TotalCount  int                        `json:"total_count"`
	Items       []domain.MemberCollectible `json:"items"`
}

// WallpapersView is GET /wallpapers.
type WallpapersView struct {
	Entitlement EntitlementSummary         `json:"entitlement"`
	OwnedCount  int                        `json:"owned_count"`
	Items       []domain.MemberCollectible `json:"items"`
}

// catalog evaluates a member's view of one asset catalog. Owned items stay
// visible even after they are retired.
func (s *Service) catalog(ctx context.Context, kind collectibleKind, customerID string) (*RewardMember, *WallpapersView, error) {
	member, err := loadRewardMember(ctx, s.repo, customerID)
	if err != nil {
		return nil, nil, err
	}
	rows, err := s.repo.CollectibleCatalog(ctx, kind.asset, member.MemberProfileID)
	if err != nil {
		return nil, nil, err
	}
	entitlement, err := entitlementSummary(ctx, s.repo, customerID, member.TotalXP)
	if err != nil {
		return nil, nil, err
	}
	view := &WallpapersView{Entitlement: entitlement, Items: make([]domain.MemberCollectible, len(rows))}
	for i, row := range rows {
		view.Items[i] = domain.EvaluateCollectible(row, member.TotalXP)
		if view.Items[i].Owned {
			view.OwnedCount++
		}
	}
	domain.SortCollectibles(view.Items)
	return member, view, nil
}

// Collectibles is the member's avatar showcase.
func (s *Service) Collectibles(ctx context.Context, customerID string) (*CollectiblesView, error) {
	member, c, err := s.catalog(ctx, avatarKind, customerID)
	if err != nil {
		return nil, err
	}
	return &CollectiblesView{Member: member.summary(), Entitlement: c.Entitlement, OwnedCount: c.OwnedCount, TotalCount: len(c.Items), Items: c.Items}, nil
}

// Wallpapers is the member's wallpaper showcase.
func (s *Service) Wallpapers(ctx context.Context, customerID string) (*WallpapersView, error) {
	_, view, err := s.catalog(ctx, wallpaperKind, customerID)
	return view, err
}

// EquipAvatar sets an owned avatar as the active one. Ownership is checked
// under a row lock and both tables change in one transaction.
func (s *Service) EquipAvatar(ctx context.Context, customerID, avatarID string) error {
	member, err := loadRewardMember(ctx, s.repo, customerID)
	if err != nil {
		return err
	}
	if member.MemberProfileID == nil {
		return fail(409, "Profil member belum aktif")
	}
	return s.repo.InTx(ctx, func(tx Repository) error {
		owned, err := tx.LockAvatarInventory(ctx, *member.MemberProfileID, avatarID)
		if err != nil {
			return err
		}
		if !owned {
			return fail(403, "Artwork ini belum kamu miliki")
		}
		return tx.EquipAvatar(ctx, *member.MemberProfileID, avatarID)
	})
}

// RedeemCollectible spends one entitlement on an avatar or wallpaper. The
// customer row lock serializes a member's requests; the asset row lock and
// the SQL stock guard keep stock consistent; a UNIQUE violation means a
// concurrent duplicate lost the race.
func (s *Service) RedeemCollectible(ctx context.Context, kind collectibleKind, customerID, assetID string) (EntitlementSummary, error) {
	var after EntitlementSummary
	err := s.repo.InTx(ctx, func(tx Repository) error {
		lockedXP, found, err := tx.LockCustomerXP(ctx, customerID)
		if err != nil {
			return err
		}
		if !found {
			return fail(404, "Member tidak ditemukan")
		}
		totalXP := float64(lockedXP)

		member, err := tx.RewardMember(ctx, customerID)
		if err != nil {
			return err
		}
		if member == nil || member.MemberProfileID == nil {
			return fail(409, "Profil loyalty belum aktif — lakukan satu transaksi ARK Coin dulu di kasir.")
		}
		profileID := *member.MemberProfileID

		exists, err := tx.LockCollectible(ctx, kind.asset, assetID)
		if err != nil {
			return err
		}
		if !exists {
			return fail(404, kind.noun+" tidak ditemukan")
		}
		owned, err := tx.OwnsCollectible(ctx, kind.asset, profileID, assetID)
		if err != nil {
			return err
		}
		if owned {
			return fail(409, kind.noun+" ini sudah kamu miliki")
		}

		summary, err := entitlementSummary(ctx, tx, customerID, totalXP)
		if err != nil {
			return err
		}
		if summary.Remaining <= 0 {
			return fail(409, "Jatah tukar kamu sudah habis — kumpulkan XP lagi.")
		}

		check, err := tx.CollectibleCheck(ctx, kind.asset, assetID, customerID)
		if err != nil {
			return err
		}
		if check == nil {
			return fail(409, kind.noun+" atau member tidak ditemukan")
		}
		if allowed, reason := domain.CheckCollectible(*check, s.now()); !allowed {
			return fail(409, reason)
		}

		claimed, err := tx.ClaimCollectibleStock(ctx, kind.asset, assetID)
		if err != nil {
			return err
		}
		if !claimed {
			return fail(409, "Stok habis")
		}
		if err := tx.InsertEntitlement(ctx, customerID, profileID, kind.asset, assetID); err != nil {
			return err
		}
		if err := tx.InsertCollectibleInventory(ctx, kind.asset, profileID, assetID); err != nil {
			return err
		}
		after, err = entitlementSummary(ctx, tx, customerID, totalXP)
		return err
	})
	if database.IsUniqueViolation(err) {
		return EntitlementSummary{}, fail(409, kind.noun+" ini sudah kamu miliki")
	}
	return after, err
}
