package mail

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Statuses of a platform.mail_log row.
const (
	StatusQueued = "queued"
	StatusSent   = "sent"
	StatusFailed = "failed"
)

// MaxAttempts is how many sends a retried message gets in all.
const MaxAttempts = 3

// backoff is the wait before attempt 2 and attempt 3.
var backoff = []time.Duration{time.Minute, 5 * time.Minute}

// Entry is one log row without the body.
type Entry struct {
	ID            string
	Kind          string
	To            string
	From          string
	FromName      *string
	Subject       string
	Provider      string
	Status        string
	Attempts      int
	MaxAttempts   int
	NextAttemptAt *time.Time
	Error         *string
	MessageID     *string
	SentAt        *time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// Summary counts the log by status.
type Summary struct {
	Sent, Queued, Failed int
}

// Filter narrows List.
type Filter struct {
	// Status is sent, queued, failed or "" for all.
	Status string
	// Search matches the recipient or subject.
	Search string
	Limit  int
}

const entryColumns = `id::text, kind, to_address, from_address, from_name, subject, provider, status, attempts, max_attempts,
	next_attempt_at, error, message_id, sent_at, created_at, updated_at`

func scanEntry(row pgx.CollectableRow) (Entry, error) {
	var e Entry
	err := row.Scan(&e.ID, &e.Kind, &e.To, &e.From, &e.FromName, &e.Subject, &e.Provider, &e.Status, &e.Attempts, &e.MaxAttempts,
		&e.NextAttemptAt, &e.Error, &e.MessageID, &e.SentAt, &e.CreatedAt, &e.UpdatedAt)
	return e, err
}

// List returns the newest rows matching f and the status counts of the
// whole log.
func (s *Service) List(ctx context.Context, f Filter) ([]Entry, Summary, error) {
	var args []any
	var where []string
	if f.Status == StatusSent || f.Status == StatusQueued || f.Status == StatusFailed {
		args = append(args, f.Status)
		where = append(where, fmt.Sprintf("status = $%d", len(args)))
	}
	if q := strings.TrimSpace(f.Search); q != "" {
		args = append(args, "%"+strings.NewReplacer("%", "", "_", "").Replace(q)+"%")
		where = append(where, fmt.Sprintf("(to_address ILIKE $%d OR subject ILIKE $%d)", len(args), len(args)))
	}
	filter := ""
	if len(where) > 0 {
		filter = "WHERE " + strings.Join(where, " AND ")
	}
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	args = append(args, limit)
	rows, err := s.db.Query(ctx, `SELECT `+entryColumns+` FROM platform.mail_log `+filter+
		fmt.Sprintf(` ORDER BY created_at DESC LIMIT $%d`, len(args)), args...)
	if err != nil {
		return nil, Summary{}, err
	}
	list, err := pgx.CollectRows(rows, scanEntry)
	if err != nil {
		return nil, Summary{}, err
	}
	if list == nil {
		list = []Entry{}
	}
	var sum Summary
	err = s.db.QueryRow(ctx, `SELECT COUNT(*) FILTER (WHERE status = 'sent')::int, COUNT(*) FILTER (WHERE status = 'queued')::int,
		COUNT(*) FILTER (WHERE status = 'failed')::int FROM platform.mail_log`).Scan(&sum.Sent, &sum.Queued, &sum.Failed)
	return list, sum, err
}

// Get returns one row, nil when missing.
func (s *Service) Get(ctx context.Context, id string) (*Entry, error) {
	rows, err := s.db.Query(ctx, `SELECT `+entryColumns+` FROM platform.mail_log WHERE id = $1`, id)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, scanEntry)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// insert logs a message before its first attempt and returns the row id.
func (s *Service) insert(ctx context.Context, m Message, provider string) (string, error) {
	var attachments []byte
	if len(m.Attachments) > 0 {
		var err error
		if attachments, err = json.Marshal(m.Attachments); err != nil {
			return "", err
		}
	}
	kind := m.Kind
	if kind == "" {
		kind = "generic"
	}
	maxAttempts := MaxAttempts
	if m.NoRetry {
		maxAttempts = 1
	}
	var id string
	err := s.db.QueryRow(ctx, `INSERT INTO platform.mail_log
		(kind, to_address, from_address, from_name, subject, body_html, attachments, provider, status, max_attempts, next_attempt_at, created_at, updated_at)
		VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, $8, 'queued', $9, $10, $10, $10) RETURNING id::text`,
		kind, m.To, m.From, m.FromName, m.Subject, m.HTML, attachments, provider, maxAttempts, s.now()).Scan(&id)
	return id, err
}

// message rebuilds the Message of a row for a retry or a resend.
func (s *Service) message(ctx context.Context, id string) (Message, error) {
	var m Message
	var fromName *string
	var attachments []byte
	err := s.db.QueryRow(ctx, `SELECT kind, to_address, from_address, from_name, subject, body_html, attachments
		FROM platform.mail_log WHERE id = $1`, id).Scan(&m.Kind, &m.To, &m.From, &fromName, &m.Subject, &m.HTML, &attachments)
	if err != nil {
		return m, err
	}
	if fromName != nil {
		m.FromName = *fromName
	}
	if len(attachments) > 0 {
		if err := json.Unmarshal(attachments, &m.Attachments); err != nil {
			return m, err
		}
	}
	return m, nil
}

// recordAttempt stores the outcome of one send and returns the row's new
// status. A transient failure with attempts left is queued again after the
// backoff; anything else is final.
func (s *Service) recordAttempt(ctx context.Context, id, provider, messageID string, sendErr error) (string, error) {
	now := s.now()
	if sendErr == nil {
		_, err := s.db.Exec(ctx, `UPDATE platform.mail_log SET status = 'sent', attempts = attempts + 1, provider = $2,
			message_id = $3, error = NULL, next_attempt_at = NULL, sent_at = $4, updated_at = $4 WHERE id = $1`,
			id, provider, messageID, now)
		return StatusSent, err
	}
	// Every SET expression sees the old attempts, so attempts + 1 is the
	// number just made; the wait before the next one is backoff[that - 1].
	waits := make([]float64, len(backoff))
	for i, d := range backoff {
		waits[i] = d.Seconds()
	}
	var status string
	err := s.db.QueryRow(ctx, `UPDATE platform.mail_log
		SET attempts = attempts + 1, provider = $2, error = $3, updated_at = $4,
		    status = CASE WHEN $5::boolean AND attempts + 1 < max_attempts THEN 'queued' ELSE 'failed' END,
		    next_attempt_at = CASE WHEN $5::boolean AND attempts + 1 < max_attempts
		        THEN $4::timestamptz + make_interval(secs => ($6::float8[])[LEAST(attempts + 1, cardinality($6::float8[]))]) END
		WHERE id = $1 RETURNING status`, id, provider, firstLine(sendErr.Error()), now, IsTransient(sendErr), waits).Scan(&status)
	return status, err
}

// due lists queued rows whose wait is over, oldest first.
func (s *Service) due(ctx context.Context, now time.Time, limit int) ([]string, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text FROM platform.mail_log
		WHERE status = 'queued' AND next_attempt_at IS NOT NULL AND next_attempt_at <= $1
		ORDER BY next_attempt_at LIMIT $2`, now, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// reopen puts a final row back to queued for a manual resend.
func (s *Service) reopen(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, `UPDATE platform.mail_log SET status = 'queued', max_attempts = attempts + 1, next_attempt_at = NULL,
		updated_at = $2 WHERE id = $1`, id, s.now())
	return err
}
