package investor

import (
	"context"
	"errors"
	"io/fs"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/storage"
)

// Progres: the updates the directors write for investors, with
// attachments stored under uploads/investor-updates (staff session to
// read). Investors see published updates only, without the author.

const (
	maxTitleLen      = 200
	maxBodyLen       = 20_000
	attachmentBucket = "investor-updates"
	maxAttachment    = storage.MaxFileSize
)

// attachmentTypes are the declared MIME types accepted when the bytes do
// not sniff as a PDF or image.
var attachmentTypes = map[string]bool{
	"application/pdf": true,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":   true,
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         true,
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
	"application/msword": true,
	"text/csv":           true,
}

// Attachment is a file on an update.
type Attachment struct {
	ID        string       `json:"id"`
	Name      string       `json:"name"`
	Mime      string       `json:"mime"`
	SizeBytes int64        `json:"size_bytes"`
	URL       string       `json:"url"`
	CreatedAt httpx.JSTime `json:"created_at"`
}

// Update is an investor update as investors read it.
type Update struct {
	ID          string        `json:"id"`
	Title       string        `json:"title"`
	Body        string        `json:"body"`
	Status      string        `json:"status"`
	PublishedAt *httpx.JSTime `json:"published_at"`
	UpdatedAt   httpx.JSTime  `json:"updated_at"`
	Attachments []Attachment  `json:"attachments"`
}

// ManagedUpdate is an update as the editor lists it.
type ManagedUpdate struct {
	Update
	CreatedByName *string      `json:"created_by_name"`
	CreatedAt     httpx.JSTime `json:"created_at"`
}

// Document is an attachment of a published update, as the Dokumen page
// lists it.
type Document struct {
	Attachment
	UpdateID    string       `json:"update_id"`
	UpdateTitle string       `json:"update_title"`
	PublishedAt httpx.JSTime `json:"published_at"`
}

// UpdateInput is the editor's create and edit body.
type UpdateInput struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

func (in UpdateInput) clean() (UpdateInput, error) {
	in.Title = strings.TrimSpace(in.Title)
	in.Body = strings.TrimSpace(in.Body)
	switch {
	case in.Title == "":
		return in, httpx.BadRequest("Judul wajib diisi")
	case utf8.RuneCountInString(in.Title) > maxTitleLen:
		return in, httpx.BadRequest("Judul maksimal 200 karakter")
	case utf8.RuneCountInString(in.Body) > maxBodyLen:
		return in, httpx.BadRequest("Isi maksimal 20.000 karakter")
	}
	return in, nil
}

const updateCols = `u.id::text, u.title, u.body, u.status, u.published_at, u.updated_at, u.created_by_name, u.created_at`

func scanManaged(row pgx.CollectableRow) (ManagedUpdate, error) {
	var m ManagedUpdate
	var published *time.Time
	var updated, created time.Time
	err := row.Scan(&m.ID, &m.Title, &m.Body, &m.Status, &published, &updated, &m.CreatedByName, &created)
	m.PublishedAt, m.UpdatedAt, m.CreatedAt = httpx.NewJSTime(published), httpx.JSTime(updated), httpx.JSTime(created)
	m.Attachments = []Attachment{}
	return m, err
}

// queryUpdates lists updates matching where, newest first, with attachments.
func (s *Service) queryUpdates(ctx context.Context, where string, args ...any) ([]ManagedUpdate, error) {
	rows, err := s.db.Query(ctx, `SELECT `+updateCols+` FROM investor.updates u WHERE `+where+`
		ORDER BY COALESCE(u.published_at, u.created_at) DESC, u.created_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, scanManaged)
	if err != nil {
		return nil, err
	}
	if list == nil {
		list = []ManagedUpdate{}
	}
	index := map[string]int{}
	ids := make([]string, len(list))
	for i, u := range list {
		index[u.ID] = i
		ids[i] = u.ID
	}
	rows, err = s.db.Query(ctx, `SELECT update_id::text, id::text, name, mime, size_bytes, url, created_at
		FROM investor.update_attachments WHERE update_id = ANY($1::uuid[]) ORDER BY created_at`, ids)
	if err != nil {
		return nil, err
	}
	var updateID string
	var a Attachment
	var created time.Time
	_, err = pgx.ForEachRow(rows, []any{&updateID, &a.ID, &a.Name, &a.Mime, &a.SizeBytes, &a.URL, &created}, func() error {
		a.CreatedAt = httpx.JSTime(created)
		u := &list[index[updateID]]
		u.Attachments = append(u.Attachments, a)
		return nil
	})
	return list, err
}

// Published lists the published updates, newest first.
func (s *Service) Published(ctx context.Context) ([]Update, error) {
	list, err := s.queryUpdates(ctx, `u.status = 'published'`)
	if err != nil {
		return nil, err
	}
	out := make([]Update, len(list))
	for i, u := range list {
		out[i] = u.Update
	}
	return out, nil
}

// Documents lists the attachments of published updates, newest first.
func (s *Service) Documents(ctx context.Context) ([]Document, error) {
	list, err := s.queryUpdates(ctx, `u.status = 'published'`)
	if err != nil {
		return nil, err
	}
	out := []Document{}
	for _, u := range list {
		for _, a := range u.Attachments {
			out = append(out, Document{Attachment: a, UpdateID: u.ID, UpdateTitle: u.Title, PublishedAt: *u.PublishedAt})
		}
	}
	return out, nil
}

// Manage lists every update for the editor.
func (s *Service) Manage(ctx context.Context) ([]ManagedUpdate, error) {
	return s.queryUpdates(ctx, `true`)
}

func (s *Service) managed(ctx context.Context, id string) (*ManagedUpdate, error) {
	list, err := s.queryUpdates(ctx, `u.id = $1`, id)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, httpx.NotFound("Update tidak ditemukan")
	}
	return &list[0], nil
}

// CreateUpdate inserts a draft.
func (s *Service) CreateUpdate(ctx context.Context, in UpdateInput, userID, userName string) (*ManagedUpdate, error) {
	in, err := in.clean()
	if err != nil {
		return nil, err
	}
	var id string
	if err := s.db.QueryRow(ctx, `INSERT INTO investor.updates (title, body, created_by, created_by_name)
		VALUES ($1, $2, $3, $4) RETURNING id::text`, in.Title, in.Body, userID, userName).Scan(&id); err != nil {
		return nil, err
	}
	return s.managed(ctx, id)
}

// EditUpdate changes the title and body.
func (s *Service) EditUpdate(ctx context.Context, id string, in UpdateInput) (*ManagedUpdate, error) {
	in, err := in.clean()
	if err != nil {
		return nil, err
	}
	tag, err := s.db.Exec(ctx, `UPDATE investor.updates SET title = $2, body = $3, updated_at = now() WHERE id = $1`, id, in.Title, in.Body)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, httpx.NotFound("Update tidak ditemukan")
	}
	return s.managed(ctx, id)
}

// SetPublished publishes an update (keeping its first publish date) or
// takes it back to draft.
func (s *Service) SetPublished(ctx context.Context, id string, published bool) (*ManagedUpdate, error) {
	status := "draft"
	if published {
		status = "published"
	}
	tag, err := s.db.Exec(ctx, `UPDATE investor.updates
		SET status = $2, published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, $3) ELSE NULL END, updated_at = now()
		WHERE id = $1`, id, status, s.now())
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, httpx.NotFound("Update tidak ditemukan")
	}
	return s.managed(ctx, id)
}

// DeleteUpdate removes an update and its files.
func (s *Service) DeleteUpdate(ctx context.Context, id string) error {
	rows, err := s.db.Query(ctx, `SELECT url FROM investor.update_attachments WHERE update_id = $1`, id)
	if err != nil {
		return err
	}
	urls, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	tag, err := s.db.Exec(ctx, `DELETE FROM investor.updates WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Update tidak ditemukan")
	}
	for _, u := range urls {
		s.removeFile(u)
	}
	return nil
}

// AddAttachment stores f under the update.
func (s *Service) AddAttachment(ctx context.Context, updateID string, f *storage.File) (*ManagedUpdate, error) {
	switch {
	case f == nil || f.Size() == 0:
		return nil, httpx.BadRequest("Pilih berkas dulu")
	case f.Size() > maxAttachment:
		return nil, httpx.BadRequest("Berkas maksimal 10 MB")
	}
	mime := storage.SniffDocument(f.Data)
	if mime == "" {
		if !attachmentTypes[f.Type] {
			return nil, httpx.BadRequest("Berkas harus PDF, gambar, dokumen Office, atau CSV")
		}
		mime = f.Type
	}
	if _, err := s.managed(ctx, updateID); err != nil {
		return nil, err
	}
	url, err := s.store.Upload(attachmentBucket, "", f.Data, mime, f.Name)
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(f.Name)
	if name == "" {
		name = "lampiran"
	}
	if _, err := s.db.Exec(ctx, `INSERT INTO investor.update_attachments (update_id, name, mime, size_bytes, url)
		VALUES ($1, $2, $3, $4, $5)`, updateID, name, mime, f.Size(), url); err != nil {
		s.removeFile(url)
		return nil, err
	}
	return s.managed(ctx, updateID)
}

// RemoveAttachment deletes one attachment and its file.
func (s *Service) RemoveAttachment(ctx context.Context, updateID, attachmentID string) (*ManagedUpdate, error) {
	var url string
	err := s.db.QueryRow(ctx, `DELETE FROM investor.update_attachments WHERE id = $1 AND update_id = $2 RETURNING url`,
		attachmentID, updateID).Scan(&url)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Lampiran tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	s.removeFile(url)
	return s.managed(ctx, updateID)
}

// removeFile deletes a stored attachment; a missing file is not an error.
func (s *Service) removeFile(url string) {
	if err := s.store.Delete(attachmentBucket, url); err != nil && !errors.Is(err, fs.ErrNotExist) {
		s.log.Warn("investor: hapus lampiran gagal", "url", url, "error", err)
	}
}
