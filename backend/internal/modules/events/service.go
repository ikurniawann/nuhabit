package events

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	eventsc "nuhabit/backend/internal/contracts/events"
	"nuhabit/backend/internal/modules/events/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/jobs"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/members"
)

// StaffChannels delivers a staff notice on WhatsApp and email, best effort,
// returning at once; internal/app wires the gym channels.
type StaffChannels interface {
	SendTo(phone, email *string, title, body string)
}

// Ports are the capabilities of other contexts the module uses.
type Ports struct {
	// Channels may be nil: staff then hear through the inbox only.
	Channels StaffChannels
}

// Service holds the calendar use cases. It is also the eventsc.Calendar
// the CRM and site writers call on their own transactions.
type Service struct {
	db       database.DB
	repo     Postgres
	channels StaffChannels
	now      func() time.Time
	log      *slog.Logger
}

var _ eventsc.Calendar = (*Service)(nil)

// NewService builds the service on db: the pool in production, a rolled
// back transaction in tests.
func NewService(db database.DB, p Ports, now func() time.Time, log *slog.Logger) *Service {
	if now == nil {
		now = time.Now
	}
	if log == nil {
		log = slog.Default()
	}
	return &Service{db: db, repo: Postgres{}, channels: p.Channels, now: now, log: log}
}

func (s *Service) inTx(ctx context.Context, fn func(q Q) error) error {
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error { return fn(tx) })
}

// CalendarLink is the dashboard page a notice opens, on the event's day.
func CalendarLink(at time.Time, zone *time.Location) string {
	return "/dashboard/events/calendar?date=" + localtime.DayKey(at, zone)
}

/* ── eventsc.Calendar ────────────────────────────────────────────────── */

// Lock takes the timetable lock for the rest of the transaction.
func (s *Service) Lock(ctx context.Context, q database.Querier) error {
	return s.repo.LockSchedule(ctx, q)
}

// Check lists the clashes of the subject with the rest of the calendar.
func (s *Service) Check(ctx context.Context, q database.Querier, sub eventsc.Subject) (eventsc.Report, error) {
	others, err := s.repo.Neighbours(ctx, q, sub)
	if err != nil {
		return eventsc.Report{}, err
	}
	return domain.Detect(sub, others), nil
}

// RecordOverride stores the "tetap simpan" against the saved event.
func (s *Service) RecordOverride(ctx context.Context, q database.Querier, sub eventsc.Subject, o eventsc.Override, r eventsc.Report) error {
	return s.repo.InsertOverride(ctx, q, sub, o, r)
}

// inboxKind maps a change to the public.notifications type.
func inboxKind(k eventsc.ChangeKind) string {
	if k == eventsc.ChangeCancelled {
		return "alert"
	}
	return "status_change"
}

// staffNotice words a change for staff, in the event's branch zone.
func staffNotice(c eventsc.Change, zone *time.Location, branchName *string) (title, body string) {
	sub := c.Subject
	span := localtime.FormatSpan(sub.StartsAt, sub.EndsAt, zone)
	where := ""
	if branchName != nil {
		where = " di " + *branchName
		if sub.Area != nil && *sub.Area != "" {
			where += " · " + *sub.Area
		}
	}
	switch c.Kind {
	case eventsc.ChangeCreated:
		return "Event baru: " + sub.Title, sub.Title + " dijadwalkan " + span + where + "."
	case eventsc.ChangeTimeChanged:
		from := ""
		if c.PreviousStartsAt != nil {
			from = " dari " + localtime.Format(*c.PreviousStartsAt, zone)
		}
		return "Jadwal event berubah: " + sub.Title, sub.Title + " pindah" + from + " ke " + span + where + "."
	case eventsc.ChangeCancelled:
		return "Event dibatalkan: " + sub.Title, sub.Title + " pada " + span + where + " dibatalkan."
	}
	return "Event diperbarui: " + sub.Title, "Detail " + sub.Title + " (" + span + where + ") diubah."
}

// Notify fans a change out: the organiser and the checklist assignees get
// the inbox row plus WhatsApp and email; coaches with overlapping classes
// and the branch front desk get the inbox row; registered members hear
// about a time change or a cancellation when asked. The actor is skipped.
func (s *Service) Notify(ctx context.Context, q database.Querier, c eventsc.Change) error {
	sub := c.Subject
	branchName, zone, err := s.repo.Branch(ctx, q, sub.BranchID)
	if err != nil {
		return err
	}
	assigned, err := s.repo.TaskAssignees(ctx, q, sub.Source, sub.ID)
	if err != nil {
		return err
	}
	if c.OrganiserUserID != nil {
		assigned = append(assigned, *c.OrganiserUserID)
	}
	coaches, err := s.repo.OverlappingCoachUsers(ctx, q, sub.BranchID, sub.StartsAt, sub.EndsAt)
	if err != nil {
		return err
	}
	desk, err := s.repo.FrontDeskUsers(ctx, q, sub.BranchID)
	if err != nil {
		return err
	}
	title, body := staffNotice(c, zone, branchName)
	link := CalendarLink(sub.StartsAt, zone)
	meta := map[string]any{"event_source": sub.Source, "event_id": sub.ID, "change": c.Kind}
	seen := map[string]bool{c.ActorUserID: true}
	for _, id := range slices.Concat(assigned, coaches, desk) {
		if seen[id] {
			continue
		}
		seen[id] = true
		if err := s.repo.InboxNotice(ctx, q, id, inboxKind(c.Kind), title, body, link, meta); err != nil {
			return err
		}
	}
	if err := s.sendChannels(ctx, q, withoutActor(assigned, c.ActorUserID), title, body); err != nil {
		return err
	}
	if !c.NotifyMembers || (c.Kind != eventsc.ChangeTimeChanged && c.Kind != eventsc.ChangeCancelled) {
		return nil
	}
	return s.notifyMembers(ctx, q, c, zone)
}

func withoutActor(ids []string, actor string) []string {
	return slices.DeleteFunc(slices.Clone(ids), func(id string) bool { return id == actor })
}

// sendChannels reaches the staff accounts outside the app, best effort.
func (s *Service) sendChannels(ctx context.Context, q database.Querier, userIDs []string, title, body string) error {
	if s.channels == nil || len(userIDs) == 0 {
		return nil
	}
	contacts, err := s.repo.StaffContacts(ctx, q, userIDs)
	if err != nil {
		return err
	}
	for _, c := range contacts {
		s.channels.SendTo(c.Phone, c.Email, title, body)
	}
	return nil
}

// notifyMembers tells the registered members of the CRM event (the linked
// one when the subject is a site event).
func (s *Service) notifyMembers(ctx context.Context, q database.Querier, c eventsc.Change, zone *time.Location) error {
	src, id, found, err := s.repo.Canonical(ctx, q, c.Subject.Source, c.Subject.ID)
	if err != nil || !found || src != eventsc.SourceCRM {
		return err
	}
	ids, err := s.repo.EventMembers(ctx, q, id)
	if err != nil {
		return err
	}
	n := members.Notice{Type: "event_rescheduled", Title: "Jadwal berubah: " + c.Subject.Title,
		Body: "Event pindah ke " + localtime.FormatSpan(c.Subject.StartsAt, c.Subject.EndsAt, zone) + ". Pendaftaran Anda tetap berlaku."}
	if c.Kind == eventsc.ChangeCancelled {
		n = members.Notice{Type: "event_cancelled", Title: "Dibatalkan: " + c.Subject.Title,
			Body: "Event " + localtime.Format(c.Subject.StartsAt, zone) + " dibatalkan. Mohon maaf atas ketidaknyamanannya."}
	}
	for _, customerID := range ids {
		if err := members.Notify(ctx, q, customerID, n); err != nil {
			return err
		}
	}
	return nil
}

/* ── reads ───────────────────────────────────────────────────────────── */

// Calendar lists the entries of a window.
func (s *Service) Calendar(ctx context.Context, f CalendarFilter) ([]CalendarEntry, error) {
	return s.repo.Entries(ctx, s.db, f)
}

// Options are the pick lists of the event forms and the calendar filters.
type Options struct {
	Branches  []Option `json:"branches"`
	Coaches   []Option `json:"coaches"`
	Staff     []Option `json:"staff"`
	Areas     []string `json:"areas"`
	TaskKinds []string `json:"task_kinds"`
}

// Options reads every pick list at once.
func (s *Service) Options(ctx context.Context) (Options, error) {
	var o Options
	var err error
	if o.Branches, err = s.repo.Branches(ctx, s.db); err != nil {
		return o, err
	}
	if o.Coaches, err = s.repo.Coaches(ctx, s.db); err != nil {
		return o, err
	}
	if o.Staff, err = s.repo.StaffUsers(ctx, s.db); err != nil {
		return o, err
	}
	if o.Areas, err = s.repo.Areas(ctx, s.db); err != nil {
		return o, err
	}
	o.TaskKinds = TaskKinds
	return o, nil
}

/* ── links ───────────────────────────────────────────────────────────── */

// ErrNotLinkable: one side is missing, cancelled or already linked.
var ErrNotLinkable = errors.New("event tidak bisa ditautkan")

// Link ties a CRM event to a site event.
func (s *Service) Link(ctx context.Context, crmID, siteID string) error {
	return s.inTx(ctx, func(q Q) error {
		ok, err := s.repo.Link(ctx, q, crmID, siteID)
		if err == nil && !ok {
			return ErrNotLinkable
		}
		return err
	})
}

// Unlink separates a CRM event from its site twin; false when it had none.
func (s *Service) Unlink(ctx context.Context, crmID string) (bool, error) {
	var ok bool
	err := s.inTx(ctx, func(q Q) error {
		var err error
		ok, err = s.repo.Unlink(ctx, q, crmID)
		return err
	})
	return ok, err
}

// PublishToSite makes a site draft out of a CRM event and links them.
func (s *Service) PublishToSite(ctx context.Context, crmID, userID string) (string, error) {
	var siteID string
	err := s.inTx(ctx, func(q Q) error {
		var err error
		siteID, err = s.repo.PublishToSite(ctx, q, crmID, userID, s.now())
		if err == nil && siteID == "" {
			return ErrNotLinkable
		}
		return err
	})
	return siteID, err
}

// Candidates lists the unlinked events on the other side of source.
func (s *Service) Candidates(ctx context.Context, src eventsc.Source) ([]EventRef, error) {
	if src == eventsc.SourceSite {
		return s.repo.UnlinkedCRMEvents(ctx, s.db, s.now())
	}
	return s.repo.UnlinkedSiteEvents(ctx, s.db, s.now())
}

/* ── tasks ───────────────────────────────────────────────────────────── */

// ErrEventNotFound is an unknown event reference.
var ErrEventNotFound = errors.New("event tidak ditemukan")

// Tasks lists the checklist of an event, following a site event's link.
func (s *Service) Tasks(ctx context.Context, src eventsc.Source, id string) ([]Task, error) {
	src, id, found, err := s.repo.Canonical(ctx, s.db, src, id)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, ErrEventNotFound
	}
	return s.repo.Tasks(ctx, s.db, src, id)
}

// AddTask appends a checklist line and tells its assignee.
func (s *Service) AddTask(ctx context.Context, src eventsc.Source, id string, in TaskInput, userID string) (*Task, error) {
	var out *Task
	err := s.inTx(ctx, func(q Q) error {
		src, id, found, err := s.repo.Canonical(ctx, q, src, id)
		if err != nil {
			return err
		}
		if !found {
			return ErrEventNotFound
		}
		if out, err = s.repo.InsertTask(ctx, q, src, id, in, userID); err != nil {
			return err
		}
		return s.tellAssignee(ctx, q, *out, userID)
	})
	return out, err
}

// tellAssignee writes the inbox row of a new assignment; the creator
// assigning themselves hears nothing.
func (s *Service) tellAssignee(ctx context.Context, q Q, t Task, actorID string) error {
	if t.AssigneeUserID == nil || *t.AssigneeUserID == actorID {
		return nil
	}
	body := "Anda ditugaskan: " + t.Title
	if t.DueAt != nil {
		body += ", tenggat " + localtime.FormatDateTime(time.Time(*t.DueAt), nil)
	}
	return s.repo.InboxNotice(ctx, q, *t.AssigneeUserID, "status_change", "Tugas event baru", body+".",
		"/dashboard/events/calendar", map[string]any{"task_id": t.ID})
}

// PatchTask edits a checklist line; nil when it does not exist. A new
// assignee is told.
func (s *Service) PatchTask(ctx context.Context, id string, p TaskPatch, userID string) (*Task, error) {
	var out *Task
	err := s.inTx(ctx, func(q Q) error {
		var err error
		if out, err = s.repo.UpdateTask(ctx, q, id, p); err != nil || out == nil || p.AssigneeUserID == nil {
			return err
		}
		return s.tellAssignee(ctx, q, *out, userID)
	})
	return out, err
}

// RemoveTask deletes a checklist line.
func (s *Service) RemoveTask(ctx context.Context, id string) (bool, error) {
	return s.repo.DeleteTask(ctx, s.db, id)
}

/* ── feeds ───────────────────────────────────────────────────────────── */

// FeedPath is the public route of the ICS feed; the token goes in the query.
const FeedPath = "/api/public/events/calendar.ics"

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// CreateFeed mints a subscription token for a branch (nil: every branch).
// The raw token is returned once; only its hash is stored.
func (s *Service) CreateFeed(ctx context.Context, userID string, branchID *string, label string) (id, token string, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	token = hex.EncodeToString(raw)
	id, err = s.repo.InsertFeed(ctx, s.db, hashToken(token), branchID, userID, label)
	return id, token, err
}

// Feeds lists the caller's live subscriptions.
func (s *Service) Feeds(ctx context.Context, userID string) ([]Feed, error) {
	return s.repo.Feeds(ctx, s.db, userID)
}

// RevokeFeed stops one of the caller's subscriptions.
func (s *Service) RevokeFeed(ctx context.Context, id, userID string) (bool, error) {
	return s.repo.RevokeFeed(ctx, s.db, id, userID)
}

// Feed window: a week back, a quarter ahead.
const (
	feedBack  = 7 * 24 * time.Hour
	feedAhead = 90 * 24 * time.Hour
)

// FeedICS renders the calendar a token subscribes to; found is false for an
// unknown or revoked token.
func (s *Service) FeedICS(ctx context.Context, token string) (ics string, found bool, err error) {
	branchID, branchName, found, err := s.repo.FeedByHash(ctx, s.db, hashToken(token))
	if err != nil || !found {
		return "", false, err
	}
	now := s.now()
	entries, err := s.repo.Entries(ctx, s.db, CalendarFilter{From: now.Add(-feedBack), To: now.Add(feedAhead), BranchID: branchID})
	if err != nil {
		return "", false, err
	}
	list := make([]domain.ICSEntry, len(entries))
	for i, e := range entries {
		list[i] = e.ics()
	}
	name := "NüHabit · Kalender Event"
	if branchName != nil {
		name += " · " + *branchName
	}
	return domain.RenderICS(name, list, now), true, nil
}

/* ── export ──────────────────────────────────────────────────────────── */

// ErrBadMonth is a month outside "YYYY-MM".
var ErrBadMonth = errors.New("bulan harus YYYY-MM")

// MonthCSV exports the entries of a month (in the branch zone, Jakarta
// without a branch) as UTF-8 CSV with a byte order mark for Excel.
func (s *Service) MonthCSV(ctx context.Context, month string, branchID *string) ([]byte, error) {
	_, zone, err := s.repo.Branch(ctx, s.db, branchID)
	if err != nil {
		return nil, err
	}
	first, err := time.ParseInLocation("2006-01", month, zone)
	if err != nil {
		return nil, ErrBadMonth
	}
	entries, err := s.repo.Entries(ctx, s.db, CalendarFilter{From: first, To: first.AddDate(0, 1, 0), BranchID: branchID})
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	buf.Write([]byte{0xEF, 0xBB, 0xBF})
	w := csv.NewWriter(&buf)
	_ = w.Write([]string{"Tanggal", "Mulai", "Selesai", "Zona", "Jenis", "Judul", "Cabang", "Area", "Coach", "Status", "Kapasitas", "Terdaftar"})
	for _, e := range entries {
		z := localtime.Zone(e.Timezone)
		start, end := time.Time(e.StartsAt).In(z), time.Time(e.EndsAt).In(z)
		_ = w.Write([]string{start.Format(time.DateOnly), start.Format("15:04"), end.Format("15:04"), localtime.Abbrev(z),
			kindName(e.Kind), e.Title, deref(e.BranchName), deref(e.Area), deref(e.CoachName), e.Status, intStr(e.Capacity), intStr(e.Confirmed)})
	}
	w.Flush()
	return buf.Bytes(), w.Error()
}

func kindName(k eventsc.Kind) string {
	switch k {
	case eventsc.KindCRMEvent:
		return "Event member"
	case eventsc.KindSiteEvent:
		return "Event situs"
	case eventsc.KindClass:
		return "Kelas"
	}
	return "PT"
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func intStr(n *int) string {
	if n == nil {
		return ""
	}
	return strconv.Itoa(*n)
}

/* ── reminders ───────────────────────────────────────────────────────── */

// reminderKind is the platform.reminder_sends kind of event reminders.
const reminderKind = "event_reminder"

// SendReminders sends the 24 h and 2 h reminders of published events: to
// members with a confirmed seat (members.Notify) and to the organiser and
// checklist assignees (inbox). The sent log keeps a rerun from sending
// twice; one failure does not stop the others.
func (s *Service) SendReminders(ctx context.Context, now time.Time) error {
	upcoming, err := s.repo.UpcomingEvents(ctx, s.db, now, now.Add(domain.ReminderHorizon))
	if err != nil {
		return err
	}
	var errs []error
	for _, e := range upcoming {
		w := domain.DueWindow(e.StartsAt, now)
		if w == nil {
			continue
		}
		period := domain.ReminderPeriod(*w, e.StartsAt)
		if err := s.remindMembers(ctx, e, period); err != nil {
			errs = append(errs, err)
		}
		if err := s.remindStaff(ctx, e, period); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (s *Service) remindMembers(ctx context.Context, e UpcomingEvent, period string) error {
	if e.Source != eventsc.SourceCRM {
		return nil
	}
	bookings, err := s.repo.ReminderBookings(ctx, s.db, e.ID)
	if err != nil {
		return err
	}
	n := members.Notice{Type: reminderKind, Title: "Pengingat event: " + e.Title,
		Body: "Event mulai " + localtime.Format(e.StartsAt, e.Zone) + ". Sampai jumpa di lokasi."}
	var errs []error
	for _, b := range bookings {
		err := s.inTx(ctx, func(q Q) error {
			claimed, err := jobs.ClaimSend(ctx, q, reminderKind, b.ID, period, &b.CustomerID)
			if err != nil || !claimed {
				return err
			}
			return members.Notify(ctx, q, b.CustomerID, n)
		})
		if err != nil {
			errs = append(errs, fmt.Errorf("booking %s: %w", b.ID, err))
		}
	}
	return errors.Join(errs...)
}

func (s *Service) remindStaff(ctx context.Context, e UpcomingEvent, period string) error {
	ids, err := s.repo.TaskAssignees(ctx, s.db, e.Source, e.ID)
	if err != nil {
		return err
	}
	if e.OrganiserUserID != nil {
		ids = append(ids, *e.OrganiserUserID)
	}
	title := "Pengingat event: " + e.Title
	body := e.Title + " mulai " + localtime.Format(e.StartsAt, e.Zone) + ". Cek checklist dan persiapan lokasi."
	meta := map[string]any{"event_source": e.Source, "event_id": e.ID}
	var errs []error
	for _, id := range slices.Compact(slices.Sorted(slices.Values(ids))) {
		err := s.inTx(ctx, func(q Q) error {
			claimed, err := jobs.ClaimSend(ctx, q, reminderKind, "staff:"+e.ID+":"+id, period, nil)
			if err != nil || !claimed {
				return err
			}
			return s.repo.InboxNotice(ctx, q, id, "reminder", title, body, CalendarLink(e.StartsAt, e.Zone), meta)
		})
		if err != nil {
			errs = append(errs, fmt.Errorf("staff %s: %w", id, err))
		}
	}
	return errors.Join(errs...)
}
