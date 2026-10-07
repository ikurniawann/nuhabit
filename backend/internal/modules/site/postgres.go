package site

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Postgres is the Repository on the site schema.
type Postgres struct{ db database.DB }

var _ Repository = Postgres{}

/* ── content ─────────────────────────────────────────────────────────── */

// Content is the stored value of key, nil when staff never saved it.
func (p Postgres) Content(ctx context.Context, key string) (map[string]any, error) {
	var raw []byte
	err := p.db.QueryRow(ctx, `SELECT value FROM site.content WHERE key = $1`, key).Scan(&raw)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var value map[string]any
	return value, json.Unmarshal(raw, &value)
}

// PutContent upserts the value of key.
func (p Postgres) PutContent(ctx context.Context, key string, value map[string]any, userID string, at time.Time) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = p.db.Exec(ctx, `INSERT INTO site.content (key, value, updated_at, updated_by) VALUES ($1, $2, $3, $4)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
		key, raw, at, userID)
	return err
}

/* ── articles ────────────────────────────────────────────────────────── */

const articleColumns = `id::text, slug, title, category, excerpt, cover_image_url, body_md, status, published_at, created_at, updated_at`

func scanArticle(row pgx.Row) (*Article, error) {
	var a Article
	var published *time.Time
	var created, updated time.Time
	if err := row.Scan(&a.ID, &a.Slug, &a.Title, &a.Category, &a.Excerpt, &a.CoverImage, &a.BodyMD, &a.Status,
		&published, &created, &updated); err != nil {
		return nil, err
	}
	a.PublishedAt = httpx.NewJSTime(published)
	a.CreatedAt, a.UpdatedAt = httpx.JSTime(created), httpx.JSTime(updated)
	return &a, nil
}

func one[T any](scan func(pgx.Row) (*T, error), row pgx.Row) (*T, error) {
	v, err := scan(row)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return v, err
}

func many[T any](ctx context.Context, q database.Querier, scan func(pgx.Row) (*T, error), sql string, args ...any) ([]T, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []T{}
	for rows.Next() {
		v, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

// Articles lists articles newest first (by publish date, then creation).
func (p Postgres) Articles(ctx context.Context, f ArticleFilter) ([]Article, error) {
	where := []string{"true"}
	var args []any
	if f.Category != "" {
		args = append(args, f.Category)
		where = append(where, "category = $"+strconv.Itoa(len(args)))
	}
	if f.PublishedOnly {
		args = append(args, f.Now)
		where = append(where, "status = 'published' AND published_at <= $"+strconv.Itoa(len(args)))
	}
	return many(ctx, p.db, scanArticle, `SELECT `+articleColumns+` FROM site.articles WHERE `+strings.Join(where, " AND ")+
		` ORDER BY coalesce(published_at, created_at) DESC, created_at DESC`, args...)
}

// ArticleByID reads one article, nil when none.
func (p Postgres) ArticleByID(ctx context.Context, id string) (*Article, error) {
	return one(scanArticle, p.db.QueryRow(ctx, `SELECT `+articleColumns+` FROM site.articles WHERE id = $1`, id))
}

// ArticleBySlug reads one article by slug, published and live only when asked.
func (p Postgres) ArticleBySlug(ctx context.Context, slug string, publishedOnly bool, now time.Time) (*Article, error) {
	return one(scanArticle, p.db.QueryRow(ctx, `SELECT `+articleColumns+` FROM site.articles
		WHERE slug = $1 AND ($2 = false OR (status = 'published' AND published_at <= $3))`, slug, publishedOnly, now))
}

// write runs a statement that may hit the slug index inside a savepoint,
// so a duplicate answers ErrSlugTaken without aborting the caller's
// transaction, and maps no rows to nil.
func write[T any](ctx context.Context, db database.DB, scan func(pgx.Row) (*T, error), sql string, args ...any) (*T, error) {
	var out *T
	err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
		v, err := scan(tx.QueryRow(ctx, sql, args...))
		out = v
		return err
	})
	switch {
	case database.IsUniqueViolation(err):
		return nil, ErrSlugTaken
	case database.IsNoRows(err):
		return nil, nil
	}
	return out, err
}

// InsertArticle writes a new article; ErrSlugTaken on a duplicate slug.
func (p Postgres) InsertArticle(ctx context.Context, in ArticleInput, userID string, at time.Time) (*Article, error) {
	return write(ctx, p.db, scanArticle, `INSERT INTO site.articles
		(slug, title, category, excerpt, cover_image_url, body_md, status, published_at, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING `+articleColumns,
		in.Slug, in.Title, in.Category, in.Excerpt, in.CoverImage, in.BodyMD, in.Status, in.PublishedAt, userID, at)
}

// setList builds a SET clause from the patch fields that are set.
type setList struct {
	sets []string
	args []any
}

func (s *setList) add(col string, v any) {
	s.args = append(s.args, v)
	s.sets = append(s.sets, col+" = $"+strconv.Itoa(len(s.args)))
}

// UpdateArticle applies the set fields; nil when the article does not exist.
func (p Postgres) UpdateArticle(ctx context.Context, id string, in ArticlePatch, at time.Time) (*Article, error) {
	var s setList
	if in.Slug != nil {
		s.add("slug", *in.Slug)
	}
	if in.Title != nil {
		s.add("title", *in.Title)
	}
	if in.Category != nil {
		s.add("category", *in.Category)
	}
	if in.Excerpt != nil {
		s.add("excerpt", *in.Excerpt)
	}
	if in.CoverImage != nil {
		s.add("cover_image_url", *in.CoverImage)
	}
	if in.BodyMD != nil {
		s.add("body_md", *in.BodyMD)
	}
	if in.Status != nil {
		s.add("status", *in.Status)
	}
	if in.PublishedAt != nil {
		s.add("published_at", *in.PublishedAt)
	}
	s.add("updated_at", at)
	s.args = append(s.args, id)
	return write(ctx, p.db, scanArticle, `UPDATE site.articles SET `+strings.Join(s.sets, ", ")+
		` WHERE id = $`+strconv.Itoa(len(s.args))+` RETURNING `+articleColumns, s.args...)
}

// DeleteArticle removes an article.
func (p Postgres) DeleteArticle(ctx context.Context, id string) (bool, error) {
	tag, err := p.db.Exec(ctx, `DELETE FROM site.articles WHERE id = $1`, id)
	return tag.RowsAffected() > 0, err
}

/* ── events ──────────────────────────────────────────────────────────── */

const eventColumns = `id::text, slug, title, starts_at, ends_at, location_text, cover_image_url, body_md, form_slug, status, created_at, updated_at`

func scanEvent(row pgx.Row) (*Event, error) {
	var e Event
	var starts, created, updated time.Time
	var ends *time.Time
	if err := row.Scan(&e.ID, &e.Slug, &e.Title, &starts, &ends, &e.Location, &e.CoverImage, &e.BodyMD, &e.FormSlug,
		&e.Status, &created, &updated); err != nil {
		return nil, err
	}
	e.StartsAt, e.EndsAt = httpx.JSTime(starts), httpx.NewJSTime(ends)
	e.CreatedAt, e.UpdatedAt = httpx.JSTime(created), httpx.JSTime(updated)
	return &e, nil
}

// Events lists events soonest first.
func (p Postgres) Events(ctx context.Context, f EventFilter) ([]Event, error) {
	return many(ctx, p.db, scanEvent, `SELECT `+eventColumns+` FROM site.events
		WHERE $1 = false OR status = 'published' ORDER BY starts_at ASC, created_at DESC`, f.PublishedOnly)
}

// EventByID reads one event, nil when none.
func (p Postgres) EventByID(ctx context.Context, id string) (*Event, error) {
	return one(scanEvent, p.db.QueryRow(ctx, `SELECT `+eventColumns+` FROM site.events WHERE id = $1`, id))
}

// EventBySlug reads one event by slug, published only when asked.
func (p Postgres) EventBySlug(ctx context.Context, slug string, publishedOnly bool) (*Event, error) {
	return one(scanEvent, p.db.QueryRow(ctx, `SELECT `+eventColumns+` FROM site.events
		WHERE slug = $1 AND ($2 = false OR status = 'published')`, slug, publishedOnly))
}

// InsertEvent writes a new event; ErrSlugTaken on a duplicate slug.
func (p Postgres) InsertEvent(ctx context.Context, in EventInput, userID string, at time.Time) (*Event, error) {
	return write(ctx, p.db, scanEvent, `INSERT INTO site.events
		(slug, title, starts_at, ends_at, location_text, cover_image_url, body_md, form_slug, status, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING `+eventColumns,
		in.Slug, in.Title, in.StartsAt, in.EndsAt, in.Location, in.CoverImage, in.BodyMD, in.FormSlug, in.Status, userID, at)
}

// UpdateEvent applies the set fields; nil when the event does not exist.
func (p Postgres) UpdateEvent(ctx context.Context, id string, in EventPatch, at time.Time) (*Event, error) {
	var s setList
	if in.Slug != nil {
		s.add("slug", *in.Slug)
	}
	if in.Title != nil {
		s.add("title", *in.Title)
	}
	if in.StartsAt != nil {
		s.add("starts_at", *in.StartsAt)
	}
	if in.EndsAt != nil {
		s.add("ends_at", *in.EndsAt)
	}
	if in.Location != nil {
		s.add("location_text", *in.Location)
	}
	if in.CoverImage != nil {
		s.add("cover_image_url", *in.CoverImage)
	}
	if in.BodyMD != nil {
		s.add("body_md", *in.BodyMD)
	}
	if in.FormSlug != nil {
		s.add("form_slug", *in.FormSlug)
	}
	if in.Status != nil {
		s.add("status", *in.Status)
	}
	s.add("updated_at", at)
	s.args = append(s.args, id)
	return write(ctx, p.db, scanEvent, `UPDATE site.events SET `+strings.Join(s.sets, ", ")+
		` WHERE id = $`+strconv.Itoa(len(s.args))+` RETURNING `+eventColumns, s.args...)
}

// DeleteEvent removes an event.
func (p Postgres) DeleteEvent(ctx context.Context, id string) (bool, error) {
	tag, err := p.db.Exec(ctx, `DELETE FROM site.events WHERE id = $1`, id)
	return tag.RowsAffected() > 0, err
}
