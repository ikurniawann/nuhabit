package gymdesk

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Note is a staff note on a member.
type Note struct {
	ID         string    `json:"id"`
	AuthorID   string    `json:"author_id"`
	AuthorName string    `json:"author_name"`
	Body       string    `json:"body"`
	CreatedAt  time.Time `json:"created_at"`
}

// NoteMaxLength is the longest note, in characters.
const NoteMaxLength = 2000

// Notes lists the member's notes, newest first.
func (s *Service) Notes(ctx context.Context, customerID string) ([]Note, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id::text, author_id::text, author_name, body, created_at
		   FROM gym.member_notes WHERE customer_id = $1 ORDER BY created_at DESC, id`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Note])
}

// AddNote stores a note by the signed-in staff member.
func (s *Service) AddNote(ctx context.Context, customerID, authorID, authorName, body string) (*Note, error) {
	if err := s.requireMember(ctx, customerID); err != nil {
		return nil, err
	}
	n := Note{AuthorID: authorID, AuthorName: authorName, Body: body}
	err := s.db.QueryRow(ctx,
		`INSERT INTO gym.member_notes (customer_id, author_id, author_name, body)
		 VALUES ($1, $2, $3, $4) RETURNING id::text, created_at`, customerID, authorID, authorName, body).
		Scan(&n.ID, &n.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// DeleteNote removes a note; staff delete only their own notes.
func (s *Service) DeleteNote(ctx context.Context, customerID, noteID, authorID string) error {
	var owner string
	err := s.db.QueryRow(ctx,
		`SELECT author_id::text FROM gym.member_notes WHERE id = $1 AND customer_id = $2`, noteID, customerID).Scan(&owner)
	if database.IsNoRows(err) {
		return httpx.NotFound("Catatan tidak ditemukan")
	}
	if err != nil {
		return err
	}
	if owner != authorID {
		return httpx.Forbidden("Hanya penulis yang bisa menghapus catatan ini")
	}
	_, err = s.db.Exec(ctx, `DELETE FROM gym.member_notes WHERE id = $1`, noteID)
	return err
}
