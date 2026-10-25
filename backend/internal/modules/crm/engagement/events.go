package engagement

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	eventsc "nuhabit/backend/internal/contracts/events"
	"nuhabit/backend/internal/modules/crm/engagement/domain"
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// listEvents lists every event, upcoming first, with attendee counts and
// the names of its branch, host coach and organiser.
func (h *handler) listEvents(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateEngagement); err != nil {
		return err
	}
	rows, err := kit.Query(r.Context(), h.db, `SELECT e.*, e.price_idr::float AS price_idr,
            br.name AS branch_name, co.name AS coach_name, u.full_name AS organiser_name,
            count(b.*) FILTER (WHERE b.status IN ('confirmed', 'attended'))::int AS confirmed_count,
            count(b.*) FILTER (WHERE b.status = 'waitlist')::int AS waitlist_count,
            count(b.*) FILTER (WHERE b.status = 'attended')::int AS attended_count
       FROM crm.events e
       LEFT JOIN crm.event_bookings b ON b.event_id = e.id
       LEFT JOIN configuration.branches br ON br.id = e.branch_id
       LEFT JOIN gym.coaches co ON co.id = e.coach_id
       LEFT JOIN configuration.users u ON u.id = e.organiser_user_id
      GROUP BY e.id, br.name, co.name, u.full_name
      ORDER BY (e.ends_at < now()), e.starts_at`)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

// savedEvent is the save response: the id and the calendar warnings
// (classes in the same branch at another room) staff should know about.
type savedEvent struct {
	ID       string          `json:"id"`
	Warnings []eventsc.Clash `json:"warnings"`
}

// saveEvent creates or updates an event; a cancelled event stays as it is.
// The calendar check blocks a room or coach clash unless the caller, with
// update on the engagement menu, sends override_reason; the override is
// recorded. Published events tell the involved staff about the change.
func (h *handler) saveEvent(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.Require(r, kit.GateEngagement)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	id := f.UUID("id", optional)
	title := f.Str("title", required, validate.StrOpts{Trim: true, Min: 3, Max: 120})
	description := f.StrDefault("description", "", validate.StrOpts{Max: 2000})
	host := f.Str("host_name", nullOpt, validate.StrOpts{Trim: true, Max: 120})
	location := f.Str("location", nullOpt, validate.StrOpts{Trim: true, Max: 160})
	starts, ends := datetime(f, "starts_at"), datetime(f, "ends_at")
	capacity := f.Int("capacity", required, bounds(1, 10_000))
	price := numDefault(f, "price_idr", 0, bounds(0, 100_000_000), false)
	closes := numDefault(f, "booking_closes_hours", 0, bounds(0, 720), true)
	deadline := numDefault(f, "cancel_deadline_hours", 2, bounds(0, 720), true)
	status := f.Enum("status", required, []string{"draft", "published"})
	branchID := f.UUID("branch_id", nullOpt)
	area := emptyToNil(f.Str("area", nullOpt, validate.StrOpts{Trim: true, Max: 80}))
	coachID := f.UUID("coach_id", nullOpt)
	organiser := f.UUID("organiser_user_id", nullOpt)
	overrideReason := emptyToNil(f.Str("override_reason", nullOpt, validate.StrOpts{Trim: true, Max: 500}))
	endsAfterStart(f, starts, ends)
	if err := kit.CrmInputErr(f); err != nil {
		return err
	}
	startsAt, _ := jsDate(starts)
	endsAt, _ := jsDate(ends)
	subject := eventsc.Subject{Source: eventsc.SourceCRM, Title: *title, BranchID: branchID, Area: area, CoachID: coachID,
		StartsAt: startsAt, EndsAt: endsAt}
	if id != nil {
		subject.ID = *id
	}
	ctx := r.Context()
	args := []any{*title, description, host, location, *starts, *ends, *capacity, price, int(closes), int(deadline), *status,
		branchID, area, coachID, organiser}
	var out savedEvent
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		report, override, err := h.guardCalendar(ctx, tx, user, subject, overrideReason)
		if err != nil {
			return err
		}
		out.Warnings = report.Warnings
		var previous *time.Time
		prevStatus := ""
		if id != nil {
			err = tx.QueryRow(ctx, `SELECT starts_at, status FROM crm.events WHERE id = $1 AND status <> 'cancelled' FOR UPDATE`, *id).
				Scan(&previous, &prevStatus)
			if database.IsNoRows(err) {
				return httpx.NotFound("Event tidak ditemukan atau sudah dibatalkan")
			}
			if err != nil {
				return err
			}
			err = tx.QueryRow(ctx, `UPDATE crm.events SET title=$1, description=$2, host_name=$3, location=$4,
                starts_at=$5::text::timestamptz, ends_at=$6::text::timestamptz,
                capacity=$7, price_idr=$8, booking_closes_hours=$9, cancel_deadline_hours=$10, status=$11,
                branch_id=$12, area=$13, coach_id=$14, organiser_user_id=$15, updated_at=now()
          WHERE id=$16 RETURNING id::text`, append(args, *id)...).Scan(&out.ID)
		} else {
			err = tx.QueryRow(ctx, `INSERT INTO crm.events (title, description, host_name, location, starts_at, ends_at, capacity,
                                 price_idr, booking_closes_hours, cancel_deadline_hours, status,
                                 branch_id, area, coach_id, organiser_user_id)
         VALUES ($1,$2,$3,$4,$5::text::timestamptz,$6::text::timestamptz,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id::text`, args...).Scan(&out.ID)
		}
		if err != nil {
			return err
		}
		subject.ID = out.ID
		if override != nil {
			if err := h.calendar.RecordOverride(ctx, tx, subject, *override, report); err != nil {
				return err
			}
		}
		if h.calendar == nil || (*status != "published" && prevStatus != "published") {
			return nil
		}
		change := eventsc.Change{Kind: eventsc.ChangeCreated, Subject: subject, OrganiserUserID: organiser, ActorUserID: user.ID, NotifyMembers: true}
		switch {
		case prevStatus == "published" && !previous.Equal(startsAt):
			change.Kind, change.PreviousStartsAt = eventsc.ChangeTimeChanged, previous
		case prevStatus == "published":
			change.Kind = eventsc.ChangeUpdated
		}
		return h.calendar.Notify(ctx, tx, change)
	})
	if err != nil {
		return err
	}
	return kit.OK(w, out)
}

// guardCalendar runs the conflict check under the timetable lock. A
// blocking clash is refused unless the caller sent a reason and holds
// update on the engagement menu; the override to record comes back.
func (h *handler) guardCalendar(ctx context.Context, q database.Querier, user *auth.User, subject eventsc.Subject, reason *string) (eventsc.Report, *eventsc.Override, error) {
	if h.calendar == nil {
		return eventsc.Report{}, nil, nil
	}
	if err := h.calendar.Lock(ctx, q); err != nil {
		return eventsc.Report{}, nil, err
	}
	report, err := h.calendar.Check(ctx, q, subject)
	if err != nil || !report.Blocked() {
		return report, nil, err
	}
	if reason == nil {
		return report, nil, report.Refusal()
	}
	allowed, err := h.guard.Auth.HasMenuAction(ctx, user, "update", iam.CrmEngagement...)
	if err != nil {
		return report, nil, err
	}
	if !allowed {
		return report, nil, httpx.Forbidden("Butuh izin mengubah event untuk tetap menyimpan jadwal yang bentrok")
	}
	return report, &eventsc.Override{UserID: user.ID, Reason: *reason}, nil
}

// numDefault is z.number()[.int()]….default(def).
func numDefault(f *validate.Form, key string, def float64, o validate.NumOpts, integer bool) float64 {
	o.Integer = integer
	if x := f.Num(key, withDef, o); x != nil {
		return *x
	}
	return def
}

// cancelEvent mirrors cancelEvent: every active booking is cancelled and its
// member notified; the body counts the notified members.
func (h *handler) cancelEvent(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.Require(r, kit.GateEngagement)
	if err != nil {
		return err
	}
	id := r.URL.Query().Get("id")
	if !validate.IsUUID(id) {
		return httpx.BadRequest("ID tidak valid")
	}
	ctx := r.Context()
	var sent notifications
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		var title string
		var startsAt, endsAt time.Time
		var branchID, area, coachID, organiser *string
		err := tx.QueryRow(ctx, `UPDATE crm.events SET status = 'cancelled', updated_at = now() WHERE id = $1
        RETURNING title, starts_at, ends_at, branch_id::text, area, coach_id::text, organiser_user_id::text`, id).
			Scan(&title, &startsAt, &endsAt, &branchID, &area, &coachID, &organiser)
		if database.IsNoRows(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if h.calendar != nil {
			// Members are told below, with the push the engagement area sends.
			subject := eventsc.Subject{Source: eventsc.SourceCRM, ID: id, Title: title, BranchID: branchID, Area: area, CoachID: coachID,
				StartsAt: startsAt, EndsAt: endsAt}
			change := eventsc.Change{Kind: eventsc.ChangeCancelled, Subject: subject, OrganiserUserID: organiser, ActorUserID: user.ID}
			if err := h.calendar.Notify(ctx, tx, change); err != nil {
				return err
			}
		}
		rows, err := tx.Query(ctx, `UPDATE crm.event_bookings SET status = 'cancelled', cancelled_at = now(), updated_at = now()
        WHERE event_id = $1 AND status IN ('confirmed', 'waitlist') RETURNING customer_id::text`, id)
		if err != nil {
			return err
		}
		customers, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		msg := domain.PushMessage{Type: "event_cancelled", Title: "Dibatalkan: " + title,
			Body: "Event " + domain.FormatWIB(startsAt) + " dibatalkan. Mohon maaf atas ketidaknyamanannya."}
		for _, c := range customers {
			if err := sent.notify(ctx, tx, c, msg); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	h.send(sent)
	return kit.OK(w, struct {
		Notified int `json:"notified"`
	}{len(sent)})
}

// listBookings lists an event's bookings: confirmed, waitlist, then the rest.
func (h *handler) listBookings(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateEngagement); err != nil {
		return err
	}
	eventID := r.URL.Query().Get("event_id")
	if !validate.IsUUID(eventID) {
		return httpx.BadRequest("ID event tidak valid")
	}
	rows, err := kit.Query(r.Context(), h.db, `SELECT b.id, b.status, b.waitlist_position, b.late_cancel, b.created_at, b.cancelled_at,
            c.name, c.phone
       FROM crm.event_bookings b JOIN pos.pos_customers c ON c.id = b.customer_id
      WHERE b.event_id = $1
      ORDER BY array_position(ARRAY['confirmed','attended','waitlist','no_show','cancelled'], b.status),
               b.waitlist_position NULLS LAST, b.created_at`, eventID)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

type bookingChanged struct {
	OK         bool `json:"ok"`
	LateCancel bool `json:"lateCancel"`
}

// changeBooking mirrors changeBooking for staff: mark attended or no-show,
// or cancel for the member. A seat released by a confirmed booking goes to
// the head of the waitlist.
func (h *handler) changeBooking(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateEngagement); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	bookingID := f.UUID("booking_id", required)
	next := f.Enum("status", required, []string{"attended", "no_show", "cancelled"})
	if err := kit.CrmInputErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	var sent notifications
	var result bookingChanged
	var refusal string
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		var eventID, status, title string
		var startsAt time.Time
		var deadlineHours int
		err := tx.QueryRow(ctx, `SELECT b.event_id::text, b.status, e.title, e.starts_at, e.cancel_deadline_hours
         FROM crm.event_bookings b JOIN crm.events e ON e.id = b.event_id
        WHERE b.id = $1 FOR UPDATE OF b`, *bookingID).Scan(&eventID, &status, &title, &startsAt, &deadlineHours)
		if database.IsNoRows(err) {
			refusal = "Booking tidak ditemukan"
			return nil
		}
		if err != nil {
			return err
		}
		if !domain.CanChangeBooking(status, *next) {
			refusal = "Status booking ini tidak bisa diubah lagi"
			return nil
		}
		released := *next == "cancelled" && status == "confirmed"
		late := released && domain.IsLateCancel(startsAt, deadlineHours, h.now())
		if _, err := tx.Exec(ctx, `UPDATE crm.event_bookings
          SET status = $2, late_cancel = $3, waitlist_position = NULL, updated_at = now(),
              cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END
        WHERE id = $1`, *bookingID, *next, late); err != nil {
			return err
		}
		if released {
			if err := promoteWaitlist(ctx, tx, &sent, eventID, title, startsAt); err != nil {
				return err
			}
		}
		result = bookingChanged{OK: true, LateCancel: late}
		return nil
	})
	if err != nil {
		return err
	}
	if refusal != "" {
		return httpx.Conflict(refusal)
	}
	h.send(sent)
	return kit.OK(w, result)
}

// promoteWaitlist gives a released seat to the head of the waitlist.
func promoteWaitlist(ctx context.Context, tx pgx.Tx, sent *notifications, eventID, title string, startsAt time.Time) error {
	rows, err := tx.Query(ctx, `SELECT id::text, customer_id::text, waitlist_position, created_at
       FROM crm.event_bookings WHERE event_id = $1 AND status = 'waitlist'`, eventID)
	if err != nil {
		return err
	}
	waiting, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.WaitlistEntry, error) {
		var e domain.WaitlistEntry
		err := row.Scan(&e.ID, &e.CustomerID, &e.Position, &e.CreatedAt)
		return e, err
	})
	if err != nil {
		return err
	}
	next := domain.PickWaitlistPromotion(waiting)
	if next == nil {
		return nil
	}
	if _, err := tx.Exec(ctx, `UPDATE crm.event_bookings SET status = 'confirmed', waitlist_position = NULL, updated_at = now() WHERE id = $1`,
		next.ID); err != nil {
		return err
	}
	return sent.notify(ctx, tx, next.CustomerID, domain.PushMessage{Type: "waitlist_promoted", Title: "Kursi tersedia: " + title,
		Body: "Anda naik dari waitlist dan sudah terdaftar untuk " + domain.FormatWIB(startsAt) + "."})
}
