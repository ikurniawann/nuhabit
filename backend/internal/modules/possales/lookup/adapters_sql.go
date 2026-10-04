package lookup

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/lookup/domain"
	"nuhabit/backend/internal/platform/database"
)

// Stopgap adapters for data owned by ticketing and CRM, with the SQL the TS
// code runs today. New uses them until internal/app wires the owners'
// services.

// PassesSQL reads ticketing.ticket_season_passes (SQL of the pass-lookup route).
type PassesSQL struct{}

var _ SeasonPasses = PassesSQL{}

var passColumns = map[domain.PassField]string{
	domain.ByAccessToken: "sp.access_token",
	domain.ByPassCode:    "sp.pass_code",
	domain.ByBandUID:     "sp.band_uid",
}

func (PassesSQL) FindSeasonPass(ctx context.Context, q database.Querier, key domain.PassKey) (*domain.SeasonPass, error) {
	column, ok := passColumns[key.Field]
	if !ok {
		return nil, fmt.Errorf("lookup: unknown pass field %q", key.Field)
	}
	var p domain.SeasonPass
	err := q.QueryRow(ctx, `SELECT sp.pass_code, sp.holder_name, sp.status,
              sp.valid_from::text AS valid_from, sp.valid_until::text AS valid_until,
              pc.member_discount_percent::float8, tp.name AS product_name
       FROM ticketing.ticket_season_passes sp
       JOIN ticketing.ticket_products tp ON tp.id = sp.ticket_product_id
       JOIN ticketing.ticket_pass_configs pc ON pc.ticket_product_id = sp.ticket_product_id
       WHERE `+column+` = $1 LIMIT 1`, key.Value).
		Scan(&p.PassCode, &p.HolderName, &p.Status, &p.ValidFrom, &p.ValidUntil, &p.MemberDiscountPercent, &p.ProductName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// MemberQrSQL ports scanMemberQr (lib/crm/engagement/server.ts) on the
// crm.member_qr_tokens, crm.member_checkins and crm.member_notifications
// tables. The TS notifyMember also sends a web push after commit; that stays
// with the CRM/member-portal push sender and is not sent from here.
type MemberQrSQL struct{}

var _ MemberQrScanner = MemberQrSQL{}

func (MemberQrSQL) ScanMemberQr(ctx context.Context, q database.Querier, rawToken, scannedBy string, now time.Time) (QrScan, error) {
	token := strings.ToLower(strings.TrimSpace(rawToken))
	var (
		scan  QrScan
		t     domain.QrToken
		row   *domain.QrToken
		owner *string // customer_id of the token, NULL in the log when unknown
	)
	err := q.QueryRow(ctx, `SELECT t.customer_id::text, t.expires_at, t.consumed_at, c.name, c.phone
         FROM crm.member_qr_tokens t JOIN pos.pos_customers c ON c.id = t.customer_id
        WHERE t.token = $1 FOR UPDATE OF t`, token).
		Scan(&scan.CustomerID, &t.ExpiresAt, &t.ConsumedAt, &scan.Name, &scan.Phone)
	switch {
	case err == nil:
		row, owner = &t, &scan.CustomerID
	case !errors.Is(err, pgx.ErrNoRows):
		return QrScan{}, err
	}

	problem := domain.CheckQrToken(row, now)
	decision, reason := "accepted", (*string)(nil)
	if problem != "" {
		r := string(problem)
		decision, reason = "denied", &r
	}
	if _, err := q.Exec(ctx,
		`INSERT INTO crm.member_checkins (customer_id, decision, reason, scanned_by) VALUES ($1, $2, $3, $4)`,
		owner, decision, reason, scannedBy); err != nil {
		return QrScan{}, err
	}
	if problem != "" {
		return QrScan{Problem: problem}, nil
	}
	if _, err := q.Exec(ctx, `UPDATE crm.member_qr_tokens SET consumed_at = now() WHERE token = $1`, token); err != nil {
		return QrScan{}, err
	}
	_, err = q.Exec(ctx,
		`INSERT INTO crm.member_notifications (customer_id, type, title, body) VALUES ($1, $2, $3, $4)`,
		scan.CustomerID, "visit_recorded", "Kunjungan tercatat", domain.VisitRecordedBody(scan.Name, now))
	return scan, err
}
