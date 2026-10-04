package dataroom

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/dataroom/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Share links (lib/dataroom/shares.ts): public or for listed emails
// (verified by a six-digit code), an optional PIN, an expiry and an
// optional watermark. Recipients hold a random session cookie.

// shareFields are the share columns a client sees (pin_hash is replaced
// by has_pin).
type shareFields struct {
	ID             string        `json:"id"`
	Token          string        `json:"token"`
	NodeID         string        `json:"node_id"`
	AccessType     string        `json:"access_type"`
	AllowedEmails  []string      `json:"allowed_emails"`
	Watermark      bool          `json:"watermark"`
	ExpiresAt      httpx.JSTime  `json:"expires_at"`
	RevokedAt      *httpx.JSTime `json:"revoked_at"`
	ViewCount      int           `json:"view_count"`
	LastAccessedAt *httpx.JSTime `json:"last_accessed_at"`
	CreatedBy      *string       `json:"created_by"`
	CreatedByName  *string       `json:"created_by_name"`
	CreatedAt      httpx.JSTime  `json:"created_at"`
}

// Share is a DataroomShare.
type Share struct {
	shareFields
	PinHash *string
}

const shareCols = `s.id::text, s.token, s.node_id::text, s.access_type, s.allowed_emails, s.pin_hash, s.watermark, s.expires_at,
  s.revoked_at, s.view_count, s.last_accessed_at, s.created_by::text, s.created_by_name, s.created_at`

// scanShare reads shareCols followed by extra destinations.
func scanShare(row pgx.Row, extra ...any) (*Share, error) {
	var sh Share
	var expires, created time.Time
	var revoked, accessed *time.Time
	dest := append([]any{&sh.ID, &sh.Token, &sh.NodeID, &sh.AccessType, &sh.AllowedEmails, &sh.PinHash, &sh.Watermark, &expires,
		&revoked, &sh.ViewCount, &accessed, &sh.CreatedBy, &sh.CreatedByName, &created}, extra...)
	if err := row.Scan(dest...); err != nil {
		return nil, err
	}
	sh.ExpiresAt, sh.CreatedAt = httpx.JSTime(expires), httpx.JSTime(created)
	sh.RevokedAt, sh.LastAccessedAt = httpx.NewJSTime(revoked), httpx.NewJSTime(accessed)
	return &sh, nil
}

func (s *Service) oneShare(ctx context.Context, where string, arg any) (*Share, error) {
	sh, err := scanShare(s.db.QueryRow(ctx, `SELECT `+shareCols+` FROM dataroom.shares s WHERE `+where, arg))
	if database.IsNoRows(err) {
		return nil, nil
	}
	return sh, err
}

// ShareByID is getShareById.
func (s *Service) ShareByID(ctx context.Context, id string) (*Share, error) {
	return s.oneShare(ctx, "s.id = $1", id)
}

// shareByToken is findShareByToken: a malformed token finds nothing.
func (s *Service) shareByToken(ctx context.Context, token string) (*Share, error) {
	if !domain.ShareTokenRe.MatchString(token) {
		return nil, nil
	}
	return s.oneShare(ctx, "s.token = $1", token)
}

// shareURL is shareUrl.
func (s *Service) shareURL(token string) string { return s.ports.AppOrigin + "/share/" + token }

// ListedShare is a listShares row for the client.
type ListedShare struct {
	shareFields
	NodeName     string  `json:"node_name"`
	NodeKind     string  `json:"node_kind"`
	NodeParentID *string `json:"node_parent_id"`
	AccessCount  int     `json:"access_count"`
	HasPin       bool    `json:"has_pin"`
	URL          string  `json:"url"`
}

// Shares is listShares (one node, or all; at most 300) keeping those the
// actor may open.
func (s *Service) Shares(ctx context.Context, a *Access, nodeID *string) ([]ListedShare, error) {
	where, args := "", []any{}
	if nodeID != nil {
		where, args = "WHERE s.node_id = $1", []any{*nodeID}
	}
	rows, err := s.db.Query(ctx, `SELECT `+shareCols+`,
	        n.name AS node_name, n.kind AS node_kind, n.parent_id::text AS node_parent_id,
	        (SELECT COUNT(*) FROM dataroom.share_access_logs l WHERE l.share_id = s.id AND l.action IN ('view','download'))::int AS access_count
	 FROM dataroom.shares s JOIN dataroom.nodes n ON n.id = s.node_id
	 `+where+`
	 ORDER BY s.created_at DESC LIMIT 300`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ListedShare{}
	for rows.Next() {
		var l ListedShare
		sh, err := scanShare(rows, &l.NodeName, &l.NodeKind, &l.NodeParentID, &l.AccessCount)
		if err != nil {
			return nil, err
		}
		if !a.Allows(sh.NodeID, l.NodeParentID, l.NodeKind) {
			continue
		}
		l.shareFields, l.HasPin, l.URL = sh.shareFields, sh.PinHash != nil, s.shareURL(sh.Token)
		out = append(out, l)
	}
	return out, rows.Err()
}

// ShareInput is the create body after parsing.
type ShareInput struct {
	NodeID, AccessType string
	Emails             []string
	Pin                *string
	Watermark          bool
	ExpiresDays        int
	SendEmail          bool
}

// MailResult is the `mail` field of the create answer.
type MailResult struct {
	Sent   int      `json:"sent"`
	Failed []string `json:"failed"`
}

// CreatedShare is the create answer data.
type CreatedShare struct {
	shareFields
	HasPin      bool        `json:"has_pin"`
	URL         string      `json:"url"`
	NodeName    string      `json:"node_name"`
	NodeKind    string      `json:"node_kind"`
	AccessCount int         `json:"access_count"`
	Mail        *MailResult `json:"mail"`
}

// CreateShare is the POST /api/dataroom/shares use case: the node must be
// open to the actor; an email link needs at least one valid recipient.
func (s *Service) CreateShare(ctx context.Context, a *Access, userID, userName string, in ShareInput) (*CreatedShare, error) {
	node, err := s.Node(ctx, in.NodeID)
	if err != nil {
		return nil, err
	}
	if node == nil {
		return nil, httpx.NotFound("Item tidak ditemukan")
	}
	if !a.AllowsNode(node) {
		return nil, httpx.Forbidden("Item ini tidak dibuka untuk departemen Anda")
	}
	emails := domain.NormalizeEmails(in.Emails)
	if in.AccessType == "email" && len(emails) == 0 {
		return nil, httpx.BadRequest("Isi minimal satu email penerima yang valid")
	}
	expiresAt := domain.ComputeExpiry(in.ExpiresDays, s.now())
	allowed := []string{}
	if in.AccessType == "email" {
		allowed = emails
	}
	var pinHash *string
	if in.Pin != nil && *in.Pin != "" {
		// bcrypt cost 10 through pgcrypto (bcryptjs hashPin).
		var h string
		if err := s.db.QueryRow(ctx, `SELECT crypt($1, gen_salt('bf', 10))`, *in.Pin).Scan(&h); err != nil {
			return nil, err
		}
		pinHash = &h
	}
	sh, err := scanShare(s.db.QueryRow(ctx, `WITH s AS (
	   INSERT INTO dataroom.shares (token, node_id, access_type, allowed_emails, pin_hash, watermark, expires_at, created_by, created_by_name)
	   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *)
	 SELECT `+shareCols+` FROM s`,
		domain.GenerateShareToken(), node.ID, in.AccessType, allowed, pinHash, in.Watermark, expiresAt, userID, userName))
	if err != nil {
		return nil, err
	}
	out := &CreatedShare{shareFields: sh.shareFields, HasPin: sh.PinHash != nil, URL: s.shareURL(sh.Token),
		NodeName: node.Name, NodeKind: node.Kind}
	if in.SendEmail && len(emails) > 0 {
		out.Mail = s.sendShareLink(ctx, emails, node, sh.Token, userName, expiresAt, pinHash != nil)
	}
	return out, nil
}

// RevokeShare is revokeShare.
func (s *Service) RevokeShare(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, `UPDATE dataroom.shares SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, id)
	return err
}

// AccessLog is one listShareLogs row.
type AccessLog struct {
	ID        string       `json:"id"`
	NodeID    *string      `json:"node_id"`
	Action    string       `json:"action"`
	FileName  *string      `json:"file_name"`
	Email     *string      `json:"email"`
	IP        *string      `json:"ip"`
	UserAgent *string      `json:"user_agent"`
	CreatedAt httpx.JSTime `json:"created_at"`
}

// ShareLogs is listShareLogs (latest 200).
func (s *Service) ShareLogs(ctx context.Context, shareID string) ([]AccessLog, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, node_id::text, action, file_name, email, ip, user_agent, created_at
	 FROM dataroom.share_access_logs WHERE share_id = $1 ORDER BY created_at DESC LIMIT $2`, shareID, 200)
	if err != nil {
		return nil, err
	}
	out := []AccessLog{}
	var l AccessLog
	var created time.Time
	_, err = pgx.ForEachRow(rows, []any{&l.ID, &l.NodeID, &l.Action, &l.FileName, &l.Email, &l.IP, &l.UserAgent, &created}, func() error {
		l.CreatedAt = httpx.JSTime(created)
		out = append(out, l)
		return nil
	})
	return out, err
}

// touchShare counts one open of the link page.
func (s *Service) touchShare(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, `UPDATE dataroom.shares SET view_count = view_count + 1, last_accessed_at = now() WHERE id = $1`, id)
	return err
}

// accessEvent is one logShareAccess call.
type accessEvent struct {
	shareID, action  string
	nodeID, fileName *string
	email            *string
	ip, userAgent    string
}

// logAccess is logShareAccess: a failed write is only logged.
func (s *Service) logAccess(ctx context.Context, e accessEvent) {
	var email *string
	if e.email != nil {
		v := domain.JSSlice(strings.ToLower(*e.email), 255)
		email = &v
	}
	var fileName *string
	if e.fileName != nil {
		v := domain.JSSlice(*e.fileName, 255)
		fileName = &v
	}
	if _, err := s.db.Exec(ctx, `INSERT INTO dataroom.share_access_logs (share_id, node_id, action, file_name, email, ip, user_agent)
	 VALUES ($1, $2, $3, $4, $5, $6, $7)`, e.shareID, e.nodeID, e.action, fileName, email, domain.JSSlice(e.ip, 64), orNull(domain.JSSlice(e.userAgent, 255))); err != nil {
		s.log.Warn("[dataroom] gagal tulis log akses", "error", err)
	}
}

// orNull is `value ?? null` for a header that may be absent.
func orNull(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

/* ── Recipient sessions ──────────────────────────────────────────────── */

// Session is a ShareSession.
type Session struct {
	ID, SessionToken string
	Email            *string
	EmailOK, PinOK   bool
	ExpiresAt        time.Time
}

const sessionCols = `id::text, session_token, email, email_ok, pin_ok, expires_at`

func scanSession(row pgx.Row) (*Session, error) {
	var se Session
	err := row.Scan(&se.ID, &se.SessionToken, &se.Email, &se.EmailOK, &se.PinOK, &se.ExpiresAt)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &se, nil
}

// session is getSession: the live session for the cookie value, or nil.
func (s *Service) session(ctx context.Context, shareID, token string) (*Session, error) {
	if !domain.ShareTokenRe.MatchString(token) {
		return nil, nil
	}
	return scanSession(s.db.QueryRow(ctx, `SELECT `+sessionCols+` FROM dataroom.share_sessions
	 WHERE share_id = $1 AND session_token = $2 AND expires_at > now()`, shareID, token))
}

// sessionUpdate is upsertSession's input.
type sessionUpdate struct {
	email          *string
	emailOK, pinOK bool
	ip, userAgent  string
}

// upsertSession is upsertSession: progress only accumulates; the session
// lives 24 hours, never past the link.
func (s *Service) upsertSession(ctx context.Context, existing *Session, sh *Share, u sessionUpdate) (*Session, error) {
	expires := s.now().Add(domain.SessionTTL)
	if linkEnd := time.Time(sh.ExpiresAt); linkEnd.Before(expires) {
		expires = linkEnd
	}
	if existing != nil {
		return scanSession(s.db.QueryRow(ctx, `UPDATE dataroom.share_sessions
		 SET email = COALESCE($2, email), email_ok = email_ok OR $3, pin_ok = pin_ok OR $4, expires_at = $5
		 WHERE id = $1 RETURNING `+sessionCols, existing.ID, u.email, u.emailOK, u.pinOK, expires))
	}
	return scanSession(s.db.QueryRow(ctx, `INSERT INTO dataroom.share_sessions (share_id, session_token, email, email_ok, pin_ok, ip, user_agent, expires_at)
	 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING `+sessionCols,
		sh.ID, domain.GenerateShareToken(), u.email, u.emailOK, u.pinOK, domain.JSSlice(u.ip, 64), orNull(domain.JSSlice(u.userAgent, 255)), expires))
}

/* ── Email codes ─────────────────────────────────────────────────────── */

// issueEmailCode replaces the recipient's code with a fresh six-digit one.
func (s *Service) issueEmailCode(ctx context.Context, shareID, email string) (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	code := fmt.Sprintf("%06d", n.Int64())
	e := strings.ToLower(strings.TrimSpace(email))
	if _, err := s.db.Exec(ctx, `DELETE FROM dataroom.share_email_codes WHERE share_id = $1 AND lower(email) = $2`, shareID, e); err != nil {
		return "", err
	}
	_, err = s.db.Exec(ctx, `INSERT INTO dataroom.share_email_codes (share_id, email, code_hash, expires_at) VALUES ($1, $2, $3, $4)`,
		shareID, e, domain.HashEmailCode(shareID, e, code), s.now().Add(domain.EmailCodeTTL))
	return code, err
}

// verifyEmailCode is verifyEmailCode: "ok", "invalid", "expired",
// "too_many" or "missing". A wrong code counts an attempt; a right one is
// consumed.
func (s *Service) verifyEmailCode(ctx context.Context, shareID, email, code string) (string, error) {
	e := strings.ToLower(strings.TrimSpace(email))
	var id, hash string
	var attempts int
	var expires time.Time
	err := s.db.QueryRow(ctx, `SELECT id::text, code_hash, attempts, expires_at FROM dataroom.share_email_codes
	 WHERE share_id = $1 AND lower(email) = $2 ORDER BY created_at DESC LIMIT 1`, shareID, e).Scan(&id, &hash, &attempts, &expires)
	switch {
	case database.IsNoRows(err):
		return "missing", nil
	case err != nil:
		return "", err
	case expires.Before(s.now()):
		return "expired", nil
	case attempts >= domain.EmailCodeMaxAttempts:
		return "too_many", nil
	}
	if subtle.ConstantTimeCompare([]byte(hash), []byte(domain.HashEmailCode(shareID, e, strings.TrimSpace(code)))) != 1 {
		_, err := s.db.Exec(ctx, `UPDATE dataroom.share_email_codes SET attempts = attempts + 1 WHERE id = $1`, id)
		return "invalid", err
	}
	_, err = s.db.Exec(ctx, `DELETE FROM dataroom.share_email_codes WHERE id = $1`, id)
	return "ok", err
}

/* ── PIN and its attempt limit (auth.attempt_limits) ─────────────────── */

// verifyPin is bcrypt.compare through pgcrypto. bcryptjs writes $2b$,
// which pgcrypto does not parse; $2a$ and $2b$ differ only past 255
// bytes, so the hash is read as $2a$. A hash crypt() rejects is a wrong
// PIN, as the TS .catch(() => false) makes it.
func (s *Service) verifyPin(ctx context.Context, pin, hash string) (bool, error) {
	if strings.HasPrefix(hash, "$2b$") || strings.HasPrefix(hash, "$2y$") {
		hash = "$2a$" + hash[4:]
	}
	var ok bool
	err := s.db.QueryRow(ctx, `SELECT crypt($1, $2) = $2`, pin, hash).Scan(&ok)
	if database.PgCode(err) != "" {
		return false, nil
	}
	return ok, err
}

func (s *Service) attemptStates(ctx context.Context, q database.Querier, sql string, args ...any) ([]domain.AttemptState, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[domain.AttemptState])
}

// pinLock is findActiveLock for the link's PIN.
func (s *Service) pinLock(ctx context.Context, shareID string) (*time.Time, error) {
	states, err := s.attemptStates(ctx, s.db, `SELECT failures, window_started_at, locked_until FROM auth.attempt_limits
	 WHERE scope = $1 AND subject = $2`, domain.SharePinScope, "share:"+shareID)
	if err != nil || len(states) == 0 {
		return nil, err
	}
	return domain.ActiveLock(&states[0], s.now()), nil
}

// recordPinFailure is recordFailure: one more failure under a row lock;
// the lock end when the link is now locked. Like the TS, one call in
// twenty prunes rows idle for a day.
func (s *Service) recordPinFailure(ctx context.Context, shareID string) (*time.Time, error) {
	subject := "share:" + shareID
	var lock *time.Time
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO auth.attempt_limits (scope, subject) VALUES ($1, $2) ON CONFLICT (scope, subject) DO NOTHING`,
			domain.SharePinScope, subject); err != nil {
			return err
		}
		states, err := s.attemptStates(ctx, tx, `SELECT failures, window_started_at, locked_until FROM auth.attempt_limits
		 WHERE scope = $1 AND subject = $2 FOR UPDATE`, domain.SharePinScope, subject)
		if err != nil {
			return err
		}
		now := s.now()
		var cur *domain.AttemptState
		if len(states) > 0 {
			cur = &states[0]
		}
		next := domain.ApplyFailure(cur, now, domain.SharePinPolicy)
		if _, err := tx.Exec(ctx, `UPDATE auth.attempt_limits SET failures = $3, window_started_at = $4, locked_until = $5, updated_at = now()
		 WHERE scope = $1 AND subject = $2`, domain.SharePinScope, subject, next.Failures, next.WindowStarted, next.LockedUntil); err != nil {
			return err
		}
		lock = domain.ActiveLock(&next, now)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if n, _ := rand.Int(rand.Reader, big.NewInt(20)); n != nil && n.Int64() == 0 {
		if _, err := s.db.Exec(ctx, `DELETE FROM auth.attempt_limits
		 WHERE updated_at < now() - interval '1 day' AND (locked_until IS NULL OR locked_until < now())`); err != nil {
			s.log.Error("[attempt-limit] gagal memangkas", "error", err)
		}
	}
	return lock, nil
}

// clearPinFailures is clearFailures.
func (s *Service) clearPinFailures(ctx context.Context, shareID string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM auth.attempt_limits WHERE scope = $1 AND subject = $2`, domain.SharePinScope, "share:"+shareID)
	return err
}
