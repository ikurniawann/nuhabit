package site

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/site/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// Repository is the site's own tables.
type Repository interface {
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

// Event is a site.events row.
type Event struct {
	ID         string        `json:"id"`
	Slug       string        `json:"slug"`
	Title      string        `json:"title"`
	StartsAt   httpx.JSTime  `json:"starts_at"`
	EndsAt     *httpx.JSTime `json:"ends_at"`
	Location   *string       `json:"location_text"`
	CoverImage *string       `json:"cover_image_url"`
	BodyMD     string        `json:"body_md"`
	FormSlug   *string       `json:"form_slug"`
	Status     string        `json:"status"`
	CreatedAt  httpx.JSTime  `json:"created_at"`
	UpdatedAt  httpx.JSTime  `json:"updated_at"`
}

// EventInput creates an event.
type EventInput struct {
	Slug       string
	Title      string
	StartsAt   time.Time
	EndsAt     *time.Time
	Location   *string
	CoverImage *string
	BodyMD     string
	FormSlug   *string
	Status     string
}

// EventPatch changes the fields that are set.
type EventPatch struct {
	Slug       *string
	Title      *string
	StartsAt   *time.Time
	EndsAt     **time.Time
	Location   **string
	CoverImage **string
	BodyMD     *string
	FormSlug   **string
	Status     *string
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

// CreateEvent inserts an event.
func (s *Service) CreateEvent(ctx context.Context, in EventInput, userID string) (*Event, error) {
	in.Slug = slugFor(in.Slug, in.Title)
	return s.repo.InsertEvent(ctx, in, userID, s.now())
}

// UpdateEvent applies a patch.
func (s *Service) UpdateEvent(ctx context.Context, id string, in EventPatch) (*Event, error) {
	return s.repo.UpdateEvent(ctx, id, in, s.now())
}

// DeleteEvent removes an event; false when it did not exist.
func (s *Service) DeleteEvent(ctx context.Context, id string) (bool, error) {
	return s.repo.DeleteEvent(ctx, id)
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
