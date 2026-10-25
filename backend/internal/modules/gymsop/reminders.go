package gymsop

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymsop/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// RemindResult counts one reminder round over the unread readers.
type RemindResult struct {
	Pending int `json:"pending"`
	Sent    int `json:"sent"`
	// Skipped were already reminded today (manual) or recently (job).
	Skipped int `json:"skipped"`
}

// unread is a reader who has not confirmed the latest version.
type unread struct {
	userID, name string
	phone        *string
	last         *time.Time
}

// round is the latest version of one document and its unread readers,
// read under the document lock so two rounds never remind twice.
type round struct {
	versionID, title string
	version          int
	publishedAt      time.Time
	remindAfterDays  int
	active           bool
	readers          []unread
}

func lockRound(ctx context.Context, tx pgx.Tx, id string) (*round, error) {
	r := round{}
	err := tx.QueryRow(ctx, `SELECT lv.id::text, lv.title, lv.version, lv.published_at, d.remind_after_days, d.is_active
	    FROM gym.sop_documents d `+latest+` WHERE d.id = $1 FOR UPDATE OF d`, id).
		Scan(&r.versionID, &r.title, &r.version, &r.publishedAt, &r.remindAfterDays, &r.active)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Dokumen SOP tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `SELECT rd.user_id::text, rd.name,
	    (SELECT e.phone FROM hris.employees e WHERE e.user_id = rd.user_id AND e.phone <> '' ORDER BY e.created_at LIMIT 1),
	    (SELECT max(m.sent_at) FROM gym.sop_reminders m WHERE m.version_id = $2 AND m.user_id = rd.user_id)
	  FROM gym.sop_documents d CROSS JOIN LATERAL `+readersOf+` rd
	 WHERE d.id = $1
	   AND NOT EXISTS (SELECT 1 FROM gym.sop_acknowledgements a WHERE a.version_id = $2 AND a.user_id = rd.user_id)
	 ORDER BY rd.name, rd.user_id`, id, r.versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var u unread
		if err := rows.Scan(&u.userID, &u.name, &u.phone, &u.last); err != nil {
			return nil, err
		}
		r.readers = append(r.readers, u)
	}
	return &r, rows.Err()
}

// whatsApp is a message to send after the round commits.
type whatsApp struct{ phone, title, body string }

// remind stores the reminder and the inbox notice of one reader.
func (r *round) remind(ctx context.Context, tx pgx.Tx, u unread, source string, by *string, now time.Time) (*whatsApp, error) {
	heading, body := domain.Reminder(u.name, r.title, r.version)
	if _, err := tx.Exec(ctx, `INSERT INTO gym.sop_reminders (version_id, user_id, source, sent_by, sent_at) VALUES ($1, $2, $3, $4, $5)`,
		r.versionID, u.userID, source, by, now); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO public.notifications (user_id, title, message, type, link, metadata, created_at)
	    VALUES ($1, $2, $3, 'reminder', $4, jsonb_build_object('gym_type', 'gym_sop_unread', 'sop_version_id', $5::text), $6)`,
		u.userID, heading, body, InboxLink, r.versionID, now); err != nil {
		return nil, err
	}
	if u.phone == nil {
		return nil, nil
	}
	return &whatsApp{phone: *u.phone, title: heading, body: body}, nil
}

func (s *Service) send(messages []whatsApp) {
	if s.msg == nil {
		return
	}
	for _, m := range messages {
		s.msg.WhatsApp(m.phone, m.title, m.body)
	}
}

// Remind reminds every unread reader of the SOP's latest version once a
// Jakarta day: the inbox always, WhatsApp when the reader has a phone.
func (s *Service) Remind(ctx context.Context, by Staff, id string) (RemindResult, error) {
	var out RemindResult
	var messages []whatsApp
	now := s.now()
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		r, err := lockRound(ctx, tx, id)
		if err != nil {
			return err
		}
		if !r.active {
			return httpx.Conflict("Dokumen SOP tidak aktif")
		}
		out.Pending = len(r.readers)
		for _, u := range r.readers {
			if domain.RemindedToday(u.last, now) {
				out.Skipped++
				continue
			}
			m, err := r.remind(ctx, tx, u, domain.SourceManual, &by.ID, now)
			if err != nil {
				return err
			}
			if m != nil {
				messages = append(messages, *m)
			}
			out.Sent++
		}
		return nil
	})
	if err != nil {
		return RemindResult{}, err
	}
	s.send(messages)
	return out, nil
}

// RemindOverdue is the gym-sop.reminders job: for each active SOP with
// automatic reminders, remind the unread readers domain.JobDue picks.
func (s *Service) RemindOverdue(ctx context.Context, now time.Time) error {
	rows, err := s.db.Query(ctx, `SELECT d.id::text FROM gym.sop_documents d `+latest+`
	  WHERE d.is_active AND d.remind_after_days > 0
	    AND lv.published_at <= $1::timestamptz - make_interval(days => d.remind_after_days)
	  ORDER BY d.id`, now)
	if err != nil {
		return err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	sent := 0
	for _, id := range ids {
		var messages []whatsApp
		err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
			r, err := lockRound(ctx, tx, id)
			if err != nil || !r.active {
				return err
			}
			for _, u := range r.readers {
				if !domain.JobDue(r.publishedAt, u.last, now, r.remindAfterDays) {
					continue
				}
				m, err := r.remind(ctx, tx, u, domain.SourceJob, nil, now)
				if err != nil {
					return err
				}
				if m != nil {
					messages = append(messages, *m)
				}
				sent++
			}
			return nil
		})
		if err != nil {
			return err
		}
		s.send(messages)
	}
	if sent > 0 {
		s.log.InfoContext(ctx, "[gym-sop] pengingat SOP terkirim", "readers", sent)
	}
	return nil
}
