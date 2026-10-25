// Package gymloyalty owns gym membership tiers from 12-month spending
// (EPIC-069), attendance progress XP and the monthly attendance leaderboard
// (EPIC-066), and the member status managers set (active, suspended, banned).
//
// How it sits next to the CRM XP tiers (crm/loyalty): XP stays the
// "Progress" ladder by lifetime XP, now fed by attendance as well as POS
// spend and challenges, and its only perk is a POS discount. Spending tiers
// are the "Membership" ladder and carry the booking perks. One perks engine
// (domain.Perks.Merge) reads both, so where both give the same perk the
// member gets the better one. Gym scheduling reads the merged perks through
// its TierPerks port; POS reads the merged discount through its member
// discount hook. XP posts to the CRM ledger through the XP port.
package gymloyalty

import (
	"context"
	"log/slog"
	"time"

	"nuhabit/backend/internal/modules/gymloyalty/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/localtime"
)

// memberZone is the zone of member-level dates: the spending window, tier
// hold and streak weeks.
var memberZone = localtime.Jakarta

// XPAward is one idempotent XP posting.
type XPAward struct {
	CustomerID     string
	XP             int
	SourceType     string
	SourceID       string
	ReferenceTable string
	IdempotencyKey string
	Description    string
	BranchID       *string
}

// XPTier is a rung of the CRM XP ladder.
type XPTier struct {
	Code            string  `json:"code"`
	Name            string  `json:"name"`
	MinLifetimeXP   float64 `json:"min_lifetime_xp"`
	DiscountPercent float64 `json:"discount_percent"`
}

// XPStanding is a member's place on the XP ladder.
type XPStanding struct {
	LifetimeXP float64 `json:"lifetime_xp"`
	Tier       *XPTier `json:"tier"`
	Next       *XPTier `json:"next_tier"`
}

// XPEntry is one gym XP ledger row.
type XPEntry struct {
	XP          int       `json:"xp"`
	SourceType  string    `json:"source_type"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}

// XP is the CRM XP engine and ladder (owned by crm).
type XP interface {
	// Award posts once per IdempotencyKey; posted is false for a duplicate
	// or a skipped award.
	Award(ctx context.Context, q database.DB, a XPAward) (posted bool, err error)
	// Standing is the member's lifetime XP and XP tier.
	Standing(ctx context.Context, q database.Querier, customerID string) (XPStanding, error)
	// History lists the member's latest gym XP postings, newest first.
	History(ctx context.Context, q database.Querier, customerID string, limit int) ([]XPEntry, error)
}

// Ports are the adapters internal/app wires in.
type Ports struct {
	XP XP
}

// Service implements the loyalty use cases.
type Service struct {
	db  database.DB
	XP  XP
	now func() time.Time
	log *slog.Logger
}

// NewService builds the service on db (a pool, or a transaction in tests).
func NewService(db database.DB, p Ports, now func() time.Time, log *slog.Logger) *Service {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{db: db, XP: p.XP, now: now, log: log}
}

func (s *Service) today() domain.Day { return domain.DayOf(s.now(), memberZone) }

func (s *Service) inTx(ctx context.Context, fn func(q database.DB) error) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// errMemberNotFound is the 404 of an unknown member.
var errMemberNotFound = httpx.Coded(404, "MEMBER_NOT_FOUND", "Member tidak ditemukan", nil)

// requireMember returns errMemberNotFound for an unknown customer.
func requireMember(ctx context.Context, q database.Querier, customerID string) error {
	var ok bool
	if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pos.pos_customers WHERE id = $1)`, customerID).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return errMemberNotFound
	}
	return nil
}
