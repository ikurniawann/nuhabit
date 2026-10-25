package app

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm"
	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/modules/gymloyalty"
	loyaltydomain "nuhabit/backend/internal/modules/gymloyalty/domain"
	scheddomain "nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/modules/possales/tableorder"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// gym-loyalty: membership tiers from 12-month spending, attendance XP and
// the attendance leaderboard, member status. XP posts through the CRM
// engine on channel "gym". Gym scheduling reads the tier perks through its
// TierPerks port; POS reads the merged discount below.
func init() {
	Register(gymloyalty.Name, func(d module.Deps) module.Module {
		return gymloyalty.New(d, loyaltyPorts(d))
	})
	RegisterJob(gymloyalty.Name, "gym-loyalty.memberships", time.Hour, loyaltyService, (*gymloyalty.Service).SweepMemberships)
	RegisterJob(gymloyalty.Name, "gym-loyalty.attendance-xp", 10*time.Minute, loyaltyService, (*gymloyalty.Service).SweepAttendance)
}

func loyaltyPorts(d module.Deps) gymloyalty.Ports {
	return gymloyalty.Ports{XP: loyaltyXP{engine: crm.NewEngine(d, crmPosReads{})}}
}

// loyaltyService is the loyalty service for background jobs.
func loyaltyService(d module.Deps) *gymloyalty.Service {
	return gymloyalty.NewService(d.DB, loyaltyPorts(d), d.Now, d.Log)
}

// loyaltyXP adapts the CRM XP engine and ladder to gym-loyalty.
type loyaltyXP struct{ engine *xp.Engine }

var _ gymloyalty.XP = loyaltyXP{}

func (l loyaltyXP) Award(ctx context.Context, q database.DB, a gymloyalty.XPAward) (bool, error) {
	r, err := l.engine.AwardFlat(ctx, q, xp.FlatAward{
		CustomerID: a.CustomerID, XPAmount: float64(a.XP), BranchID: a.BranchID, SourceType: a.SourceType,
		SourceID: a.SourceID, ReferenceTable: a.ReferenceTable, IdempotencyKey: a.IdempotencyKey,
		Description: a.Description, SourceChannel: "gym",
	})
	return r.Status == "posted", err
}

// Standing places pos_customers.total_xp (the canonical XP) on the active
// XP tiers, as the POS member discount does.
func (loyaltyXP) Standing(ctx context.Context, q database.Querier, customerID string) (gymloyalty.XPStanding, error) {
	var out gymloyalty.XPStanding
	if err := q.QueryRow(ctx, `SELECT COALESCE(c.total_xp, p.lifetime_xp, 0)::float8 FROM pos.pos_customers c
		LEFT JOIN crm.crm_member_profiles p ON p.customer_id = c.id WHERE c.id = $1`, customerID).Scan(&out.LifetimeXP); err != nil {
		return out, err
	}
	rows, err := q.Query(ctx, `SELECT code::text, name, min_lifetime_xp::float8, COALESCE(discount_percent, 0)::float8
		FROM crm.crm_membership_tiers WHERE is_active ORDER BY min_lifetime_xp, rank`)
	if err != nil {
		return out, err
	}
	tiers, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (gymloyalty.XPTier, error) {
		var t gymloyalty.XPTier
		err := r.Scan(&t.Code, &t.Name, &t.MinLifetimeXP, &t.DiscountPercent)
		return t, err
	})
	for i := range tiers {
		if out.LifetimeXP >= tiers[i].MinLifetimeXP {
			out.Tier = &tiers[i]
		} else if out.Next == nil {
			out.Next = &tiers[i]
		}
	}
	return out, err
}

func (loyaltyXP) History(ctx context.Context, q database.Querier, customerID string, limit int) ([]gymloyalty.XPEntry, error) {
	rows, err := q.Query(ctx, `SELECT xp_delta, source_type, COALESCE(description, ''), created_at FROM crm.crm_xp_ledger
		WHERE customer_id = $1 ORDER BY created_at DESC, id LIMIT $2`, customerID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (gymloyalty.XPEntry, error) {
		var e gymloyalty.XPEntry
		err := r.Scan(&e.XP, &e.SourceType, &e.Description, &e.CreatedAt)
		return e, err
	})
}

// schedulingPerks serves the scheduling TierPerks port. XP tiers carry no
// booking perks, so these come from the membership tier alone.
type schedulingPerks struct{ svc *gymloyalty.Service }

func (p schedulingPerks) TierPerks(ctx context.Context, q database.Querier, customerID string) (scheddomain.MemberPerks, error) {
	mp, err := p.svc.Perks(ctx, q, customerID)
	return scheddomain.MemberPerks{
		EarlyBookingDays: mp.Perks.EarlyBookingDays, CancelWindowHours: mp.Perks.CancelWindowHours,
		WaitlistRank: mp.Perks.WaitlistRank, Banned: mp.Banned,
	}, err
}

// memberDiscountCRM is the self-order member discount hook: the better of
// the XP tier discount and the membership tier discount (Perks.Merge), none
// for a suspended or banned member.
type memberDiscountCRM struct {
	tableorder.CRM
	loyalty *gymloyalty.Service
}

func (c memberDiscountCRM) MemberDiscountPercent(ctx context.Context, q database.Querier, customerID string) float64 {
	mp, err := c.loyalty.Perks(ctx, q, customerID)
	if err != nil || mp.Frozen {
		return 0
	}
	xpTier := loyaltydomain.Perks{DiscountPercent: c.CRM.MemberDiscountPercent(ctx, q, customerID)}
	return xpTier.Merge(mp.Perks).DiscountPercent
}
