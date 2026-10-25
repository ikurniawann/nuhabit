package gymloyalty

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"time"

	"nuhabit/backend/internal/modules/gymloyalty/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/members"
)

// Membership: each member's tier from 12-month spending, evaluated when a
// paid purchase lands (outbox), when the member or staff open it, and by the
// hourly job once per Jakarta day.

// Evaluated is a member's tier after an evaluation, with the spending behind it.
type Evaluated struct {
	domain.Evaluation
	Spend Spend
}

// recompute evaluates one member on q and stores the result. The member's
// row is locked, so parallel evaluations record one change.
func (s *Service) recompute(ctx context.Context, q database.Querier, customerID string, tiers []domain.Tier, settings domain.Settings, today domain.Day) (Evaluated, error) {
	if _, err := q.Exec(ctx, `INSERT INTO gym.member_memberships (customer_id, evaluated_on) VALUES ($1, $2::date)
		ON CONFLICT (customer_id) DO NOTHING`, customerID, string(today)); err != nil {
		return Evaluated{}, err
	}
	stored, err := loadMembership(ctx, q, customerID, true)
	if err != nil {
		return Evaluated{}, err
	}
	spend, err := memberSpend(ctx, q, customerID, today)
	if err != nil {
		return Evaluated{}, err
	}
	ev := domain.Evaluate(tiers, spend.Total, stored.State, today, settings.TierHoldMonths)
	out := Evaluated{Evaluation: ev, Spend: spend}
	var tierID *string
	if ev.Tier != nil {
		tierID = &ev.Tier.ID
	}
	unchanged := reflect.DeepEqual(tierID, stored.State.TierID) && reflect.DeepEqual(ev.ValidUntil, stored.State.ValidUntil) &&
		spend.Total == stored.Spend && stored.EvaluatedOn == today
	if !unchanged {
		if err := saveMembership(ctx, q, customerID, ev, spend.Total, today); err != nil {
			return out, err
		}
	}
	if ev.Change == nil {
		return out, nil
	}
	if err := insertTierChange(ctx, q, customerID, ev.Change, spend.Total, s.now()); err != nil {
		return out, err
	}
	if ev.Change.Direction == "up" && ev.Change.To != nil {
		err = members.Notify(ctx, q, customerID, members.Notice{
			Type:  "gym_membership_tier_up",
			Title: "Selamat, kamu naik ke " + ev.Change.To.Name,
			Body:  "Perks tier " + ev.Change.To.Name + " sudah aktif di akunmu.",
		})
	}
	return out, err
}

// Recompute evaluates one member on q (the caller's transaction), loading
// the ladder and settings first.
func (s *Service) Recompute(ctx context.Context, q database.Querier, customerID string) (Evaluated, error) {
	tiers, err := activeTiers(ctx, q)
	if err != nil {
		return Evaluated{}, err
	}
	settings, err := loadSettings(ctx, q)
	if err != nil {
		return Evaluated{}, err
	}
	return s.recompute(ctx, q, customerID, tiers, settings, s.today())
}

// RecomputeAll evaluates every member not yet evaluated today (all of them
// when force), each in its own transaction so one failure does not stop the
// rest. It returns how many changed tier. The hourly job calls it.
func (s *Service) RecomputeAll(ctx context.Context, force bool) (changed int, err error) {
	today := s.today()
	tiers, err := activeTiers(ctx, s.db)
	if err != nil {
		return 0, err
	}
	settings, err := loadSettings(ctx, s.db)
	if err != nil {
		return 0, err
	}
	if force {
		// Dating every row yesterday puts it back in today's queue.
		if _, err := s.db.Exec(ctx, `UPDATE gym.member_memberships SET evaluated_on = $1::date - 1 WHERE evaluated_on >= $1::date`, string(today)); err != nil {
			return 0, err
		}
	}
	ids, err := spendingMembers(ctx, s.db, today)
	if err != nil {
		return 0, err
	}
	var errs []error
	for _, id := range ids {
		err := s.inTx(ctx, func(q database.DB) error {
			ev, err := s.recompute(ctx, q, id, tiers, settings, today)
			if err == nil && ev.Change != nil {
				changed++
			}
			return err
		})
		if err != nil {
			errs = append(errs, fmt.Errorf("membership %s: %w", id, err))
		}
	}
	return changed, errors.Join(errs...)
}

// SweepMemberships is the hourly job: members are evaluated once per day.
func (s *Service) SweepMemberships(ctx context.Context, _ time.Time) error {
	_, err := s.RecomputeAll(ctx, false)
	return err
}

// MemberPerks are what booking and POS apply for a member right now.
type MemberPerks struct {
	Perks  domain.Perks
	Frozen bool
	Banned bool
}

// Perks reads the member's stored tier and status (no evaluation, so it is
// safe inside a booking transaction). A frozen member gets no perks.
func (s *Service) Perks(ctx context.Context, q database.Querier, customerID string) (MemberPerks, error) {
	standing, err := loadStanding(ctx, q, customerID)
	if err != nil {
		return MemberPerks{}, err
	}
	now := s.now()
	out := MemberPerks{Frozen: standing.Frozen(now), Banned: standing.Banned(now)}
	if out.Frozen {
		return out, nil
	}
	tier, err := storedTier(ctx, q, customerID)
	if err != nil || tier == nil {
		return out, err
	}
	tiers, err := activeTiers(ctx, q)
	if err != nil {
		return out, err
	}
	out.Perks = domain.TierPerks(tier, domain.Rank(tiers, tier.ID))
	return out, nil
}

// MemberDiscount is a member's membership tier discount for the POS list.
type MemberDiscount struct {
	Percent float64
	Frozen  bool
}

// Discounts reads the stored membership discount of many members at once.
// Members without a tier or status row are left out.
func Discounts(ctx context.Context, q database.Querier, customerIDs []string, now time.Time) (map[string]MemberDiscount, error) {
	out := map[string]MemberDiscount{}
	if len(customerIDs) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT c.id::text, COALESCE(t.discount_percent, 0)::float8, st.status, st.suspended_until
		FROM pos.pos_customers c
		LEFT JOIN gym.member_memberships m ON m.customer_id = c.id
		LEFT JOIN gym.membership_tiers t ON t.id = m.tier_id AND t.is_active
		LEFT JOIN gym.member_status st ON st.customer_id = c.id
		WHERE c.id = ANY($1::uuid[]) AND (t.id IS NOT NULL OR st.customer_id IS NOT NULL)`, customerIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var d MemberDiscount
		var standing domain.Standing
		var status *domain.Status
		if err := rows.Scan(&id, &d.Percent, &status, &standing.SuspendedUntil); err != nil {
			return nil, err
		}
		if status != nil {
			standing.Status = *status
		}
		if d.Frozen = standing.Frozen(now); d.Frozen {
			d.Percent = 0
		}
		out[id] = d
	}
	return out, rows.Err()
}

// MembershipView is the member's tier card: the tier and its perks, the
// spending behind it, what the next tier needs and the history.
type MembershipView struct {
	Enabled    bool          `json:"enabled"`
	Status     domain.Status `json:"status"`
	Frozen     bool          `json:"frozen"`
	Tier       *domain.Tier  `json:"tier"`
	ValidUntil *domain.Day   `json:"valid_until"`
	Spend      Spend         `json:"spend"`
	Next       *domain.Next  `json:"next"`
	Keep       *domain.Keep  `json:"keep"`
	Perks      domain.Perks  `json:"perks"`
	Tiers      []domain.Tier `json:"tiers"`
	History    []TierChange  `json:"history"`
}

// Membership evaluates the member and returns their card.
func (s *Service) Membership(ctx context.Context, customerID string) (MembershipView, error) {
	var view MembershipView
	err := s.inTx(ctx, func(q database.DB) error {
		if err := requireMember(ctx, q, customerID); err != nil {
			return err
		}
		tiers, err := activeTiers(ctx, q)
		if err != nil {
			return err
		}
		settings, err := loadSettings(ctx, q)
		if err != nil {
			return err
		}
		ev, err := s.recompute(ctx, q, customerID, tiers, settings, s.today())
		if err != nil {
			return err
		}
		standing, err := loadStanding(ctx, q, customerID)
		if err != nil {
			return err
		}
		history, err := tierHistory(ctx, q, customerID, 10)
		if err != nil {
			return err
		}
		now := s.now()
		view = MembershipView{
			Enabled: len(tiers) > 0, Status: standing.Effective(now), Frozen: standing.Frozen(now),
			Tier: ev.Tier, ValidUntil: ev.ValidUntil, Spend: ev.Spend,
			Next: domain.NextTier(tiers, ev.Tier, ev.Spend.Total), Keep: domain.KeepTier(ev.Tier, ev.Spend.Total, ev.ValidUntil),
			Tiers: tiers, History: history,
		}
		if !view.Frozen && ev.Tier != nil {
			view.Perks = domain.TierPerks(ev.Tier, domain.Rank(tiers, ev.Tier.ID))
		}
		return nil
	})
	return view, err
}
