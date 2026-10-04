package storedvalue

import (
	"context"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	svcontracts "nuhabit/backend/internal/contracts/storedvalue"
	"nuhabit/backend/internal/modules/storedvalue/domain"
	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/outbox"
)

// Wallet sweep (lib/wallet/sweep.ts), hourly in the Next process and on
// demand: expire lot remainders past their validity, remind members of lots
// about to expire, nudge low balances. A session advisory lock keeps one
// sweeper at a time across Next and Go.

const (
	sweepLockKey = 411_000_401
	sweepBatch   = 500
)

// SweepResult is runWalletSweep's result.
type SweepResult struct {
	Status        string  `json:"status"`
	RunID         string  `json:"run_id,omitempty"`
	ExpiredLots   int     `json:"expired_lots"`
	ExpiredIdr    float64 `json:"expired_idr"`
	RemindersSent int     `json:"reminders_sent"`
	NudgesSent    int     `json:"nudges_sent"`
}

// SweepRun is a pos_wallet_sweep_runs row.
type SweepRun struct {
	ID            string        `json:"id"`
	Trigger       string        `json:"trigger"`
	StartedAt     httpx.JSTime  `json:"started_at"`
	FinishedAt    *httpx.JSTime `json:"finished_at"`
	ExpiredLots   int           `json:"expired_lots"`
	ExpiredIdr    float64       `json:"expired_idr"`
	RemindersSent int           `json:"reminders_sent"`
	NudgesSent    int           `json:"nudges_sent"`
	Error         *string       `json:"error"`
}

// SweepRuns lists the last 10 sweeps.
func (w *Wallet) SweepRuns(ctx context.Context) ([]SweepRun, error) {
	rows, err := w.db.Query(ctx,
		`SELECT id, trigger, started_at, finished_at, expired_lots, expired_idr::float AS expired_idr,
		        reminders_sent, nudges_sent, error
		   FROM pos.pos_wallet_sweep_runs ORDER BY started_at DESC LIMIT $1`, 10)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (SweepRun, error) {
		var s SweepRun
		var started time.Time
		var finished *time.Time
		err := r.Scan(&s.ID, &s.Trigger, &started, &finished, &s.ExpiredLots, &s.ExpiredIdr, &s.RemindersSent, &s.NudgesSent, &s.Error)
		s.StartedAt, s.FinishedAt = httpx.JSTime(started), httpx.NewJSTime(finished)
		return s, err
	})
	if out == nil {
		out = []SweepRun{}
	}
	return out, err
}

// RunSweep mirrors runWalletSweep: "busy" when another process holds the
// sweep lock.
func (w *Wallet) RunSweep(ctx context.Context, trigger string, actorID *string) (SweepResult, error) {
	lockQ := database.Querier(w.db)
	if pool, isPool := w.db.(*pgxpool.Pool); isPool {
		conn, err := pool.Acquire(ctx)
		if err != nil {
			return SweepResult{}, err
		}
		defer conn.Release()
		lockQ = conn
	}
	var locked bool
	if err := lockQ.QueryRow(ctx, `SELECT pg_try_advisory_lock($1) AS ok`, sweepLockKey).Scan(&locked); err != nil {
		return SweepResult{}, err
	}
	if !locked {
		return SweepResult{Status: "busy"}, nil
	}
	defer func() { _, _ = lockQ.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, sweepLockKey) }()

	var runID string
	if err := w.db.QueryRow(ctx,
		`INSERT INTO pos.pos_wallet_sweep_runs (trigger, actor_id) VALUES ($1, $2) RETURNING id`, trigger, actorID).Scan(&runID); err != nil {
		return SweepResult{}, err
	}
	res, err := w.sweep(ctx, trigger)
	if err != nil {
		msg := kit.ErrorMessage(err)
		if len(msg) > 500 {
			msg = jsSlice(msg, 500)
		}
		_, _ = w.db.Exec(ctx, `UPDATE pos.pos_wallet_sweep_runs SET finished_at = now(), error = $2 WHERE id = $1`, runID, msg)
		return SweepResult{}, err
	}
	if _, err := w.db.Exec(ctx,
		`UPDATE pos.pos_wallet_sweep_runs
		    SET finished_at = now(), expired_lots = $2, expired_idr = $3, reminders_sent = $4, nudges_sent = $5
		  WHERE id = $1`, runID, res.ExpiredLots, res.ExpiredIdr, res.RemindersSent, res.NudgesSent); err != nil {
		return SweepResult{}, err
	}
	res.Status, res.RunID = "done", runID
	return res, nil
}

func (w *Wallet) sweep(ctx context.Context, trigger string) (SweepResult, error) {
	now := w.now()
	settings, err := loadWalletSettings(ctx, w.db)
	if err != nil {
		return SweepResult{}, err
	}
	var res SweepResult
	if res.ExpiredLots, res.ExpiredIdr, err = w.sweepExpirations(ctx, settings, now, trigger); err != nil {
		return res, err
	}
	if res.RemindersSent, err = w.sendExpiryReminders(ctx, settings, now); err != nil {
		return res, err
	}
	res.NudgesSent, err = w.sendLowBalanceNudges(ctx, settings, now)
	return res, err
}

func (w *Wallet) customerIDs(ctx context.Context, sql string, args ...any) ([]string, error) {
	rows, err := w.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

/* ── 1. expiry ───────────────────────────────────────────────────────── */

func (w *Wallet) sweepExpirations(ctx context.Context, settings WalletSettings, now time.Time, trigger string) (int, float64, error) {
	ids, err := w.customerIDs(ctx,
		`SELECT DISTINCT customer_id::text FROM pos.pos_wallet_transactions
		  WHERE expires_at <= $1 AND expiry_processed_at IS NULL AND customer_id IS NOT NULL
		    AND COALESCE(status, 'completed') = 'completed'
		  LIMIT `+strconv.Itoa(sweepBatch), now)
	if err != nil {
		return 0, 0, err
	}
	lots, idr := 0, 0.0
	for _, id := range ids {
		n, amount, err := w.expireCustomer(ctx, id, settings, now, trigger)
		if err != nil {
			w.log.Error("[wallet-sweep] kedaluwarsa member gagal", "customer", id, "error", err.Error())
			continue
		}
		lots += n
		idr += amount
	}
	return lots, domain.RoundIdr(idr), nil
}

// expireCustomer writes one member's expiration rows and the new balance
// in one transaction with the member locked; the lot_id unique index keeps
// it idempotent.
func (w *Wallet) expireCustomer(ctx context.Context, customerID string, settings WalletSettings, now time.Time, trigger string) (int, float64, error) {
	var lots int
	var idr float64
	err := database.WithTx(ctx, w.db, func(tx pgx.Tx) error {
		customer, err := lockCustomer(ctx, tx, customerID)
		if err != nil {
			return err
		}
		rows, err := loadLedgerRows(ctx, tx, customerID)
		if err != nil {
			return err
		}
		already := map[string]bool{}
		byID := map[string]*WalletRow{}
		for _, r := range rows {
			byID[r.ID] = r
			if r.Type == "expiration" {
				already[domain.JSString(r.meta["lot_id"])] = true
			}
		}
		entries, processed := domain.PlanExpirySweep(ledgerRows(rows), customer.Balance, now, already)
		for _, d := range entries {
			lot := byID[d.LotID]
			lotType, created := "lot", now
			var lotTypeMeta, lotExpires any
			var company, branch *string
			if lot != nil {
				lotType, created, lotTypeMeta, company, branch = lot.Type, lot.createdAt, lot.Type, lot.CompanyID, lot.BranchID
				if lot.ExpiresAt != nil {
					lotExpires = lot.ExpiresAt
				}
			}
			notes := "Saldo kedaluwarsa (" + lotType + " " + domain.FormatWib(created) + ")"
			if _, err := insertWalletRow(ctx, tx, newWalletRow{
				CustomerID: customerID, Type: "expiration", Amount: -d.Amount,
				BalanceBefore: d.BalanceBefore, BalanceAfter: d.BalanceAfter, ArkRate: settings.ArkRate, Notes: notes,
				Metadata: map[string]any{
					"lot_id": d.LotID, "lot_type": lotTypeMeta, "lot_expires_at": lotExpires,
					"lot_allocations": []domain.LotAllocation{{LotID: d.LotID, Amount: d.Amount}},
					"swept_by":        trigger,
				},
				CompanyID: company, BranchID: branch,
			}); err != nil {
				return err
			}
			lots++
			idr += d.Amount
		}
		idr = domain.RoundIdr(idr)
		if idr > 0 {
			if err := setCustomerBalance(ctx, tx, customerID, entries[len(entries)-1].BalanceAfter); err != nil {
				return err
			}
			if err := outbox.Publish(ctx, tx, svcontracts.TopicMemberNotified, customerID, svcontracts.MemberNotified{
				CustomerID: customerID, Type: "wallet_expired", Title: "Saldo ARK Coin kedaluwarsa",
				Body: domain.FormatRupiah(idr) + " saldo Anda melewati masa berlaku dan sudah hangus.",
			}); err != nil {
				return err
			}
		}
		if len(processed) > 0 {
			_, err = tx.Exec(ctx, `UPDATE pos.pos_wallet_transactions SET expiry_processed_at = now() WHERE id = ANY($1::uuid[])`, processed)
		}
		return err
	})
	return lots, idr, err
}

/* ── 2. expiry reminders ─────────────────────────────────────────────── */

type memberContact struct {
	Name      *string
	Phone     *string
	WaConsent *bool
}

func (w *Wallet) loadContact(ctx context.Context, customerID string) (*memberContact, error) {
	var c memberContact
	err := w.db.QueryRow(ctx, `SELECT name, phone, wa_consent FROM pos.pos_customers WHERE id = $1`, customerID).Scan(&c.Name, &c.Phone, &c.WaConsent)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &c, err
}

// sendMemberWa sends a service WhatsApp; members who refused WhatsApp
// (wa_consent = false) are skipped.
func (w *Wallet) sendMemberWa(ctx context.Context, c memberContact, message string) bool {
	if c.WaConsent != nil && !*c.WaConsent {
		return false
	}
	target := domain.NormalizeWaPhone(c.Phone)
	if target == nil {
		return false
	}
	return w.ports.WhatsApp.SendText(ctx, *target, message, "notification", nil).Delivered
}

func memberName(name *string) string {
	if name == nil || *name == "" {
		return "Member"
	}
	return *name
}

func (w *Wallet) sendExpiryReminders(ctx context.Context, settings WalletSettings, now time.Time) (int, error) {
	if settings.WalletExpiryReminderDays <= 0 {
		return 0, nil
	}
	horizon := now.Add(time.Duration(settings.WalletExpiryReminderDays * float64(24*time.Hour)))
	ids, err := w.customerIDs(ctx,
		`SELECT DISTINCT w.customer_id::text FROM pos.pos_wallet_transactions w
		  WHERE w.expires_at > $1 AND w.expires_at <= $2 AND w.customer_id IS NOT NULL
		    AND w.type = ANY($3::text[]) AND COALESCE(w.status, 'completed') = 'completed'
		    AND NOT EXISTS (SELECT 1 FROM pos.pos_wallet_lot_reminders r WHERE r.lot_id = w.id)
		  LIMIT `+strconv.Itoa(sweepBatch), now, horizon, domain.LotTypes)
	if err != nil {
		return 0, err
	}
	sent := 0
	for _, id := range ids {
		reminded, err := w.remindCustomer(ctx, id, settings, now)
		if err != nil {
			w.log.Error("[wallet-sweep] pengingat member gagal", "customer", id, "error", err.Error())
			continue
		}
		if reminded {
			sent++
		}
	}
	return sent, nil
}

func (w *Wallet) remindCustomer(ctx context.Context, customerID string, settings WalletSettings, now time.Time) (bool, error) {
	rows, err := loadLedgerRows(ctx, w.db, customerID)
	if err != nil {
		return false, err
	}
	done, err := w.customerIDs(ctx, `SELECT lot_id::text FROM pos.pos_wallet_lot_reminders WHERE customer_id = $1`, customerID)
	if err != nil {
		return false, err
	}
	reminded := map[string]bool{}
	for _, id := range done {
		reminded[id] = true
	}
	picks := domain.SelectExpiryReminders(ledgerRows(rows), now, int(settings.WalletExpiryReminderDays), reminded)
	if len(picks) == 0 {
		return false, nil
	}
	// Claim first (once per lot), then send.
	var claimed []domain.ExpiringLot
	for _, p := range picks {
		tag, err := w.db.Exec(ctx,
			`INSERT INTO pos.pos_wallet_lot_reminders (lot_id, customer_id, expires_at, remaining_idr)
			 VALUES ($1, $2, $3, $4) ON CONFLICT (lot_id) DO NOTHING`, p.LotID, customerID, p.ExpiresAt, p.Remaining)
		if err != nil {
			return false, err
		}
		if tag.RowsAffected() > 0 {
			claimed = append(claimed, p)
		}
	}
	if len(claimed) == 0 {
		return false, nil
	}
	total := 0.0
	earliest := claimed[0].ExpiresAt
	lotIDs := make([]string, len(claimed))
	for i, p := range claimed {
		total += p.Remaining
		if p.ExpiresAt.Before(earliest) {
			earliest = p.ExpiresAt
		}
		lotIDs[i] = p.LotID
	}
	contact, err := w.loadContact(ctx, customerID)
	if err != nil {
		return false, err
	}
	ark := domain.JSNumber(domain.JSRound(total / max(1, settings.ArkRate)))
	if err := outbox.Publish(ctx, w.db, svcontracts.TopicMemberNotified, customerID, svcontracts.MemberNotified{
		CustomerID: customerID, Type: "wallet_expiring", Title: "Saldo ARK Coin segera kedaluwarsa",
		Body: domain.FormatRupiah(total) + " (" + ark + " ARK) berakhir " + domain.FormatWib(earliest) + ". Pakai sebelum tanggal itu.",
	}); err != nil {
		return false, err
	}
	if contact != nil && w.sendMemberWa(ctx, *contact,
		"Halo "+memberName(contact.Name)+", saldo ARK Coin Anda sebesar "+domain.FormatRupiah(total)+" ("+ark+
			" ARK) akan kedaluwarsa pada "+domain.FormatWib(earliest)+". Gunakan sebelum tanggal tersebut di outlet mana pun.") {
		if _, err := w.db.Exec(ctx, `UPDATE pos.pos_wallet_lot_reminders SET wa_sent = true WHERE lot_id = ANY($1::uuid[])`, lotIDs); err != nil {
			return false, err
		}
	}
	return true, nil
}

/* ── 3. low balance ──────────────────────────────────────────────────── */

func (w *Wallet) sendLowBalanceNudges(ctx context.Context, settings WalletSettings, now time.Time) (int, error) {
	threshold := settings.lowBalanceThreshold()
	if threshold <= 0 {
		return 0, nil
	}
	since := now.Add(-domain.LowBalanceNudgeCooldownDays * 24 * time.Hour)
	rows, err := w.db.Query(ctx,
		`SELECT c.id, c.name, c.phone, c.wa_consent, COALESCE(c.ark_coin_balance, 0)::float AS balance,
		        max(w.created_at) AS crossed_at,
		        (SELECT max(n.sent_at) FROM pos.pos_wallet_low_balance_nudges n WHERE n.customer_id = c.id) AS last_nudge_at
		   FROM pos.pos_customers c
		   JOIN pos.pos_wallet_transactions w ON w.customer_id = c.id
		  WHERE COALESCE(c.ark_coin_balance, 0) < $1
		    AND w.created_at >= $2
		    AND COALESCE(w.status, 'completed') = 'completed'
		    AND w.balance_before >= $1 AND w.balance_after < $1
		  GROUP BY c.id
		  LIMIT `+strconv.Itoa(sweepBatch), threshold, since)
	if err != nil {
		return 0, err
	}
	type candidate struct {
		ID        string
		Contact   memberContact
		Balance   float64
		CrossedAt *time.Time
		LastNudge *time.Time
	}
	candidates, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (candidate, error) {
		var c candidate
		err := r.Scan(&c.ID, &c.Contact.Name, &c.Contact.Phone, &c.Contact.WaConsent, &c.Balance, &c.CrossedAt, &c.LastNudge)
		return c, err
	})
	if err != nil {
		return 0, err
	}
	sent := 0
	for _, c := range candidates {
		if !domain.ShouldNudgeLowBalance(threshold, c.Balance, c.CrossedAt, c.LastNudge, now) {
			continue
		}
		if err := w.nudge(ctx, c.ID, c.Contact, c.Balance, threshold); err != nil {
			w.log.Error("[wallet-sweep] dorongan saldo rendah gagal", "customer", c.ID, "error", err.Error())
			continue
		}
		sent++
	}
	return sent, nil
}

func (w *Wallet) nudge(ctx context.Context, customerID string, contact memberContact, balance, threshold float64) error {
	var nudgeID string
	if err := w.db.QueryRow(ctx,
		`INSERT INTO pos.pos_wallet_low_balance_nudges (customer_id, balance_idr, threshold_idr) VALUES ($1, $2, $3) RETURNING id`,
		customerID, balance, threshold).Scan(&nudgeID); err != nil {
		return err
	}
	if err := outbox.Publish(ctx, w.db, svcontracts.TopicMemberNotified, customerID, svcontracts.MemberNotified{
		CustomerID: customerID, Type: "wallet_low_balance", Title: "Saldo ARK Coin menipis",
		Body: "Saldo Anda tinggal " + domain.FormatRupiah(balance) + ". Top-up di kasir atau dari menu ARK Coin di portal.",
	}); err != nil {
		return err
	}
	if w.sendMemberWa(ctx, contact, "Halo "+memberName(contact.Name)+", saldo ARK Coin Anda tinggal "+domain.FormatRupiah(balance)+
		". Top-up sekarang di kasir atau lewat portal member agar transaksi berikutnya tetap lancar.") {
		_, err := w.db.Exec(ctx, `UPDATE pos.pos_wallet_low_balance_nudges SET wa_sent = true WHERE id = $1`, nudgeID)
		return err
	}
	return nil
}
