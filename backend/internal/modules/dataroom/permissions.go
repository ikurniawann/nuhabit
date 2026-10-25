package dataroom

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Explicit grants (dataroom.permissions) and the notifications a new grant
// sends.

// Grant is one permission row for the client.
type Grant struct {
	ID          string       `json:"id"`
	NodeID      string       `json:"node_id"`
	SubjectType string       `json:"subject_type"`
	SubjectID   string       `json:"subject_id"`
	SubjectName string       `json:"subject_name"`
	Role        string       `json:"role"`
	CreatedAt   httpx.JSTime `json:"created_at"`
}

// GrantInput is one entry of the PUT body.
type GrantInput struct {
	SubjectType, SubjectID, Role string
}

// Grants lists the explicit grants of one node, users named through the
// People port.
func (s *Service) Grants(ctx context.Context, nodeID string) ([]Grant, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, node_id::text, subject_type, subject_id, role, created_at
	 FROM dataroom.permissions WHERE node_id = $1 ORDER BY subject_type DESC, created_at`, nodeID)
	if err != nil {
		return nil, err
	}
	out := []Grant{}
	var g Grant
	var created time.Time
	if _, err := pgx.ForEachRow(rows, []any{&g.ID, &g.NodeID, &g.SubjectType, &g.SubjectID, &g.Role, &created}, func() error {
		g.CreatedAt = httpx.JSTime(created)
		out = append(out, g)
		return nil
	}); err != nil {
		return nil, err
	}
	var userIDs []string
	for _, g := range out {
		if g.SubjectType == "user" {
			userIDs = append(userIDs, g.SubjectID)
		}
	}
	names := map[string]string{}
	if len(userIDs) > 0 {
		people, err := s.ports.People.ByIDs(ctx, userIDs)
		if err != nil {
			return nil, err
		}
		for _, p := range people {
			names[p.ID] = p.FullName
		}
	}
	for i := range out {
		if out[i].SubjectType == "user" {
			out[i].SubjectName = names[out[i].SubjectID]
		} else {
			out[i].SubjectName = out[i].SubjectID
		}
	}
	return out, nil
}

// SetGrants replaces the node's grants. Users must exist; new user grants
// notify the user (inbox and email, best effort).
func (s *Service) SetGrants(ctx context.Context, a *Access, node *Node, in []GrantInput) ([]Grant, error) {
	var userIDs []string
	seen := map[string]bool{}
	clean := []GrantInput{}
	for _, g := range in {
		key := g.SubjectType + ":" + g.SubjectID
		if seen[key] || (g.SubjectType == "user" && g.SubjectID == a.Actor.UserID) {
			continue
		}
		seen[key] = true
		clean = append(clean, g)
		if g.SubjectType == "user" {
			userIDs = append(userIDs, g.SubjectID)
		}
	}
	people := map[string]Person{}
	if len(userIDs) > 0 {
		list, err := s.ports.People.ByIDs(ctx, userIDs)
		if err != nil {
			return nil, err
		}
		for _, p := range list {
			people[p.ID] = p
		}
		for _, id := range userIDs {
			if _, ok := people[id]; !ok {
				return nil, httpx.BadRequest("Pengguna tidak ditemukan")
			}
		}
	}
	before, err := s.Grants(ctx, node.ID)
	if err != nil {
		return nil, err
	}
	had := map[string]bool{}
	for _, g := range before {
		had[g.SubjectType+":"+g.SubjectID] = true
	}
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM dataroom.permissions WHERE node_id = $1`, node.ID); err != nil {
			return err
		}
		for _, g := range clean {
			if _, err := tx.Exec(ctx, `INSERT INTO dataroom.permissions (node_id, subject_type, subject_id, role, created_by)
			 VALUES ($1, $2, $3, $4, $5)`, node.ID, g.SubjectType, g.SubjectID, g.Role, nullUUID(a.Actor.UserID)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.logActivity(ctx, activity{node: node, action: "permissions", actorID: a.Actor.UserID, actorName: a.Actor.Name,
		detail: map[string]any{"count": len(clean)}})
	for _, g := range clean {
		if g.SubjectType == "user" && !had["user:"+g.SubjectID] {
			s.notifyGrant(ctx, people[g.SubjectID], node, g.Role, a.Actor.Name)
		}
	}
	return s.Grants(ctx, node.ID)
}

// roleLabels are the Indonesian names of the grant roles.
var roleLabels = map[string]string{"viewer": "melihat", "commenter": "berkomentar", "editor": "mengedit", "owner": "memiliki"}

// notifyGrant writes the staff inbox row and sends an email when the
// person has one.
func (s *Service) notifyGrant(ctx context.Context, p Person, node *Node, role, byName string) {
	noun := "file"
	if node.Kind == "folder" {
		noun = "folder"
	}
	link := s.nodeLink(node)
	title := fmt.Sprintf("%s membagikan %s \"%s\"", byName, noun, node.Name)
	body := fmt.Sprintf("Anda kini bisa %s %s ini di Dataroom.", roleLabels[role], noun)
	s.notify(ctx, p.ID, title, body, "dataroom_share", link, map[string]any{"node_id": node.ID, "role": role})
	if p.Email != nil && strings.TrimSpace(*p.Email) != "" {
		html := s.shell(title, `<p>`+esc(body)+`</p>
  <p><a href="`+esc(link)+`" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Buka di Dataroom</a></p>`)
		s.ports.Mailer.Send(ctx, strings.TrimSpace(*p.Email), s.ports.MailFrom, title, html)
	}
}

// nodeLink is the dashboard URL that opens the node.
func (s *Service) nodeLink(node *Node) string {
	if node.Kind == "folder" {
		return s.ports.AppOrigin + "/dashboard/dataroom?folder=" + node.ID
	}
	if node.ParentID != nil {
		return s.ports.AppOrigin + "/dashboard/dataroom?folder=" + *node.ParentID + "&file=" + node.ID
	}
	return s.ports.AppOrigin + "/dashboard/dataroom?file=" + node.ID
}

// notify inserts one public.notifications row (type "alert", the Data
// Room kind in metadata); a failure is only logged.
func (s *Service) notify(ctx context.Context, userID, title, message, kind, link string, meta map[string]any) {
	meta["kind"] = kind
	if _, err := s.db.Exec(ctx, `INSERT INTO public.notifications (user_id, title, message, type, link, metadata)
	 VALUES ($1, $2, $3, 'alert', $4, $5)`, userID, title, message, strings.TrimPrefix(link, s.ports.AppOrigin), meta); err != nil {
		s.log.Warn("[dataroom] gagal tulis notifikasi", "error", err)
	}
}
