package dataroom

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/httpx"
)

// Activity log of the dashboard (dataroom.activity_logs). Share link
// recipients are logged in share_access_logs as before.

// activity is one event to record.
type activity struct {
	node               *Node
	action             string
	actorID, actorName string
	detail             map[string]any
	ip                 string
}

// logActivity writes one row; a failure is only logged.
func (s *Service) logActivity(ctx context.Context, e activity) {
	var nodeID, parentID *string
	name := ""
	if e.node != nil {
		if e.node.ID != "" {
			nodeID = &e.node.ID
		}
		parentID = e.node.ParentID
		name = e.node.Name
	}
	if e.detail == nil {
		e.detail = map[string]any{}
	}
	if e.ip != "" {
		e.detail["ip"] = e.ip
	}
	raw, _ := json.Marshal(e.detail)
	if _, err := s.db.Exec(ctx, `INSERT INTO dataroom.activity_logs (node_id, parent_id, action, node_name, actor_id, actor_name, detail)
	 VALUES ($1, $2, $3, $4, $5, $6, $7)`, nodeID, parentID, e.action, name, nullUUID(e.actorID), orNull(e.actorName), raw); err != nil {
		s.log.Warn("[dataroom] gagal tulis aktivitas", "error", err)
	}
}

// ActivityRow is one listed event.
type ActivityRow struct {
	ID        string          `json:"id"`
	NodeID    *string         `json:"node_id"`
	ParentID  *string         `json:"parent_id"`
	Action    string          `json:"action"`
	NodeName  *string         `json:"node_name"`
	ActorID   *string         `json:"actor_id"`
	ActorName *string         `json:"actor_name"`
	Detail    json.RawMessage `json:"detail"`
	CreatedAt httpx.JSTime    `json:"created_at"`
}

// accessActions are the events only owners see (who read what).
var accessActions = []string{"view", "download"}

// Activity lists the latest 200 events of a node (a folder: its own and its
// direct children's; nil: the root listing). Without includeAccess the
// view and download rows are left out.
func (s *Service) Activity(ctx context.Context, nodeID *string, includeAccess bool) ([]ActivityRow, error) {
	where, args := "a.parent_id IS NULL", []any{}
	if nodeID != nil {
		where, args = "(a.node_id = $1 OR a.parent_id = $1)", []any{*nodeID}
	}
	if !includeAccess {
		args = append(args, accessActions)
		where += " AND NOT (a.action = ANY($" + strconv.Itoa(len(args)) + "))"
	}
	rows, err := s.db.Query(ctx, `SELECT a.id::text, a.node_id::text, a.parent_id::text, a.action, a.node_name, a.actor_id::text, a.actor_name, a.detail, a.created_at
	 FROM dataroom.activity_logs a WHERE `+where+` ORDER BY a.created_at DESC LIMIT 200`, args...)
	if err != nil {
		return nil, err
	}
	out := []ActivityRow{}
	var r ActivityRow
	var created time.Time
	_, err = pgx.ForEachRow(rows, []any{&r.ID, &r.NodeID, &r.ParentID, &r.Action, &r.NodeName, &r.ActorID, &r.ActorName, &r.Detail, &created}, func() error {
		r.CreatedAt = httpx.JSTime(created)
		out = append(out, r)
		return nil
	})
	return out, err
}
