package memberportal

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/database"
)

// store is the PostgreSQL repository. q is the pool or, inside inTx, the
// transaction.
type store struct {
	pool *pgxpool.Pool
	q    database.Querier
}

func newStore(pool *pgxpool.Pool) *store { return &store{pool: pool, q: pool} }

func (s *store) InTx(ctx context.Context, fn func(Repository) error) error {
	return database.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		return fn(&store{pool: s.pool, q: tx})
	})
}

// FindMemberByPhone matches an active pos_customers row by digits; numbers
// are stored as 08xx or 62xx.
func (s *store) FindMemberByPhone(ctx context.Context, phone string) (*MemberRef, error) {
	var m MemberRef
	err := s.q.QueryRow(ctx,
		`SELECT id, name FROM pos.pos_customers
		  WHERE is_active IS NOT FALSE
		    AND regexp_replace(COALESCE(phone, ''), '\D', '', 'g')
		        IN ($1, '0' || substring($1 from 3))
		  LIMIT 1`, phone).Scan(&m.ID, &m.Name)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func (s *store) FindMemberByGoogle(ctx context.Context, sub, email string) (*MemberRef, error) {
	var m MemberRef
	err := s.q.QueryRow(ctx,
		`SELECT id, name FROM pos.pos_customers
		  WHERE is_active IS NOT FALSE
		    AND (google_sub = $1 OR ($2 <> '' AND google_sub IS NULL AND lower(email) = $2))
		  ORDER BY (google_sub = $1) DESC, created_at
		  LIMIT 1`, sub, email).Scan(&m.ID, &m.Name)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func (s *store) LinkGoogle(ctx context.Context, customerID, sub string) error {
	_, err := s.q.Exec(ctx,
		`UPDATE pos.pos_customers SET google_sub = $2, updated_at = now() WHERE id = $1 AND google_sub IS NULL`, customerID, sub)
	return err
}

func (s *store) CountRecentOTP(ctx context.Context, phone string, window time.Duration) (int, error) {
	var n int
	err := s.q.QueryRow(ctx,
		`SELECT count(*)::int FROM crm.member_portal_otp
		  WHERE phone = $1 AND created_at > now() - make_interval(secs => $2)`,
		phone, window.Seconds()).Scan(&n)
	return n, err
}

func (s *store) InsertOTP(ctx context.Context, phone, codeHash string, ttl time.Duration) error {
	_, err := s.q.Exec(ctx,
		`INSERT INTO crm.member_portal_otp (phone, code_hash, expires_at)
		 VALUES ($1, $2, now() + make_interval(secs => $3))`,
		phone, codeHash, ttl.Seconds())
	return err
}

func (s *store) LatestOTP(ctx context.Context, phone string) (*OTPRecord, error) {
	var o OTPRecord
	err := s.q.QueryRow(ctx,
		`SELECT id, code_hash, expires_at, consumed_at
		   FROM crm.member_portal_otp
		  WHERE phone = $1
		  ORDER BY created_at DESC LIMIT 1`, phone).Scan(&o.ID, &o.CodeHash, &o.ExpiresAt, &o.ConsumedAt)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// ClaimOTPAttempt increments attempts atomically, only below the cap and
// while unconsumed. False means no attempt is left.
func (s *store) ClaimOTPAttempt(ctx context.Context, id string, max int) (bool, error) {
	tag, err := s.q.Exec(ctx,
		`UPDATE crm.member_portal_otp SET attempts = attempts + 1
		  WHERE id = $1 AND attempts < $2 AND consumed_at IS NULL`, id, max)
	return tag.RowsAffected() > 0, err
}

func (s *store) ConsumeOTP(ctx context.Context, id string) (bool, error) {
	tag, err := s.q.Exec(ctx,
		`UPDATE crm.member_portal_otp SET consumed_at = now()
		  WHERE id = $1 AND consumed_at IS NULL`, id)
	return tag.RowsAffected() > 0, err
}

func (s *store) MarkWAVerified(ctx context.Context, customerID string) error {
	_, err := s.q.Exec(ctx,
		`UPDATE pos.pos_customers
		    SET wa_verified_at = COALESCE(wa_verified_at, now()), updated_at = now()
		  WHERE id = $1`, customerID)
	return err
}

func (s *store) CreateSession(ctx context.Context, tokenHash, customerID string, expiresAt time.Time) error {
	_, err := s.q.Exec(ctx,
		`INSERT INTO crm.member_portal_sessions (token_hash, customer_id, expires_at) VALUES ($1, $2, $3)`,
		tokenHash, customerID, expiresAt)
	return err
}

func (s *store) DeleteSession(ctx context.Context, tokenHash string) error {
	_, err := s.q.Exec(ctx, `DELETE FROM crm.member_portal_sessions WHERE token_hash = $1`, tokenHash)
	return err
}

// FindLoginAccount matches an active member by phone digits (stored as
// 08xx or 62xx) or email; an email match wins when both are given.
func (s *store) FindLoginAccount(ctx context.Context, digits, email string) (*LoginAccount, error) {
	var a LoginAccount
	err := s.q.QueryRow(ctx,
		`SELECT id, name, COALESCE(phone, ''), password_hash FROM pos.pos_customers
		  WHERE is_active IS NOT FALSE
		    AND (($1 <> '' AND regexp_replace(COALESCE(phone, ''), '\D', '', 'g') IN ($1, '0' || substring($1 from 3)))
		      OR ($2 <> '' AND lower(COALESCE(email, '')) = $2))
		  ORDER BY (lower(COALESCE(email, '')) = $2) DESC
		  LIMIT 1`, digits, email).Scan(&a.ID, &a.Name, &a.Phone, &a.PasswordHash)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (s *store) PasswordHash(ctx context.Context, customerID string) (*string, error) {
	var hash *string
	err := s.q.QueryRow(ctx, `SELECT password_hash FROM pos.pos_customers WHERE id = $1`, customerID).Scan(&hash)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return hash, err
}

func (s *store) SetPasswordHash(ctx context.Context, customerID, hash string) error {
	_, err := s.q.Exec(ctx, `UPDATE pos.pos_customers SET password_hash = $2, updated_at = now() WHERE id = $1`, customerID, hash)
	return err
}

// DeleteOtherSessions ends every session of the member except the one
// behind keepTokenHash ("" ends them all).
func (s *store) DeleteOtherSessions(ctx context.Context, customerID, keepTokenHash string) error {
	_, err := s.q.Exec(ctx,
		`DELETE FROM crm.member_portal_sessions WHERE customer_id = $1 AND token_hash <> $2`, customerID, keepTokenHash)
	return err
}

// LockRegistration serializes registrations of one number for the tx.
func (s *store) LockRegistration(ctx context.Context, phoneDigits string) error {
	_, err := s.q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "member-register:"+phoneDigits)
	return err
}

// InsertRegisteredMember creates the pos_customers row and the CRM profile
// on the regular (or lowest active) tier, like enroll_member at the till.
func (s *store) InsertRegisteredMember(ctx context.Context, reg domain.Registration) (*MemberRef, error) {
	var m MemberRef
	err := s.q.QueryRow(ctx,
		`INSERT INTO pos.pos_customers
		   (phone, name, email, birth_date, member_type, wa_consent, wa_verified_at, google_sub)
		 VALUES ($1, $2, $3, $4, 'registered', $5, now(), $6)
		 RETURNING id, name`,
		reg.PhoneLocal, reg.Name, reg.Email, reg.BirthDate, reg.WAConsent, reg.GoogleSub).Scan(&m.ID, &m.Name)
	if err != nil {
		return nil, err
	}
	_, err = s.q.Exec(ctx,
		`INSERT INTO crm.crm_member_profiles (customer_id, tier_id, status, metadata, last_activity_at)
		 SELECT $1, t.id, 'active', '{"source":"member_portal_register"}'::jsonb, now()
		   FROM crm.crm_membership_tiers t
		  WHERE t.code = 'regular' OR t.is_active
		  ORDER BY (t.code = 'regular') DESC, t.rank
		  LIMIT 1
		 ON CONFLICT (customer_id) DO NOTHING`, m.ID)
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// DefaultVenue reads crm_settings default_company_id/default_branch_id;
// any failure is no venue (getCrmDefaultVenue).
func (s *store) DefaultVenue(ctx context.Context) Venue {
	var v Venue
	rows, err := s.q.Query(ctx,
		`SELECT key, value FROM crm.crm_settings WHERE key IN ('default_company_id', 'default_branch_id')`)
	if err != nil {
		return v
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var raw json.RawMessage
		if rows.Scan(&key, &raw) != nil {
			return Venue{}
		}
		var str string
		if json.Unmarshal(raw, &str) != nil {
			continue
		}
		switch key {
		case "default_company_id":
			v.CompanyID = &str
		case "default_branch_id":
			v.BranchID = &str
		}
	}
	if rows.Err() != nil {
		return Venue{}
	}
	return v
}

// SetMarketingConsent keeps pos_customers.wa_consent and the campaign
// opt-out list in step (lib/member-portal/consent.ts).
func (s *store) SetMarketingConsent(ctx context.Context, customerID string, enabled bool, venue Venue) error {
	var digits *string
	err := s.q.QueryRow(ctx,
		`UPDATE pos.pos_customers SET wa_consent = $2, updated_at = now()
		  WHERE id = $1 RETURNING regexp_replace(phone, '\D', '', 'g')`, customerID, enabled).Scan(&digits)
	if database.IsNoRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if digits == nil || *digits == "" {
		return nil
	}
	if enabled {
		_, err = s.q.Exec(ctx,
			`DELETE FROM crm.crm_marketing_optouts
			  WHERE `+canonicalPhone("phone")+` = `+canonicalPhone("$1::text"), *digits)
		return err
	}
	if venue.CompanyID == nil || venue.BranchID == nil || *venue.CompanyID == "" || *venue.BranchID == "" {
		return nil
	}
	_, err = s.q.Exec(ctx,
		`INSERT INTO crm.crm_marketing_optouts (company_id, branch_id, phone, customer_id, source, note)
		 VALUES ($2, $3, $1, $4, 'portal', 'Dimatikan member lewat portal')
		 ON CONFLICT (branch_id, phone) DO NOTHING`,
		*digits, *venue.CompanyID, *venue.BranchID, customerID)
	return err
}

// ReadMarketingConsent is true when the member opted in and the number is
// on no opt-out list.
func (s *store) ReadMarketingConsent(ctx context.Context, customerID string) (bool, error) {
	var consent, optedOut *bool
	err := s.q.QueryRow(ctx,
		`SELECT c.wa_consent,
		        EXISTS (SELECT 1 FROM crm.crm_marketing_optouts o
		                 WHERE `+canonicalPhone("o.phone")+` = `+canonicalPhone("c.phone")+`)
		   FROM pos.pos_customers c WHERE c.id = $1`, customerID).Scan(&consent, &optedOut)
	if database.IsNoRows(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return consent != nil && *consent && (optedOut == nil || !*optedOut), nil
}

// canonicalPhone is the SQL for a number's digits with a leading 0 as 62.
func canonicalPhone(column string) string {
	return `regexp_replace(regexp_replace(` + column + `, '\D', '', 'g'), '^0', '62')`
}
