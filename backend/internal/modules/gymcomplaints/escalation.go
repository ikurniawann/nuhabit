package gymcomplaints

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcomplaints/domain"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/whatsapp"
)

// overdue is an open ticket past a deadline it has not escalated for.
type overdue struct {
	id, code, title, category, priority string
	branchID                            *string
	timezone                            string
	reporter, coach                     *string
	ownerID, ownerName, ownerPhone      *string
	clock                               domain.Clock
}

// alert is one claimed escalation, sent after the claim commits.
type alert struct {
	phones []string
	text   string
}

// Escalate runs from the "gym-complaints.escalate" job. Each open ticket
// past its respond or resolve deadline escalates once per deadline: a
// staff inbox SLA alert to the branch's head coach or ops user and to the
// owner, and WhatsApp to the escalation phone (or that user's employee
// phone) and the owner. Outside the branch's working window only high and
// urgent tickets go out; the rest wait for the morning. The claim column
// is stamped in the same transaction as the inbox rows and the history
// entry, so a second run or a second process sends nothing.
func (s *Service) Escalate(ctx context.Context, now time.Time) error {
	rows, err := s.db.Query(ctx, `SELECT k.id::text, k.code, k.title, cat.label, k.priority, k.branch_id::text,
	       COALESCE(br.timezone, 'Asia/Jakarta'), COALESCE(c.name, k.contact_name), co.name,
	       k.owner_user_id::text, ou.full_name,
	       (SELECT e.phone FROM hris.employees e WHERE e.user_id = k.owner_user_id AND e.is_active LIMIT 1),
	       k.status, k.respond_by, k.resolve_by, k.first_response_at, k.respond_escalated_at, k.resolve_escalated_at
	  FROM gym.complaints k
	  JOIN gym.complaint_categories cat ON cat.code = k.category
	  LEFT JOIN configuration.branches br ON br.id = k.branch_id
	  LEFT JOIN pos.pos_customers c ON c.id = k.customer_id
	  LEFT JOIN gym.coaches co ON co.id = k.coach_id
	  LEFT JOIN configuration.users ou ON ou.id = k.owner_user_id
	 WHERE k.status IN ('received', 'in_progress', 'reopened')
	   AND ((k.resolve_escalated_at IS NULL AND k.resolve_by < $1)
	     OR (k.first_response_at IS NULL AND k.respond_escalated_at IS NULL AND k.respond_by < $1))
	 ORDER BY k.resolve_by
	 LIMIT 200`, now)
	if err != nil {
		return err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (overdue, error) {
		var o overdue
		var status string
		err := r.Scan(&o.id, &o.code, &o.title, &o.category, &o.priority, &o.branchID, &o.timezone, &o.reporter, &o.coach,
			&o.ownerID, &o.ownerName, &o.ownerPhone,
			&status, &o.clock.RespondBy, &o.clock.ResolveBy, &o.clock.FirstResponseAt, &o.clock.RespondEscalatedAt, &o.clock.ResolveEscalatedAt)
		o.clock.Status = domain.Status(status)
		return o, err
	})
	if err != nil {
		return err
	}
	settings := map[string]Settings{}
	escalated, held := 0, 0
	for _, o := range list {
		key := deref(o.branchID)
		st, ok := settings[key]
		if !ok {
			if st, err = loadSettings(ctx, s.db, o.branchID); err != nil {
				return err
			}
			settings[key] = st
		}
		kind := o.clock.Due(now)
		if kind == "" {
			continue
		}
		zone := localtime.Zone(o.timezone)
		if !domain.SendableNow(now, domain.Priority(o.priority), st.window(), zone) {
			held++
			continue
		}
		var a *alert
		err := s.inTx(ctx, func(q Q) error {
			var err error
			a, err = s.claim(ctx, q, o, kind, st, zone, now)
			return err
		})
		if err != nil {
			return err
		}
		if a == nil {
			continue
		}
		escalated++
		if s.ports.WhatsApp != nil {
			for _, phone := range a.phones {
				if !s.ports.WhatsApp.SendWhatsApp(ctx, phone, a.text) {
					s.log.Warn("[gym-complaints] WhatsApp eskalasi gagal", "complaint", o.code, "phone", phone)
				}
			}
		}
	}
	if escalated > 0 || held > 0 {
		s.log.Info("[gym-complaints] eskalasi", "escalated", escalated, "held", held)
	}
	return nil
}

// claim stamps the escalation, writes the inbox alerts and the history
// entry, and returns the WhatsApp to send; nil when another run claimed it.
// A resolve escalation also closes a pending respond one, so a ticket that
// missed both gets one message.
func (s *Service) claim(ctx context.Context, q Q, o overdue, kind domain.Escalation, st Settings, zone *time.Location, now time.Time) (*alert, error) {
	sql := `UPDATE gym.complaints SET respond_escalated_at = $2 WHERE id = $1 AND respond_escalated_at IS NULL RETURNING id`
	deadline := o.clock.RespondBy
	if kind == domain.EscalateResolve {
		sql = `UPDATE gym.complaints SET resolve_escalated_at = $2,
		    respond_escalated_at = CASE WHEN first_response_at IS NULL THEN COALESCE(respond_escalated_at, $2) ELSE respond_escalated_at END
		  WHERE id = $1 AND resolve_escalated_at IS NULL RETURNING id`
		deadline = o.clock.ResolveBy
	}
	var id string
	if err := q.QueryRow(ctx, sql, o.id, now).Scan(&id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	link := ticketLink(o.id)
	text := domain.AlertMessage(domain.AlertInput{Kind: kind, Code: o.code, Title: o.title, Category: o.category,
		Priority: domain.Priority(o.priority), Reporter: deref(o.reporter), Coach: deref(o.coach), Owner: deref(o.ownerName),
		Deadline: deadline, Zone: zone, Link: s.ports.AppOrigin + link})
	users := []string{deref(st.EscalationUserID), deref(o.ownerID)}
	title := domain.AlertTitle(kind, o.code)
	if err := staffNotice(ctx, q, users, "alert", title, o.title, link,
		map[string]any{"gym_type": "gym_complaint_sla", "complaint_id": o.id, "kind": string(kind)}); err != nil {
		return nil, err
	}

	escalationPhone := st.EscalationPhone
	if escalationPhone == nil && st.EscalationUserID != nil {
		var phone *string
		if err := q.QueryRow(ctx, `SELECT phone FROM hris.employees WHERE user_id = $1 AND is_active LIMIT 1`,
			*st.EscalationUserID).Scan(&phone); err != nil && err != pgx.ErrNoRows {
			return nil, err
		}
		escalationPhone = phone
	}
	var phones []string
	for _, p := range []*string{escalationPhone, o.ownerPhone} {
		if n := whatsapp.NormalizeRecipient(deref(p)); n != "" && !contains(phones, n) {
			phones = append(phones, n)
		}
	}
	if s.ports.WhatsApp == nil {
		phones = nil
	}
	limit := "respons"
	if kind == domain.EscalateResolve {
		limit = "selesai"
	}
	body := fmt.Sprintf("Lewat batas %s. Notifikasi ke %d staf, WhatsApp ke %d nomor.", limit, countIDs(users), len(phones))
	if err := addEvent(ctx, q, o.id, "escalated", nil, nil, &body, false, actor{}); err != nil {
		return nil, err
	}
	return &alert{phones: phones, text: text}, nil
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// countIDs counts the distinct non-empty ids.
func countIDs(ids []string) int {
	var seen []string
	for _, id := range ids {
		if id != "" && !contains(seen, id) {
			seen = append(seen, id)
		}
	}
	return len(seen)
}
