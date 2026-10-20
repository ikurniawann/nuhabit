package gymscheduling

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/jobs"
	"nuhabit/backend/internal/platform/localtime"
)

// reminderKind is the platform.reminder_sends kind of class reminders.
const reminderKind = "gym_class_reminder"

// ReminderSession is an open session starting soon that has confirmed bookings.
type ReminderSession struct {
	ID            string
	BranchID      *string
	ClassTypeName string
	StartsAt      time.Time
	Zone          *time.Location
}

func (s ReminderSession) when() string { return localtime.Format(s.StartsAt, s.Zone) }

// ReminderBooking is a confirmed seat still owed a reminder.
type ReminderBooking struct {
	ID         string
	CustomerID string
}

// SendClassReminders notifies booked members classReminderMinutes (rule of
// the session's branch) before class. Members who turned off booking
// reminders in the member app are skipped; the sent log keeps a rerun from
// sending twice. One member's failure does not stop the others: the errors
// come back joined after the sweep.
func (s *Service) SendClassReminders(ctx context.Context, now time.Time) error {
	sessions, err := s.repo.ReminderSessions(ctx, s.db, now, now.Add(domain.ClassReminderHorizon))
	if err != nil {
		return err
	}
	rules := map[string]domain.Rules{}
	var errs []error
	for _, session := range sessions {
		key := ""
		if session.BranchID != nil {
			key = *session.BranchID
		}
		r, ok := rules[key]
		if !ok {
			if r, err = s.Rules.ForBranch(ctx, s.db, session.BranchID); err != nil {
				return err
			}
			rules[key] = r
		}
		if !domain.ClassReminderDue(session.StartsAt, now, r.ClassReminderMinutes) {
			continue
		}
		period := domain.ClassReminderPeriod(session.StartsAt)
		bookings, err := s.repo.ReminderBookings(ctx, s.db, session.ID, period)
		if err != nil {
			return err
		}
		for _, b := range bookings {
			if err := s.remind(ctx, session, b, period); err != nil {
				errs = append(errs, fmt.Errorf("booking %s: %w", b.ID, err))
			}
		}
	}
	return errors.Join(errs...)
}

// remind claims the sent-log row and writes the notification in one
// transaction, so a failed write leaves the reminder for the next run.
func (s *Service) remind(ctx context.Context, session ReminderSession, b ReminderBooking, period string) error {
	return s.inTx(ctx, func(q Q) error {
		claimed, err := jobs.ClaimSend(ctx, q, reminderKind, b.ID, period, &b.CustomerID)
		if err != nil || !claimed {
			return err
		}
		return s.Notifier.NotifyMember(ctx, q, b.CustomerID, Notification{
			Type:  "gym_class_reminder",
			Title: "Kelas segera dimulai: " + session.ClassTypeName,
			Body:  "Kelas mulai " + session.when() + ". Siapkan QR check-in di aplikasi.",
		})
	})
}

func (Postgres) ReminderSessions(ctx context.Context, q Q, from, to time.Time) ([]ReminderSession, error) {
	rows, err := q.Query(ctx, `
SELECT s.id, s.branch_id, t.name, s.starts_at, `+sessionZone+`
  FROM gym.class_sessions s
  JOIN gym.class_types t ON t.id = s.class_type_id
  LEFT JOIN configuration.branches br ON br.id = s.branch_id
 WHERE s.status IN ('published', 'full') AND s.starts_at > $1 AND s.starts_at <= $2
   AND EXISTS (SELECT 1 FROM gym.bookings b WHERE b.session_id = s.id AND b.status = 'confirmed')
 ORDER BY s.starts_at`, from, to)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ReminderSession, error) {
		var s ReminderSession
		var zone string
		err := r.Scan(&s.ID, &s.BranchID, &s.ClassTypeName, &s.StartsAt, &zone)
		s.Zone = localtime.Zone(zone)
		return s, err
	})
}

// ReminderBookings reads the member's booking_reminders switch from
// gym.athlete_settings (the member app settings, owned by the athlete
// module); no row means the default, on.
func (Postgres) ReminderBookings(ctx context.Context, q Q, sessionID, period string) ([]ReminderBooking, error) {
	rows, err := q.Query(ctx, `
SELECT b.id, b.customer_id
  FROM gym.bookings b
 WHERE b.session_id = $1 AND b.status = 'confirmed'
   AND NOT EXISTS (SELECT 1 FROM gym.athlete_settings a WHERE a.customer_id = b.customer_id AND NOT a.booking_reminders)
   AND NOT EXISTS (SELECT 1 FROM platform.reminder_sends r
                    WHERE r.kind = $2 AND r.subject_id = b.id::text AND r.period = $3)
 ORDER BY b.created_at`, sessionID, reminderKind, period)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[ReminderBooking])
}
