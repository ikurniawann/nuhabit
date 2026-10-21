package gymcredits

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/jackc/pgx/v5"

	contracts "nuhabit/backend/internal/contracts/gymcredits"
	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/outbox"
)

// Opening balance for packages sold before the gym journals existed
// (cmd/gym-opening-balance, see docs/GYM_OPENING_BALANCE.md). Two passes:
//
//  1. Backfill: entries written before deductions recorded their lot are
//     pinned to the lots the FIFO pool would have drawn (domain.PlanBackfill),
//     so later usage, breakage and refunds value the right lot. A member
//     whose lots would end up with different credits is left alone.
//  2. Opening: per company, every paid purchase with no GYM_SALE_* journal
//     is valued at what deferred revenue should hold for it today, and one
//     GYM_OPENING_BALANCE journal (debit the opening balance account, credit
//     deferred revenue) is published per company. The purchases are marked
//     with the batch so a second run finds nothing.

// OpeningOptions drives RunOpeningBalance.
type OpeningOptions struct {
	// DryRun lists what would happen and writes nothing.
	DryRun bool
	// UserID is recorded on the journals.
	UserID string
	Now    time.Time
	Out    io.Writer
}

// openingPurchase is one purchase and what its opening journal holds.
type openingPurchase struct {
	ID, CustomerID, PackageName, Kind string
	Credits                           int
	TotalIdr                          float64
	Zone                              *time.Location
	// UnusedSen is the deferred revenue the unused credits or days hold now;
	// JournaledSen is what the lot journals already took out of it without
	// a sale ever putting it in. The opening posts both.
	UnusedSen, JournaledSen int64
	Note                    string
}

func (p openingPurchase) openingSen() int64 { return p.UnusedSen + p.JournaledSen }

// RunOpeningBalance backfills lot ids, then posts the opening balances.
func RunOpeningBalance(ctx context.Context, db database.DB, o OpeningOptions) error {
	if o.Now.IsZero() {
		o.Now = time.Now()
	}
	if o.Out == nil {
		o.Out = io.Discard
	}
	if err := backfillLots(ctx, db, o); err != nil {
		return fmt.Errorf("backfill: %w", err)
	}
	return postOpeningBalances(ctx, db, o)
}

/* ── Backfill ────────────────────────────────────────────────────────── */

func backfillLots(ctx context.Context, db database.DB, o OpeningOptions) error {
	rows, err := db.Query(ctx, `SELECT DISTINCT customer_id::text FROM gym.credit_ledger
		WHERE lot_id IS NULL AND type IN ('class_deduction', 'refund', 'adjustment', 'reversal') ORDER BY 1`)
	if err != nil {
		return err
	}
	members, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	fmt.Fprintf(o.Out, "Backfill lot: %d member dengan entri tanpa lot\n", len(members))
	repo := Postgres{}
	pinned, skipped := 0, 0
	for _, customerID := range members {
		err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
			if err := repo.LockMemberCredits(ctx, tx, customerID); err != nil {
				return err
			}
			lots, err := repo.Lots(ctx, tx, customerID)
			if err != nil {
				return err
			}
			entries, err := repo.Entries(ctx, tx, customerID)
			if err != nil {
				return err
			}
			reversedRows, err := tx.Query(ctx, `SELECT reverses_entry_id::text FROM gym.credit_ledger
				WHERE customer_id = $1 AND reverses_entry_id IS NOT NULL`, customerID)
			if err != nil {
				return err
			}
			reversedIDs, err := pgx.CollectRows(reversedRows, pgx.RowTo[string])
			if err != nil {
				return err
			}
			reversed := map[string]bool{}
			for _, id := range reversedIDs {
				reversed[id] = true
			}
			plan := domain.PlanBackfill(lots, entries, reversed)
			if !plan.Consistent {
				skipped++
				fmt.Fprintf(o.Out, "  %s: dilewati, sisa kredit per lot akan berubah\n", customerID)
				return nil
			}
			fmt.Fprintf(o.Out, "  %s: %d pin, %d entri tetap tanpa lot\n", customerID, len(plan.Pins), len(plan.Unpinned))
			pinned += len(plan.Pins)
			if o.DryRun {
				return nil
			}
			if _, err := tx.Exec(ctx, `SET LOCAL gym.ledger_backfill = 'on'`); err != nil {
				return err
			}
			return applyPins(ctx, tx, entries, plan.Pins)
		})
		if err != nil {
			return fmt.Errorf("member %s: %w", customerID, err)
		}
	}
	fmt.Fprintf(o.Out, "Backfill lot: %d pin, %d member dilewati\n", pinned, skipped)
	return nil
}

// applyPins writes the pins: the first pin of an entry updates its row,
// the rest are copies of it with the split amount.
func applyPins(ctx context.Context, tx pgx.Tx, entries []domain.Entry, pins []domain.Pin) error {
	seen := map[string]int{}
	sign := map[string]int{}
	for _, e := range entries {
		sign[e.ID] = 1
		if e.Amount < 0 {
			sign[e.ID] = -1
		}
	}
	for _, p := range pins {
		seen[p.EntryID]++
		amount := sign[p.EntryID] * p.Credits
		if seen[p.EntryID] == 1 {
			if _, err := tx.Exec(ctx, `UPDATE gym.credit_ledger SET lot_id = $2, amount = $3 WHERE id = $1`, p.EntryID, p.LotID, amount); err != nil {
				return err
			}
			continue
		}
		if _, err := tx.Exec(ctx, `INSERT INTO gym.credit_ledger
			(customer_id, type, amount, lot_id, source_type, source_id, reverses_entry_id, note, idempotency_key, created_by, created_at)
			SELECT customer_id, type, $3, $2, source_type, source_id, reverses_entry_id, note,
			       CASE WHEN idempotency_key IS NULL THEN NULL ELSE idempotency_key || '#bf' || $4::text END, created_by, created_at
			  FROM gym.credit_ledger WHERE id = $1`, p.EntryID, p.LotID, amount, seen[p.EntryID]); err != nil {
			return err
		}
	}
	return nil
}

/* ── Opening balances ────────────────────────────────────────────────── */

func postOpeningBalances(ctx context.Context, db database.DB, o OpeningOptions) error {
	companies, err := Postgres{}.Companies(ctx, db)
	if err != nil {
		return err
	}
	for _, c := range companies {
		if err := openCompany(ctx, db, o, c); err != nil {
			return fmt.Errorf("company %s: %w", c.Name, err)
		}
	}
	return nil
}

func openCompany(ctx context.Context, db database.DB, o OpeningOptions, c Company) error {
	return database.WithTx(ctx, db, func(tx pgx.Tx) error {
		purchases, err := unopenedPurchases(ctx, tx, c.ID)
		if err != nil {
			return err
		}
		fmt.Fprintf(o.Out, "\n%s: %d pembelian lunas tanpa jurnal penjualan\n", c.Name, len(purchases))
		var total int64
		ids := make([]string, 0, len(purchases))
		for i := range purchases {
			p := &purchases[i]
			if p.Kind == KindPass {
				err = valueOpenPass(ctx, tx, p, o.Now)
			} else {
				err = valueOpenCredits(ctx, tx, p)
			}
			if err != nil {
				return fmt.Errorf("purchase %s: %w", p.ID, err)
			}
			total += p.openingSen()
			ids = append(ids, p.ID)
			fmt.Fprintf(o.Out, "  %s %-24.24s %-7s %s  sisa Rp %s  sudah dijurnal Rp %s  saldo awal Rp %s\n",
				p.ID, p.PackageName, p.Kind, p.Note, rupiah(p.UnusedSen), rupiah(p.JournaledSen), rupiah(p.openingSen()))
		}
		fmt.Fprintf(o.Out, "  Jurnal GYM_OPENING_BALANCE %s: Rp %s\n", c.Name, rupiah(total))
		if o.DryRun || len(ids) == 0 {
			return nil
		}
		var batch string
		if err := tx.QueryRow(ctx, `SELECT gen_random_uuid()::text`).Scan(&batch); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE gym.credit_purchases SET opening_batch_id = $2, updated_at = now() WHERE id = ANY($1::uuid[])`, ids, batch); err != nil {
			return err
		}
		if total <= 0 {
			return nil
		}
		company := c.ID
		j := contracts.Journal{
			EventCode: "GYM_OPENING_BALANCE", DocumentType: "gym_opening_batch", DocumentID: batch, CompanyID: &company,
			UserID: o.UserID, EntryDate: localtime.DayKey(o.Now, localtime.Jakarta), Amount: domain.SenToIdr(total),
			Description: fmt.Sprintf("Saldo awal pendapatan diterima di muka paket gym (%d pembelian)", len(ids)),
		}
		return outbox.Publish(ctx, tx, contracts.TopicJournal, j.EventCode+":"+j.DocumentID, j)
	})
}

// unopenedPurchases are the company's paid purchases that no sale journal
// ever put into deferred revenue and no opening batch has opened.
func unopenedPurchases(ctx context.Context, q database.Querier, companyID string) ([]openingPurchase, error) {
	rows, err := q.Query(ctx, `
		SELECT p.id::text, p.customer_id::text, pk.name, pk.kind, p.credits, p.total_idr::float, `+purchaseZone+`
		  FROM gym.credit_purchases p JOIN gym.credit_packages pk ON pk.id = p.package_id
		 WHERE p.status = 'paid' AND p.opening_batch_id IS NULL AND p.total_idr > 0
		   AND `+purchaseCompany+` = $1::uuid
		   AND NOT EXISTS (SELECT 1 FROM accounting.journal_entries je
		         WHERE je.deleted_at IS NULL AND je.source_event_code LIKE 'GYM\_SALE\_%' AND je.source_document_id = p.id)
		   AND NOT EXISTS (SELECT 1 FROM platform.outbox_events ev
		         WHERE ev.topic = $2 AND ev.key LIKE 'GYM\_SALE\_%:' || p.id::text)
		 ORDER BY p.paid_at, p.id`, companyID, contracts.TopicJournal)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (openingPurchase, error) {
		var p openingPurchase
		var zone string
		err := row.Scan(&p.ID, &p.CustomerID, &p.PackageName, &p.Kind, &p.Credits, &p.TotalIdr, &zone)
		p.Zone = localtime.Zone(zone)
		return p, err
	})
}

// valueOpenCredits values a credit pack: the credits still in its lot at
// the lot's unit price, plus what its lot journals already recognised.
func valueOpenCredits(ctx context.Context, q database.Querier, p *openingPurchase) error {
	repo := Postgres{}
	var lotID string
	err := q.QueryRow(ctx, `SELECT id::text FROM gym.credit_lots WHERE purchase_id = $1`, p.ID).Scan(&lotID)
	if database.IsNoRows(err) {
		p.Note = "tanpa lot"
		return nil
	}
	if err != nil {
		return err
	}
	lots, err := repo.Lots(ctx, q, p.CustomerID)
	if err != nil {
		return err
	}
	entries, err := repo.Entries(ctx, q, p.CustomerID)
	if err != nil {
		return err
	}
	remaining := domain.RemainingIn(domain.LotRemainders(lots, entries), lotID)
	value := domain.LotValueSen(p.TotalIdr)
	p.UnusedSen = domain.UnusedValueSen(value, p.Credits, p.Credits-remaining)
	p.Note = fmt.Sprintf("%d/%d kredit sisa", remaining, p.Credits)
	var journaled float64
	err = q.QueryRow(ctx, `
		SELECT COALESCE(sum(CASE WHEN je.source_event_code = 'GYM_CREDIT_USAGE_REVERSAL' THEN -l.amount ELSE l.amount END), 0)::float
		  FROM accounting.journal_entries je
		  JOIN accounting.journal_entry_lines l ON l.entry_id = je.id AND l.entry_side = 'DEBIT'
		 WHERE je.deleted_at IS NULL AND je.source_document_type = 'gym_credit_entry'
		   AND je.source_event_code IN ('GYM_CREDIT_USAGE', 'GYM_CREDIT_USAGE_REVERSAL', 'GYM_CREDIT_BREAKAGE', 'GYM_CREDIT_ADJUSTMENT', 'GYM_TRANSFER_OUT')
		   AND je.source_document_id IN (SELECT e.id FROM gym.credit_ledger e WHERE e.lot_id = $1::uuid)`, lotID).Scan(&journaled)
	p.JournaledSen = domain.LotValueSen(journaled)
	return err
}

// valueOpenPass values a pass: the days still to come at the daily price
// (what the daily release has not recognised yet), plus the releases
// already posted against a sale that never was.
func valueOpenPass(ctx context.Context, q database.Querier, p *openingPurchase, now time.Time) error {
	var startsAt, endsAt time.Time
	var status string
	err := q.QueryRow(ctx, `SELECT starts_at, ends_at, status FROM gym.member_passes WHERE purchase_id = $1`, p.ID).Scan(&startsAt, &endsAt, &status)
	if database.IsNoRows(err) {
		p.Note = "tanpa pass"
		return nil
	}
	if err != nil {
		return err
	}
	var released float64
	if err := q.QueryRow(ctx, `SELECT COALESCE(sum(r.amount_idr), 0)::float FROM gym.pass_revenue_releases r
		JOIN gym.member_passes mp ON mp.id = r.pass_id WHERE mp.purchase_id = $1`, p.ID).Scan(&released); err != nil {
		return err
	}
	p.JournaledSen = domain.LotValueSen(released)
	if status == domain.PassRefunded {
		p.Note = "pass direfund"
		return nil
	}
	start, end, today := localDay(startsAt, p.Zone), localDay(endsAt, p.Zone), localDay(now, p.Zone)
	due := domain.PassRevenueDue(p.TotalIdr, start, end, today)
	p.UnusedSen = domain.LotValueSen(p.TotalIdr) - domain.LotValueSen(due)
	p.Note = fmt.Sprintf("pass %s sampai %s", status, end.Format(time.DateOnly))
	return nil
}
