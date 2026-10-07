package ticketing

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Season passes at the loket (season-pass-server.ts): list, product
// options, issue (paid on the spot, active at once) and renew. Gate entry
// is PassTap in gate.go.

// passPriceLateral is PASS_PRICE_LATERAL: the first active variant's
// regular price, falling back to base_price.
const passPriceLateral = `LEFT JOIN LATERAL (
	SELECT price_regular FROM ticketing.ticket_product_variants
	WHERE ticket_product_id = tp.id AND is_active = true
	ORDER BY sort_order LIMIT 1
) v ON true`

// ListSeasonPasses is listSeasonPasses.
func (s *Service) ListSeasonPasses(ctx context.Context, v Venue, q string) ([]*Row, error) {
	args := []any{v.BranchID, v.CompanyID}
	where := "sp.branch_id = $1 AND sp.company_id = $2"
	if q != "" {
		args = append(args, "%"+q+"%")
		n := len(args)
		where += fmt.Sprintf(" AND (sp.pass_code ILIKE $%d OR sp.holder_name ILIKE $%d OR sp.holder_phone ILIKE $%d)", n, n, n)
	}
	rows, err := queryRows(ctx, s.db, `SELECT sp.id, sp.pass_code, sp.holder_name, sp.holder_phone,
		  tp.name AS product_name, sp.status, sp.entry_policy,
		  sp.valid_from, sp.valid_until, sp.visit_quota_total,
		  sp.visit_quota_used, sp.band_uid, sp.unit_price, sp.created_at
		FROM ticketing.ticket_season_passes sp
		JOIN ticketing.ticket_products tp ON tp.id = sp.ticket_product_id
		WHERE `+where+`
		ORDER BY sp.created_at DESC
		LIMIT 200`, args...)
	for _, r := range rows {
		r.ToNum("unit_price")
	}
	return rows, err
}

// PassOptions is listPassOptions.
func (s *Service) PassOptions(ctx context.Context, v Venue) ([]*Row, error) {
	rows, err := queryRows(ctx, s.db, `SELECT tp.id AS ticket_product_id, tp.name,
		  pc.validity_months, pc.entry_policy, pc.visit_quota,
		  COALESCE(v.price_regular, tp.base_price) AS unit_price
		FROM ticketing.ticket_products tp
		JOIN ticketing.ticket_pass_configs pc ON pc.ticket_product_id = tp.id
		`+passPriceLateral+`
		WHERE tp.branch_id = $1 AND tp.company_id = $2
		  AND tp.product_kind = 'season_pass' AND tp.status = 'active'
		ORDER BY tp.name`, v.BranchID, v.CompanyID)
	for _, r := range rows {
		r.ToNum("unit_price")
	}
	return rows, err
}

// IssuePassInput is issuePassSchema after parsing.
type IssuePassInput struct {
	TicketProductID string
	HolderName      string
	HolderPhone     *string
	BandUID         *string
}

// IssueSeasonPass is issueSeasonPass.
func (s *Service) IssueSeasonPass(ctx context.Context, v Venue, in IssuePassInput) (*Row, error) {
	var validityMonths int
	var entryPolicy string
	var quota *int
	var unitPrice float64
	err := s.db.QueryRow(ctx, `SELECT pc.validity_months, pc.entry_policy, pc.visit_quota,
		  COALESCE(COALESCE(v.price_regular, tp.base_price), 0)::float8
		FROM ticketing.ticket_products tp
		JOIN ticketing.ticket_pass_configs pc ON pc.ticket_product_id = tp.id
		`+passPriceLateral+`
		WHERE tp.id = $1 AND tp.branch_id = $2 AND tp.company_id = $3
		  AND tp.product_kind = 'season_pass' AND tp.status = 'active'`,
		in.TicketProductID, v.BranchID, v.CompanyID).Scan(&validityMonths, &entryPolicy, &quota, &unitPrice)
	if database.IsNoRows(err) {
		return nil, httpx.BadRequest("Produk Season Pass tidak ditemukan atau belum aktif")
	}
	if err != nil {
		return nil, err
	}

	var bandID, bandUID *string
	if in.BandUID != nil && *in.BandUID != "" {
		uid := domain.NormalizeNfcUID(*in.BandUID)
		if !domain.IsValidNfcUID(uid) {
			return nil, httpx.BadRequest("UID gelang tidak valid")
		}
		var id string
		err := s.db.QueryRow(ctx, `SELECT id::text FROM ticketing.ticket_bands
			WHERE nfc_uid = $1 AND branch_id = $2 AND company_id = $3`, uid, v.BranchID, v.CompanyID).Scan(&id)
		if database.IsNoRows(err) {
			return nil, httpx.BadRequest("Gelang belum terdaftar — daftarkan dulu di Pengaturan")
		}
		if err != nil {
			return nil, err
		}
		bandID, bandUID = &id, &uid
	}

	today := s.today()
	validUntil := domain.AddMonthsISO(today, validityMonths)
	token := domain.GenerateAccessToken()
	var quotaTotal *int
	if entryPolicy == "limited_visits" {
		quotaTotal = quota
	}
	var id, passCode string
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		prefix := domain.PassCodePrefix(today)
		var next int
		if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(NULLIF(substring(pass_code from '[0-9]+$'), '')::int), 0) + 1
			FROM ticketing.ticket_season_passes
			WHERE branch_id = $1 AND pass_code LIKE $2`, v.BranchID, prefix+"-%").Scan(&next); err != nil {
			return err
		}
		passCode = fmt.Sprintf("%s-%04d", prefix, next)
		return tx.QueryRow(ctx, `INSERT INTO ticketing.ticket_season_passes
			(company_id, branch_id, ticket_product_id, pass_code, access_token,
			 holder_name, holder_phone, valid_from, valid_until, status,
			 entry_policy, visit_quota_total, visit_quota_used, band_id, band_uid,
			 source, unit_price, paid_at, activated_at, created_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11,0,$12,$13,'loket',$14, now(), now(), $15)
			RETURNING id::text`,
			v.CompanyID, v.BranchID, in.TicketProductID, passCode, token, in.HolderName, orNil(in.HolderPhone),
			today, validUntil, entryPolicy, quotaTotal, bandID, bandUID, unitPrice, v.UserID).Scan(&id)
	})
	if err != nil {
		return nil, onDuplicate(err, "Tabrakan kode pass — coba terbitkan sekali lagi")
	}
	return object(
		"id", id, "pass_code", passCode, "access_token", token, "holder_name", in.HolderName,
		"valid_from", today, "valid_until", validUntil, "entry_policy", entryPolicy,
		"visit_quota_total", quotaTotal, "unit_price", unitPrice, "band_uid", bandUID,
	), nil
}

// RenewSeasonPass is renewSeasonPass: valid_until grows by validity_months
// from MAX(today, valid_until); a punch card gets its full quota back.
func (s *Service) RenewSeasonPass(ctx context.Context, v Venue, id string) (*Row, error) {
	var status, entryPolicy string
	var validUntil *string
	var validityMonths int
	var quota *int
	err := s.db.QueryRow(ctx, `SELECT sp.status, sp.entry_policy, sp.valid_until::text, pc.validity_months, pc.visit_quota
		FROM ticketing.ticket_season_passes sp
		JOIN ticketing.ticket_pass_configs pc ON pc.ticket_product_id = sp.ticket_product_id
		WHERE sp.id = $1 AND sp.branch_id = $2 AND sp.company_id = $3`, id, v.BranchID, v.CompanyID).
		Scan(&status, &entryPolicy, &validUntil, &validityMonths, &quota)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Pass tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	switch status {
	case "cancelled":
		return nil, httpx.BadRequest("Pass dibatalkan — tidak bisa diperpanjang")
	case "pending":
		return nil, httpx.BadRequest("Pass belum aktif (menunggu pembayaran)")
	}
	today := s.today()
	base := today
	if validUntil != nil && *validUntil > today {
		base = *validUntil
	}
	newUntil := domain.AddMonthsISO(base, validityMonths)
	resetQuota := entryPolicy == "limited_visits"
	if _, err := s.db.Exec(ctx, `UPDATE ticketing.ticket_season_passes
		SET valid_until = $2,
		    valid_from = COALESCE(valid_from, $3),
		    status = 'active',
		    activated_at = COALESCE(activated_at, now()),
		    visit_quota_total = CASE WHEN $4 THEN $5 ELSE visit_quota_total END,
		    visit_quota_used = CASE WHEN $4 THEN 0 ELSE visit_quota_used END,
		    updated_at = now()
		WHERE id = $1`, id, newUntil, today, resetQuota, quota); err != nil {
		return nil, err
	}
	return object("id", id, "valid_until", newUntil, "quota_reset", resetQuota), nil
}
