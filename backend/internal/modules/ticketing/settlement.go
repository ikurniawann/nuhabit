package ticketing

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Cashier settlement (visit-settlement-server.ts), atomic per call:
// without a visit band the whole group closes (postpaid pays, prepaid gets
// its balance back) and every band is released; with a visit band
// (postpaid only) one band pays its own charges and is released.

// SettleInput is settleSchema after parsing.
type SettleInput struct {
	VisitBandID  *string
	Payments     []DepositInput
	RefundMethod *string
}

func exactAmountError(paid, due float64) error {
	return httpx.BadRequest("Nominal pembayaran (" + domain.FormatRupiah(paid) + ") harus pas " + domain.FormatRupiah(due))
}

func closeVisit(ctx context.Context, q database.Querier, v Venue, visitID string) error {
	_, err := q.Exec(ctx, `UPDATE ticketing.ticket_visits
		SET status = 'settled', settled_at = now(), settled_by = $2, updated_at = now()
		WHERE id = $1`, visitID, v.UserID)
	return err
}

func insertPayments(ctx context.Context, q database.Querier, v Venue, visitID string, payments []DepositInput, bandID *string, label string) error {
	for _, p := range payments {
		if _, err := q.Exec(ctx, `INSERT INTO ticketing.ticket_visit_charges
			(company_id, branch_id, visit_id, band_id, charge_type, direction, description, amount, payment_method, created_by)
			VALUES ($1, $2, $3, $4, 'pembayaran', 'kredit', $5, $6, $7, $8)`,
			v.CompanyID, v.BranchID, visitID, bandID, label+" ("+p.Method+")", p.Amount, p.Method, v.UserID); err != nil {
			return err
		}
	}
	return nil
}

// SettleVisit is settleVisit. The result is {mode, paid, closed} for one
// band or {mode, paid, refunded, closed} for the group.
func (s *Service) SettleVisit(ctx context.Context, v Venue, visitID string, in SettleInput) (*Row, error) {
	payments := make([]DepositInput, len(in.Payments))
	paidTotal := 0.0
	for i, p := range in.Payments {
		payments[i] = DepositInput{Method: p.Method, Amount: domain.Round2(p.Amount)}
		paidTotal += payments[i].Amount
	}
	paidTotal = domain.Round2(paidTotal)

	var out *Row
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		mode, err := lockOpenVisit(ctx, tx, v, visitID, "Kunjungan sudah ditutup")
		if err != nil {
			return err
		}
		if in.VisitBandID == nil || *in.VisitBandID == "" {
			refund := "cash"
			if in.RefundMethod != nil {
				refund = *in.RefundMethod
			}
			out, err = settleWholeVisit(ctx, tx, v, visitID, payments, paidTotal, refund)
			return err
		}
		if mode == "prepaid" {
			return httpx.BadRequest("Mode prepaid di-settle satu rombongan sekaligus (refund sisa saldo)")
		}
		out, err = settleSingleBand(ctx, tx, v, visitID, *in.VisitBandID, payments, paidTotal)
		return err
	})
	return out, err
}

func settleSingleBand(ctx context.Context, tx pgx.Tx, v Venue, visitID, visitBandID string, payments []DepositInput, paidTotal float64) (*Row, error) {
	var id, bandID, status string
	err := tx.QueryRow(ctx, `SELECT id::text, band_id::text, status FROM ticketing.ticket_visit_bands
		WHERE id = $1 AND visit_id = $2 FOR UPDATE`, visitBandID, visitID).Scan(&id, &bandID, &status)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Gelang tidak ada di kunjungan ini")
	}
	if err != nil {
		return nil, err
	}
	if status != "aktif" {
		return nil, httpx.Conflict("Gelang sudah di-settle / tidak aktif")
	}
	lines, err := visitCharges(ctx, tx, visitID)
	if err != nil {
		return nil, err
	}
	due := domain.Round2(summarize(lines, func(l chargeLine) bool { return l.BandID != nil && *l.BandID == bandID }).Outstanding)
	if due <= 0 && paidTotal > 0 {
		return nil, httpx.BadRequest("Gelang ini tidak punya tagihan — pembayaran tidak diperlukan")
	}
	if due > 0 && paidTotal != due {
		return nil, exactAmountError(paidTotal, due)
	}
	if due > 0 {
		if err := insertPayments(ctx, tx, v, visitID, payments, &bandID, "Pembayaran settle gelang"); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE ticketing.ticket_visit_bands SET status = 'selesai', updated_at = now() WHERE id = $1`, id); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE ticketing.ticket_bands SET status = 'tersedia', updated_at = now()
		WHERE id = $1 AND status = 'dipakai'`, bandID); err != nil {
		return nil, err
	}

	// The visit closes itself once no band is active and the ledger balances.
	var remaining int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM ticketing.ticket_visit_bands WHERE visit_id = $1 AND status = 'aktif'`, visitID).Scan(&remaining); err != nil {
		return nil, err
	}
	after, err := visitCharges(ctx, tx, visitID)
	if err != nil {
		return nil, err
	}
	closed := remaining == 0 && summarize(after, nil).Outstanding == 0
	if closed {
		if err := closeVisit(ctx, tx, v, visitID); err != nil {
			return nil, err
		}
	}
	return object("mode", "per-gelang", "paid", due, "closed", closed), nil
}

func settleWholeVisit(ctx context.Context, tx pgx.Tx, v Venue, visitID string, payments []DepositInput, paidTotal float64, refundMethod string) (*Row, error) {
	lines, err := visitCharges(ctx, tx, visitID)
	if err != nil {
		return nil, err
	}
	plan := domain.PlanSettlement(summarize(lines, nil))
	if plan.AmountDue > 0 && paidTotal != plan.AmountDue {
		return nil, exactAmountError(paidTotal, plan.AmountDue)
	}
	if plan.AmountDue == 0 && paidTotal > 0 {
		return nil, httpx.BadRequest("Tidak ada tagihan — pembayaran tidak diperlukan")
	}
	if err := insertPayments(ctx, tx, v, visitID, payments, nil, "Pembayaran settlement"); err != nil {
		return nil, err
	}
	if plan.RefundAmount > 0 {
		if _, err := tx.Exec(ctx, `INSERT INTO ticketing.ticket_visit_charges
			(company_id, branch_id, visit_id, charge_type, direction, description, amount, payment_method, created_by)
			VALUES ($1, $2, $3, 'refund-deposit', 'debit', $4, $5, $6, $7)`,
			v.CompanyID, v.BranchID, visitID, "Refund sisa deposit ("+refundMethod+")", plan.RefundAmount, refundMethod, v.UserID); err != nil {
			return nil, err
		}
	}
	if err := closeVisit(ctx, tx, v, visitID); err != nil {
		return nil, err
	}
	// Release every band still active (lost bands stay lost).
	if _, err := tx.Exec(ctx, `UPDATE ticketing.ticket_bands b
		SET status = 'tersedia', updated_at = now()
		FROM ticketing.ticket_visit_bands vb
		WHERE vb.visit_id = $1 AND vb.band_id = b.id AND vb.status = 'aktif' AND b.status = 'dipakai'`, visitID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE ticketing.ticket_visit_bands SET status = 'selesai', updated_at = now()
		WHERE visit_id = $1 AND status = 'aktif'`, visitID); err != nil {
		return nil, err
	}
	return object("mode", "rombongan", "paid", plan.AmountDue, "refunded", plan.RefundAmount, "closed", true), nil
}
