package payroll

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/jobs"
	"nuhabit/backend/internal/platform/localtime"
)

// Background jobs of department tasks: occurrence generation when a period
// starts, and the staff reminders.

// MaterializeOccurrences creates the occurrences of every department's
// active tasks for yesterday, today and tomorrow in every branch zone, so
// a daily task exists each morning whether or not anyone opened the page.
// (task, date) is unique, so a rerun creates nothing.
func (s *service) MaterializeOccurrences(ctx context.Context, now time.Time) error {
	rows, err := s.db.Query(ctx, `SELECT DISTINCT department_id::text FROM hris.department_tasks WHERE is_active`)
	if err != nil {
		return err
	}
	depts, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	// Jakarta's yesterday to Jayapura's tomorrow covers every zone's today.
	start := localtime.DayKey(now.AddDate(0, 0, -1), localtime.Jakarta)
	end := localtime.DayKey(now.AddDate(0, 0, 1), localtime.Zone("Asia/Jayapura"))
	var errs []error
	for _, d := range depts {
		if err := s.ensureOccurrences(ctx, d, start, end); err != nil {
			errs = append(errs, fmt.Errorf("department %s: %w", d, err))
		}
	}
	return errors.Join(errs...)
}

const (
	digestKind  = "dept_tasks_digest"
	overdueKind = "dept_tasks_overdue"
	// TasksInboxLink is the page a task notice opens.
	TasksInboxLink = "/dashboard/tasks"
	digestLines    = 5
)

type recipient struct {
	UserID     string
	EmployeeID string
	Name       string
	Email      *string
	Phone      *string
	Timezone   string
}

// SendReminders sends each assignee with open occurrences the morning
// digest (today's rows, overdue first) once 07.00 has passed in their
// branch zone, and an afternoon notice of what is still overdue after
// 16.00. The sent log (platform.reminder_sends) keeps a rerun from
// sending twice; WhatsApp and email follow the inbox row, best effort.
func (s *service) SendReminders(ctx context.Context, now time.Time) error {
	rows, err := s.db.Query(ctx, `
SELECT u.id::text, e.id::text, e.full_name, COALESCE(NULLIF(e.email, ''), u.email), NULLIF(e.phone, ''), COALESCE(b.timezone, 'Asia/Jakarta')
  FROM hris.employees e
  JOIN configuration.users u ON u.id = e.user_id AND u.status = 'active'
  LEFT JOIN configuration.branches b ON b.id = u.branch_id
 WHERE e.is_active AND EXISTS (
       SELECT 1 FROM hris.department_task_occurrences o JOIN hris.department_tasks t ON t.id = o.task_id
        WHERE t.assignee_employee_id = e.id AND t.is_active AND o.status IN ('pending', 'in_progress', 'rejected'))
 ORDER BY e.id`)
	if err != nil {
		return err
	}
	people, err := pgx.CollectRows(rows, pgx.RowToStructByPos[recipient])
	if err != nil {
		return err
	}
	var errs []error
	for _, p := range people {
		zone := localtime.Zone(p.Timezone)
		day := localtime.DayKey(now, zone)
		if domain.ReminderDue(now, domain.DigestHour, zone) {
			if err := s.remind(ctx, p, digestKind, day, false); err != nil {
				errs = append(errs, fmt.Errorf("digest %s: %w", p.EmployeeID, err))
			}
		}
		if domain.ReminderDue(now, domain.OverdueHour, zone) {
			if err := s.remind(ctx, p, overdueKind, day, true); err != nil {
				errs = append(errs, fmt.Errorf("overdue %s: %w", p.EmployeeID, err))
			}
		}
	}
	return errors.Join(errs...)
}

// remind claims the sent-log row and writes the inbox notice in one
// transaction; the other channels follow once it is committed.
func (s *service) remind(ctx context.Context, p recipient, kind, day string, overdueOnly bool) error {
	var title, body string
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		claimed, err := jobs.ClaimSend(ctx, tx, kind, p.EmployeeID, day, nil)
		if err != nil || !claimed {
			return err
		}
		cmp := "<="
		if overdueOnly {
			cmp = "<"
		}
		rows, err := tx.Query(ctx, `SELECT t.title, o.occurrence_date::text, t.priority
			  FROM hris.department_task_occurrences o JOIN hris.department_tasks t ON t.id = o.task_id
			 WHERE t.assignee_employee_id = $1 AND t.is_active AND o.status IN ('pending', 'in_progress', 'rejected')
			   AND o.occurrence_date `+cmp+` $2::date
			 ORDER BY o.occurrence_date, array_position(ARRAY['urgent','high','normal','low'], t.priority), t.created_at`, p.EmployeeID, day)
		if err != nil {
			return err
		}
		type line struct{ Title, Date, Priority string }
		due, err := pgx.CollectRows(rows, pgx.RowToStructByPos[line])
		if err != nil || len(due) == 0 {
			return err
		}
		titles, overdue := make([]string, len(due)), 0
		for i, d := range due {
			titles[i] = d.Title
			if d.Date < day {
				overdue++
			}
		}
		title, body = composeNotice(titles, overdue, overdueOnly)
		return inboxNotice(ctx, tx, p.UserID, title, body, TasksInboxLink, kind)
	})
	if err == nil && title != "" {
		s.ports.TaskChannels.SendTo(p.Phone, p.Email, title, body)
	}
	return err
}

// composeNotice writes the digest or overdue text; titles arrive overdue
// first, so the first `overdue` of them are marked.
func composeNotice(titles []string, overdue int, overdueOnly bool) (title, body string) {
	var lines []string
	for i, t := range titles {
		if i == digestLines {
			lines = append(lines, fmt.Sprintf("… dan %d tugas lagi", len(titles)-digestLines))
			break
		}
		mark := ""
		if i < overdue && !overdueOnly {
			mark = " (terlambat)"
		}
		lines = append(lines, "• "+t+mark)
	}
	if overdueOnly {
		return fmt.Sprintf("%d tugas terlambat", len(titles)), "Masih terbuka dan lewat jatuh tempo:\n" + strings.Join(lines, "\n")
	}
	title = fmt.Sprintf("Tugas hari ini: %d", len(titles))
	if overdue > 0 {
		title += fmt.Sprintf(" (%d terlambat)", overdue)
	}
	return title, strings.Join(lines, "\n")
}
