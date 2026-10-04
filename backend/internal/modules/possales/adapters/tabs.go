package adapters

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/database"
)

// Tabs ports the POS side of lib/ticketing/tab-server.ts: an F&B order
// charged to (or voided from) a ticketing visit tab. ticketing owns the
// tables; each TS withTransaction is a savepoint on the caller's querier.
type Tabs struct{}

var _ ports.Tabs = Tabs{}

var nonHex = regexp.MustCompile(`[^0-9a-fA-F]`)

// normalizeNfcUid keeps the hex digits, upper-cased.
func normalizeNfcUid(raw string) string { return strings.ToUpper(nonHex.ReplaceAllString(raw, "")) }

// tabSummary is computeTabSummary.
type tabSummary struct{ Debit, Kredit, Outstanding, Saldo float64 }

func computeTabSummary(debits, kredits []float64) tabSummary {
	var d, k float64
	for _, a := range debits {
		d += a
	}
	for _, a := range kredits {
		k += a
	}
	d, k = round2(d), round2(k)
	return tabSummary{Debit: d, Kredit: k, Outstanding: round2(d - k), Saldo: round2(k - d)}
}

// canCharge is the payment-mode guard of tab.ts ("" = allowed).
func canCharge(mode string, s tabSummary, amount float64, creditLimit *float64) string {
	amount = round2(amount)
	if amount <= 0 {
		return "Nominal charge harus > 0"
	}
	if mode == "prepaid" {
		if round2(s.Saldo-amount) < 0 {
			return "Saldo tidak cukup (saldo " + domain.FormatRupiah(s.Saldo) + ") — silakan top-up dulu"
		}
		return ""
	}
	if creditLimit != nil && round2(s.Outstanding+amount) > *creditLimit {
		return "Melewati plafon tagihan " + domain.FormatRupiah(*creditLimit) + " — silakan bayar parsial di kasir"
	}
	return ""
}

// Charge is chargeFnbOrderToTab without markOrderPaid: the visit locked,
// the guard re-checked inside the lock, one 'fnb' debit per order.
func (Tabs) Charge(ctx context.Context, q database.Querier, in ports.TabCharge) (ports.TabOutcome, error) {
	uid := normalizeNfcUid(in.BandUID)
	amount := round2(in.Amount)
	var out ports.TabOutcome
	err := savepoint(ctx, q, func(q database.Querier) error {
		var visitID, bandID, mode, status string
		var creditText *string
		err := q.QueryRow(ctx, `SELECT vb.visit_id::text, vb.band_id::text, v.payment_mode, v.credit_limit::text, v.status
			FROM ticketing.ticket_bands b
			JOIN ticketing.ticket_visit_bands vb ON vb.band_id = b.id AND vb.status = 'aktif'
			JOIN ticketing.ticket_visits v ON v.id = vb.visit_id
			WHERE b.branch_id = $1 AND b.company_id = $2 AND b.nfc_uid = $3
			ORDER BY vb.created_at DESC
			LIMIT 1
			FOR UPDATE OF vb, v`, in.BranchID, in.CompanyID, uid).Scan(&visitID, &bandID, &mode, &creditText, &status)
		if errors.Is(err, pgx.ErrNoRows) {
			out = ports.TabOutcome{Reason: "Gelang tidak terikat kunjungan aktif — daftar di loket dulu", Status: 404}
			return nil
		}
		if err != nil {
			return err
		}
		if status != "open" {
			out = ports.TabOutcome{Reason: "Kunjungan sudah ditutup — tidak bisa menerima charge", Status: 409}
			return nil
		}
		var dup bool
		if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ticketing.ticket_visit_charges
			WHERE pos_order_id = $1 AND charge_type = 'fnb' AND voided_by_charge_id IS NULL)`, in.OrderID).Scan(&dup); err != nil {
			return err
		}
		if dup {
			out = ports.TabOutcome{Reason: "Order ini sudah ter-charge ke tab", Status: 409}
			return nil
		}
		summary, err := visitSummary(ctx, q, visitID)
		if err != nil {
			return err
		}
		var creditLimit *float64
		if creditText != nil {
			v := jsrow.ToNumber(*creditText)
			creditLimit = &v
		}
		if reason := canCharge(mode, summary, amount, creditLimit); reason != "" {
			out = ports.TabOutcome{Reason: reason, Status: 402}
			return nil
		}
		if _, err := q.Exec(ctx, `INSERT INTO ticketing.ticket_visit_charges
			  (company_id, branch_id, visit_id, band_id, charge_type, direction, description, amount, pos_order_id, created_by)
			VALUES ($1, $2, $3, $4, 'fnb', 'debit', $5, $6, $7, $8)`,
			in.CompanyID, in.BranchID, visitID, bandID, "F&B Order "+in.OrderNumber, amount, in.OrderID, nullable(in.CreatedBy)); err != nil {
			return err
		}
		out = ports.TabOutcome{OK: true}
		return nil
	})
	return out, err
}

func visitSummary(ctx context.Context, q database.Querier, visitID string) (tabSummary, error) {
	rows, err := q.Query(ctx, `SELECT direction, amount::text FROM ticketing.ticket_visit_charges WHERE visit_id = $1`, visitID)
	if err != nil {
		return tabSummary{}, err
	}
	defer rows.Close()
	var debits, kredits []float64
	for rows.Next() {
		var dir, amount string
		if err := rows.Scan(&dir, &amount); err != nil {
			return tabSummary{}, err
		}
		if dir == "debit" {
			debits = append(debits, jsrow.ToNumber(amount))
		} else {
			kredits = append(kredits, jsrow.ToNumber(amount))
		}
	}
	if err := rows.Err(); err != nil {
		return tabSummary{}, err
	}
	return computeTabSummary(debits, kredits), nil
}

// Void is voidFnbOrderFromTab: an append-only 'koreksi' credit reversing the
// order's fnb debit, once (true when already reversed, false without a
// charge). Closed visits are written too.
func (Tabs) Void(ctx context.Context, q database.Querier, orderID, reason, createdBy string) (bool, error) {
	var done bool
	err := savepoint(ctx, q, func(q database.Querier) error {
		var id, company, branch, visit, description, amount string
		var band *string
		err := q.QueryRow(ctx, `SELECT id::text, company_id::text, branch_id::text, visit_id::text, band_id::text, description, amount::text
			FROM ticketing.ticket_visit_charges
			WHERE pos_order_id = $1 AND charge_type = 'fnb' AND direction = 'debit'
			ORDER BY created_at LIMIT 1`, orderID).Scan(&id, &company, &branch, &visit, &band, &description, &amount)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		var reversed bool
		if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ticketing.ticket_visit_charges WHERE voided_by_charge_id = $1)`, id).Scan(&reversed); err != nil {
			return err
		}
		if !reversed {
			if _, err := q.Exec(ctx, `INSERT INTO ticketing.ticket_visit_charges
				  (company_id, branch_id, visit_id, band_id, charge_type, direction, description, amount, voided_by_charge_id, created_by)
				VALUES ($1, $2, $3, $4, 'koreksi', 'kredit', $5, $6::numeric, $7, $8)`,
				company, branch, visit, band, "Void POS: "+description+" — "+reason, amount, id, nullable(createdBy)); err != nil {
				return err
			}
		}
		done = true
		return nil
	})
	return done, err
}
