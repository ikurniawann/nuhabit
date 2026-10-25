package events

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	eventsc "nuhabit/backend/internal/contracts/events"
	"nuhabit/backend/internal/modules/events/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/localtime"
)

// Q is the querier the repository runs on: the pool or a transaction.
type Q = database.Querier

// Postgres is the module's SQL. It has no state; every call takes its Q.
type Postgres struct{}

// entriesCTE is the unified calendar: live CRM events, site events not
// represented by a linked CRM event, open class sessions and open PT
// appointments, with the columns the four share.
const entriesCTE = `
WITH entries AS (
  SELECT 'crm_event' AS kind, e.id, e.title, e.starts_at, e.ends_at, e.branch_id, e.area, e.coach_id, e.status, e.updated_at,
         e.id AS crm_event_id, e.site_event_id, e.organiser_user_id, e.capacity,
         (SELECT count(*)::int FROM crm.event_bookings b WHERE b.event_id = e.id AND b.status IN ('confirmed', 'attended')) AS confirmed
    FROM crm.events e
   WHERE e.status <> 'cancelled'
  UNION ALL
  SELECT 'site_event', s.id, s.title, s.starts_at, COALESCE(s.ends_at, s.starts_at + interval '2 hours'), s.branch_id, s.area, s.coach_id,
         s.status, s.updated_at, NULL, s.id, s.organiser_user_id, NULL, NULL
    FROM site.events s
   WHERE s.crm_event_id IS NULL
  UNION ALL
  SELECT 'class', x.id, t.name, x.starts_at, x.ends_at, x.branch_id, x.area, x.coach_id, x.status, x.updated_at, NULL, NULL, NULL, x.capacity,
         (SELECT count(*)::int FROM gym.bookings b WHERE b.session_id = x.id AND b.status IN ('confirmed', 'checked_in', 'completed'))
    FROM gym.class_sessions x
    JOIN gym.class_types t ON t.id = x.class_type_id
   WHERE x.status <> 'cancelled'
  UNION ALL
  SELECT 'pt', a.id, t.name || ' · ' || c.name, a.starts_at, a.ends_at, a.branch_id, NULL, a.coach_id, a.status, a.updated_at, NULL, NULL, NULL,
         a.capacity, (SELECT count(*)::int FROM gym.pt_participants p WHERE p.appointment_id = a.id AND p.status = 'confirmed')
    FROM gym.pt_appointments a
    JOIN gym.class_types t ON t.id = a.class_type_id
    JOIN gym.coaches c ON c.id = a.coach_id
   WHERE a.status IN ('requested', 'confirmed')
)
SELECT e.kind, e.id::text, e.title, e.starts_at, e.ends_at, e.branch_id::text, br.name, COALESCE(br.timezone, 'Asia/Jakarta'),
       e.area, e.coach_id::text, c.name, e.status, e.updated_at, e.crm_event_id::text, e.site_event_id::text,
       e.organiser_user_id::text, e.capacity, e.confirmed
  FROM entries e
  LEFT JOIN configuration.branches br ON br.id = e.branch_id
  LEFT JOIN gym.coaches c ON c.id = e.coach_id
 WHERE e.starts_at < $2 AND e.ends_at > $1`

// CalendarEntry is one line of the calendar as the API serves it.
type CalendarEntry struct {
	Kind            eventsc.Kind `json:"kind"`
	ID              string       `json:"id"`
	Title           string       `json:"title"`
	StartsAt        httpx.JSTime `json:"starts_at"`
	EndsAt          httpx.JSTime `json:"ends_at"`
	BranchID        *string      `json:"branch_id"`
	BranchName      *string      `json:"branch_name"`
	Timezone        string       `json:"timezone"`
	Area            *string      `json:"area"`
	CoachID         *string      `json:"coach_id"`
	CoachName       *string      `json:"coach_name"`
	Status          string       `json:"status"`
	UpdatedAt       httpx.JSTime `json:"updated_at"`
	CRMEventID      *string      `json:"crm_event_id"`
	SiteEventID     *string      `json:"site_event_id"`
	OrganiserUserID *string      `json:"organiser_user_id"`
	Capacity        *int         `json:"capacity"`
	Confirmed       *int         `json:"confirmed"`
}

func (e CalendarEntry) entry() domain.Entry {
	return domain.Entry{Kind: e.Kind, ID: e.ID, Title: e.Title, BranchID: e.BranchID, Area: e.Area, CoachID: e.CoachID,
		CoachName: e.CoachName, StartsAt: time.Time(e.StartsAt), EndsAt: time.Time(e.EndsAt), Zone: localtime.Zone(e.Timezone)}
}

func (e CalendarEntry) ics() domain.ICSEntry {
	return domain.ICSEntry{Entry: e.entry(), BranchName: e.BranchName, Status: e.Status, UpdatedAt: time.Time(e.UpdatedAt)}
}

func scanEntry(r pgx.CollectableRow) (CalendarEntry, error) {
	var e CalendarEntry
	var starts, ends, updated time.Time
	err := r.Scan(&e.Kind, &e.ID, &e.Title, &starts, &ends, &e.BranchID, &e.BranchName, &e.Timezone, &e.Area, &e.CoachID,
		&e.CoachName, &e.Status, &updated, &e.CRMEventID, &e.SiteEventID, &e.OrganiserUserID, &e.Capacity, &e.Confirmed)
	e.StartsAt, e.EndsAt, e.UpdatedAt = httpx.JSTime(starts), httpx.JSTime(ends), httpx.JSTime(updated)
	return e, err
}

// CalendarFilter narrows the calendar listing.
type CalendarFilter struct {
	From, To time.Time
	BranchID *string
	Area     *string
	// Kinds limits the entry kinds; nil is every kind.
	Kinds []string
}

// Entries lists the calendar entries overlapping [From, To), soonest first.
func (Postgres) Entries(ctx context.Context, q Q, f CalendarFilter) ([]CalendarEntry, error) {
	rows, err := q.Query(ctx, entriesCTE+`
   AND ($3::uuid IS NULL OR e.branch_id = $3)
   AND ($4::text IS NULL OR lower(btrim(e.area)) = lower(btrim($4)))
   AND ($5::text[] IS NULL OR e.kind = ANY($5))
 ORDER BY e.starts_at, e.title`, f.From, f.To, f.BranchID, f.Area, f.Kinds)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanEntry)
}

// LockSchedule takes the timetable lock class scheduling uses, so an event
// and a class never pass their overlap checks at the same time.
func (Postgres) LockSchedule(ctx context.Context, q Q) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('gym:schedule'))`)
	return err
}

// Neighbours lists the entries that overlap s in time and share its branch
// or its coach. The subject's own row and its linked twin are left out;
// domain.Detect sorts the rest into clashes and warnings.
func (Postgres) Neighbours(ctx context.Context, q Q, s eventsc.Subject) ([]domain.Entry, error) {
	// e.site_event_id is set on CRM rows only, so a site subject's CRM twin
	// drops out with the subject's own row.
	rows, err := q.Query(ctx, entriesCTE+`
   AND (e.branch_id = $3::uuid OR e.coach_id = $4::uuid)
   AND ($5::uuid IS NULL OR (e.id <> $5 AND e.site_event_id IS DISTINCT FROM $5))
 ORDER BY e.starts_at
 LIMIT 50`, s.StartsAt, s.EndsAt, s.BranchID, s.CoachID, nullIfEmpty(s.ID))
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, scanEntry)
	if err != nil {
		return nil, err
	}
	out := make([]domain.Entry, len(list))
	for i, e := range list {
		out[i] = e.entry()
	}
	return out, nil
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// Branch reads a branch's name and zone; a nil or unknown branch has no
// name and reads in Jakarta.
func (Postgres) Branch(ctx context.Context, q Q, branchID *string) (name *string, zone *time.Location, err error) {
	if branchID == nil {
		return nil, localtime.Jakarta, nil
	}
	var tz string
	err = q.QueryRow(ctx, `SELECT name, COALESCE(timezone, 'Asia/Jakarta') FROM configuration.branches WHERE id = $1`, *branchID).Scan(&name, &tz)
	if database.IsNoRows(err) {
		return nil, localtime.Jakarta, nil
	}
	return name, localtime.Zone(tz), err
}

/* ── overrides ───────────────────────────────────────────────────────── */

// InsertOverride records who saved s over the clashes and why.
func (Postgres) InsertOverride(ctx context.Context, q Q, s eventsc.Subject, o eventsc.Override, r eventsc.Report) error {
	clashes, err := json.Marshal(r.Blocking)
	if err != nil {
		return err
	}
	crmID, siteID := ownerColumns(s.Source, s.ID)
	_, err = q.Exec(ctx, `INSERT INTO events.conflict_overrides (crm_event_id, site_event_id, user_id, reason, clashes)
     VALUES ($1, $2, $3, $4, $5::jsonb)`, crmID, siteID, o.UserID, o.Reason, string(clashes))
	return err
}

// ownerColumns splits an event reference into the (crm_event_id,
// site_event_id) pair the events tables store.
func ownerColumns(src eventsc.Source, id string) (crmID, siteID *string) {
	if src == eventsc.SourceSite {
		return nil, &id
	}
	return &id, nil
}

// Override is one recorded "tetap simpan".
type Override struct {
	ID        string          `json:"id"`
	UserID    *string         `json:"user_id"`
	UserName  *string         `json:"user_name"`
	Reason    string          `json:"reason"`
	Clashes   json.RawMessage `json:"clashes"`
	CreatedAt httpx.JSTime    `json:"created_at"`
}

// Overrides lists the overrides of an event, newest first.
func (Postgres) Overrides(ctx context.Context, q Q, src eventsc.Source, id string) ([]Override, error) {
	crmID, siteID := ownerColumns(src, id)
	rows, err := q.Query(ctx, `SELECT o.id::text, o.user_id::text, u.full_name, o.reason, o.clashes, o.created_at
       FROM events.conflict_overrides o
       LEFT JOIN configuration.users u ON u.id = o.user_id
      WHERE o.crm_event_id = $1::uuid OR o.site_event_id = $2::uuid
      ORDER BY o.created_at DESC`, crmID, siteID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Override, error) {
		var o Override
		var created time.Time
		err := r.Scan(&o.ID, &o.UserID, &o.UserName, &o.Reason, &o.Clashes, &created)
		o.CreatedAt = httpx.JSTime(created)
		return o, err
	})
}

/* ── links ───────────────────────────────────────────────────────────── */

// EventRef is the summary of an event on one side of a link.
type EventRef struct {
	ID       string       `json:"id"`
	Title    string       `json:"title"`
	StartsAt httpx.JSTime `json:"starts_at"`
	Status   string       `json:"status"`
}

func scanRef(r pgx.CollectableRow) (EventRef, error) {
	var e EventRef
	var starts time.Time
	err := r.Scan(&e.ID, &e.Title, &starts, &e.Status)
	e.StartsAt = httpx.JSTime(starts)
	return e, err
}

// UnlinkedCRMEvents lists live CRM events without a site twin, upcoming first.
func (Postgres) UnlinkedCRMEvents(ctx context.Context, q Q, now time.Time) ([]EventRef, error) {
	rows, err := q.Query(ctx, `SELECT id::text, title, starts_at, status FROM crm.events
      WHERE site_event_id IS NULL AND status <> 'cancelled' AND ends_at > $1
      ORDER BY starts_at LIMIT 100`, now.Add(-30*24*time.Hour))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanRef)
}

// UnlinkedSiteEvents lists site events without a CRM twin, upcoming first.
func (Postgres) UnlinkedSiteEvents(ctx context.Context, q Q, now time.Time) ([]EventRef, error) {
	rows, err := q.Query(ctx, `SELECT id::text, title, starts_at, status FROM site.events
      WHERE crm_event_id IS NULL AND starts_at > $1
      ORDER BY starts_at LIMIT 100`, now.Add(-30*24*time.Hour))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanRef)
}

// Link points the two rows at each other. false when either does not exist
// or is already linked elsewhere.
func (Postgres) Link(ctx context.Context, q Q, crmID, siteID string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE crm.events c SET site_event_id = s.id, updated_at = now()
       FROM site.events s
      WHERE c.id = $1 AND s.id = $2 AND c.site_event_id IS NULL AND s.crm_event_id IS NULL`, crmID, siteID)
	if err != nil || tag.RowsAffected() == 0 {
		return false, err
	}
	_, err = q.Exec(ctx, `UPDATE site.events SET crm_event_id = $1, updated_at = now() WHERE id = $2`, crmID, siteID)
	return err == nil, err
}

// Unlink clears both sides of the CRM event's link; false when it had none.
func (Postgres) Unlink(ctx context.Context, q Q, crmID string) (bool, error) {
	if _, err := q.Exec(ctx, `UPDATE site.events SET crm_event_id = NULL, updated_at = now() WHERE crm_event_id = $1`, crmID); err != nil {
		return false, err
	}
	tag, err := q.Exec(ctx, `UPDATE crm.events SET site_event_id = NULL, updated_at = now()
      WHERE id = $1 AND site_event_id IS NOT NULL`, crmID)
	return tag.RowsAffected() > 0, err
}

// PublishToSite copies a CRM event into a site draft and links the two;
// the slug comes from the title with a numeric suffix when taken. "" when
// the CRM event is missing, cancelled or already linked.
func (Postgres) PublishToSite(ctx context.Context, q Q, crmID, userID string, at time.Time) (string, error) {
	var siteID string
	err := q.QueryRow(ctx, `
WITH src AS (
  SELECT id, title, description, location, starts_at, ends_at, branch_id, area, coach_id, organiser_user_id,
         configuration.slugify(title) AS base
    FROM crm.events WHERE id = $1 AND status <> 'cancelled' AND site_event_id IS NULL
), slug AS (
  SELECT src.id, CASE WHEN NOT EXISTS (SELECT 1 FROM site.events WHERE slug = src.base) THEN src.base
                      ELSE src.base || '-' || (SELECT count(*) + 1 FROM site.events WHERE slug LIKE src.base || '%') END AS value
    FROM src
), ins AS (
  INSERT INTO site.events (slug, title, starts_at, ends_at, location_text, body_md, status, branch_id, area, coach_id,
                           organiser_user_id, crm_event_id, created_by, created_at, updated_at)
  SELECT NULLIF(slug.value, ''), src.title, src.starts_at, src.ends_at, src.location, src.description, 'draft', src.branch_id,
         src.area, src.coach_id, src.organiser_user_id, src.id, $2, $3, $3
    FROM src JOIN slug ON slug.id = src.id
  RETURNING id, crm_event_id
)
UPDATE crm.events c SET site_event_id = ins.id, updated_at = $3 FROM ins WHERE c.id = ins.crm_event_id
RETURNING ins.id::text`, crmID, userID, at).Scan(&siteID)
	if database.IsNoRows(err) {
		return "", nil
	}
	return siteID, err
}

/* ── tasks ───────────────────────────────────────────────────────────── */

// Task is one checklist line of an event.
type Task struct {
	ID             string        `json:"id"`
	Kind           string        `json:"kind"`
	Title          string        `json:"title"`
	AssigneeUserID *string       `json:"assignee_user_id"`
	AssigneeName   *string       `json:"assignee_name"`
	DueAt          *httpx.JSTime `json:"due_at"`
	DoneAt         *httpx.JSTime `json:"done_at"`
	CreatedAt      httpx.JSTime  `json:"created_at"`
}

// TaskKinds are the checklist categories.
var TaskKinds = []string{"venue", "sponsor", "promo", "equipment", "other"}

const taskColumns = `t.id::text, t.kind, t.title, t.assignee_user_id::text, u.full_name, t.due_at, t.done_at, t.created_at`

func scanTask(r pgx.CollectableRow) (Task, error) {
	var t Task
	var due, done *time.Time
	var created time.Time
	err := r.Scan(&t.ID, &t.Kind, &t.Title, &t.AssigneeUserID, &t.AssigneeName, &due, &done, &created)
	t.DueAt, t.DoneAt, t.CreatedAt = httpx.NewJSTime(due), httpx.NewJSTime(done), httpx.JSTime(created)
	return t, err
}

// Tasks lists an event's checklist: open first, then by due date.
func (Postgres) Tasks(ctx context.Context, q Q, src eventsc.Source, id string) ([]Task, error) {
	crmID, siteID := ownerColumns(src, id)
	rows, err := q.Query(ctx, `SELECT `+taskColumns+`
       FROM events.tasks t LEFT JOIN configuration.users u ON u.id = t.assignee_user_id
      WHERE t.crm_event_id = $1::uuid OR t.site_event_id = $2::uuid
      ORDER BY (t.done_at IS NOT NULL), t.due_at NULLS LAST, t.created_at`, crmID, siteID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanTask)
}

// TaskInput creates or edits a checklist line.
type TaskInput struct {
	Kind           string
	Title          string
	AssigneeUserID *string
	DueAt          *time.Time
}

// InsertTask adds a line to the event's checklist.
func (Postgres) InsertTask(ctx context.Context, q Q, src eventsc.Source, id string, in TaskInput, userID string) (*Task, error) {
	crmID, siteID := ownerColumns(src, id)
	rows, err := q.Query(ctx, `WITH t AS (
       INSERT INTO events.tasks (crm_event_id, site_event_id, kind, title, assignee_user_id, due_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *)
     SELECT `+taskColumns+` FROM t LEFT JOIN configuration.users u ON u.id = t.assignee_user_id`,
		crmID, siteID, in.Kind, in.Title, in.AssigneeUserID, in.DueAt, userID)
	if err != nil {
		return nil, err
	}
	t, err := pgx.CollectExactlyOneRow(rows, scanTask)
	return &t, err
}

// TaskPatch changes the fields that are set; Done toggles completion.
type TaskPatch struct {
	Kind           *string
	Title          *string
	AssigneeUserID **string
	DueAt          **time.Time
	Done           *bool
}

// UpdateTask applies a patch; nil when the task does not exist.
func (Postgres) UpdateTask(ctx context.Context, q Q, id string, p TaskPatch) (*Task, error) {
	var assigneeSet, dueSet bool
	var assignee *string
	var due *time.Time
	if p.AssigneeUserID != nil {
		assigneeSet, assignee = true, *p.AssigneeUserID
	}
	if p.DueAt != nil {
		dueSet, due = true, *p.DueAt
	}
	rows, err := q.Query(ctx, `WITH t AS (
       UPDATE events.tasks SET
         kind = COALESCE($2, kind), title = COALESCE($3, title),
         assignee_user_id = CASE WHEN $4 THEN $5::uuid ELSE assignee_user_id END,
         due_at = CASE WHEN $6 THEN $7::timestamptz ELSE due_at END,
         done_at = CASE WHEN $8::boolean IS NULL THEN done_at WHEN $8 THEN COALESCE(done_at, now()) ELSE NULL END,
         updated_at = now()
       WHERE id = $1 RETURNING *)
     SELECT `+taskColumns+` FROM t LEFT JOIN configuration.users u ON u.id = t.assignee_user_id`,
		id, p.Kind, p.Title, assigneeSet, assignee, dueSet, due, p.Done)
	if err != nil {
		return nil, err
	}
	t, err := pgx.CollectExactlyOneRow(rows, scanTask)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &t, err
}

// DeleteTask removes a checklist line.
func (Postgres) DeleteTask(ctx context.Context, q Q, id string) (bool, error) {
	tag, err := q.Exec(ctx, `DELETE FROM events.tasks WHERE id = $1`, id)
	return tag.RowsAffected() > 0, err
}

// Canonical resolves an event reference to the row that owns its checklist
// and registrations: a site event linked to a CRM event defers to the CRM
// event. The second result is false when the event does not exist.
func (Postgres) Canonical(ctx context.Context, q Q, src eventsc.Source, id string) (eventsc.Source, string, bool, error) {
	var crmID *string
	var err error
	if src == eventsc.SourceSite {
		err = q.QueryRow(ctx, `SELECT crm_event_id::text FROM site.events WHERE id = $1`, id).Scan(&crmID)
	} else {
		err = q.QueryRow(ctx, `SELECT id::text FROM crm.events WHERE id = $1`, id).Scan(&crmID)
	}
	if database.IsNoRows(err) {
		return src, id, false, nil
	}
	if err != nil {
		return src, id, false, err
	}
	if crmID != nil {
		return eventsc.SourceCRM, *crmID, true, nil
	}
	return src, id, true, nil
}

/* ── feeds ───────────────────────────────────────────────────────────── */

// Feed is one ICS subscription a staff member created.
type Feed struct {
	ID         string       `json:"id"`
	BranchID   *string      `json:"branch_id"`
	BranchName *string      `json:"branch_name"`
	Label      string       `json:"label"`
	CreatedAt  httpx.JSTime `json:"created_at"`
}

// InsertFeed stores the hash of a new feed token.
func (Postgres) InsertFeed(ctx context.Context, q Q, tokenHash string, branchID *string, userID, label string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `INSERT INTO events.calendar_feeds (token_hash, branch_id, user_id, label) VALUES ($1, $2, $3, $4) RETURNING id::text`,
		tokenHash, branchID, userID, label).Scan(&id)
	return id, err
}

// Feeds lists the live feeds of a staff member.
func (Postgres) Feeds(ctx context.Context, q Q, userID string) ([]Feed, error) {
	rows, err := q.Query(ctx, `SELECT f.id::text, f.branch_id::text, b.name, f.label, f.created_at
       FROM events.calendar_feeds f LEFT JOIN configuration.branches b ON b.id = f.branch_id
      WHERE f.user_id = $1 AND f.revoked_at IS NULL ORDER BY f.created_at`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Feed, error) {
		var f Feed
		var created time.Time
		err := r.Scan(&f.ID, &f.BranchID, &f.BranchName, &f.Label, &created)
		f.CreatedAt = httpx.JSTime(created)
		return f, err
	})
}

// RevokeFeed stops a feed of the caller; false when it is not theirs.
func (Postgres) RevokeFeed(ctx context.Context, q Q, id, userID string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE events.calendar_feeds SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, id, userID)
	return tag.RowsAffected() > 0, err
}

// FeedByHash resolves a live token: its branch (nil for every branch) and
// the branch name. found is false for an unknown or revoked token.
func (Postgres) FeedByHash(ctx context.Context, q Q, tokenHash string) (branchID, branchName *string, found bool, err error) {
	err = q.QueryRow(ctx, `SELECT f.branch_id::text, b.name FROM events.calendar_feeds f
       LEFT JOIN configuration.branches b ON b.id = f.branch_id
      WHERE f.token_hash = $1 AND f.revoked_at IS NULL`, tokenHash).Scan(&branchID, &branchName)
	if database.IsNoRows(err) {
		return nil, nil, false, nil
	}
	return branchID, branchName, err == nil, err
}

/* ── options ─────────────────────────────────────────────────────────── */

// Option is a pick-list item.
type Option struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Timezone is set for branches.
	Timezone string `json:"timezone,omitempty"`
}

// Branches lists the active branches with their zones.
func (Postgres) Branches(ctx context.Context, q Q) ([]Option, error) {
	rows, err := q.Query(ctx, `SELECT id::text, name, COALESCE(timezone, 'Asia/Jakarta') FROM configuration.branches WHERE is_active ORDER BY name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Option])
}

// Coaches lists the active coaches.
func (Postgres) Coaches(ctx context.Context, q Q) ([]Option, error) {
	rows, err := q.Query(ctx, `SELECT id::text, name, '' FROM gym.coaches WHERE status = 'active' ORDER BY name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Option])
}

// StaffUsers lists the active staff accounts for organiser and assignee
// pick lists.
func (Postgres) StaffUsers(ctx context.Context, q Q) ([]Option, error) {
	rows, err := q.Query(ctx, `SELECT id::text, full_name, '' FROM configuration.users WHERE status = 'active' ORDER BY full_name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Option])
}

// Areas lists the rooms in use across classes, templates and events.
func (Postgres) Areas(ctx context.Context, q Q) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT DISTINCT btrim(area) FROM (
         SELECT area FROM gym.class_sessions WHERE starts_at > now() - interval '90 days'
         UNION ALL SELECT area FROM gym.session_templates
         UNION ALL SELECT area FROM crm.events
         UNION ALL SELECT area FROM site.events) a
      WHERE NULLIF(btrim(area), '') IS NOT NULL ORDER BY 1`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

/* ── notification recipients ─────────────────────────────────────────── */

// StaffContact is a staff account with its reachable addresses.
type StaffContact struct {
	UserID string
	Email  *string
	Phone  *string
}

// StaffContacts reads the active accounts among userIDs with the phone of
// their employee record.
func (Postgres) StaffContacts(ctx context.Context, q Q, userIDs []string) ([]StaffContact, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	rows, err := q.Query(ctx, `SELECT DISTINCT ON (u.id) u.id::text, u.email, e.phone
       FROM configuration.users u LEFT JOIN hris.employees e ON e.user_id = u.id
      WHERE u.id = ANY($1::uuid[]) AND u.status = 'active'
      ORDER BY u.id, e.created_at DESC`, userIDs)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[StaffContact])
}

// TaskAssignees lists the staff assigned to the event's checklist.
func (Postgres) TaskAssignees(ctx context.Context, q Q, src eventsc.Source, id string) ([]string, error) {
	crmID, siteID := ownerColumns(src, id)
	rows, err := q.Query(ctx, `SELECT DISTINCT assignee_user_id::text FROM events.tasks
      WHERE (crm_event_id = $1::uuid OR site_event_id = $2::uuid) AND assignee_user_id IS NOT NULL`, crmID, siteID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// OverlappingCoachUsers lists the staff accounts of coaches whose classes or
// PT sessions in the branch overlap the span.
func (Postgres) OverlappingCoachUsers(ctx context.Context, q Q, branchID *string, from, to time.Time) ([]string, error) {
	if branchID == nil {
		return nil, nil
	}
	rows, err := q.Query(ctx, `SELECT DISTINCT c.user_id::text FROM gym.coaches c
      WHERE c.user_id IS NOT NULL AND c.status = 'active' AND (
        EXISTS (SELECT 1 FROM gym.class_sessions s WHERE s.coach_id = c.id AND s.branch_id = $1 AND s.status <> 'cancelled'
                   AND s.starts_at < $3 AND s.ends_at > $2)
        OR EXISTS (SELECT 1 FROM gym.pt_appointments a WHERE a.coach_id = c.id AND a.branch_id = $1
                   AND a.status IN ('requested', 'confirmed') AND a.starts_at < $3 AND a.ends_at > $2))`, branchID, from, to)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// FrontDeskUsers lists the active front desk accounts of a branch: users
// holding the gym_front_desk role whose account sits in that branch.
func (Postgres) FrontDeskUsers(ctx context.Context, q Q, branchID *string) ([]string, error) {
	if branchID == nil {
		return nil, nil
	}
	rows, err := q.Query(ctx, `SELECT DISTINCT u.id::text FROM configuration.users u
       JOIN iam.user_roles ur ON ur.user_id = u.id
       JOIN iam.roles r ON r.id = ur.role_id AND r.code = 'gym_front_desk' AND r.deleted_at IS NULL
      WHERE u.status = 'active' AND u.branch_id = $1`, branchID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// EventMembers lists the members holding a confirmed or waitlisted seat.
func (Postgres) EventMembers(ctx context.Context, q Q, crmEventID string) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT customer_id::text FROM crm.event_bookings
      WHERE event_id = $1 AND status IN ('confirmed', 'waitlist') ORDER BY created_at`, crmEventID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// InboxNotice writes a dashboard inbox row (public.notifications, the bell
// every staff screen shows).
func (Postgres) InboxNotice(ctx context.Context, q Q, userID, kind, title, body, link string, metadata map[string]any) error {
	meta, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `INSERT INTO public.notifications (user_id, title, message, type, link, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, userID, title, body, kind, link, string(meta))
	return err
}

/* ── reminders ───────────────────────────────────────────────────────── */

// UpcomingEvent is an event whose reminders may be due.
type UpcomingEvent struct {
	Source          eventsc.Source
	ID              string
	Title           string
	StartsAt        time.Time
	Zone            *time.Location
	BranchID        *string
	OrganiserUserID *string
}

// UpcomingEvents lists published CRM events and unlinked published site
// events starting in (from, to].
func (Postgres) UpcomingEvents(ctx context.Context, q Q, from, to time.Time) ([]UpcomingEvent, error) {
	rows, err := q.Query(ctx, `
SELECT 'crm', e.id::text, e.title, e.starts_at, COALESCE(b.timezone, 'Asia/Jakarta'), e.branch_id::text, e.organiser_user_id::text
  FROM crm.events e LEFT JOIN configuration.branches b ON b.id = e.branch_id
 WHERE e.status = 'published' AND e.starts_at > $1 AND e.starts_at <= $2
UNION ALL
SELECT 'site', s.id::text, s.title, s.starts_at, COALESCE(b.timezone, 'Asia/Jakarta'), s.branch_id::text, s.organiser_user_id::text
  FROM site.events s LEFT JOIN configuration.branches b ON b.id = s.branch_id
 WHERE s.status = 'published' AND s.crm_event_id IS NULL AND s.starts_at > $1 AND s.starts_at <= $2
 ORDER BY 4`, from, to)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (UpcomingEvent, error) {
		var e UpcomingEvent
		var zone string
		err := r.Scan(&e.Source, &e.ID, &e.Title, &e.StartsAt, &zone, &e.BranchID, &e.OrganiserUserID)
		e.Zone = localtime.Zone(zone)
		return e, err
	})
}

// ReminderBooking is a confirmed seat owed a reminder.
type ReminderBooking struct {
	ID         string
	CustomerID string
}

// ReminderBookings lists the confirmed bookings of an event whose member
// keeps booking reminders on (gym.athlete_settings; no row means on).
func (Postgres) ReminderBookings(ctx context.Context, q Q, crmEventID string) ([]ReminderBooking, error) {
	rows, err := q.Query(ctx, `SELECT b.id::text, b.customer_id::text FROM crm.event_bookings b
      WHERE b.event_id = $1 AND b.status = 'confirmed'
        AND NOT EXISTS (SELECT 1 FROM gym.athlete_settings a WHERE a.customer_id = b.customer_id AND NOT a.booking_reminders)
      ORDER BY b.created_at`, crmEventID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[ReminderBooking])
}
