package gymcredits

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/jobs"
)

// Sent-log kinds (platform.reminder_sends) of the credit reminders.
const (
	kindCreditExpiry = "gym_credit_expiry"
	kindPassExpiry   = "gym_pass_expiry"
	kindLowBalance   = "gym_low_balance"
)

// SendCreditReminders sends the periodic member reminders of the global
// rules: credits about to expire and passes about to end (expiryReminderDays
// ahead), and a low-balance nudge (lowBalanceThreshold). Each reminder is
// claimed in the sent log in the transaction that writes it, so a rerun never
// sends twice and a failed write is retried next run. One member's failure
// does not stop the others: the errors come back joined after the sweep.
func (s *Service) SendCreditReminders(ctx context.Context, now time.Time) error {
	rules, err := s.Rules(ctx, s.db, nil)
	if err != nil {
		return err
	}
	return errors.Join(
		s.remindExpiringCredits(ctx, now, rules.ExpiryReminderDays),
		s.remindEndingPasses(ctx, now, rules.ExpiryReminderDays),
		s.nudgeLowBalances(ctx, now, rules.LowBalanceThreshold),
	)
}

func (s *Service) customerIDs(ctx context.Context, sql string, args ...any) ([]string, error) {
	rows, err := s.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// claimAndNotify claims every (kind, subject, period) and, when at least one
// was new, writes the notice built from the claimed subjects, all in one
// transaction.
func (s *Service) claimAndNotify(ctx context.Context, customerID, kind string, subjects map[string]string, notice func(claimed []string) Notice) error {
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		var claimed []string
		for subject, period := range subjects {
			ok, err := jobs.ClaimSend(ctx, tx, kind, subject, period, &customerID)
			if err != nil {
				return err
			}
			if ok {
				claimed = append(claimed, subject)
			}
		}
		if len(claimed) == 0 {
			return nil
		}
		return s.ports.Notifier.NotifyMember(ctx, tx, customerID, notice(claimed))
	})
}

func (s *Service) remindExpiringCredits(ctx context.Context, now time.Time, days int) error {
	horizon := now.Add(time.Duration(days) * 24 * time.Hour)
	ids, err := s.customerIDs(ctx, `
SELECT DISTINCT l.customer_id::text FROM gym.credit_lots l
 WHERE l.expires_at > $1 AND l.expires_at <= $2
   AND NOT EXISTS (SELECT 1 FROM platform.reminder_sends r WHERE r.kind = $3 AND r.subject_id = l.id::text)`,
		now, horizon, kindCreditExpiry)
	if err != nil {
		return err
	}
	var errs []error
	for _, id := range ids {
		state, err := s.loadState(ctx, s.db, id)
		if err != nil {
			errs = append(errs, fmt.Errorf("credit expiry %s: %w", id, err))
			continue
		}
		expiring := domain.ExpiringLots(state.lots, state.entries, now, days)
		if len(expiring) == 0 {
			continue
		}
		byID := map[string]domain.LotRemainder{}
		subjects := map[string]string{}
		for _, r := range expiring {
			byID[r.Lot.ID] = r
			subjects[r.Lot.ID] = domain.ExpiryPeriod(r.Lot.ExpiresAt)
		}
		err = s.claimAndNotify(ctx, id, kindCreditExpiry, subjects, func(claimed []string) Notice {
			credits, earliest := 0, time.Time{}
			for _, lotID := range claimed {
				r := byID[lotID]
				credits += r.Remaining
				if earliest.IsZero() || r.Lot.ExpiresAt.Before(earliest) {
					earliest = r.Lot.ExpiresAt
				}
			}
			return Notice{
				Type:  "gym_credit_expiring",
				Title: "Kredit kelas segera hangus",
				Body:  strconv.Itoa(credits) + " kredit berakhir " + domain.FormatDateWib(earliest) + ". Pakai untuk booking kelas sebelum tanggal itu.",
			}
		})
		if err != nil {
			errs = append(errs, fmt.Errorf("credit expiry %s: %w", id, err))
		}
	}
	return errors.Join(errs...)
}

type endingPass struct {
	ID, CustomerID, PackageName string
	EndsAt                      time.Time
}

// remindEndingPasses skips a member who already holds a pass running past
// the ending one (renewed early).
func (s *Service) remindEndingPasses(ctx context.Context, now time.Time, days int) error {
	rows, err := s.db.Query(ctx, `
SELECT mp.id, mp.customer_id, pk.name, mp.ends_at
  FROM gym.member_passes mp JOIN gym.credit_packages pk ON pk.id = mp.package_id
 WHERE mp.status = 'active' AND mp.ends_at > $1 AND mp.ends_at <= $2
   AND NOT EXISTS (SELECT 1 FROM gym.member_passes n
                    WHERE n.customer_id = mp.customer_id AND n.status = 'active' AND n.ends_at > mp.ends_at)
   AND NOT EXISTS (SELECT 1 FROM platform.reminder_sends r WHERE r.kind = $3 AND r.subject_id = mp.id::text)`,
		now, now.Add(time.Duration(days)*24*time.Hour), kindPassExpiry)
	if err != nil {
		return err
	}
	passes, err := pgx.CollectRows(rows, pgx.RowToStructByPos[endingPass])
	if err != nil {
		return err
	}
	var errs []error
	for _, p := range passes {
		err := s.claimAndNotify(ctx, p.CustomerID, kindPassExpiry, map[string]string{p.ID: domain.ExpiryPeriod(p.EndsAt)}, func([]string) Notice {
			return Notice{
				Type:  "gym_pass_expiring",
				Title: "Pass segera berakhir: " + p.PackageName,
				Body:  "Pass Anda berakhir " + domain.FormatDateWib(p.EndsAt) + ". Perpanjang di aplikasi agar tetap bisa ikut kelas.",
			}
		})
		if err != nil {
			errs = append(errs, fmt.Errorf("pass expiry %s: %w", p.ID, err))
		}
	}
	return errors.Join(errs...)
}

// nudgeLowBalances looks at members whose ledger moved recently; pass
// holders are skipped because they book without credits.
func (s *Service) nudgeLowBalances(ctx context.Context, now time.Time, threshold int) error {
	ids, err := s.customerIDs(ctx, `
SELECT DISTINCT e.customer_id::text FROM gym.credit_ledger e
 WHERE e.created_at > $1
   AND NOT EXISTS (SELECT 1 FROM gym.member_passes mp
                    WHERE mp.customer_id = e.customer_id AND mp.status = 'active' AND mp.starts_at <= $2 AND mp.ends_at > $2)`,
		now.Add(-domain.LowBalanceActiveDays*24*time.Hour), now)
	if err != nil {
		return err
	}
	var errs []error
	for _, id := range ids {
		state, err := s.loadState(ctx, s.db, id)
		if err != nil {
			errs = append(errs, fmt.Errorf("low balance %s: %w", id, err))
			continue
		}
		balance, period, due := domain.LowBalanceNudge(state.lots, state.entries, now, threshold)
		if !due {
			continue
		}
		err = s.claimAndNotify(ctx, id, kindLowBalance, map[string]string{id: period}, func([]string) Notice {
			return Notice{
				Type:  "gym_low_balance",
				Title: "Kredit kelas menipis",
				Body:  "Sisa kredit Anda " + strconv.Itoa(balance) + ". Beli paket di aplikasi agar booking berikutnya lancar.",
			}
		})
		if err != nil {
			errs = append(errs, fmt.Errorf("low balance %s: %w", id, err))
		}
	}
	return errors.Join(errs...)
}
