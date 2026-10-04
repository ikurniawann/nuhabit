package ticketing

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/jsmath"
)

// Season passes sold online (public-pass-server.ts): the catalog, the
// purchase ('pending' until the Xendit PAID webhook) and the status page.

// onlinePassFrom is ONLINE_PASS_FROM: Active season passes distributed to
// the 'website' channel.
const onlinePassFrom = `FROM ticketing.ticket_products tp
	JOIN ticketing.ticket_pass_configs pc ON pc.ticket_product_id = tp.id
	JOIN ticketing.ticket_product_channels pch
	  ON pch.ticket_product_id = tp.id AND pch.is_distributed = true
	JOIN ticketing.ticket_channels ch
	  ON ch.id = pch.channel_id AND ch.code = 'website'
	` + passPriceLateral

const onlinePassWhere = `tp.branch_id = $1 AND tp.company_id = $2
	AND tp.product_kind = 'season_pass' AND tp.status = 'active'`

// OnlinePasses is listOnlinePasses.
func (s *Service) OnlinePasses(ctx context.Context, v Venue) ([]*Row, error) {
	rows, err := queryRows(ctx, s.db, `SELECT tp.id AS ticket_product_id, tp.name, tp.description, tp.thumbnail_url,
		  pc.validity_months, pc.entry_policy, pc.visit_quota,
		  COALESCE(v.price_regular, tp.base_price) AS unit_price
		`+onlinePassFrom+`
		WHERE `+onlinePassWhere+`
		ORDER BY tp.name`, v.BranchID, v.CompanyID)
	for _, r := range rows {
		r.ToNum("unit_price")
	}
	return rows, err
}

// PassPurchase is purchasePassSchema after parsing.
type PassPurchase struct {
	TicketProductID, HolderName, HolderPhone string
}

// PassCreated is purchasePassOnline's result.
type PassCreated struct {
	PassCode    string  `json:"pass_code"`
	AccessToken string  `json:"access_token"`
	StatusURL   string  `json:"status_url"`
	InvoiceURL  string  `json:"invoice_url"`
	Total       float64 `json:"total"`
	ExpiresAt   string  `json:"expires_at"`
}

// PurchasePassOnline is purchasePassOnline: insert 'pending' (retrying a
// pass code collision), then the invoice; a failed invoice cancels it.
func (s *Service) PurchasePassOnline(ctx context.Context, slug string, in PassPurchase, baseURL string) (*PassCreated, error) {
	phone := domain.NormalizePhoneDigits(in.HolderPhone)
	if phone == "" {
		return nil, httpx.BadRequest("Nomor WhatsApp tidak valid")
	}
	if !s.ports.Public.Payments.Configured() {
		return nil, httpx.Status(503, "Pembayaran online belum tersedia — silakan beli di loket")
	}
	venue, err := s.resolvePublicVenue(ctx, slug)
	if err != nil {
		return nil, err
	}
	if venue == nil {
		return nil, httpx.NotFound(notFound)
	}
	var entryPolicy, name string
	var quota *int
	var unitPrice float64
	err = s.db.QueryRow(ctx, `SELECT pc.entry_policy, pc.visit_quota, tp.name,
		  COALESCE(COALESCE(v.price_regular, tp.base_price), 0)::float8
		`+onlinePassFrom+`
		WHERE tp.id = $3 AND `+onlinePassWhere, venue.BranchID, venue.CompanyID, in.TicketProductID).
		Scan(&entryPolicy, &quota, &name, &unitPrice)
	if database.IsNoRows(err) {
		return nil, httpx.BadRequest("Produk pass tidak tersedia untuk dibeli online")
	}
	if err != nil {
		return nil, err
	}
	if unitPrice <= 0 {
		return nil, httpx.BadRequest("Harga pass belum diatur — hubungi loket")
	}
	var quotaTotal *int
	if entryPolicy == "limited_visits" {
		quotaTotal = quota
	}
	token := domain.GenerateAccessToken()
	expiresAt := s.now().Add(invoiceExpiryHours * time.Hour)
	today := s.today()

	var id, passCode string
	for attempt := 0; attempt < 3 && id == ""; attempt++ {
		err = s.inTx(ctx, func(tx pgx.Tx) error {
			prefix := domain.PassCodePrefix(today)
			var next int
			if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(NULLIF(substring(pass_code from '[0-9]+$'), '')::int), 0) + 1
				FROM ticketing.ticket_season_passes
				WHERE branch_id = $1 AND pass_code LIKE $2`, venue.BranchID, prefix+"-%").Scan(&next); err != nil {
				return err
			}
			passCode = fmt.Sprintf("%s-%04d", prefix, next)
			return tx.QueryRow(ctx, `INSERT INTO ticketing.ticket_season_passes
				  (company_id, branch_id, ticket_product_id, pass_code, access_token,
				   holder_name, holder_phone, status, entry_policy, visit_quota_total,
				   visit_quota_used, source, unit_price, payment_expires_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,0,'online',$10,$11)
				RETURNING id::text`, venue.CompanyID, venue.BranchID, in.TicketProductID, passCode, token,
				in.HolderName, phone, entryPolicy, quotaTotal, unitPrice, expiresAt).Scan(&id)
		})
		if err != nil {
			id = ""
			if database.IsUniqueViolation(err) && attempt < 2 {
				continue
			}
			return nil, err
		}
	}
	if id == "" {
		return nil, errors.New("Gagal mengalokasikan kode pass")
	}

	statusURL := baseURL + "/pass/status/" + token
	invoice, err := s.ports.Public.Payments.CreateInvoice(ctx, InvoiceRequest{
		ExternalID:  passInvoicePrefix + id,
		Amount:      jsmath.Round(unitPrice),
		PayerName:   in.HolderName,
		Description: "Season Pass " + passCode + " — " + name,
		RedirectURL: statusURL,
	})
	if err == nil {
		_, err = s.db.Exec(ctx, `UPDATE ticketing.ticket_season_passes
			SET xendit_invoice_id = $2, xendit_invoice_url = $3,
			    payment_expires_at = $4, updated_at = now()
			WHERE id = $1`, id, invoice.ID, invoice.URL, invoice.ExpiresAt)
	}
	if err != nil {
		s.log.Error("[pass] invoice error", "error", err)
		if _, err := s.db.Exec(ctx, `UPDATE ticketing.ticket_season_passes
			SET status = 'cancelled', notes = 'pembuatan-invoice-gagal', updated_at = now()
			WHERE id = $1 AND status = 'pending'`, id); err != nil {
			return nil, err
		}
		return nil, httpx.Status(502, "Pembayaran sedang gangguan — coba lagi")
	}
	return &PassCreated{
		PassCode: passCode, AccessToken: token, StatusURL: statusURL, InvoiceURL: invoice.URL,
		Total: unitPrice, ExpiresAt: invoice.ExpiresAt.UTC().Format(httpx.JSTimeLayout),
	}, nil
}

// PassStatus is getPassStatus by access token (nil when unknown). A pending
// pass whose invoice ran out reads 'expired' (nothing is written).
func (s *Service) PassStatus(ctx context.Context, token string) (*Row, error) {
	p, err := queryRow(ctx, s.db, `SELECT sp.pass_code, sp.holder_name, sp.status, sp.entry_policy,
		  sp.valid_from::text AS valid_from, sp.valid_until::text AS valid_until,
		  sp.visit_quota_total, sp.visit_quota_used, sp.unit_price,
		  tp.name AS product_name, sp.xendit_invoice_url,
		  sp.payment_expires_at::text AS payment_expires_at,
		  (sp.payment_expires_at < $2) AS invoice_lapsed
		FROM ticketing.ticket_season_passes sp
		JOIN ticketing.ticket_products tp ON tp.id = sp.ticket_product_id
		WHERE sp.access_token = $1`, token, s.now())
	if err != nil || p == nil {
		return nil, err
	}
	status := p.Str("status")
	if status == "pending" && p.Bool("invoice_lapsed") {
		status = "expired"
	}
	return object(
		"pass_code", p.Get("pass_code"),
		"holder_name", p.Get("holder_name"),
		"product_name", p.Get("product_name"),
		"status", status,
		"entry_policy", p.Get("entry_policy"),
		"valid_from", p.Get("valid_from"),
		"valid_until", p.Get("valid_until"),
		"visit_quota_total", p.Get("visit_quota_total"),
		"visit_quota_used", p.Get("visit_quota_used"),
		"unit_price", p.Num("unit_price"),
		"qr_value", token,
		"invoice_url", p.Get("xendit_invoice_url"),
		"payment_expires_at", p.Get("payment_expires_at"),
	), nil
}
