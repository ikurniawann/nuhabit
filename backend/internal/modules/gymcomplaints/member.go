package gymcomplaints

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcomplaints/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// Member app side: "Kirim masukan / Laporkan masalah", the member's own
// tickets with the replies they may read, and confirm or reopen.

// MemberTicket is a ticket as its member sees it: no internal notes, no
// staff names.
type MemberTicket struct {
	ID              string        `json:"id"`
	Code            string        `json:"code"`
	Category        string        `json:"category"`
	CategoryLabel   string        `json:"category_label"`
	Status          string        `json:"status"`
	Title           string        `json:"title"`
	Description     *string       `json:"description"`
	CoachName       *string       `json:"coach_name"`
	SessionName     *string       `json:"session_name"`
	SessionStartsAt *httpx.JSTime `json:"session_starts_at"`
	CreatedAt       httpx.JSTime  `json:"created_at"`
	UpdatedAt       httpx.JSTime  `json:"updated_at"`
	ResolvedAt      *httpx.JSTime `json:"resolved_at"`
}

func memberView(t Ticket) MemberTicket {
	return MemberTicket{ID: t.ID, Code: t.Code, Category: t.Category, CategoryLabel: t.CategoryLabel, Status: t.Status,
		Title: t.Title, Description: t.Description, CoachName: t.CoachName, SessionName: t.SessionName,
		SessionStartsAt: t.SessionStartsAt, CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt, ResolvedAt: t.ResolvedAt}
}

// MemberEvent is a public history entry: who wrote it is the member or
// the NüHabit team.
type MemberEvent struct {
	Kind      string       `json:"kind"`
	ToStatus  *string      `json:"to_status"`
	Body      *string      `json:"body"`
	ByMember  bool         `json:"by_member"`
	CreatedAt httpx.JSTime `json:"created_at"`
}

// MemberDetail is one of the member's tickets with its public history.
type MemberDetail struct {
	MemberTicket
	Events []MemberEvent `json:"events"`
}

// MyTickets lists a member's tickets, newest first.
func (s *Service) MyTickets(ctx context.Context, customerID string) ([]MemberTicket, error) {
	now := s.now()
	rows, err := s.db.Query(ctx, ticketSelect+` WHERE k.customer_id = $1 ORDER BY k.created_at DESC LIMIT 100`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (MemberTicket, error) {
		t, err := scanTicket(r, now)
		return memberView(t), err
	})
}

func (s *Service) memberTicket(ctx context.Context, q Q, customerID, id string) (*Ticket, error) {
	t, err := s.getTicket(ctx, q, id)
	if err != nil {
		return nil, err
	}
	if t.CustomerID == nil || *t.CustomerID != customerID {
		return nil, httpx.Coded(404, "COMPLAINT_NOT_FOUND", "Laporan tidak ditemukan", nil)
	}
	return t, nil
}

// MyTicket is one of the member's tickets with its public history.
func (s *Service) MyTicket(ctx context.Context, customerID, id string) (*MemberDetail, error) {
	t, err := s.memberTicket(ctx, s.db, customerID, id)
	if err != nil {
		return nil, err
	}
	events, err := listEvents(ctx, s.db, id, true)
	if err != nil {
		return nil, err
	}
	out := &MemberDetail{MemberTicket: memberView(*t), Events: make([]MemberEvent, len(events))}
	for i, e := range events {
		out.Events[i] = MemberEvent{Kind: e.Kind, ToStatus: e.ToStatus, Body: e.Body, ByMember: e.ByMember, CreatedAt: e.CreatedAt}
	}
	return out, nil
}

// RecentClass is a class the member booked lately, to pin a report on.
type RecentClass struct {
	SessionID string       `json:"session_id"`
	Name      string       `json:"name"`
	StartsAt  httpx.JSTime `json:"starts_at"`
	Timezone  string       `json:"timezone"`
	CoachID   *string      `json:"coach_id"`
	CoachName *string      `json:"coach_name"`
}

// MemberOptions are the categories and the member's classes of the last 30
// days for the report form.
type MemberOptions struct {
	Categories []Category    `json:"categories"`
	Classes    []RecentClass `json:"classes"`
}

func (s *Service) MemberOptions(ctx context.Context, customerID string) (MemberOptions, error) {
	cats, err := s.Categories(ctx, false)
	if err != nil {
		return MemberOptions{}, err
	}
	now := s.now()
	rows, err := s.db.Query(ctx, `SELECT s.id::text, ct.name, s.starts_at, COALESCE(br.timezone, 'Asia/Jakarta'), s.coach_id::text, co.name
	  FROM gym.bookings b
	  JOIN gym.class_sessions s ON s.id = b.session_id
	  JOIN gym.class_types ct ON ct.id = s.class_type_id
	  LEFT JOIN gym.coaches co ON co.id = s.coach_id
	  LEFT JOIN configuration.branches br ON br.id = s.branch_id
	 WHERE b.customer_id = $1 AND b.status IN ('confirmed', 'checked_in', 'completed', 'no_show')
	   AND s.starts_at BETWEEN $2 AND $3
	 ORDER BY s.starts_at DESC LIMIT 30`, customerID, now.AddDate(0, 0, -30), now.Add(24*time.Hour))
	if err != nil {
		return MemberOptions{}, err
	}
	classes, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (RecentClass, error) {
		var c RecentClass
		var at time.Time
		err := r.Scan(&c.SessionID, &c.Name, &at, &c.Timezone, &c.CoachID, &c.CoachName)
		c.StartsAt = httpx.JSTime(at)
		return c, err
	})
	return MemberOptions{Categories: cats, Classes: classes}, err
}

// MemberReport is the member app form. Kind "feedback" (a suggestion) is
// low priority; "problem" is normal.
type MemberReport struct {
	Kind      string  `json:"kind"`
	Category  string  `json:"category"`
	Title     string  `json:"title"`
	Message   string  `json:"message"`
	SessionID *string `json:"session_id"`
	CoachID   *string `json:"coach_id"`
}

// Submit opens a member_app ticket. The session must be one the member
// booked; at most MemberDailyLimit reports go in per 24 hours.
func (s *Service) Submit(ctx context.Context, customerID string, in MemberReport) (Created, error) {
	msg := strings.TrimSpace(in.Message)
	switch n := utf8.RuneCountInString(msg); {
	case n < domain.MemberMinLength:
		return Created{}, httpx.Coded(400, "FEEDBACK_TOO_SHORT", "Ceritakan sedikit lebih lengkap (minimal 10 karakter)",
			map[string]any{"min": domain.MemberMinLength})
	case n > domain.MemberMaxLength:
		return Created{}, httpx.Coded(400, "FEEDBACK_TOO_LONG", "Laporan terlalu panjang (maksimal 2000 karakter)",
			map[string]any{"max": domain.MemberMaxLength})
	}
	priority := domain.Normal
	switch in.Kind {
	case "feedback":
		priority = domain.Low
	case "problem", "":
	default:
		return Created{}, httpx.BadRequest("Jenis laporan tidak valid")
	}
	var out Created
	err := s.inTx(ctx, func(q Q) error {
		if _, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('gym.complaints:member:' || $1))`, customerID); err != nil {
			return err
		}
		var recent int
		if err := q.QueryRow(ctx, `SELECT count(*)::int FROM gym.complaints
		  WHERE customer_id = $1 AND source = 'member_app' AND created_at > $2`, customerID, s.now().Add(-24*time.Hour)).Scan(&recent); err != nil {
			return err
		}
		if recent >= domain.MemberDailyLimit {
			return httpx.Coded(429, "FEEDBACK_DAILY_LIMIT", "Batas laporan harian tercapai. Coba lagi besok.",
				map[string]any{"max": domain.MemberDailyLimit})
		}
		if in.SessionID != nil {
			var booked bool
			if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM gym.bookings WHERE customer_id = $1 AND session_id = $2)`,
				customerID, *in.SessionID).Scan(&booked); err != nil {
				return err
			}
			if !booked {
				return httpx.Coded(404, "SESSION_NOT_FOUND", "Kelas tidak ditemukan", nil)
			}
		}
		if in.CoachID != nil {
			var ok bool
			if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM gym.coaches WHERE id = $1 AND status = 'active')`, *in.CoachID).Scan(&ok); err != nil {
				return err
			}
			if !ok {
				return httpx.NotFound("Coach tidak ditemukan")
			}
		}
		var err error
		out, err = s.create(ctx, q, NewTicket{Source: domain.SourceMemberApp, Category: in.Category, Priority: string(priority),
			Title: in.Title, Description: msg, CustomerID: &customerID, SessionID: in.SessionID, CoachID: in.CoachID,
			by: memberActor(customerID)})
		if err != nil {
			return err
		}
		return s.newReportNotice(ctx, q, out)
	})
	return out, err
}

// newReportNotice tells the branch's escalation contact about a report from
// the member app in the staff inbox.
func (s *Service) newReportNotice(ctx context.Context, q Q, c Created) error {
	var branchID *string
	var title string
	if err := q.QueryRow(ctx, `SELECT branch_id::text, title FROM gym.complaints WHERE id = $1`, c.ID).Scan(&branchID, &title); err != nil {
		return err
	}
	st, err := loadSettings(ctx, q, branchID)
	if err != nil || st.EscalationUserID == nil {
		return err
	}
	return staffNotice(ctx, q, []string{*st.EscalationUserID}, "alert", "Laporan baru dari member app: "+c.Code, title,
		ticketLink(c.ID), map[string]any{"gym_type": "gym_complaint_new", "complaint_id": c.ID})
}

// MemberMove confirms or reopens a resolved ticket from the member app.
func (s *Service) MemberMove(ctx context.Context, customerID, id string, to domain.Status, reason string) error {
	return s.inTx(ctx, func(q Q) error {
		if _, err := s.memberTicket(ctx, q, customerID, id); err != nil {
			return err
		}
		t, err := s.lockTicket(ctx, q, id)
		if err != nil {
			return err
		}
		if domain.Status(t.Status) != domain.Resolved {
			return httpx.Coded(409, "FEEDBACK_NOT_RESOLVED", "Laporan ini belum ditandai selesai", nil)
		}
		return s.move(ctx, q, t, to, reason, memberActor(customerID))
	})
}

// ── Coach (Kelas Saya) ───────────────────────────────────────────────────────

// CoachTicket is a ticket linked to a coach, without the member's contact.
type CoachTicket struct {
	ID              string        `json:"id"`
	Code            string        `json:"code"`
	CategoryLabel   string        `json:"category_label"`
	Priority        string        `json:"priority"`
	Status          string        `json:"status"`
	Title           string        `json:"title"`
	Description     *string       `json:"description"`
	SessionName     *string       `json:"session_name"`
	SessionStartsAt *httpx.JSTime `json:"session_starts_at"`
	Timezone        string        `json:"timezone"`
	CreatedAt       httpx.JSTime  `json:"created_at"`
}

// CoachTickets is Kelas Saya's complaint section.
type CoachTickets struct {
	Coach   *CoachRef     `json:"coach"`
	Tickets []CoachTicket `json:"tickets"`
}

// CoachRef names a coach.
type CoachRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ForCoachUser lists the last 90 days of tickets linked to the coach of a
// staff account; Coach is nil when the account has no coach.
func (s *Service) ForCoachUser(ctx context.Context, userID string) (CoachTickets, error) {
	out := CoachTickets{Tickets: []CoachTicket{}}
	id, name, err := coachForUser(ctx, s.db, userID)
	if err != nil || id == "" {
		return out, err
	}
	out.Coach = &CoachRef{ID: id, Name: name}
	now := s.now()
	rows, err := s.db.Query(ctx, ticketSelect+` WHERE k.coach_id = $1 AND k.created_at > $2 ORDER BY k.created_at DESC LIMIT 50`,
		id, now.AddDate(0, 0, -90))
	if err != nil {
		return out, err
	}
	out.Tickets, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (CoachTicket, error) {
		t, err := scanTicket(r, now)
		return CoachTicket{ID: t.ID, Code: t.Code, CategoryLabel: t.CategoryLabel, Priority: t.Priority, Status: t.Status,
			Title: t.Title, Description: t.Description, SessionName: t.SessionName, SessionStartsAt: t.SessionStartsAt,
			Timezone: t.Timezone, CreatedAt: t.CreatedAt}, err
	})
	return out, err
}
