package site

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	eventsc "nuhabit/backend/internal/contracts/events"
	"nuhabit/backend/internal/modules/site/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Repository is the site's own tables.
type Repository interface {
	// InTx runs fn on one transaction: the repository bound to it and the
	// querier other contexts' ports take.
	InTx(ctx context.Context, fn func(repo Repository, q database.Querier) error) error

	Content(ctx context.Context, key string) (map[string]any, error)
	PutContent(ctx context.Context, key string, value map[string]any, userID string, at time.Time) error

	Articles(ctx context.Context, f ArticleFilter) ([]Article, error)
	ArticleByID(ctx context.Context, id string) (*Article, error)
	ArticleBySlug(ctx context.Context, slug string, publishedOnly bool, now time.Time) (*Article, error)
	InsertArticle(ctx context.Context, in ArticleInput, userID string, at time.Time) (*Article, error)
	UpdateArticle(ctx context.Context, id string, in ArticlePatch, at time.Time) (*Article, error)
	DeleteArticle(ctx context.Context, id string) (bool, error)

	Events(ctx context.Context, f EventFilter) ([]Event, error)
	EventByID(ctx context.Context, id string) (*Event, error)
	EventBySlug(ctx context.Context, slug string, publishedOnly bool) (*Event, error)
	InsertEvent(ctx context.Context, in EventInput, userID string, at time.Time) (*Event, error)
	UpdateEvent(ctx context.Context, id string, in EventPatch, at time.Time) (*Event, error)
	DeleteEvent(ctx context.Context, id string) (bool, error)
}

// ErrSlugTaken is a slug another row already uses.
var ErrSlugTaken = errors.New("slug sudah dipakai")

// Service holds the site's use cases.
type Service struct {
	repo     Repository
	branches Branches
	calendar eventsc.Calendar
	now      func() time.Time
}

/* ── content ─────────────────────────────────────────────────────────── */

// Content is the stored value of key merged over its defaults.
func (s *Service) Content(ctx context.Context, key string) (map[string]any, error) {
	stored, err := s.repo.Content(ctx, key)
	if err != nil {
		return nil, err
	}
	return domain.Merge(key, stored), nil
}

// PutContent stores the cleaned value of key and returns the merged view.
func (s *Service) PutContent(ctx context.Context, key string, value map[string]any, userID string) (map[string]any, error) {
	if err := s.repo.PutContent(ctx, key, value, userID, s.now()); err != nil {
		return nil, err
	}
	return s.Content(ctx, key)
}

/* ── articles ────────────────────────────────────────────────────────── */

// Categories are the article categories.
var Categories = []string{"training", "events", "apparel", "news"}

// Statuses are the publication states of articles and events.
var Statuses = []string{"draft", "published"}

// Article is a site.articles row.
type Article struct {
	ID          string        `json:"id"`
	Slug        string        `json:"slug"`
	Title       string        `json:"title"`
	Category    string        `json:"category"`
	Excerpt     *string       `json:"excerpt"`
	CoverImage  *string       `json:"cover_image_url"`
	BodyMD      string        `json:"body_md"`
	Status      string        `json:"status"`
	PublishedAt *httpx.JSTime `json:"published_at"`
	CreatedAt   httpx.JSTime  `json:"created_at"`
	UpdatedAt   httpx.JSTime  `json:"updated_at"`
}

// ArticleInput creates an article.
type ArticleInput struct {
	Slug        string
	Title       string
	Category    string
	Excerpt     *string
	CoverImage  *string
	BodyMD      string
	Status      string
	PublishedAt *time.Time
}

// ArticlePatch changes the fields that are set.
type ArticlePatch struct {
	Slug        *string
	Title       *string
	Category    *string
	Excerpt     **string
	CoverImage  **string
	BodyMD      *string
	Status      *string
	PublishedAt **time.Time
}

// ArticleFilter narrows a listing.
type ArticleFilter struct {
	Category      string
	PublishedOnly bool
	Now           time.Time
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

// slugify is the URL form of a title.
func slugify(title string) string {
	return strings.Trim(nonSlug.ReplaceAllString(strings.ToLower(title), "-"), "-")
}

// slugFor is the requested slug, or one derived from the title.
func slugFor(slug, title string) string {
	if slug != "" {
		return slug
	}
	if s := slugify(title); s != "" {
		return s
	}
	return "artikel"
}

// ListArticles is the staff listing: every article, newest first.
func (s *Service) ListArticles(ctx context.Context) ([]Article, error) {
	return s.repo.Articles(ctx, ArticleFilter{})
}

// PublishedArticles lists published articles of a category (any when empty).
func (s *Service) PublishedArticles(ctx context.Context, category string) ([]Article, error) {
	return s.repo.Articles(ctx, ArticleFilter{Category: category, PublishedOnly: true, Now: s.now()})
}

// PublishedArticle reads one published article by slug.
func (s *Service) PublishedArticle(ctx context.Context, slug string) (*Article, error) {
	return s.repo.ArticleBySlug(ctx, slug, true, s.now())
}

// Article reads one article by id for staff.
func (s *Service) Article(ctx context.Context, id string) (*Article, error) {
	return s.repo.ArticleByID(ctx, id)
}

// CreateArticle inserts an article; publishing without a date stamps now.
func (s *Service) CreateArticle(ctx context.Context, in ArticleInput, userID string) (*Article, error) {
	now := s.now()
	in.Slug = slugFor(in.Slug, in.Title)
	if in.Status == "published" && in.PublishedAt == nil {
		in.PublishedAt = &now
	}
	return s.repo.InsertArticle(ctx, in, userID, now)
}

// UpdateArticle applies a patch; a draft that becomes published without a
// date is stamped now.
func (s *Service) UpdateArticle(ctx context.Context, id string, in ArticlePatch) (*Article, error) {
	now := s.now()
	if in.Status != nil && *in.Status == "published" && in.PublishedAt == nil {
		current, err := s.repo.ArticleByID(ctx, id)
		if err != nil || current == nil {
			return current, err
		}
		if current.PublishedAt == nil {
			at := &now
			in.PublishedAt = &at
		}
	}
	return s.repo.UpdateArticle(ctx, id, in, now)
}

// DeleteArticle removes an article; false when it did not exist.
func (s *Service) DeleteArticle(ctx context.Context, id string) (bool, error) {
	return s.repo.DeleteArticle(ctx, id)
}

/* ── events ──────────────────────────────────────────────────────────── */

// Event is a site.events row with the names of its branch, host coach and
// organiser, and the CRM event it is linked to.
type Event struct {
	ID              string        `json:"id"`
	Slug            string        `json:"slug"`
	Title           string        `json:"title"`
	StartsAt        httpx.JSTime  `json:"starts_at"`
	EndsAt          *httpx.JSTime `json:"ends_at"`
	Location        *string       `json:"location_text"`
	CoverImage      *string       `json:"cover_image_url"`
	BodyMD          string        `json:"body_md"`
	FormSlug        *string       `json:"form_slug"`
	Status          string        `json:"status"`
	BranchID        *string       `json:"branch_id"`
	BranchName      *string       `json:"branch_name"`
	Area            *string       `json:"area"`
	CoachID         *string       `json:"coach_id"`
	CoachName       *string       `json:"coach_name"`
	OrganiserUserID *string       `json:"organiser_user_id"`
	OrganiserName   *string       `json:"organiser_name"`
	CRMEventID      *string       `json:"crm_event_id"`
	CreatedAt       httpx.JSTime  `json:"created_at"`
	UpdatedAt       httpx.JSTime  `json:"updated_at"`
}

// EventInput creates an event.
type EventInput struct {
	Slug            string
	Title           string
	StartsAt        time.Time
	EndsAt          *time.Time
	Location        *string
	CoverImage      *string
	BodyMD          string
	FormSlug        *string
	Status          string
	BranchID        *string
	Area            *string
	CoachID         *string
	OrganiserUserID *string
	// OverrideReason saves over a calendar clash; nil refuses the clash.
	OverrideReason *string
}

// EventPatch changes the fields that are set.
type EventPatch struct {
	Slug            *string
	Title           *string
	StartsAt        *time.Time
	EndsAt          **time.Time
	Location        **string
	CoverImage      **string
	BodyMD          *string
	FormSlug        **string
	Status          *string
	BranchID        **string
	Area            **string
	CoachID         **string
	OrganiserUserID **string
	OverrideReason  *string
}

// SavedEvent is a create or update response: the row and the calendar
// warnings (classes in the same branch at another room).
type SavedEvent struct {
	*Event
	Warnings []eventsc.Clash `json:"warnings"`
}

// ErrOverrideForbidden: the caller sent an override without update on the
// site events menu.
var ErrOverrideForbidden = errors.New("butuh izin mengubah event untuk tetap menyimpan jadwal yang bentrok")

// endOrDefault is the end of a site event; one without an end holds two hours.
func endOrDefault(start time.Time, end *time.Time) time.Time {
	if end != nil {
		return *end
	}
	return start.Add(2 * time.Hour)
}

func (e Event) subject() eventsc.Subject {
	var end *time.Time
	if e.EndsAt != nil {
		t := time.Time(*e.EndsAt)
		end = &t
	}
	start := time.Time(e.StartsAt)
	return eventsc.Subject{Source: eventsc.SourceSite, ID: e.ID, Title: e.Title, BranchID: e.BranchID, Area: e.Area,
		CoachID: e.CoachID, StartsAt: start, EndsAt: endOrDefault(start, end)}
}

// guardCalendar runs the conflict check under the timetable lock. A
// blocking clash is refused unless a reason came with the save and the
// caller may override; the override to record comes back.
func (s *Service) guardCalendar(ctx context.Context, q database.Querier, sub eventsc.Subject, reason *string, userID string, canOverride bool) (eventsc.Report, *eventsc.Override, error) {
	if s.calendar == nil {
		return eventsc.Report{}, nil, nil
	}
	if err := s.calendar.Lock(ctx, q); err != nil {
		return eventsc.Report{}, nil, err
	}
	report, err := s.calendar.Check(ctx, q, sub)
	if err != nil || !report.Blocked() {
		return report, nil, err
	}
	if reason == nil {
		return report, nil, report.Refusal()
	}
	if !canOverride {
		return report, nil, ErrOverrideForbidden
	}
	return report, &eventsc.Override{UserID: userID, Reason: *reason}, nil
}

// afterSave records the override and tells the involved staff when the
// event is, or was, published.
func (s *Service) afterSave(ctx context.Context, q database.Querier, saved *Event, override *eventsc.Override, report eventsc.Report, previous *Event, userID string) error {
	if s.calendar == nil {
		return nil
	}
	sub := saved.subject()
	if override != nil {
		if err := s.calendar.RecordOverride(ctx, q, sub, *override, report); err != nil {
			return err
		}
	}
	wasPublished := previous != nil && previous.Status == "published"
	if saved.Status != "published" && !wasPublished {
		return nil
	}
	// Members register through the CRM event, so a site page change never
	// reaches them.
	change := eventsc.Change{Kind: eventsc.ChangeCreated, Subject: sub, OrganiserUserID: saved.OrganiserUserID, ActorUserID: userID}
	switch {
	case wasPublished && !time.Time(previous.StartsAt).Equal(sub.StartsAt):
		prev := time.Time(previous.StartsAt)
		change.Kind, change.PreviousStartsAt = eventsc.ChangeTimeChanged, &prev
	case wasPublished:
		change.Kind = eventsc.ChangeUpdated
	}
	return s.calendar.Notify(ctx, q, change)
}

// EventFilter narrows a listing.
type EventFilter struct {
	PublishedOnly bool
}

// ListEvents is the staff listing, soonest first.
func (s *Service) ListEvents(ctx context.Context) ([]Event, error) {
	return s.repo.Events(ctx, EventFilter{})
}

// PublishedEvents lists published events, soonest first.
func (s *Service) PublishedEvents(ctx context.Context) ([]Event, error) {
	return s.repo.Events(ctx, EventFilter{PublishedOnly: true})
}

// PublishedEvent reads one published event by slug.
func (s *Service) PublishedEvent(ctx context.Context, slug string) (*Event, error) {
	return s.repo.EventBySlug(ctx, slug, true)
}

// Event reads one event by id for staff.
func (s *Service) Event(ctx context.Context, id string) (*Event, error) {
	return s.repo.EventByID(ctx, id)
}

// CreateEvent inserts an event after the calendar check; canOverride lets
// the caller save over a clash with a reason.
func (s *Service) CreateEvent(ctx context.Context, in EventInput, userID string, canOverride bool) (*SavedEvent, error) {
	in.Slug = slugFor(in.Slug, in.Title)
	sub := eventsc.Subject{Source: eventsc.SourceSite, Title: in.Title, BranchID: in.BranchID, Area: in.Area, CoachID: in.CoachID,
		StartsAt: in.StartsAt, EndsAt: endOrDefault(in.StartsAt, in.EndsAt)}
	var out SavedEvent
	err := s.repo.InTx(ctx, func(repo Repository, q database.Querier) error {
		report, override, err := s.guardCalendar(ctx, q, sub, in.OverrideReason, userID, canOverride)
		if err != nil {
			return err
		}
		out.Warnings = report.Warnings
		if out.Event, err = repo.InsertEvent(ctx, in, userID, s.now()); err != nil {
			return err
		}
		return s.afterSave(ctx, q, out.Event, override, report, nil, userID)
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// UpdateEvent applies a patch after checking the patched event against the
// calendar; nil when the event does not exist.
func (s *Service) UpdateEvent(ctx context.Context, id string, in EventPatch, userID string, canOverride bool) (*SavedEvent, error) {
	var out SavedEvent
	err := s.repo.InTx(ctx, func(repo Repository, q database.Querier) error {
		current, err := repo.EventByID(ctx, id)
		if err != nil || current == nil {
			return err
		}
		report, override, err := s.guardCalendar(ctx, q, patched(*current, in), in.OverrideReason, userID, canOverride)
		if err != nil {
			return err
		}
		out.Warnings = report.Warnings
		if out.Event, err = repo.UpdateEvent(ctx, id, in, s.now()); err != nil || out.Event == nil {
			return err
		}
		return s.afterSave(ctx, q, out.Event, override, report, current, userID)
	})
	if err != nil || out.Event == nil {
		return nil, err
	}
	return &out, nil
}

// patched is the subject the event becomes once the patch applies.
func patched(e Event, p EventPatch) eventsc.Subject {
	sub := e.subject()
	if p.Title != nil {
		sub.Title = *p.Title
	}
	if p.StartsAt != nil {
		sub.StartsAt = *p.StartsAt
	}
	var end *time.Time
	if e.EndsAt != nil {
		t := time.Time(*e.EndsAt)
		end = &t
	}
	if p.EndsAt != nil {
		end = *p.EndsAt
	}
	sub.EndsAt = endOrDefault(sub.StartsAt, end)
	if p.BranchID != nil {
		sub.BranchID = *p.BranchID
	}
	if p.Area != nil {
		sub.Area = *p.Area
	}
	if p.CoachID != nil {
		sub.CoachID = *p.CoachID
	}
	return sub
}

// DeleteEvent removes an event; false when it did not exist. A published
// event's staff hear that it is cancelled.
func (s *Service) DeleteEvent(ctx context.Context, id, userID string) (bool, error) {
	var deleted bool
	err := s.repo.InTx(ctx, func(repo Repository, q database.Querier) error {
		current, err := repo.EventByID(ctx, id)
		if err != nil || current == nil {
			return err
		}
		if s.calendar != nil && current.Status == "published" {
			change := eventsc.Change{Kind: eventsc.ChangeCancelled, Subject: current.subject(), OrganiserUserID: current.OrganiserUserID,
				ActorUserID: userID}
			if err := s.calendar.Notify(ctx, q, change); err != nil {
				return err
			}
		}
		deleted, err = repo.DeleteEvent(ctx, id)
		return err
	})
	return deleted, err
}

/* ── branches ────────────────────────────────────────────────────────── */

// PublicBranches lists the public branches' summaries.
func (s *Service) PublicBranches(ctx context.Context) ([]BranchSummary, error) {
	list, err := s.branches.Public(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]BranchSummary, len(list))
	for i, b := range list {
		out[i] = b.Summary()
	}
	return out, nil
}

// PublicBranch reads one public branch's full profile.
func (s *Service) PublicBranch(ctx context.Context, slug string) (*Branch, error) {
	return s.branches.BySlug(ctx, slug)
}
