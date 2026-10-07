package ticketing

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Visits at the loket (visits-server.ts): list, ledger detail, deposit
// top-up, voiding a charge, lost bands, the live tab stats and the POS
// tab preview (tab-server.ts checkTabForCharge).

// VisitStatuses are the ticket_visits statuses.
var VisitStatuses = []string{"open", "settled", "void"}

// listResult is a page plus the COUNT(*) OVER() total.
type listResult struct {
	Items []*Row
	Total int
}

// splitTotal is splitTotalCount.
func splitTotal(rows []*Row) listResult {
	total := 0
	if len(rows) > 0 {
		total = int(rows[0].Num("total_count"))
	}
	for _, r := range rows {
		r.Del("total_count")
	}
	return listResult{Items: rows, Total: total}
}

// pageArgs renders LIMIT/OFFSET the way node-postgres sends JS numbers.
func pageArgs(page, limit float64) (string, string) {
	return domain.FormatNumber(limit), domain.FormatNumber((page - 1) * limit)
}

// ListVisits is listVisits.
func (s *Service) ListVisits(ctx context.Context, v Venue, status, q string, page, limit float64) (listResult, error) {
	conds := []string{"v.branch_id = $1", "v.company_id = $2", "v.status = $3"}
	args := []any{v.BranchID, v.CompanyID, status}
	if q != "" {
		uid := domain.NormalizeNfcUID(q)
		if uid == "" {
			uid = q
		}
		args = append(args, "%"+q+"%", uid)
		n := len(args)
		conds = append(conds, fmt.Sprintf(`(v.contact_name ILIKE $%d
		  OR v.contact_phone ILIKE $%d
		  OR EXISTS (
		    SELECT 1 FROM ticketing.ticket_visit_bands vb
		    JOIN ticketing.ticket_bands b ON b.id = vb.band_id
		    WHERE vb.visit_id = v.id AND b.nfc_uid = $%d
		  ))`, n-1, n-1, n))
	}
	lim, off := pageArgs(page, limit)
	args = append(args, lim, off)
	rows, err := queryRows(ctx, s.db, fmt.Sprintf(`SELECT v.id, v.contact_name, v.contact_phone, v.payment_mode,
		  v.credit_limit, v.status, v.opened_at, v.settled_at,
		  (SELECT COUNT(*) FROM ticketing.ticket_visit_bands vb WHERE vb.visit_id = v.id) AS band_count,
		  (SELECT COUNT(*) FROM ticketing.ticket_visit_bands vb WHERE vb.visit_id = v.id AND vb.status = 'aktif') AS active_band_count,
		  COALESCE((SELECT SUM(c.amount) FROM ticketing.ticket_visit_charges c
		   WHERE c.visit_id = v.id AND c.direction = 'debit'), 0) AS debit,
		  COALESCE((SELECT SUM(c.amount) FROM ticketing.ticket_visit_charges c
		   WHERE c.visit_id = v.id AND c.direction = 'kredit'), 0) AS kredit,
		  COUNT(*) OVER() AS total_count
		FROM ticketing.ticket_visits v
		WHERE %s
		ORDER BY v.opened_at DESC
		LIMIT $%d OFFSET $%d`, strings.Join(conds, " AND "), len(args)-1, len(args)), args...)
	if err != nil {
		return listResult{}, err
	}
	res := splitTotal(rows)
	for _, r := range res.Items {
		debit, kredit := r.Num("debit"), r.Num("kredit")
		r.ToNum("band_count", "active_band_count", "debit", "kredit")
		r.Set("outstanding", domain.Round2(debit-kredit))
		r.Set("saldo", domain.Round2(kredit-debit))
	}
	return res, nil
}

// VisitDetail is getVisitDetail.
func (s *Service) VisitDetail(ctx context.Context, v Venue, id string) (*Row, error) {
	visit, err := queryRow(ctx, s.db, `SELECT id, contact_name, contact_phone, payment_mode, credit_limit,
		  status, opened_at, settled_at, notes
		FROM ticketing.ticket_visits
		WHERE id = $1 AND branch_id = $2 AND company_id = $3`, id, v.BranchID, v.CompanyID)
	if err != nil {
		return nil, err
	}
	if visit == nil {
		return nil, httpx.NotFound("Kunjungan tidak ditemukan")
	}
	bands, err := queryRows(ctx, s.db, `SELECT vb.id, vb.band_id, b.nfc_uid, b.label, vb.variant_id,
		  tp.name || ' — ' || pv.name AS ticket_type_name,
		  vb.guest_name, vb.entered_at, vb.status
		FROM ticketing.ticket_visit_bands vb
		JOIN ticketing.ticket_bands b ON b.id = vb.band_id
		JOIN ticketing.ticket_product_variants pv ON pv.id = vb.variant_id
		JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
		WHERE vb.visit_id = $1
		ORDER BY vb.created_at`, id)
	if err != nil {
		return nil, err
	}
	charges, err := queryRows(ctx, s.db, `SELECT id, band_id, charge_type, direction, description, amount,
		  payment_method, pos_order_id, voided_by_charge_id, created_at
		FROM ticketing.ticket_visit_charges
		WHERE visit_id = $1
		ORDER BY created_at, id`, id)
	if err != nil {
		return nil, err
	}
	entries := make([]domain.TabEntry, len(charges))
	for i, c := range charges {
		entries[i] = domain.TabEntry{Direction: c.Str("direction"), Amount: c.Num("amount")}
		c.ToNum("amount")
	}
	summary := domain.ComputeTabSummary(entries)
	return object(
		"visit", visit.ToNumOrNull("credit_limit"),
		"bands", bands,
		"charges", charges,
		"summary", summary,
		"plan", domain.PlanSettlement(summary),
	), nil
}

// TabStats is loadTabStats.
func (s *Service) TabStats(ctx context.Context, v Venue) (*Row, error) {
	stats, err := queryRow(ctx, s.db, `SELECT
		  COUNT(*) AS open_visits,
		  COALESCE(SUM((SELECT COUNT(*) FROM ticketing.ticket_visit_bands vb
		    WHERE vb.visit_id = v.id AND vb.status = 'aktif')), 0) AS open_bands,
		  COALESCE(SUM(CASE WHEN v.payment_mode = 'postpaid' THEN GREATEST(bal.net, 0) END), 0) AS outstanding_total,
		  COALESCE(SUM(CASE WHEN v.payment_mode = 'prepaid' THEN GREATEST(-bal.net, 0) END), 0) AS saldo_total
		FROM ticketing.ticket_visits v
		CROSS JOIN LATERAL (
		  SELECT COALESCE(SUM(CASE WHEN c.direction = 'debit' THEN c.amount ELSE -c.amount END), 0) AS net
		  FROM ticketing.ticket_visit_charges c
		  WHERE c.visit_id = v.id
		) bal
		WHERE v.branch_id = $1 AND v.company_id = $2 AND v.status = 'open'`, v.BranchID, v.CompanyID)
	if err != nil {
		return nil, err
	}
	return stats.ToNum("open_visits", "open_bands", "outstanding_total", "saldo_total"), nil
}

// TopUpDeposit is topUpDeposit (amount already validated positive).
func (s *Service) TopUpDeposit(ctx context.Context, v Venue, visitID string, amount float64, method string) error {
	amount = domain.Round2(amount)
	if amount <= 0 {
		return httpx.BadRequest("Nominal top-up harus > 0")
	}
	return s.inTx(ctx, func(tx pgx.Tx) error {
		mode, err := lockOpenVisit(ctx, tx, v, visitID, "Kunjungan sudah ditutup — top-up tidak bisa")
		if err != nil {
			return err
		}
		if mode != "prepaid" {
			return httpx.BadRequest("Top-up hanya untuk kunjungan mode prepaid")
		}
		_, err = tx.Exec(ctx, `INSERT INTO ticketing.ticket_visit_charges
			(company_id, branch_id, visit_id, charge_type, direction, description, amount, payment_method, created_by)
			VALUES ($1, $2, $3, 'deposit', 'kredit', $4, $5, $6, $7)`,
			v.CompanyID, v.BranchID, visitID, "Top-up deposit ("+method+")", amount, method, v.UserID)
		return err
	})
}

// VoidCharge is voidVisitCharge: an append-only reversing 'koreksi'
// kredit pointing at the original line; a line is voided once.
func (s *Service) VoidCharge(ctx context.Context, v Venue, visitID, chargeID, reason string) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := lockOpenVisit(ctx, tx, v, visitID, "Kunjungan sudah ditutup — void lewat koreksi manual"); err != nil {
			return err
		}
		var bandID *string
		var chargeType, direction, description, amount string
		err := tx.QueryRow(ctx, `SELECT band_id::text, charge_type, direction, description, amount::text
			FROM ticketing.ticket_visit_charges WHERE id = $1 AND visit_id = $2`, chargeID, visitID).
			Scan(&bandID, &chargeType, &direction, &description, &amount)
		if database.IsNoRows(err) {
			return httpx.NotFound("Baris tagihan tidak ditemukan")
		}
		if err != nil {
			return err
		}
		if direction != domain.Debit || chargeType == "refund-deposit" {
			return httpx.BadRequest("Hanya baris tagihan (tiket/F&B/denda/koreksi) yang bisa di-void")
		}
		var reversed bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ticketing.ticket_visit_charges WHERE voided_by_charge_id = $1)`, chargeID).Scan(&reversed); err != nil {
			return err
		}
		if reversed {
			return httpx.Conflict("Baris ini sudah pernah di-void")
		}
		_, err = tx.Exec(ctx, `INSERT INTO ticketing.ticket_visit_charges
			(company_id, branch_id, visit_id, band_id, charge_type, direction, description, amount, voided_by_charge_id, created_by)
			VALUES ($1, $2, $3, $4, 'koreksi', 'kredit', $5, $6, $7, $8)`,
			v.CompanyID, v.BranchID, visitID, bandID, "Void: "+description+" — "+reason, amount, chargeID, v.UserID)
		return err
	})
}

// MarkBandLost is markVisitBandLost: the visit band and the registry band
// become 'hilang' (no fine; charges stay due at settlement).
func (s *Service) MarkBandLost(ctx context.Context, v Venue, visitID, visitBandID string) (*Row, error) {
	var out *Row
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if _, err := lockOpenVisit(ctx, tx, v, visitID, "Kunjungan sudah ditutup"); err != nil {
			return err
		}
		var id, bandID, status, uid string
		err := tx.QueryRow(ctx, `SELECT vb.id::text, vb.band_id::text, vb.status, b.nfc_uid
			FROM ticketing.ticket_visit_bands vb
			JOIN ticketing.ticket_bands b ON b.id = vb.band_id
			WHERE vb.id = $1 AND vb.visit_id = $2
			FOR UPDATE OF vb, b`, visitBandID, visitID).Scan(&id, &bandID, &status, &uid)
		if database.IsNoRows(err) {
			return httpx.NotFound("Gelang tidak ada di kunjungan ini")
		}
		if err != nil {
			return err
		}
		if status != "aktif" {
			return httpx.Conflict("Gelang sudah di-settle / sudah ditandai hilang")
		}
		if _, err := tx.Exec(ctx, `UPDATE ticketing.ticket_visit_bands SET status = 'hilang', updated_at = now() WHERE id = $1`, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE ticketing.ticket_bands SET status = 'hilang', updated_at = now()
			WHERE id = $1 AND status = 'dipakai'`, bandID); err != nil {
			return err
		}
		out = object("visit_band_id", id, "nfc_uid", uid)
		return nil
	})
	return out, err
}

// TabCheck is checkTabForCharge, rendered as the route does:
// {ok:true, ...target} or {ok:false, reason}.
func (s *Service) TabCheck(ctx context.Context, v Venue, uid string, amount float64) (*Row, error) {
	var visitID, bandID, contactName, paymentMode, visitStatus string
	var creditLimit *float64
	err := s.db.QueryRow(ctx, `SELECT vb.visit_id::text, vb.band_id::text, v.contact_name, v.payment_mode,
		  v.credit_limit::float8, v.status
		FROM ticketing.ticket_bands b
		JOIN ticketing.ticket_visit_bands vb ON vb.band_id = b.id AND vb.status = 'aktif'
		JOIN ticketing.ticket_visits v ON v.id = vb.visit_id
		WHERE b.branch_id = $1 AND b.company_id = $2 AND b.nfc_uid = $3
		ORDER BY vb.created_at DESC
		LIMIT 1`, v.BranchID, v.CompanyID, uid).Scan(&visitID, &bandID, &contactName, &paymentMode, &creditLimit, &visitStatus)
	if database.IsNoRows(err) {
		return object("ok", false, "reason", "Gelang tidak terikat kunjungan aktif — daftar di loket dulu"), nil
	}
	if err != nil {
		return nil, err
	}
	if visitStatus != "open" {
		return object("ok", false, "reason", "Kunjungan sudah ditutup — tidak bisa menerima charge"), nil
	}
	lines, err := visitCharges(ctx, s.db, visitID)
	if err != nil {
		return nil, err
	}
	summary := summarize(lines, nil)
	if why := domain.CanCharge(paymentMode, summary, amount, creditLimit); why != "" {
		return object("ok", false, "reason", why), nil
	}
	var available *float64
	switch {
	case paymentMode == "prepaid":
		available = &summary.Saldo
	case creditLimit != nil:
		left := domain.Round2(*creditLimit - summary.Outstanding)
		available = &left
	}
	return object("ok", true, "visitId", visitID, "bandId", bandID, "contactName", contactName,
		"paymentMode", paymentMode, "available", available), nil
}
