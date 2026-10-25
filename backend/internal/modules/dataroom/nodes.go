package dataroom

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/dataroom/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Node is a folder or a file (tree by parent_id, root = NULL). A trashed
// node carries trashed_at; the item the user trashed also has trashed_root.
type Node struct {
	ID            string        `json:"id"`
	ParentID      *string       `json:"parent_id"`
	Kind          string        `json:"kind"`
	Name          string        `json:"name"`
	Mime          *string       `json:"mime"`
	SizeBytes     int64         `json:"size_bytes"`
	StoragePath   *string       `json:"storage_path"`
	CreatedBy     *string       `json:"created_by"`
	CreatedByName *string       `json:"created_by_name"`
	CreatedAt     httpx.JSTime  `json:"created_at"`
	UpdatedAt     httpx.JSTime  `json:"updated_at"`
	Description   *string       `json:"description"`
	Tags          []string      `json:"tags"`
	TrashedAt     *httpx.JSTime `json:"trashed_at"`
	TrashedRoot   bool          `json:"trashed_root"`
	Version       int           `json:"version"`
	LockedBy      *string       `json:"locked_by"`
	LockedByName  *string       `json:"locked_by_name"`
	LockedAt      *httpx.JSTime `json:"locked_at"`
	Restricted    bool          `json:"restricted"`
}

// PublicNode is what a share recipient sees.
type PublicNode struct {
	ID        string       `json:"id"`
	ParentID  *string      `json:"parent_id"`
	Kind      string       `json:"kind"`
	Name      string       `json:"name"`
	Mime      *string      `json:"mime"`
	SizeBytes int64        `json:"size_bytes"`
	UpdatedAt httpx.JSTime `json:"updated_at"`
}

// Public is publicNode(node).
func (n Node) Public() PublicNode {
	return PublicNode{ID: n.ID, ParentID: n.ParentID, Kind: n.Kind, Name: n.Name, Mime: n.Mime, SizeBytes: n.SizeBytes, UpdatedAt: n.UpdatedAt}
}

func publicNodes(nodes []Node) []PublicNode {
	out := make([]PublicNode, len(nodes))
	for i, n := range nodes {
		out[i] = n.Public()
	}
	return out
}

// LockedByOther reports a lock held by someone else than userID.
func (n *Node) LockedByOther(userID string) bool {
	return n.LockedBy != nil && *n.LockedBy != userID
}

const nodeCols = `n.id::text, n.parent_id::text, n.kind, n.name, n.mime, n.size_bytes, n.storage_path,
  n.created_by::text, n.created_by_name, n.created_at, n.updated_at, n.description, n.tags, n.trashed_at, n.trashed_root,
  n.version, n.locked_by::text, n.locked_by_name, n.locked_at, n.restricted`

func scanNode(row pgx.CollectableRow) (Node, error) {
	var n Node
	var created, updated time.Time
	var trashed, locked *time.Time
	err := row.Scan(&n.ID, &n.ParentID, &n.Kind, &n.Name, &n.Mime, &n.SizeBytes, &n.StoragePath,
		&n.CreatedBy, &n.CreatedByName, &created, &updated, &n.Description, &n.Tags, &trashed, &n.TrashedRoot,
		&n.Version, &n.LockedBy, &n.LockedByName, &locked, &n.Restricted)
	n.CreatedAt, n.UpdatedAt = httpx.JSTime(created), httpx.JSTime(updated)
	n.TrashedAt, n.LockedAt = httpx.NewJSTime(trashed), httpx.NewJSTime(locked)
	if n.Tags == nil {
		n.Tags = []string{}
	}
	return n, err
}

func queryNodes(ctx context.Context, q database.Querier, sql string, args ...any) ([]Node, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, scanNode)
	if out == nil {
		out = []Node{}
	}
	return out, err
}

func queryNode(ctx context.Context, q database.Querier, sql string, args ...any) (*Node, error) {
	nodes, err := queryNodes(ctx, q, sql, args...)
	if err != nil || len(nodes) == 0 {
		return nil, err
	}
	return &nodes[0], nil
}

const (
	fromNodes = `SELECT ` + nodeCols + ` FROM dataroom.nodes n `
	// selectCTE reads the rows a `WITH n AS (... RETURNING *)` produced.
	selectCTE = `SELECT ` + nodeCols + ` FROM n`
)

// Node is one node by id, trashed or not; nil when it does not exist.
func (s *Service) Node(ctx context.Context, id string) (*Node, error) {
	return queryNode(ctx, s.db, fromNodes+`WHERE n.id = $1`, id)
}

// LiveFolder is a folder that is not in the trash, or nil.
func (s *Service) LiveFolder(ctx context.Context, id string) (*Node, error) {
	n, err := s.Node(ctx, id)
	if err != nil || n == nil || n.Kind != "folder" || n.TrashedAt != nil {
		return nil, err
	}
	return n, nil
}

const childOrder = ` ORDER BY (n.kind = 'folder') DESC, lower(n.name), n.created_at`

// Children lists the live children of a folder (root when nil): folders
// first, then by name.
func (s *Service) Children(ctx context.Context, parentID *string) ([]Node, error) {
	if parentID != nil {
		return queryNodes(ctx, s.db, fromNodes+`WHERE n.parent_id = $1 AND n.trashed_at IS NULL`+childOrder, *parentID)
	}
	return queryNodes(ctx, s.db, fromNodes+`WHERE n.parent_id IS NULL AND n.trashed_at IS NULL`+childOrder)
}

// Starred lists the user's starred live nodes.
func (s *Service) Starred(ctx context.Context, userID string) ([]Node, error) {
	return queryNodes(ctx, s.db, fromNodes+`JOIN dataroom.stars st ON st.node_id = n.id AND st.user_id = $1
	 WHERE n.trashed_at IS NULL ORDER BY st.created_at DESC`, userID)
}

// Recent lists the live files the user opened, latest first.
func (s *Service) Recent(ctx context.Context, userID string) ([]Node, error) {
	return queryNodes(ctx, s.db, fromNodes+`JOIN dataroom.recent_opens ro ON ro.node_id = n.id AND ro.user_id = $1
	 WHERE n.trashed_at IS NULL ORDER BY ro.opened_at DESC LIMIT 100`, userID)
}

// SharedWithMe lists live nodes with a direct grant for the user or the
// role that the user did not create.
func (s *Service) SharedWithMe(ctx context.Context, userID, role string) ([]Node, error) {
	return queryNodes(ctx, s.db, fromNodes+`WHERE n.trashed_at IS NULL AND (n.created_by IS NULL OR n.created_by::text <> $1)
	 AND EXISTS (SELECT 1 FROM dataroom.permissions p WHERE p.node_id = n.id
	   AND ((p.subject_type = 'user' AND p.subject_id = $1) OR (p.subject_type = 'role' AND p.subject_id = $2)))`+childOrder,
		userID, role)
}

// Trash lists the items trashed by anyone, latest first; the caller keeps
// the ones it may see.
func (s *Service) Trash(ctx context.Context) ([]Node, error) {
	return queryNodes(ctx, s.db, fromNodes+`WHERE n.trashed_root ORDER BY n.trashed_at DESC LIMIT 500`)
}

// StarredIDs is the subset of ids the user starred.
func (s *Service) StarredIDs(ctx context.Context, userID string, ids []string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.db.Query(ctx, `SELECT node_id::text FROM dataroom.stars WHERE user_id = $1 AND node_id = ANY($2::uuid[])`, userID, ids)
	if err != nil {
		return nil, err
	}
	var id string
	_, err = pgx.ForEachRow(rows, []any{&id}, func() error { out[id] = true; return nil })
	return out, err
}

// SetStar adds or removes the user's star.
func (s *Service) SetStar(ctx context.Context, userID, nodeID string, on bool) error {
	var err error
	if on {
		_, err = s.db.Exec(ctx, `INSERT INTO dataroom.stars (user_id, node_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, userID, nodeID)
	} else {
		_, err = s.db.Exec(ctx, `DELETE FROM dataroom.stars WHERE user_id = $1 AND node_id = $2`, userID, nodeID)
	}
	return err
}

// touchRecent records that the user opened a file.
func (s *Service) touchRecent(ctx context.Context, userID, nodeID string) {
	if _, err := s.db.Exec(ctx, `INSERT INTO dataroom.recent_opens (user_id, node_id, opened_at) VALUES ($1, $2, now())
	 ON CONFLICT (user_id, node_id) DO UPDATE SET opened_at = now()`, userID, nodeID); err != nil {
		s.log.Warn("[dataroom] gagal catat riwayat buka", "error", err)
	}
}

// Crumb is one Ancestors entry.
type Crumb struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	ParentID *string `json:"parent_id"`
}

// Ancestors is the trail from root to the node, inclusive.
func (s *Service) Ancestors(ctx context.Context, id string) ([]Crumb, error) {
	rows, err := s.db.Query(ctx, `WITH RECURSIVE up AS (
	   SELECT id, name, parent_id, 0 AS depth FROM dataroom.nodes WHERE id = $1
	   UNION ALL
	   SELECT n.id, n.name, n.parent_id, up.depth + 1 FROM dataroom.nodes n JOIN up ON n.id = up.parent_id
	 )
	 SELECT id::text, name, parent_id::text FROM up ORDER BY depth DESC`, id)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByPos[Crumb])
	if out == nil {
		out = []Crumb{}
	}
	return out, err
}

// isSameOrDescendant reports whether nodeID is ancestorID or below it.
func (s *Service) isSameOrDescendant(ctx context.Context, nodeID, ancestorID string) (bool, error) {
	if nodeID == ancestorID {
		return true, nil
	}
	var ok bool
	err := s.db.QueryRow(ctx, `WITH RECURSIVE up AS (
	   SELECT id, parent_id FROM dataroom.nodes WHERE id = $1
	   UNION ALL
	   SELECT n.id, n.parent_id FROM dataroom.nodes n JOIN up ON n.id = up.parent_id
	 )
	 SELECT EXISTS (SELECT 1 FROM up WHERE id = $2) AS ok`, nodeID, ancestorID).Scan(&ok)
	return ok, err
}

// usedBytes is the total size of every file, versions and trash included.
func (s *Service) usedBytes(ctx context.Context) (int64, error) {
	var total int64
	err := s.db.QueryRow(ctx, `SELECT (SELECT COALESCE(SUM(size_bytes), 0) FROM dataroom.nodes WHERE kind = 'file')
	 + (SELECT COALESCE(SUM(size_bytes), 0) FROM dataroom.node_versions)`).Scan(&total)
	return total, err
}

// FolderRef is one Folders row.
type FolderRef struct {
	ID       string  `json:"id"`
	ParentID *string `json:"parent_id"`
	Name     string  `json:"name"`
}

// Folders lists every live folder the actor may open.
func (s *Service) Folders(ctx context.Context, a *Access) ([]FolderRef, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, parent_id::text, name FROM dataroom.nodes
	 WHERE kind = 'folder' AND trashed_at IS NULL ORDER BY lower(name)`)
	if err != nil {
		return nil, err
	}
	all, err := pgx.CollectRows(rows, pgx.RowToStructByPos[FolderRef])
	if err != nil {
		return nil, err
	}
	out := []FolderRef{}
	for _, f := range all {
		if a.FolderLevel(&f.ID) >= LevelViewer {
			out = append(out, f)
		}
	}
	return out, nil
}

// CreateFolder inserts a folder.
func (s *Service) CreateFolder(ctx context.Context, parentID *string, name, userID, userName string) (*Node, error) {
	return s.insertFolder(ctx, parentID, name, userID, userName, false)
}

func (s *Service) insertFolder(ctx context.Context, parentID *string, name, userID, userName string, restricted bool) (*Node, error) {
	n, err := queryNode(ctx, s.db, `WITH n AS (
	   INSERT INTO dataroom.nodes (parent_id, kind, name, created_by, created_by_name, restricted)
	   VALUES ($1, 'folder', $2, $3, $4, $5) RETURNING *)
	 `+selectCTE, parentID, domain.SanitizeNodeName(name), nullUUID(userID), userName, restricted)
	if err == nil && n != nil {
		s.logActivity(ctx, activity{node: n, action: "create_folder", actorID: userID, actorName: userName})
	}
	return n, err
}

// nullUUID is NULL for an empty id (the filing port may run without one).
func nullUUID(id string) *string {
	if id == "" {
		return nil
	}
	return &id
}

// NodePatch is the PATCH body: move first (a folder never into itself or
// below), then rename, description and tags. Unset fields are skipped.
type NodePatch struct {
	ParentSet   bool
	ParentID    *string
	Name        *string
	Description *string
	DescSet     bool
	Tags        []string
}

// Patch applies p to node.
func (s *Service) Patch(ctx context.Context, a *Access, node *Node, p NodePatch) (*Node, error) {
	if (p.ParentSet || p.Name != nil) && node.LockedByOther(a.Actor.UserID) {
		return nil, lockedErr(node)
	}
	if p.ParentSet {
		if p.ParentID != nil && *p.ParentID != "" {
			folder, err := s.LiveFolder(ctx, *p.ParentID)
			if err != nil {
				return nil, err
			}
			if folder == nil {
				return nil, httpx.NotFound("Folder tujuan tidak ditemukan")
			}
			switch level := a.Level(folder); {
			case level < LevelViewer:
				return nil, httpx.Forbidden("Folder tujuan tidak dibuka untuk departemen Anda")
			case level < LevelEditor:
				return nil, httpx.Forbidden("Anda tidak punya hak menulis di folder tujuan")
			}
			if node.Kind == "folder" {
				inside, err := s.isSameOrDescendant(ctx, *p.ParentID, node.ID)
				if err != nil {
					return nil, err
				}
				if inside {
					return nil, httpx.BadRequest("Folder tidak bisa dipindahkan ke dalam dirinya sendiri")
				}
			}
		} else if !a.Actor.CanCreate && !a.Actor.IsAdmin {
			return nil, httpx.Forbidden("Anda tidak punya hak menulis di root")
		}
		if !sameParent(p.ParentID, node.ParentID) {
			from := node.ParentID
			moved, err := queryNode(ctx, s.db, `WITH n AS (UPDATE dataroom.nodes SET parent_id = $2, updated_at = now() WHERE id = $1 RETURNING *) `+selectCTE, node.ID, p.ParentID)
			if err != nil {
				return nil, err
			}
			if moved != nil {
				node = moved
				s.logActivity(ctx, activity{node: node, action: "move", actorID: a.Actor.UserID, actorName: a.Actor.Name,
					detail: map[string]any{"from": from, "to": p.ParentID}})
			}
		}
	}
	if p.Name != nil && *p.Name != node.Name {
		old := node.Name
		renamed, err := queryNode(ctx, s.db, `WITH n AS (UPDATE dataroom.nodes SET name = $2, updated_at = now() WHERE id = $1 RETURNING *) `+selectCTE,
			node.ID, domain.SanitizeNodeName(*p.Name))
		if err != nil {
			return nil, err
		}
		if renamed != nil {
			node = renamed
			s.logActivity(ctx, activity{node: node, action: "rename", actorID: a.Actor.UserID, actorName: a.Actor.Name, detail: map[string]any{"from": old}})
		}
	}
	if p.DescSet || p.Tags != nil {
		desc, tags := node.Description, node.Tags
		if p.DescSet {
			desc = p.Description
		}
		if p.Tags != nil {
			tags = domain.NormalizeTags(p.Tags)
		}
		updated, err := queryNode(ctx, s.db, `WITH n AS (UPDATE dataroom.nodes SET description = $2, tags = $3, updated_at = now() WHERE id = $1 RETURNING *) `+selectCTE,
			node.ID, desc, tags)
		if err != nil {
			return nil, err
		}
		if updated != nil {
			node = updated
			s.logActivity(ctx, activity{node: node, action: "update_meta", actorID: a.Actor.UserID, actorName: a.Actor.Name})
		}
	}
	return node, nil
}

func lockedErr(n *Node) error {
	by := "pengguna lain"
	if n.LockedByName != nil && *n.LockedByName != "" {
		by = *n.LockedByName
	}
	return httpx.Coded(423, "locked", "Sedang diedit oleh "+by, map[string]any{"locked_by_name": by})
}

// sameParent is null-safe equality of parent ids.
func sameParent(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

/* ── Trash ───────────────────────────────────────────────────────────── */

// TrashNode moves the subtree to the trash; the node itself becomes the
// trash root. Already trashed descendants keep their own timestamp.
func (s *Service) TrashNode(ctx context.Context, a *Access, node *Node) error {
	if node.TrashedAt != nil {
		return httpx.BadRequest("Item sudah ada di sampah")
	}
	if node.LockedByOther(a.Actor.UserID) {
		return lockedErr(node)
	}
	_, err := s.db.Exec(ctx, `WITH RECURSIVE down AS (
	   SELECT id FROM dataroom.nodes WHERE id = $1
	   UNION ALL
	   SELECT n.id FROM dataroom.nodes n JOIN down ON n.parent_id = down.id WHERE n.trashed_at IS NULL
	 )
	 UPDATE dataroom.nodes n SET trashed_at = $3, trashed_root = (n.id = $1), trashed_by = $2
	 FROM down WHERE n.id = down.id`, node.ID, nullUUID(a.Actor.UserID), s.now())
	if err == nil {
		s.logActivity(ctx, activity{node: node, action: "trash", actorID: a.Actor.UserID, actorName: a.Actor.Name})
	}
	return err
}

// RestoreNode brings a trash root back with the descendants trashed with
// it. When its parent is gone or in the trash, it lands at root.
func (s *Service) RestoreNode(ctx context.Context, a *Access, node *Node) (*Node, error) {
	if !node.TrashedRoot {
		return nil, httpx.BadRequest("Item tidak ada di sampah")
	}
	var parent *string
	if node.ParentID != nil {
		if p, err := s.LiveFolder(ctx, *node.ParentID); err != nil {
			return nil, err
		} else if p != nil {
			parent = node.ParentID
		}
	}
	restored, err := queryNode(ctx, s.db, `WITH RECURSIVE down AS (
	   SELECT id, trashed_at FROM dataroom.nodes WHERE id = $1
	   UNION ALL
	   SELECT n.id, n.trashed_at FROM dataroom.nodes n JOIN down ON n.parent_id = down.id WHERE n.trashed_at = down.trashed_at
	 ), up AS (
	   UPDATE dataroom.nodes n SET trashed_at = NULL, trashed_root = false, trashed_by = NULL,
	     parent_id = CASE WHEN n.id = $1 THEN $2::uuid ELSE n.parent_id END, updated_at = now()
	   FROM down WHERE n.id = down.id RETURNING n.*
	 ) SELECT `+nodeCols+` FROM up n WHERE n.id = $1`, node.ID, parent)
	if err == nil && restored != nil {
		s.logActivity(ctx, activity{node: restored, action: "restore", actorID: a.Actor.UserID, actorName: a.Actor.Name})
	}
	return restored, err
}

// PurgeNode deletes the subtree now with its stored files and versions.
// It returns how many files were removed from disk.
func (s *Service) PurgeNode(ctx context.Context, node *Node, actorID, actorName string) (int, error) {
	rows, err := s.db.Query(ctx, `WITH RECURSIVE down AS (
	   SELECT id, kind, storage_path FROM dataroom.nodes WHERE id = $1
	   UNION ALL
	   SELECT n.id, n.kind, n.storage_path FROM dataroom.nodes n JOIN down ON n.parent_id = down.id
	 ), versions AS (SELECT v.storage_path FROM dataroom.node_versions v JOIN down ON v.node_id = down.id),
	 gone AS (DELETE FROM dataroom.nodes WHERE id = $1)
	 SELECT storage_path FROM down WHERE kind = 'file' AND storage_path <> ''
	 UNION ALL SELECT storage_path FROM versions`, node.ID)
	if err != nil {
		return 0, err
	}
	paths, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return 0, err
	}
	s.deleteFiles(paths)
	s.logActivity(ctx, activity{node: &Node{ParentID: node.ParentID, Name: node.Name}, action: "purge", actorID: actorID, actorName: actorName})
	return len(paths), nil
}

// DeleteNode is PurgeNode for callers that only have an id (tests and the
// filing port).
func (s *Service) DeleteNode(ctx context.Context, id string) (int, error) {
	n, err := s.Node(ctx, id)
	if err != nil || n == nil {
		return 0, err
	}
	return s.PurgeNode(ctx, n, "", "")
}

/* ── Lock ────────────────────────────────────────────────────────────── */

// Lock marks the file as being edited by the actor; a lock held by someone
// else is refused.
func (s *Service) Lock(ctx context.Context, a *Access, node *Node) (*Node, error) {
	if node.Kind != "file" {
		return nil, httpx.BadRequest("Hanya file yang bisa dikunci")
	}
	if node.LockedByOther(a.Actor.UserID) {
		return nil, lockedErr(node)
	}
	n, err := queryNode(ctx, s.db, `WITH n AS (UPDATE dataroom.nodes SET locked_by = $2, locked_by_name = $3, locked_at = now() WHERE id = $1 RETURNING *) `+selectCTE,
		node.ID, a.Actor.UserID, a.Actor.Name)
	if err == nil && n != nil {
		s.logActivity(ctx, activity{node: n, action: "lock", actorID: a.Actor.UserID, actorName: a.Actor.Name})
	}
	return n, err
}

// Unlock clears the lock; the holder or an owner may do it.
func (s *Service) Unlock(ctx context.Context, a *Access, node *Node) (*Node, error) {
	if node.LockedBy == nil {
		return node, nil
	}
	if node.LockedByOther(a.Actor.UserID) && a.Level(node) < LevelOwner {
		return nil, lockedErr(node)
	}
	n, err := queryNode(ctx, s.db, `WITH n AS (UPDATE dataroom.nodes SET locked_by = NULL, locked_by_name = NULL, locked_at = NULL WHERE id = $1 RETURNING *) `+selectCTE, node.ID)
	if err == nil && n != nil {
		s.logActivity(ctx, activity{node: n, action: "unlock", actorID: a.Actor.UserID, actorName: a.Actor.Name})
	}
	return n, err
}

/* ── Search ──────────────────────────────────────────────────────────── */

// SearchHit is a search result with the folder path it lives in.
type SearchHit struct {
	Node
	Path []Crumb `json:"path"`
}

// Search runs a prefix full-text query (and/or a tag) over live nodes,
// ranked, at most 100; the caller keeps the ones the actor may see.
func (s *Service) Search(ctx context.Context, q, tag string) ([]Node, error) {
	terms := domain.SearchTerms(q)
	if len(terms) == 0 && tag == "" {
		return []Node{}, nil
	}
	where, args := []string{"n.trashed_at IS NULL"}, []any{}
	if len(terms) > 0 {
		args = append(args, strings.Join(terms, " & "))
		where = append(where, "n.search_vector @@ to_tsquery('simple', $1)")
	}
	if tag != "" {
		args = append(args, strings.ToLower(tag))
		where = append(where, "$"+strconv.Itoa(len(args))+" = ANY(n.tags)")
	}
	order := "lower(n.name)"
	if len(terms) > 0 {
		order = "ts_rank(n.search_vector, to_tsquery('simple', $1)) DESC, lower(n.name)"
	}
	return queryNodes(ctx, s.db, fromNodes+`WHERE `+strings.Join(where, " AND ")+` ORDER BY `+order+` LIMIT 100`, args...)
}

// Tags lists every tag in use with its count.
func (s *Service) Tags(ctx context.Context) ([]TagCount, error) {
	rows, err := s.db.Query(ctx, `SELECT t, count(*)::int FROM dataroom.nodes n, unnest(n.tags) t
	 WHERE n.trashed_at IS NULL GROUP BY t ORDER BY count(*) DESC, t LIMIT 200`)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByPos[TagCount])
	if out == nil {
		out = []TagCount{}
	}
	return out, err
}

// TagCount is one Tags row.
type TagCount struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}
