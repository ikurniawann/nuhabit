package gymcoaching

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcoaching/domain"
	"nuhabit/backend/internal/platform/jobs"
	"nuhabit/backend/internal/platform/localtime"
)

// reminderKind is the platform.reminder_sends kind of PT reminders.
const reminderKind = "gym_pt_reminder"

// reminderHorizon is the furthest ahead a reminder can be due: the largest
// classReminderMinutes rule (7 days).
const reminderHorizon = 7 * 24 * time.Hour

type reminderRow struct {
	ParticipantID string
	CustomerID    string
	BranchID      *string
	ClassTypeName string
	CoachName     string
	StartsAt      time.Time
	Timezone      string
}

// SendReminders notifies members of a confirmed PT session the
// classReminderMinutes rule of its branch before it starts. Members who
// turned booking reminders off are skipped, and the sent log keeps a rerun
// from sending twice. One member's failure does not stop the others.
func (s *Service) SendReminders(ctx context.Context, now time.Time) error {
	rows, err := s.db.Query(ctx, `
SELECT p.id::text, p.customer_id::text, a.branch_id::text, t.name, c.name, a.starts_at,
       COALESCE(b.timezone, 'Asia/Jakarta')
  FROM gym.pt_appointments a
  JOIN gym.pt_participants p ON p.appointment_id = a.id AND p.status = 'confirmed'
  JOIN gym.class_types t ON t.id = a.class_type_id
  JOIN gym.coaches c ON c.id = a.coach_id
  LEFT JOIN configuration.branches b ON b.id = a.branch_id
 WHERE a.status = 'confirmed' AND a.starts_at > $1 AND a.starts_at <= $2
   AND NOT EXISTS (SELECT 1 FROM gym.athlete_settings x WHERE x.customer_id = p.customer_id AND NOT x.booking_reminders)
 ORDER BY a.starts_at`, now, now.Add(reminderHorizon))
	if err != nil {
		return err
	}
	due, err := pgx.CollectRows(rows, pgx.RowToStructByPos[reminderRow])
	if err != nil {
		return err
	}
	rules := s.branchRules(s.db)
	var errs []error
	for _, r := range due {
		rs, err := rules(ctx, r.BranchID)
		if err != nil {
			return err
		}
		if !domain.ReminderDue(r.StartsAt, now, rs.ReminderMinutes) {
			continue
		}
		if err := s.remind(ctx, r); err != nil {
			errs = append(errs, fmt.Errorf("participant %s: %w", r.ParticipantID, err))
		}
	}
	return errors.Join(errs...)
}

// remind claims the sent-log row and writes the notification in one
// transaction, so a failed write leaves the reminder for the next run.
func (s *Service) remind(ctx context.Context, r reminderRow) error {
	return s.inTx(ctx, func(q Q) error {
		claimed, err := jobs.ClaimSend(ctx, q, reminderKind, r.ParticipantID, domain.ReminderPeriod(r.StartsAt), &r.CustomerID)
		if err != nil || !claimed {
			return err
		}
		return s.ports.Notifier.NotifyMember(ctx, q, r.CustomerID, Notification{
			Type:  "gym_pt_reminder",
			Title: "Sesi PT segera dimulai",
			Body:  r.ClassTypeName + " bersama " + r.CoachName + " mulai " + localtime.Format(r.StartsAt, localtime.Zone(r.Timezone)) + ".",
		})
	})
}
