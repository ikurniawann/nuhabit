package gymcomplaints

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcomplaints/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/members"
)

// Ticket is a complaint ticket with the names of what it links to.
type Ticket struct {
	ID              string        `json:"id"`
	Code            string        `json:"code"`
	Source          string        `json:"source"`
	Category        string        `json:"category"`
	CategoryLabel   string        `json:"category_label"`
	Priority        string        `json:"priority"`
	Status          string        `json:"status"`
	Title           string        `json:"title"`
	Description     *string       `json:"description"`
	CustomerID      *string       `json:"customer_id"`
	MemberName      *string       `json:"member_name"`
	MemberPhone     *string       `json:"member_phone"`
	ContactName     *string       `json:"contact_name"`
	ContactPhone    *string       `json:"contact_phone"`
	CoachID         *string       `json:"coach_id"`
	CoachName       *string       `json:"coach_name"`
	SessionID       *string       `json:"session_id"`
	SessionName     *string       `json:"session_name"`
	SessionStartsAt *httpx.JSTime `json:"session_starts_at"`
	BranchID        *string       `json:"branch_id"`
	BranchName      *string       `json:"branch_name"`
	Timezone        string        `json:"timezone"`
	ConversationID  *string       `json:"conversation_id"`
	OwnerUserID     *string       `json:"owner_user_id"`
	OwnerName       *string       `json:"owner_name"`
	RespondBy       httpx.JSTime  `json:"respond_by"`
	ResolveBy       httpx.JSTime  `json:"resolve_by"`
	FirstResponseAt *httpx.JSTime `json:"first_response_at"`
	ResolvedAt      *httpx.JSTime `json:"resolved_at"`
	ConfirmedAt     *httpx.JSTime `json:"confirmed_at"`
	ReopenCount     int           `json:"reopen_count"`
	Overdue         bool          `json:"overdue"`
	Escalated       bool          `json:"escalated"`
	CreatedByName   *string       `json:"created_by_name"`
	CreatedAt       httpx.JSTime  `json:"created_at"`
	UpdatedAt       httpx.JSTime  `json:"updated_at"`
}

const ticketSelect = `SELECT k.id::text, k.code, k.source, k.category, cat.label, k.priority, k.status, k.title, k.description,
       k.customer_id::text, c.name, c.phone, k.contact_name, k.contact_phone,
       k.coach_id::text, co.name, k.session_id::text, ct.name, s.starts_at,
       k.branch_id::text, br.name, COALESCE(br.timezone, 'Asia/Jakarta'),
       k.conversation_id::text, k.owner_user_id::text, ou.full_name,
       k.respond_by, k.resolve_by, k.first_response_at, k.resolved_at, k.confirmed_at, k.reopen_count,
       k.respond_escalated_at, k.resolve_escalated_at, cu.full_name, k.created_at, k.updated_at
  FROM gym.complaints k
  JOIN gym.complaint_categories cat ON cat.code = k.category
  LEFT JOIN pos.pos_customers c ON c.id = k.customer_id
  LEFT JOIN gym.coaches co ON co.id = k.coach_id
  LEFT JOIN gym.class_sessions s ON s.id = k.session_id
  LEFT JOIN gym.class_types ct ON ct.id = s.class_type_id
  LEFT JOIN configuration.branches br ON br.id = k.branch_id
  LEFT JOIN configuration.users ou ON ou.id = k.owner_user_id
  LEFT JOIN configuration.users cu ON cu.id = k.created_by`

func scanTicket(row pgx.Row, now time.Time) (Ticket, error) {
	var t Ticket
	var sessionAt, firstResponse, resolved, confirmed, respondEsc, resolveEsc *time.Time
	var respondBy, resolveBy, created, updated time.Time
	err := row.Scan(&t.ID, &t.Code, &t.Source, &t.Category, &t.CategoryLabel, &t.Priority, &t.Status, &t.Title, &t.Description,
		&t.CustomerID, &t.MemberName, &t.MemberPhone, &t.ContactName, &t.ContactPhone,
		&t.CoachID, &t.CoachName, &t.SessionID, &t.SessionName, &sessionAt,
		&t.BranchID, &t.BranchName, &t.Timezone,
		&t.ConversationID, &t.OwnerUserID, &t.OwnerName,
		&respondBy, &resolveBy, &firstResponse, &resolved, &confirmed, &t.ReopenCount,
		&respondEsc, &resolveEsc, &t.CreatedByName, &created, &updated)
	if err != nil {
		return t, err
	}
	t.SessionStartsAt = httpx.NewJSTime(sessionAt)
	t.RespondBy, t.ResolveBy = httpx.JSTime(respondBy), httpx.JSTime(resolveBy)
	t.FirstResponseAt, t.ResolvedAt, t.ConfirmedAt = httpx.NewJSTime(firstResponse), httpx.NewJSTime(resolved), httpx.NewJSTime(confirmed)
	t.CreatedAt, t.UpdatedAt = httpx.JSTime(created), httpx.JSTime(updated)
	clock := domain.Clock{Status: domain.Status(t.Status), RespondBy: respondBy, ResolveBy: resolveBy,
		FirstResponseAt: firstResponse, RespondEscalatedAt: respondEsc, ResolveEscalatedAt: resolveEsc}
	t.Overdue = clock.Overdue(now)
	t.Escalated = respondEsc != nil || resolveEsc != nil
	return t, nil
}

func (s *Service) getTicket(ctx context.Context, q Q, id string) (*Ticket, error) {
	t, err := scanTicket(q.QueryRow(ctx, ticketSelect+` WHERE k.id = $1`, id), s.now())
	if database.IsNoRows(err) {
		return nil, httpx.Coded(404, "COMPLAINT_NOT_FOUND", "Tiket keluhan tidak ditemukan", nil)
	}
	return &t, err
}

// ── List ─────────────────────────────────────────────────────────────────────

// Filter narrows the ticket list. Status "open" is every status the SLA
// clock runs in; "active" is everything not confirmed.
type Filter struct {
	Status, Category, Priority, Source string
	BranchID, CoachID, CustomerID      string
	OwnerUserID                        string
	Overdue                            bool
	Search                             string
	Limit, Offset                      int
}

// Page is one page of tickets with the count per status of the whole filter.
type Page struct {
	Rows   []Ticket       `json:"rows"`
	Total  int            `json:"total"`
	Counts map[string]int `json:"counts"`
}

func (s *Service) List(ctx context.Context, f Filter) (Page, error) {
	now := s.now()
	var where []string
	var args []any
	arg := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }
	eq := func(col, v string) {
		if v != "" {
			where = append(where, col+" = "+arg(v))
		}
	}
	eq("k.category", f.Category)
	eq("k.priority", f.Priority)
	eq("k.source", f.Source)
	eq("k.branch_id", f.BranchID)
	eq("k.coach_id", f.CoachID)
	eq("k.customer_id", f.CustomerID)
	eq("k.owner_user_id", f.OwnerUserID)
	if f.Search != "" {
		p := arg("%" + f.Search + "%")
		where = append(where, fmt.Sprintf("(k.code ILIKE %[1]s OR k.title ILIKE %[1]s OR c.name ILIKE %[1]s OR k.contact_name ILIKE %[1]s OR c.phone ILIKE %[1]s)", p))
	}
	if f.Overdue {
		n := arg(now)
		where = append(where, fmt.Sprintf(`k.status IN ('received','in_progress','reopened')
		  AND (k.resolve_by < %[1]s OR (k.first_response_at IS NULL AND k.respond_by < %[1]s))`, n))
	}
	// Counts ignore the status filter so the tabs keep their numbers.
	base := ""
	if len(where) > 0 {
		base = " WHERE " + strings.Join(where, " AND ")
	}
	out := Page{Rows: []Ticket{}, Counts: map[string]int{}}
	rows, err := s.db.Query(ctx, `SELECT k.status, count(*)::int FROM gym.complaints k
	  LEFT JOIN pos.pos_customers c ON c.id = k.customer_id`+base+` GROUP BY k.status`, args...)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err != nil {
			rows.Close()
			return out, err
		}
		out.Counts[st] = n
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}

	switch f.Status {
	case "":
	case "open":
		where = append(where, "k.status IN ('received','in_progress','reopened')")
	case "active":
		where = append(where, "k.status <> 'confirmed'")
	default:
		where = append(where, "k.status = "+arg(f.Status))
	}
	filter := ""
	if len(where) > 0 {
		filter = " WHERE " + strings.Join(where, " AND ")
	}
	if err := s.db.QueryRow(ctx, `SELECT count(*)::int FROM gym.complaints k
	  LEFT JOIN pos.pos_customers c ON c.id = k.customer_id`+filter, args...).Scan(&out.Total); err != nil {
		return out, err
	}
	limit, offset := arg(f.Limit), arg(f.Offset)
	rows, err = s.db.Query(ctx, ticketSelect+filter+`
	  ORDER BY CASE WHEN k.status IN ('received','in_progress','reopened') THEN 0 WHEN k.status = 'resolved' THEN 1 ELSE 2 END,
	           CASE k.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
	           k.resolve_by, k.created_at DESC
	  LIMIT `+limit+` OFFSET `+offset, args...)
	if err != nil {
		return out, err
	}
	out.Rows, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Ticket, error) { return scanTicket(r, now) })
	return out, err
}

// ── Detail ───────────────────────────────────────────────────────────────────

// Event is one history entry.
type Event struct {
	ID         string       `json:"id"`
	Kind       string       `json:"kind"`
	FromStatus *string      `json:"from_status"`
	ToStatus   *string      `json:"to_status"`
	Body       *string      `json:"body"`
	IsPublic   bool         `json:"is_public"`
	ActorName  *string      `json:"actor_name"`
	ByMember   bool         `json:"by_member"`
	CreatedAt  httpx.JSTime `json:"created_at"`
}

// Detail is a ticket with its history and the moves staff can make.
type Detail struct {
	Ticket
	Events []Event         `json:"events"`
	Next   []domain.Status `json:"next_statuses"`
}

func (s *Service) Get(ctx context.Context, id string) (*Detail, error) {
	t, err := s.getTicket(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	events, err := listEvents(ctx, s.db, id, false)
	if err != nil {
		return nil, err
	}
	return &Detail{Ticket: *t, Events: events, Next: domain.NextStatuses(domain.Status(t.Status))}, nil
}

func listEvents(ctx context.Context, q Q, id string, publicOnly bool) ([]Event, error) {
	rows, err := q.Query(ctx, `SELECT e.id::text, e.kind, e.from_status, e.to_status, e.body, e.is_public,
	       COALESCE(u.full_name, c.name), e.actor_customer_id IS NOT NULL, e.created_at
	  FROM gym.complaint_events e
	  LEFT JOIN configuration.users u ON u.id = e.actor_user_id
	  LEFT JOIN pos.pos_customers c ON c.id = e.actor_customer_id
	 WHERE e.complaint_id = $1 AND (e.is_public OR NOT $2)
	 ORDER BY e.created_at, e.id`, id, publicOnly)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Event, error) {
		var e Event
		var at time.Time
		err := r.Scan(&e.ID, &e.Kind, &e.FromStatus, &e.ToStatus, &e.Body, &e.IsPublic, &e.ActorName, &e.ByMember, &at)
		e.CreatedAt = httpx.JSTime(at)
		return e, err
	})
}

// actor is who writes an event: a staff user or the member.
type actor struct {
	userID, customerID *string
}

func staffActor(userID string) actor { return actor{userID: &userID} }
func memberActor(id string) actor    { return actor{customerID: &id} }

func (a actor) role() domain.Actor {
	if a.customerID != nil {
		return domain.Member
	}
	return domain.Staff
}

func addEvent(ctx context.Context, q Q, id, kind string, from, to *string, body *string, public bool, a actor) error {
	_, err := q.Exec(ctx, `INSERT INTO gym.complaint_events (complaint_id, kind, from_status, to_status, body, is_public, actor_user_id, actor_customer_id)
	  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, id, kind, from, to, body, public, a.userID, a.customerID)
	return err
}

// ── Create ───────────────────────────────────────────────────────────────────

// NewTicket is a ticket to open. Empty pointers are left unset; the coach
// and branch default from the session, the branch then from the coach and
// the member's latest class.
type NewTicket struct {
	Source         domain.Source
	Category       string
	Priority       string
	Title          string
	Description    string
	CustomerID     *string
	ContactName    *string
	ContactPhone   *string
	CoachID        *string
	SessionID      *string
	BranchID       *string
	ConversationID *string
	OwnerUserID    *string
	by             actor
}

// Created names the new ticket.
type Created struct {
	ID   string `json:"id"`
	Code string `json:"code"`
}

func (s *Service) create(ctx context.Context, q Q, in NewTicket) (Created, error) {
	label, err := categoryLabel(ctx, q, in.Category)
	if err != nil {
		return Created{}, err
	}
	priority := domain.Priority(in.Priority)
	if in.Priority == "" {
		priority = domain.Normal
	} else if !domain.ValidPriority(in.Priority) {
		return Created{}, httpx.BadRequest("Prioritas tidak valid")
	}
	if in.SessionID != nil {
		var coachID, branchID *string
		err := q.QueryRow(ctx, `SELECT coach_id::text, branch_id::text FROM gym.class_sessions WHERE id = $1`, *in.SessionID).Scan(&coachID, &branchID)
		if database.IsNoRows(err) {
			return Created{}, httpx.Coded(404, "SESSION_NOT_FOUND", "Sesi kelas tidak ditemukan", nil)
		}
		if err != nil {
			return Created{}, err
		}
		in.CoachID, in.BranchID = or(in.CoachID, coachID), or(in.BranchID, branchID)
	}
	if in.CoachID != nil {
		var branchID *string
		err := q.QueryRow(ctx, `SELECT branch_id::text FROM gym.coaches WHERE id = $1`, *in.CoachID).Scan(&branchID)
		if database.IsNoRows(err) {
			return Created{}, httpx.NotFound("Coach tidak ditemukan")
		}
		if err != nil {
			return Created{}, err
		}
		in.BranchID = or(in.BranchID, branchID)
	}
	if in.CustomerID != nil {
		var branchID *string
		var found bool
		err := q.QueryRow(ctx, `SELECT true, (SELECT s.branch_id::text FROM gym.bookings b JOIN gym.class_sessions s ON s.id = b.session_id
		    WHERE b.customer_id = c.id AND s.branch_id IS NOT NULL ORDER BY s.starts_at DESC LIMIT 1)
		  FROM pos.pos_customers c WHERE c.id = $1`, *in.CustomerID).Scan(&found, &branchID)
		if database.IsNoRows(err) {
			return Created{}, httpx.Coded(404, "MEMBER_NOT_FOUND", "Member tidak ditemukan", nil)
		}
		if err != nil {
			return Created{}, err
		}
		in.BranchID = or(in.BranchID, branchID)
	}
	if in.OwnerUserID != nil {
		if err := requireActiveUser(ctx, q, *in.OwnerUserID); err != nil {
			return Created{}, err
		}
	}
	c, err := loadClock(ctx, q, in.BranchID)
	if err != nil {
		return Created{}, err
	}
	now := s.now()
	respondBy, resolveBy := c.deadlines(now, priority)

	// Codes count up per month; the advisory lock keeps two creates from
	// taking the same number.
	prefix := domain.CodePrefix(now)
	if _, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('gym.complaints:' || $1))`, prefix); err != nil {
		return Created{}, err
	}
	var seq int
	if err := q.QueryRow(ctx, `SELECT COALESCE(MAX(substring(code from 10)::int), 0) + 1 FROM gym.complaints WHERE code LIKE $1`,
		prefix+"%").Scan(&seq); err != nil {
		return Created{}, err
	}
	out := Created{Code: domain.Code(now, seq)}
	var description *string
	if d := strings.TrimSpace(in.Description); d != "" {
		description = &d
	}
	err = q.QueryRow(ctx, `INSERT INTO gym.complaints (code, source, category, priority, title, description, customer_id,
	    contact_name, contact_phone, coach_id, session_id, branch_id, conversation_id, owner_user_id,
	    sla_started_at, respond_by, resolve_by, created_by, created_at, updated_at)
	  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $15, $15)
	  RETURNING id::text`,
		out.Code, in.Source, in.Category, priority, domain.Title(in.Title, in.Description, label), description, in.CustomerID,
		trimmed(in.ContactName), trimmed(in.ContactPhone), in.CoachID, in.SessionID, in.BranchID, in.ConversationID, in.OwnerUserID,
		now, respondBy, resolveBy, in.by.userID).Scan(&out.ID)
	if err != nil {
		return Created{}, err
	}
	received := string(domain.Received)
	body := "Laporan diterima"
	if err := addEvent(ctx, q, out.ID, "created", nil, &received, &body, true, in.by); err != nil {
		return Created{}, err
	}
	if in.OwnerUserID != nil {
		if err := s.assignNotice(ctx, q, out.ID, out.Code, *in.OwnerUserID, in.by); err != nil {
			return Created{}, err
		}
	}
	return out, nil
}

func or(v, fallback *string) *string {
	if v != nil {
		return v
	}
	return fallback
}

// Create opens a ticket from the front desk or a staff screen.
func (s *Service) Create(ctx context.Context, userID string, in NewTicket) (Created, error) {
	if in.Source != domain.SourceDesk && in.Source != domain.SourceStaff {
		return Created{}, httpx.BadRequest("Sumber tiket tidak valid")
	}
	if in.CustomerID == nil && trimmed(in.ContactName) == nil && trimmed(in.ContactPhone) == nil {
		return Created{}, httpx.BadRequest("Pilih member atau isi nama / nomor pelapor")
	}
	in.ConversationID = nil
	in.by = staffActor(userID)
	var out Created
	err := s.inTx(ctx, func(q Q) error {
		var err error
		out, err = s.create(ctx, q, in)
		return err
	})
	return out, err
}

// ── Update ───────────────────────────────────────────────────────────────────

// Patch changes a ticket's details; nil fields stay. Clear names the links
// to remove (coach_id, session_id, branch_id).
type Patch struct {
	Category    *string  `json:"category"`
	Priority    *string  `json:"priority"`
	Title       *string  `json:"title"`
	Description *string  `json:"description"`
	CoachID     *string  `json:"coach_id"`
	SessionID   *string  `json:"session_id"`
	BranchID    *string  `json:"branch_id"`
	Clear       []string `json:"clear"`
}

// Update applies a patch. A new priority or branch moves the deadlines of
// an open ticket from its SLA start, and a deadline moved past now may
// escalate again.
func (s *Service) Update(ctx context.Context, userID, id string, p Patch) error {
	return s.inTx(ctx, func(q Q) error {
		t, err := s.lockTicket(ctx, q, id)
		if err != nil {
			return err
		}
		var changes []string
		if p.Category != nil && *p.Category != t.Category {
			label, err := categoryLabel(ctx, q, *p.Category)
			if err != nil {
				return err
			}
			t.Category = *p.Category
			changes = append(changes, "kategori "+label)
		}
		if p.Priority != nil && *p.Priority != t.Priority {
			if !domain.ValidPriority(*p.Priority) {
				return httpx.BadRequest("Prioritas tidak valid")
			}
			t.Priority = *p.Priority
			changes = append(changes, "prioritas "+domain.PriorityLabel[domain.Priority(*p.Priority)])
		}
		if p.Title != nil {
			if v := strings.TrimSpace(*p.Title); v != "" && v != t.Title {
				t.Title = domain.Title(v, "", "")
				changes = append(changes, "judul")
			}
		}
		if p.Description != nil && !sameID(trimmed(p.Description), t.Description) {
			t.Description = trimmed(p.Description)
			changes = append(changes, "deskripsi")
		}
		clear := map[string]bool{}
		for _, c := range p.Clear {
			clear[c] = true
		}
		link := func(name, label string, cur **string, v *string, exists string) error {
			if clear[name] && *cur != nil {
				*cur = nil
				changes = append(changes, label+" dilepas")
				return nil
			}
			if v == nil || (*cur != nil && **cur == *v) {
				return nil
			}
			var ok bool
			if err := q.QueryRow(ctx, exists, *v).Scan(&ok); err != nil {
				return err
			}
			if !ok {
				return httpx.NotFound(label + " tidak ditemukan")
			}
			*cur = v
			changes = append(changes, label)
			return nil
		}
		branchBefore := t.BranchID
		if err := link("session_id", "sesi", &t.SessionID, p.SessionID, `SELECT EXISTS (SELECT 1 FROM gym.class_sessions WHERE id = $1)`); err != nil {
			return err
		}
		if err := link("coach_id", "coach", &t.CoachID, p.CoachID, `SELECT EXISTS (SELECT 1 FROM gym.coaches WHERE id = $1)`); err != nil {
			return err
		}
		if err := link("branch_id", "cabang", &t.BranchID, p.BranchID, `SELECT EXISTS (SELECT 1 FROM configuration.branches WHERE id = $1)`); err != nil {
			return err
		}
		if len(changes) == 0 {
			return nil
		}
		respondBy, resolveBy := t.respondBy, t.resolveBy
		if domain.Open(domain.Status(t.Status)) && (p.Priority != nil || !sameID(branchBefore, t.BranchID)) {
			c, err := loadClock(ctx, q, t.BranchID)
			if err != nil {
				return err
			}
			respondBy, resolveBy = c.deadlines(t.slaStartedAt, domain.Priority(t.Priority))
		}
		now := s.now()
		if _, err := q.Exec(ctx, `UPDATE gym.complaints SET category = $2, priority = $3, title = $4, description = $5,
		    coach_id = $6, session_id = $7, branch_id = $8, respond_by = $9, resolve_by = $10,
		    respond_escalated_at = CASE WHEN $9::timestamptz > $11::timestamptz THEN NULL ELSE respond_escalated_at END,
		    resolve_escalated_at = CASE WHEN $10::timestamptz > $11::timestamptz THEN NULL ELSE resolve_escalated_at END,
		    updated_at = $11
		  WHERE id = $1`, id, t.Category, t.Priority, t.Title, t.Description, t.CoachID, t.SessionID, t.BranchID,
			respondBy, resolveBy, now); err != nil {
			return err
		}
		body := "Diubah: " + strings.Join(changes, ", ")
		return addEvent(ctx, q, id, "updated", nil, nil, &body, false, staffActor(userID))
	})
}

func sameID(a, b *string) bool { return (a == nil) == (b == nil) && (a == nil || *a == *b) }

// locked is the row of a ticket under FOR UPDATE.
type locked struct {
	ID, Code, Category, Priority, Status, Title string
	Description                                 *string
	CustomerID, CoachID, SessionID, BranchID    *string
	OwnerUserID                                 *string
	slaStartedAt, respondBy, resolveBy          time.Time
}

func (s *Service) lockTicket(ctx context.Context, q Q, id string) (*locked, error) {
	var t locked
	err := q.QueryRow(ctx, `SELECT id::text, code, category, priority, status, title, description, customer_id::text,
	       coach_id::text, session_id::text, branch_id::text, owner_user_id::text, sla_started_at, respond_by, resolve_by
	  FROM gym.complaints WHERE id = $1 FOR UPDATE`, id).
		Scan(&t.ID, &t.Code, &t.Category, &t.Priority, &t.Status, &t.Title, &t.Description, &t.CustomerID,
			&t.CoachID, &t.SessionID, &t.BranchID, &t.OwnerUserID, &t.slaStartedAt, &t.respondBy, &t.resolveBy)
	if database.IsNoRows(err) {
		return nil, httpx.Coded(404, "COMPLAINT_NOT_FOUND", "Tiket keluhan tidak ditemukan", nil)
	}
	return &t, err
}

// ── Status ───────────────────────────────────────────────────────────────────

// Move changes a ticket's status. Handling stamps the first response and
// takes the ticket when it has no owner; resolving stamps the resolution;
// reopening restarts the SLA clock. The member hears about each move staff
// make; staff hear when the member reopens.
func (s *Service) Move(ctx context.Context, userID, id string, to domain.Status, note string) error {
	return s.inTx(ctx, func(q Q) error {
		t, err := s.lockTicket(ctx, q, id)
		if err != nil {
			return err
		}
		return s.move(ctx, q, t, to, note, staffActor(userID))
	})
}

func (s *Service) move(ctx context.Context, q Q, t *locked, to domain.Status, note string, by actor) error {
	from := domain.Status(t.Status)
	if !domain.CanMove(from, to, by.role()) {
		return httpx.Coded(409, "COMPLAINT_BAD_STATUS",
			fmt.Sprintf("Tiket %s tidak bisa diubah ke %s", strings.ToLower(domain.StatusLabel[from]), strings.ToLower(domain.StatusLabel[to])), nil)
	}
	note = strings.TrimSpace(note)
	if domain.NeedsNote(to) && note == "" {
		if to == domain.Resolved {
			return httpx.Coded(400, "COMPLAINT_NOTE_REQUIRED", "Isi catatan penyelesaian untuk member", nil)
		}
		return httpx.Coded(400, "COMPLAINT_NOTE_REQUIRED", "Isi alasan membuka lagi", nil)
	}
	now := s.now()
	respondBy, resolveBy := t.respondBy, t.resolveBy
	if to == domain.Reopened {
		c, err := loadClock(ctx, q, t.BranchID)
		if err != nil {
			return err
		}
		respondBy, resolveBy = c.deadlines(now, domain.Priority(t.Priority))
	}
	takeOwner := to == domain.InProgress && t.OwnerUserID == nil && by.userID != nil
	if _, err := q.Exec(ctx, `UPDATE gym.complaints SET status = $2::text,
	    first_response_at = CASE WHEN $2::text IN ('in_progress', 'resolved') AND $5::boolean THEN COALESCE(first_response_at, $3) ELSE first_response_at END,
	    resolved_at = CASE WHEN $2 = 'resolved' THEN $3 WHEN $2 = 'reopened' THEN NULL ELSE resolved_at END,
	    confirmed_at = CASE WHEN $2 = 'confirmed' THEN $3 ELSE confirmed_at END,
	    reopen_count = reopen_count + CASE WHEN $2 = 'reopened' THEN 1 ELSE 0 END,
	    sla_started_at = CASE WHEN $2 = 'reopened' THEN $3 ELSE sla_started_at END,
	    respond_by = $6, resolve_by = $7,
	    resolve_escalated_at = CASE WHEN $2 = 'reopened' THEN NULL ELSE resolve_escalated_at END,
	    owner_user_id = CASE WHEN $8::boolean THEN $4::uuid ELSE owner_user_id END,
	    updated_at = $3
	  WHERE id = $1`, t.ID, string(to), now, by.userID, by.role() == domain.Staff, respondBy, resolveBy, takeOwner); err != nil {
		return err
	}
	fromS, toS := string(from), string(to)
	var body *string
	if note != "" {
		body = &note
	}
	if err := addEvent(ctx, q, t.ID, "status", &fromS, &toS, body, true, by); err != nil {
		return err
	}
	if takeOwner {
		if err := s.assignNotice(ctx, q, t.ID, t.Code, *by.userID, by); err != nil {
			return err
		}
	}
	if by.role() == domain.Staff {
		title, msg := domain.MemberNotice(t.Code, to, false)
		s.notifyMember(ctx, q, t.CustomerID, members.Notice{Type: "gym_complaint", Title: title, Body: msg})
		return nil
	}
	if to == domain.Reopened {
		st, err := loadSettings(ctx, q, t.BranchID)
		if err != nil {
			return err
		}
		users := []string{deref(t.OwnerUserID), deref(st.EscalationUserID)}
		return staffNotice(ctx, q, users, "alert", "Member membuka lagi keluhan "+t.Code, note, ticketLink(t.ID),
			map[string]any{"gym_type": "gym_complaint_reopened", "complaint_id": t.ID})
	}
	return nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// ── Owner, notes, replies, delete ────────────────────────────────────────────

// Assign sets (or with nil clears) the owner of a ticket.
func (s *Service) Assign(ctx context.Context, userID, id string, owner *string) error {
	return s.inTx(ctx, func(q Q) error {
		t, err := s.lockTicket(ctx, q, id)
		if err != nil {
			return err
		}
		if sameID(t.OwnerUserID, owner) {
			return nil
		}
		if owner == nil {
			if _, err := q.Exec(ctx, `UPDATE gym.complaints SET owner_user_id = NULL, updated_at = $2 WHERE id = $1`, id, s.now()); err != nil {
				return err
			}
			body := "PIC dilepas"
			return addEvent(ctx, q, id, "assign", nil, nil, &body, false, staffActor(userID))
		}
		if err := requireActiveUser(ctx, q, *owner); err != nil {
			return err
		}
		if _, err := q.Exec(ctx, `UPDATE gym.complaints SET owner_user_id = $2, updated_at = $3 WHERE id = $1`, id, *owner, s.now()); err != nil {
			return err
		}
		return s.assignNotice(ctx, q, id, t.Code, *owner, staffActor(userID))
	})
}

// assignNotice records the new owner and tells them in the staff inbox
// unless they took the ticket themselves.
func (s *Service) assignNotice(ctx context.Context, q Q, id, code, owner string, by actor) error {
	var name string
	if err := q.QueryRow(ctx, `SELECT full_name FROM configuration.users WHERE id = $1`, owner).Scan(&name); err != nil {
		return err
	}
	body := "PIC: " + name
	if err := addEvent(ctx, q, id, "assign", nil, nil, &body, false, by); err != nil {
		return err
	}
	if by.userID != nil && *by.userID == owner {
		return nil
	}
	return staffNotice(ctx, q, []string{owner}, "status_change", "Keluhan "+code+" ditugaskan ke kamu",
		"Buka tiket untuk menindaklanjuti.", ticketLink(id), map[string]any{"gym_type": "gym_complaint_assigned", "complaint_id": id})
}

// Note adds an internal note, or with public a reply the member reads in
// the app. A reply counts as the first response.
func (s *Service) Note(ctx context.Context, userID, id, body string, public bool) error {
	body = strings.TrimSpace(body)
	if body == "" {
		return httpx.BadRequest("Isi catatan")
	}
	if len([]rune(body)) > domain.MemberMaxLength {
		return httpx.BadRequest(fmt.Sprintf("Catatan maksimal %d karakter", domain.MemberMaxLength))
	}
	return s.inTx(ctx, func(q Q) error {
		t, err := s.lockTicket(ctx, q, id)
		if err != nil {
			return err
		}
		kind := "note"
		if public {
			kind = "reply"
		}
		if err := addEvent(ctx, q, id, kind, nil, nil, &body, public, staffActor(userID)); err != nil {
			return err
		}
		if _, err := q.Exec(ctx, `UPDATE gym.complaints SET updated_at = $2,
		    first_response_at = CASE WHEN $3::boolean THEN COALESCE(first_response_at, $2) ELSE first_response_at END
		  WHERE id = $1`, id, s.now(), public); err != nil {
			return err
		}
		if public {
			title, msg := domain.MemberNotice(t.Code, "", true)
			s.notifyMember(ctx, q, t.CustomerID, members.Notice{Type: "gym_complaint", Title: title, Body: msg})
		}
		return nil
	})
}

// Delete removes a ticket raised by mistake, with its history.
func (s *Service) Delete(ctx context.Context, id string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM gym.complaints WHERE id = $1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return httpx.Coded(404, "COMPLAINT_NOT_FOUND", "Tiket keluhan tidak ditemukan", nil)
	}
	return err
}
