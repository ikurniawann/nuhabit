package memberportal

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/database"
)

// RewardMember mirrors getMemberContext.
func (s *store) RewardMember(ctx context.Context, customerID string) (*RewardMember, error) {
	var m RewardMember
	var totalXP *float64
	err := s.q.QueryRow(ctx,
		`SELECT c.id, c.name, c.total_xp::float AS total_xp,
		        p.id AS member_profile_id,
		        t.rank::int AS tier_rank, t.name AS tier_name
		   FROM pos.pos_customers c
		   LEFT JOIN crm.crm_member_profiles p ON p.customer_id = c.id
		   LEFT JOIN LATERAL (
		     SELECT rank, name
		       FROM crm.crm_membership_tiers
		      WHERE is_active AND min_lifetime_xp <= COALESCE(c.total_xp, 0)
		      ORDER BY rank DESC
		      LIMIT 1
		   ) t ON true
		  WHERE c.id = $1`, customerID).
		Scan(&m.CustomerID, &m.Name, &totalXP, &m.MemberProfileID, &m.TierRank, &m.TierName)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if totalXP != nil {
		m.TotalXP = *totalXP
	}
	return &m, nil
}

// ── Badges ────────────────────────────────────────────────────────────────

func (s *store) BadgeCandidates(ctx context.Context, customerID string) ([]BadgeCandidate, error) {
	rows, err := s.q.Query(ctx,
		`SELECT b.id, b.code, b.name, b.metric, b.threshold::float8, b.min_lifetime_xp::float8, b.bonus_xp
		   FROM crm.crm_badges b
		  WHERE b.is_active AND b.metric <> 'manual'
		    AND NOT EXISTS (SELECT 1 FROM crm.crm_member_badges mb
		                     WHERE mb.customer_id = $1 AND mb.badge_id = b.id)
		    AND NOT EXISTS (SELECT 1 FROM crm.crm_member_badge_revocations rv
		                     WHERE rv.customer_id = $1 AND rv.badge_id = b.id)`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (BadgeCandidate, error) {
		var b BadgeCandidate
		err := row.Scan(&b.ID, &b.Code, &b.Name, &b.Rule.Metric, &b.Rule.Threshold, &b.Rule.MinLifetimeXP, &b.BonusXP)
		return b, err
	})
}

// OrderBadgeStats counts paid orders: distinct WIB days, total spend and
// the WIB week starts with at least one order.
func (s *store) OrderBadgeStats(ctx context.Context, customerID string) (BadgeOrderStats, error) {
	var st BadgeOrderStats
	err := s.q.QueryRow(ctx,
		`SELECT count(DISTINCT (o.created_at AT TIME ZONE 'Asia/Jakarta')::date)::float8 AS visits,
		        COALESCE(sum(o.total_amount), 0)::float AS spend,
		        COALESCE(array_agg(DISTINCT date_trunc('week', o.created_at AT TIME ZONE 'Asia/Jakarta')::date::text)
		                 FILTER (WHERE o.id IS NOT NULL), '{}') AS weeks
		   FROM pos.pos_orders o
		  WHERE o.customer_id = $1 AND o.payment_status = 'paid'
		    AND o.status NOT IN ('cancelled', 'voided', 'merged')`, customerID).
		Scan(&st.Visits, &st.Spend, &st.Weeks)
	return st, err
}

// InsertMemberBadges awards the badges, skipping any already held, and
// returns the ids that were new.
func (s *store) InsertMemberBadges(ctx context.Context, customerID string, memberProfileID *string, badgeIDs []string) ([]string, error) {
	rows, err := s.q.Query(ctx,
		`INSERT INTO crm.crm_member_badges (customer_id, member_id, badge_id)
		 SELECT $1, $2, unnest($3::uuid[])
		 ON CONFLICT (customer_id, badge_id) DO NOTHING
		 RETURNING badge_id`, customerID, memberProfileID, badgeIDs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func (s *store) BadgeNoticePhone(ctx context.Context, customerID string) (string, error) {
	var phone *string
	err := s.q.QueryRow(ctx, `SELECT phone FROM pos.pos_customers WHERE id = $1`, customerID).Scan(&phone)
	if database.IsNoRows(err) || phone == nil {
		return "", nil
	}
	return *phone, err
}

func (s *store) MemberBadges(ctx context.Context, customerID string) ([]MemberBadge, error) {
	rows, err := s.q.Query(ctx,
		`SELECT b.id, b.code, b.name, b.image_url, b.min_lifetime_xp::int,
		        b.metric, b.threshold::float AS threshold,
		        mb.id AS award_id, mb.awarded_at, mb.is_showcased
		   FROM crm.crm_badges b
		   LEFT JOIN crm.crm_member_badges mb
		          ON mb.badge_id = b.id AND mb.customer_id = $1
		  WHERE b.is_active OR mb.id IS NOT NULL
		  ORDER BY b.min_lifetime_xp`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (MemberBadge, error) {
		var b MemberBadge
		var minXP *int
		var metric, awardID *string
		var showcased *bool
		err := row.Scan(&b.ID, &b.Code, &b.Name, &b.ImageURL, &minXP, &metric, &b.Threshold, &awardID, &b.AwardedAt, &showcased)
		if minXP != nil {
			b.MinLifetimeXP = *minXP
		}
		b.Metric = "lifetime_xp"
		if metric != nil {
			b.Metric = *metric
		}
		b.Owned = awardID != nil
		b.IsShowcased = showcased != nil && *showcased
		return b, err
	})
}

func (s *store) ShowcasedBadgeCount(ctx context.Context, customerID string) (int, error) {
	var n int
	err := s.q.QueryRow(ctx,
		`SELECT count(*)::int AS n FROM crm.crm_member_badges WHERE customer_id = $1 AND is_showcased`,
		customerID).Scan(&n)
	return n, err
}

func (s *store) SetBadgeShowcase(ctx context.Context, customerID, badgeID string, showcased bool) (bool, error) {
	tag, err := s.q.Exec(ctx,
		`UPDATE crm.crm_member_badges SET is_showcased = $3
		  WHERE customer_id = $1 AND badge_id = $2`, customerID, badgeID, showcased)
	return tag.RowsAffected() > 0, err
}

// ── Rewards ───────────────────────────────────────────────────────────────

// rewardSelect is REWARD_SELECT without reward_data, which no member route
// returns.
const rewardSelect = `
  SELECT r.id, r.code, r.name, r.reward_type,
         r.min_xp::int AS min_xp,
         t.rank::int AS required_tier_rank,
         t.name AS required_tier_name,
         r.stock_total::int AS stock_total,
         r.stock_redeemed::int AS stock_redeemed,
         r.max_redemptions_per_member::int AS max_redemptions_per_member,
         r.quota_period,
         r.image_url, r.starts_at, r.ends_at, r.is_active
    FROM crm.crm_rewards r
    LEFT JOIN crm.crm_membership_tiers t ON t.id = r.required_tier_id
`

func scanReward(row pgx.Row) (RewardRow, error) {
	var r RewardRow
	err := row.Scan(&r.ID, &r.Code, &r.Name, &r.RewardType, &r.MinXP, &r.RequiredTierRank, &r.RequiredTierName,
		&r.StockTotal, &r.StockRedeemed, &r.MaxRedemptionsPerMember, &r.QuotaPeriod,
		&r.ImageURL, &r.StartsAt, &r.EndsAt, &r.IsActive)
	return r, err
}

// RedeemableRewards is the active catalog; avatars have their own flow.
func (s *store) RedeemableRewards(ctx context.Context) ([]RewardRow, error) {
	rows, err := s.q.Query(ctx, rewardSelect+` WHERE r.reward_type <> 'avatar' AND r.is_active ORDER BY r.min_xp ASC, r.name ASC`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (RewardRow, error) { return scanReward(row) })
}

// RewardForUpdate locks the reward row (FOR UPDATE may only name the base
// table, not the LEFT JOIN).
func (s *store) RewardForUpdate(ctx context.Context, rewardID string) (*RewardRow, error) {
	r, err := scanReward(s.q.QueryRow(ctx, rewardSelect+` WHERE r.id = $1 FOR UPDATE OF r`, rewardID))
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *store) ActiveRedemptionTimes(ctx context.Context, customerID string, rewardIDs []string) (map[string][]time.Time, error) {
	rows, err := s.q.Query(ctx,
		`SELECT reward_id, requested_at
		   FROM crm.crm_redemptions
		  WHERE customer_id = $1
		    AND reward_id = ANY($2)
		    AND status = ANY($3)`, customerID, rewardIDs, domain.ActiveRedemptionStatuses)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]time.Time{}
	for rows.Next() {
		var id string
		var at time.Time
		if err := rows.Scan(&id, &at); err != nil {
			return nil, err
		}
		out[id] = append(out[id], at)
	}
	return out, rows.Err()
}

// CountActiveRedemptions counts the member's active redemptions of a reward
// requested at or after since (all of them when since is nil).
func (s *store) CountActiveRedemptions(ctx context.Context, customerID, rewardID string, since *time.Time) (int, error) {
	var n int
	err := s.q.QueryRow(ctx,
		`SELECT COUNT(*)::int AS total
		   FROM crm.crm_redemptions
		  WHERE customer_id = $1 AND reward_id = $2
		    AND status = ANY($3)
		    AND ($4::timestamptz IS NULL OR requested_at >= $4)`,
		customerID, rewardID, domain.ActiveRedemptionStatuses, since).Scan(&n)
	return n, err
}

// InsertRedemption writes a pending portal request.
func (s *store) InsertRedemption(ctx context.Context, in NewRedemption) (*Redemption, error) {
	var r Redemption
	err := s.q.QueryRow(ctx,
		`INSERT INTO crm.crm_redemptions
		   (member_id, customer_id, reward_id, min_xp_at_redeem, total_xp_at_redeem,
		    status, channel, requested_by_user_id, processed_by_user_id,
		    fulfilled_at, notes)
		 VALUES ($1, $2, $3, $4, $5, 'pending', 'portal', NULL, NULL, NULL, NULL)
		 RETURNING id, redemption_number, status, channel, requested_at, fulfilled_at`,
		in.MemberProfileID, in.CustomerID, in.RewardID, in.MinXP, in.TotalXP).
		Scan(&r.ID, &r.RedemptionNumber, &r.Status, &r.Channel, &r.RequestedAt, &r.FulfilledAt)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *store) IncrementRewardStock(ctx context.Context, rewardID string) error {
	_, err := s.q.Exec(ctx,
		`UPDATE crm.crm_rewards SET stock_redeemed = stock_redeemed + 1, updated_at = now()
		  WHERE id = $1`, rewardID)
	return err
}

func (s *store) RedemptionHistory(ctx context.Context, customerID string) ([]RedemptionHistoryRow, error) {
	rows, err := s.q.Query(ctx,
		`SELECT r.id, r.redemption_number, r.status, r.requested_at, r.fulfilled_at,
		        w.name AS reward_name, w.reward_type
		   FROM crm.crm_redemptions r
		   JOIN crm.crm_rewards w ON w.id = r.reward_id
		  WHERE r.customer_id = $1
		  ORDER BY r.requested_at DESC
		  LIMIT 20`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (RedemptionHistoryRow, error) {
		var h RedemptionHistoryRow
		err := row.Scan(&h.ID, &h.RedemptionNumber, &h.Status, &h.RequestedAt, &h.FulfilledAt, &h.RewardName, &h.RewardType)
		return h, err
	})
}

// ── Collectibles and wallpapers ───────────────────────────────────────────

// collectibleSQL holds the per-asset statements. Avatars and wallpapers
// share every rule; only the tables differ.
type collectibleSQL struct {
	catalog, lock, owns, check, claimStock, inventory string
}

var collectibleQueries = map[string]collectibleSQL{
	"avatar": {
		catalog: `SELECT a.id, a.code, a.name, a.rarity, a.image_url, a.thumbnail_url,
		                 a.stock_total, a.stock_redeemed,
		                 a.min_lifetime_xp::int AS min_lifetime_xp,
		                 t.name AS required_tier_name,
		                 t.min_lifetime_xp::int AS required_tier_min_xp,
		                 inv.id AS inventory_id, inv.is_equipped, inv.acquired_at
		            FROM crm.crm_collectible_avatars a
		            LEFT JOIN crm.crm_membership_tiers t ON t.id = a.required_tier_id
		            LEFT JOIN crm.crm_member_avatar_inventory inv
		                   ON inv.avatar_id = a.id AND inv.member_id = $1
		           WHERE inv.id IS NOT NULL
		              OR (a.is_active
		                  AND (a.starts_at IS NULL OR a.starts_at <= now())
		                  AND (a.ends_at IS NULL OR a.ends_at >= now()))`,
		lock: `SELECT id FROM crm.crm_collectible_avatars WHERE id = $1 FOR UPDATE`,
		owns: `SELECT id FROM crm.crm_member_avatar_inventory WHERE member_id = $1 AND avatar_id = $2`,
		check: `SELECT a.is_active, a.starts_at, a.ends_at, a.stock_total, a.stock_redeemed,
		               a.min_lifetime_xp::int AS min_lifetime_xp,
		               t.name AS required_tier_name,
		               t.min_lifetime_xp::int AS required_tier_min_xp,
		               c.total_xp::int AS total_xp
		          FROM crm.crm_collectible_avatars a
		          LEFT JOIN crm.crm_membership_tiers t ON t.id = a.required_tier_id
		          CROSS JOIN pos.pos_customers c
		         WHERE a.id = $1 AND c.id = $2`,
		claimStock: `UPDATE crm.crm_collectible_avatars
		                SET stock_redeemed = COALESCE(stock_redeemed, 0) + 1
		              WHERE id = $1
		                AND (stock_total IS NULL OR COALESCE(stock_redeemed, 0) < stock_total)`,
		inventory: `INSERT INTO crm.crm_member_avatar_inventory (member_id, avatar_id, acquisition_source, is_equipped)
		            VALUES ($1, $2, 'entitlement', false)`,
	},
	"wallpaper": {
		catalog: `SELECT w.id, w.code, w.name, w.rarity, w.image_url, w.thumbnail_url,
		                 w.stock_total, w.stock_redeemed,
		                 w.min_lifetime_xp::int AS min_lifetime_xp,
		                 t.name AS required_tier_name,
		                 t.min_lifetime_xp::int AS required_tier_min_xp,
		                 inv.id AS inventory_id, NULL::boolean AS is_equipped, inv.acquired_at
		            FROM crm.crm_collectible_wallpapers w
		            LEFT JOIN crm.crm_membership_tiers t ON t.id = w.required_tier_id
		            LEFT JOIN crm.crm_member_wallpaper_inventory inv
		                   ON inv.wallpaper_id = w.id AND inv.member_id = $1
		           WHERE inv.id IS NOT NULL
		              OR (w.is_active
		                  AND (w.starts_at IS NULL OR w.starts_at <= now())
		                  AND (w.ends_at IS NULL OR w.ends_at >= now()))`,
		lock: `SELECT id FROM crm.crm_collectible_wallpapers WHERE id = $1 FOR UPDATE`,
		owns: `SELECT id FROM crm.crm_member_wallpaper_inventory WHERE member_id = $1 AND wallpaper_id = $2`,
		check: `SELECT w.is_active, w.starts_at, w.ends_at, w.stock_total, w.stock_redeemed,
		               w.min_lifetime_xp::int AS min_lifetime_xp,
		               t.name AS required_tier_name,
		               t.min_lifetime_xp::int AS required_tier_min_xp,
		               c.total_xp::int AS total_xp
		          FROM crm.crm_collectible_wallpapers w
		          LEFT JOIN crm.crm_membership_tiers t ON t.id = w.required_tier_id
		          CROSS JOIN pos.pos_customers c
		         WHERE w.id = $1 AND c.id = $2`,
		claimStock: `UPDATE crm.crm_collectible_wallpapers
		                SET stock_redeemed = COALESCE(stock_redeemed, 0) + 1
		              WHERE id = $1
		                AND (stock_total IS NULL OR COALESCE(stock_redeemed, 0) < stock_total)`,
		inventory: `INSERT INTO crm.crm_member_wallpaper_inventory (member_id, wallpaper_id)
		            VALUES ($1, $2)`,
	},
}

func collectibleQuery(asset string) (collectibleSQL, error) {
	q, ok := collectibleQueries[asset]
	if !ok {
		return q, fmt.Errorf("unknown collectible asset %q", asset)
	}
	return q, nil
}

func (s *store) CollectibleCatalog(ctx context.Context, asset string, memberProfileID *string) ([]domain.CatalogRow, error) {
	q, err := collectibleQuery(asset)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.Query(ctx, q.catalog, memberProfileID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.CatalogRow, error) {
		var c domain.CatalogRow
		err := row.Scan(&c.ID, &c.Code, &c.Name, &c.Rarity, &c.ImageURL, &c.ThumbnailURL,
			&c.StockTotal, &c.StockRedeemed, &c.MinLifetimeXP, &c.RequiredTierName, &c.RequiredTierMinXP,
			&c.InventoryID, &c.IsEquipped, &c.AcquiredAt)
		return c, err
	})
}

// CollectibleIntervalSetting is the decoded crm_settings value, nil when the
// row is missing.
func (s *store) CollectibleIntervalSetting(ctx context.Context) (any, error) {
	var raw json.RawMessage
	err := s.q.QueryRow(ctx, `SELECT value FROM crm.crm_settings WHERE key = 'collectible_interval_xp'`).Scan(&raw)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	return v, nil
}

func (s *store) CountEntitlements(ctx context.Context, customerID string) (int, error) {
	var n int
	err := s.q.QueryRow(ctx,
		`SELECT count(*)::int AS used FROM crm.crm_member_entitlements WHERE customer_id = $1`, customerID).Scan(&n)
	return n, err
}

// LockCustomerXP locks the customer row, serializing a member's redeems.
func (s *store) LockCustomerXP(ctx context.Context, customerID string) (int, bool, error) {
	var id string
	var totalXP *int
	err := s.q.QueryRow(ctx,
		`SELECT id, total_xp::int AS total_xp FROM pos.pos_customers WHERE id = $1 FOR UPDATE`, customerID).
		Scan(&id, &totalXP)
	if database.IsNoRows(err) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	if totalXP == nil {
		return 0, true, nil
	}
	return *totalXP, true, nil
}

// collectionRowExists runs a single-row SELECT and reports whether it found a row.
func (s *store) collectionRowExists(ctx context.Context, sql string, args ...any) (bool, error) {
	var id string
	err := s.q.QueryRow(ctx, sql, args...).Scan(&id)
	if database.IsNoRows(err) {
		return false, nil
	}
	return err == nil, err
}

func (s *store) LockCollectible(ctx context.Context, asset, id string) (bool, error) {
	q, err := collectibleQuery(asset)
	if err != nil {
		return false, err
	}
	return s.collectionRowExists(ctx, q.lock, id)
}

func (s *store) OwnsCollectible(ctx context.Context, asset, memberProfileID, id string) (bool, error) {
	q, err := collectibleQuery(asset)
	if err != nil {
		return false, err
	}
	return s.collectionRowExists(ctx, q.owns, memberProfileID, id)
}

func (s *store) CollectibleCheck(ctx context.Context, asset, id, customerID string) (*domain.CollectibleCheck, error) {
	q, err := collectibleQuery(asset)
	if err != nil {
		return nil, err
	}
	var c domain.CollectibleCheck
	err = s.q.QueryRow(ctx, q.check, id, customerID).Scan(&c.IsActive, &c.StartsAt, &c.EndsAt, &c.StockTotal,
		&c.StockRedeemed, &c.MinLifetimeXP, &c.RequiredTierName, &c.RequiredTierMinXP, &c.TotalXP)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// ClaimCollectibleStock takes one unit of stock; false when none is left.
func (s *store) ClaimCollectibleStock(ctx context.Context, asset, id string) (bool, error) {
	q, err := collectibleQuery(asset)
	if err != nil {
		return false, err
	}
	tag, err := s.q.Exec(ctx, q.claimStock, id)
	return tag.RowsAffected() > 0, err
}

func (s *store) InsertEntitlement(ctx context.Context, customerID, memberProfileID, asset, id string) error {
	_, err := s.q.Exec(ctx,
		`INSERT INTO crm.crm_member_entitlements (customer_id, member_id, asset_type, asset_id)
		 VALUES ($1, $2, $3, $4)`, customerID, memberProfileID, asset, id)
	return err
}

func (s *store) InsertCollectibleInventory(ctx context.Context, asset, memberProfileID, id string) error {
	q, err := collectibleQuery(asset)
	if err != nil {
		return err
	}
	_, err = s.q.Exec(ctx, q.inventory, memberProfileID, id)
	return err
}

func (s *store) LockAvatarInventory(ctx context.Context, memberProfileID, avatarID string) (bool, error) {
	return s.collectionRowExists(ctx,
		`SELECT id FROM crm.crm_member_avatar_inventory
		  WHERE member_id = $1 AND avatar_id = $2
		  FOR UPDATE`, memberProfileID, avatarID)
}

// EquipAvatar flags the one equipped avatar and sets it on the profile.
func (s *store) EquipAvatar(ctx context.Context, memberProfileID, avatarID string) error {
	if _, err := s.q.Exec(ctx,
		`UPDATE crm.crm_member_avatar_inventory
		    SET is_equipped = (avatar_id = $2)
		  WHERE member_id = $1`, memberProfileID, avatarID); err != nil {
		return err
	}
	_, err := s.q.Exec(ctx,
		`UPDATE crm.crm_member_profiles
		    SET active_avatar_id = $2, last_activity_at = now()
		  WHERE id = $1`, memberProfileID, avatarID)
	return err
}
