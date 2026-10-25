package dataroom

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/dataroom/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// Threaded comments on files and folders, with mentions that reach the
// staff inbox.

// Comment is one dataroom.comments row.
type Comment struct {
	ID            string       `json:"id"`
	NodeID        string       `json:"node_id"`
	ParentID      *string      `json:"parent_id"`
	Body          string       `json:"body"`
	Mentions      []string     `json:"mentions"`
	CreatedBy     string       `json:"created_by"`
	CreatedByName *string      `json:"created_by_name"`
	CreatedAt     httpx.JSTime `json:"created_at"`
	Deleted       bool         `json:"deleted"`
}

const commentCols = `id::text, node_id::text, parent_id::text, body, mentions::text[], created_by::text, created_by_name, created_at, deleted_at`

func scanComment(row pgx.CollectableRow) (Comment, error) {
	var c Comment
	var created time.Time
	var deleted *time.Time
	err := row.Scan(&c.ID, &c.NodeID, &c.ParentID, &c.Body, &c.Mentions, &c.CreatedBy, &c.CreatedByName, &created, &deleted)
	c.CreatedAt = httpx.JSTime(created)
	if deleted != nil {
		c.Deleted, c.Body = true, ""
	}
	if c.Mentions == nil {
		c.Mentions = []string{}
	}
	return c, err
}

// Comments lists a node's comments oldest first (deleted ones keep their
// place in the thread with an empty body).
func (s *Service) Comments(ctx context.Context, nodeID string) ([]Comment, error) {
	rows, err := s.db.Query(ctx, `SELECT `+commentCols+` FROM dataroom.comments WHERE node_id = $1 ORDER BY created_at LIMIT 500`, nodeID)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, scanComment)
	if out == nil {
		out = []Comment{}
	}
	return out, err
}

// MaxCommentLen caps a comment body in UTF-16 units.
const MaxCommentLen = 4000

// AddComment writes a comment (a reply when parentID names a comment of
// the same node) and notifies the mentioned users.
func (s *Service) AddComment(ctx context.Context, a *Access, node *Node, parentID *string, body string, mentionIDs []string) (*Comment, error) {
	body = domain.JSSlice(body, MaxCommentLen)
	if parentID != nil {
		var ok bool
		if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM dataroom.comments WHERE id = $1 AND node_id = $2 AND deleted_at IS NULL)`,
			*parentID, node.ID).Scan(&ok); err != nil {
			return nil, err
		}
		if !ok {
			return nil, httpx.NotFound("Komentar induk tidak ditemukan")
		}
	}
	mentioned := []Person{}
	if len(mentionIDs) > 0 {
		list, err := s.ports.People.ByIDs(ctx, mentionIDs)
		if err != nil {
			return nil, err
		}
		for _, p := range list {
			if p.ID != a.Actor.UserID {
				mentioned = append(mentioned, p)
			}
		}
	}
	ids := make([]string, len(mentioned))
	for i, p := range mentioned {
		ids[i] = p.ID
	}
	rows, err := s.db.Query(ctx, `INSERT INTO dataroom.comments (node_id, parent_id, body, mentions, created_by, created_by_name)
	 VALUES ($1, $2, $3, $4::uuid[], $5, $6) RETURNING `+commentCols, node.ID, parentID, body, ids, a.Actor.UserID, a.Actor.Name)
	if err != nil {
		return nil, err
	}
	c, err := pgx.CollectOneRow(rows, scanComment)
	if err != nil {
		return nil, err
	}
	s.logActivity(ctx, activity{node: node, action: "comment", actorID: a.Actor.UserID, actorName: a.Actor.Name,
		detail: map[string]any{"comment_id": c.ID, "mentions": len(ids)}})
	for _, p := range mentioned {
		s.notify(ctx, p.ID, fmt.Sprintf("%s menyebut Anda di \"%s\"", a.Actor.Name, node.Name), domain.JSSlice(body, 200),
			"dataroom_mention", s.nodeLink(node), map[string]any{"node_id": node.ID, "comment_id": c.ID})
	}
	return &c, nil
}

// DeleteComment soft-deletes a comment; the author or an owner of the node
// may do it. It returns the node for the permission check.
func (s *Service) CommentNode(ctx context.Context, commentID string) (*Comment, *Node, error) {
	rows, err := s.db.Query(ctx, `SELECT `+commentCols+` FROM dataroom.comments WHERE id = $1`, commentID)
	if err != nil {
		return nil, nil, err
	}
	list, err := pgx.CollectRows(rows, scanComment)
	if err != nil || len(list) == 0 {
		return nil, nil, err
	}
	node, err := s.Node(ctx, list[0].NodeID)
	return &list[0], node, err
}

// DeleteComment marks the comment deleted.
func (s *Service) DeleteComment(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, `UPDATE dataroom.comments SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, id)
	return err
}
