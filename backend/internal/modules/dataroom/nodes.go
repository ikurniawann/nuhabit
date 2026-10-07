package dataroom

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/dataroom/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Node is a DataroomNode: a folder or a file (tree by parent_id, root =
// NULL), with size_bytes as a number.
type Node struct {
	ID            string       `json:"id"`
	ParentID      *string      `json:"parent_id"`
	Kind          string       `json:"kind"`
	Name          string       `json:"name"`
	Mime          *string      `json:"mime"`
	SizeBytes     int64        `json:"size_bytes"`
	StoragePath   *string      `json:"storage_path"`
	CreatedBy     *string      `json:"created_by"`
	CreatedByName *string      `json:"created_by_name"`
	CreatedAt     httpx.JSTime `json:"created_at"`
	UpdatedAt     httpx.JSTime `json:"updated_at"`
}

// PublicNode is publicNode: what a share recipient sees.
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

const nodeCols = `id::text, parent_id::text, kind, name, mime, size_bytes, storage_path,
  created_by::text, created_by_name, created_at, updated_at`

func scanNode(row pgx.CollectableRow) (Node, error) {
	var n Node
	var created, updated time.Time
	err := row.Scan(&n.ID, &n.ParentID, &n.Kind, &n.Name, &n.Mime, &n.SizeBytes, &n.StoragePath,
		&n.CreatedBy, &n.CreatedByName, &created, &updated)
	n.CreatedAt, n.UpdatedAt = httpx.JSTime(created), httpx.JSTime(updated)
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

// Node is getNode: nil when it does not exist.
func (s *Service) Node(ctx context.Context, id string) (*Node, error) {
	return queryNode(ctx, s.db, `SELECT `+nodeCols+` FROM dataroom.nodes WHERE id = $1`, id)
}

// Children is listChildren: folders first, then by name (root when nil).
func (s *Service) Children(ctx context.Context, parentID *string) ([]Node, error) {
	if parentID != nil {
		return queryNodes(ctx, s.db, `SELECT `+nodeCols+` FROM dataroom.nodes WHERE parent_id = $1
		 ORDER BY (kind = 'folder') DESC, lower(name), created_at`, *parentID)
	}
	return queryNodes(ctx, s.db, `SELECT `+nodeCols+` FROM dataroom.nodes WHERE parent_id IS NULL
	 ORDER BY (kind = 'folder') DESC, lower(name), created_at`)
}

// Crumb is one getAncestors entry.
type Crumb struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	ParentID *string `json:"parent_id"`
}

// Ancestors is getAncestors: the trail from root to the node, inclusive.
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

// isSameOrDescendant is isSameOrDescendant: nodeID is ancestorID or below it.
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

// usedBytes is usedBytes: the total size of every file.
func (s *Service) usedBytes(ctx context.Context) (int64, error) {
	var total int64
	err := s.db.QueryRow(ctx, `SELECT COALESCE(SUM(size_bytes), 0)::bigint FROM dataroom.nodes WHERE kind = 'file'`).Scan(&total)
	return total, err
}

// FolderRef is one listAllFolders row.
type FolderRef struct {
	ID       string  `json:"id"`
	ParentID *string `json:"parent_id"`
	Name     string  `json:"name"`
}

// Folders is listAllFolders, keeping those the actor may open.
func (s *Service) Folders(ctx context.Context, a *Access) ([]FolderRef, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, parent_id::text, name FROM dataroom.nodes WHERE kind = 'folder' ORDER BY lower(name)`)
	if err != nil {
		return nil, err
	}
	all, err := pgx.CollectRows(rows, pgx.RowToStructByPos[FolderRef])
	if err != nil {
		return nil, err
	}
	out := []FolderRef{}
	for _, f := range all {
		if a.AllowsFolder(&f.ID) {
			out = append(out, f)
		}
	}
	return out, nil
}

// CreateFolder is createFolder.
func (s *Service) CreateFolder(ctx context.Context, parentID *string, name, userID, userName string) (*Node, error) {
	return queryNode(ctx, s.db, `INSERT INTO dataroom.nodes (parent_id, kind, name, created_by, created_by_name)
	 VALUES ($1, 'folder', $2, $3, $4) RETURNING `+nodeCols, parentID, domain.SanitizeNodeName(name), userID, userName)
}

// MoveRename is the PATCH body applied to node: move first (a folder never
// into itself or below), then rename. Unchanged values are skipped.
func (s *Service) MoveRename(ctx context.Context, a *Access, node *Node, parentSet bool, parentID, name *string) (*Node, error) {
	if parentSet {
		if parentID != nil && *parentID != "" {
			folder, err := s.Node(ctx, *parentID)
			if err != nil {
				return nil, err
			}
			if folder == nil || folder.Kind != "folder" {
				return nil, httpx.NotFound("Folder tujuan tidak ditemukan")
			}
			if !a.AllowsFolder(parentID) {
				return nil, httpx.Forbidden("Folder tujuan tidak dibuka untuk departemen Anda")
			}
			if node.Kind == "folder" {
				inside, err := s.isSameOrDescendant(ctx, *parentID, node.ID)
				if err != nil {
					return nil, err
				}
				if inside {
					return nil, httpx.BadRequest("Folder tidak bisa dipindahkan ke dalam dirinya sendiri")
				}
			}
		}
		if !sameParent(parentID, node.ParentID) {
			moved, err := queryNode(ctx, s.db, `UPDATE dataroom.nodes SET parent_id = $2, updated_at = now() WHERE id = $1 RETURNING `+nodeCols, node.ID, parentID)
			if err != nil {
				return nil, err
			}
			if moved != nil {
				node = moved
			}
		}
	}
	if name != nil && *name != node.Name {
		renamed, err := queryNode(ctx, s.db, `UPDATE dataroom.nodes SET name = $2, updated_at = now() WHERE id = $1 RETURNING `+nodeCols,
			node.ID, domain.SanitizeNodeName(*name))
		if err != nil {
			return nil, err
		}
		if renamed != nil {
			node = renamed
		}
	}
	return node, nil
}

// sameParent is `target !== node.parent_id` negated (null equals null).
func sameParent(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
