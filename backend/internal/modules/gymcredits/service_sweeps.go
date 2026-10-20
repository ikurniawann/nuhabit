package gymcredits

import (
	"context"
	"crypto/rand"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	contracts "nuhabit/backend/internal/contracts/gymcredits"
	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
)

// Sweeps for a job runner. Each is idempotent: running it again at the
// same instant writes nothing.

// sweepBatch is how many members SweepExpiry reads per query.
const sweepBatch = 200

// SweepExpiry expires the lapsed lots of every member, each member in its
// own transaction under its credit lock (the same writes a balance read
// makes), and marks lapsed passes expired. It returns how many expiration
// entries and passes it wrote.
func (s *Service) SweepExpiry(ctx context.Context, now time.Time) (int, error) {
	now = now.Truncate(time.Millisecond)
	written, err := s.repo.ExpireAllLapsedPasses(ctx, s.db, now)
	if err != nil {
		return written, err
	}
	after := ""
	for {
		ids, err := s.repo.MembersWithLapsedLots(ctx, s.db, now, after, sweepBatch)
		if err != nil {
			return written, err
		}
		for _, id := range ids {
			err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
				if err := s.repo.LockMemberCredits(ctx, tx, id); err != nil {
					return err
				}
				_, n, err := s.expireLapsedLots(ctx, tx, id, now)
				written += n
				return err
			})
			if err != nil {
				return written, err
			}
		}
		if len(ids) < sweepBatch {
			return written, nil
		}
		after = ids[len(ids)-1]
	}
}

// SweepPassRevenue releases the revenue of paid passes through the day of
// now, spread evenly over each pass's days, and posts one GYM_PASS_REVENUE
// journal per company and day. A pass counts its days in its purchase
// branch's zone. Run it once a day or more often; it returns how many
// passes it released revenue for.
func (s *Service) SweepPassRevenue(ctx context.Context, now time.Time) (int, error) {
	released := 0
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := s.repo.LockPassRevenue(ctx, tx); err != nil {
			return err
		}
		passes, err := s.repo.PassesWithRevenueDue(ctx, tx, now)
		if err != nil {
			return err
		}
		type batch struct {
			id      string
			company *string
			day     string
			amount  float64
		}
		batches := map[string]*batch{}
		var order []string
		var releases []PassRelease
		for _, p := range passes {
			through := localDay(now, p.Zone)
			amount := domain.PassRevenueDue(p.TotalIdr, localDay(p.StartsAt, p.Zone), localDay(p.EndsAt, p.Zone), through) - p.Released
			if amount < 0.005 {
				continue
			}
			day := through.Format(time.DateOnly)
			key := deref(p.CompanyID) + "|" + day
			b := batches[key]
			if b == nil {
				b = &batch{id: newUUID(), company: p.CompanyID, day: day}
				batches[key] = b
				order = append(order, key)
			}
			b.amount += amount
			releases = append(releases, PassRelease{PassID: p.PassID, BatchID: b.id, Day: day, Amount: amount})
		}
		if err := s.repo.InsertPassReleases(ctx, tx, releases); err != nil {
			return err
		}
		for _, key := range order {
			b := batches[key]
			if err := s.publishJournal(ctx, tx, contracts.Journal{
				EventCode: "GYM_PASS_REVENUE", DocumentType: "gym_pass_revenue", DocumentID: b.id, CompanyID: b.company,
				EntryDate: b.day, Amount: b.amount,
				Description: "Pengakuan pendapatan pass gym " + b.day,
			}); err != nil {
				return err
			}
		}
		released = len(releases)
		return nil
	})
	return released, err
}

// newUUID is a random (version 4) UUID.
func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
