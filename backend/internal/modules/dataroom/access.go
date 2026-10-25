package dataroom

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/dataroom/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
)

// Access to nodes. Two layers:
//
//  1. Explicit grants (dataroom.permissions) per user or per role, inherited
//     down the tree. The nearest grant on the path from the node to the
//     root wins, so a grant on a subfolder overrides one above it. At one
//     node a user grant beats a role grant.
//  2. Without a grant on the path, the department baseline: a folder
//     without department configuration is open to everyone with the
//     Dataroom menu, a configured one only to the listed departments, and
//     the rule applies down the tree. The IAM menu actions then set the
//     level: read gives viewer, create or update gives editor. A
//     restricted folder (filing port) has no baseline.
//
// The creator of a node and super admin are owners.

// Level is what an actor may do with a node.
type Level int

const (
	LevelNone Level = iota
	LevelViewer
	LevelCommenter
	LevelEditor
	LevelOwner
)

var levelByRole = map[string]Level{"viewer": LevelViewer, "commenter": LevelCommenter, "editor": LevelEditor, "owner": LevelOwner}

// String is the role name of a level ("" for none).
func (l Level) String() string {
	for k, v := range levelByRole {
		if v == l {
			return k
		}
	}
	return ""
}

// Actor is the caller as the access layer sees it.
type Actor struct {
	UserID         string
	Name           string
	Role           string
	IsAdmin        bool
	DepartmentID   *string
	DepartmentName *string
	// CanCreate, CanUpdate and CanDelete are the IAM menu actions, set by
	// the handler.
	CanCreate, CanUpdate, CanDelete bool
}

// resolveActor reads the department; a failed lookup counts as none.
func (s *Service) resolveActor(ctx context.Context, u *auth.User) Actor {
	a := Actor{UserID: u.ID, Name: u.FullName, Role: u.Role, IsAdmin: domain.IsAdminRole(u.Role)}
	if id, name, err := s.ports.Directory.ActorDepartment(ctx, u.ID); err == nil {
		a.DepartmentID, a.DepartmentName = id, name
	}
	return a
}

// grant is one dataroom.permissions row.
type grant struct {
	subjectType, subjectID string
	level                  Level
}

// folderInfo is what the chain walk needs about a folder.
type folderInfo struct {
	parent     *string
	restricted bool
}

// Access is the resolver: every folder's parent, every department
// configuration and every grant loaded once, then checked up the chain
// without more queries.
type Access struct {
	Actor   Actor
	folders map[string]folderInfo
	configs map[string][]string
	grants  map[string][]grant
}

// access builds the resolver for the caller.
func (s *Service) access(ctx context.Context, u *auth.User) (*Access, error) {
	a := &Access{Actor: s.resolveActor(ctx, u), folders: map[string]folderInfo{}, configs: map[string][]string{}, grants: map[string][]grant{}}
	rows, err := s.db.Query(ctx, `SELECT id::text, parent_id::text, restricted FROM dataroom.nodes WHERE kind = 'folder'`)
	if err != nil {
		return nil, err
	}
	var id string
	var parent *string
	var restricted bool
	if _, err := pgx.ForEachRow(rows, []any{&id, &parent, &restricted}, func() error {
		a.folders[id] = folderInfo{parent, restricted}
		return nil
	}); err != nil {
		return nil, err
	}
	rows, err = s.db.Query(ctx, `SELECT node_id::text, subject_type, subject_id, role FROM dataroom.permissions
	 WHERE (subject_type = 'user' AND subject_id = $1) OR (subject_type = 'role' AND subject_id = $2)`, u.ID, u.Role)
	if err != nil {
		return nil, err
	}
	var node, stype, sid, role string
	if _, err := pgx.ForEachRow(rows, []any{&node, &stype, &sid, &role}, func() error {
		a.grants[node] = append(a.grants[node], grant{stype, sid, levelByRole[role]})
		return nil
	}); err != nil {
		return nil, err
	}
	rows, err = s.db.Query(ctx, `SELECT node_id::text, department_id::text FROM dataroom.folder_departments`)
	if err != nil {
		if s.missingConfigTable(err) {
			return a, nil
		}
		return nil, err
	}
	var dept string
	_, err = pgx.ForEachRow(rows, []any{&node, &dept}, func() error { a.configs[node] = append(a.configs[node], dept); return nil })
	if err != nil && s.missingConfigTable(err) {
		return a, nil
	}
	return a, err
}

// grantAt is the level of the actor's grant on one node: a user grant,
// else the highest role grant; LevelNone without one.
func (a *Access) grantAt(nodeID string) Level {
	best := LevelNone
	for _, g := range a.grants[nodeID] {
		if g.subjectType == "user" {
			return g.level
		}
		if g.level > best {
			best = g.level
		}
	}
	return best
}

// baseline is the department rule and the IAM actions for a folder chain
// (nil is the root).
func (a *Access) baseline(folderID *string) Level {
	var chain [][]string
	cur := folderID
	for guard := 0; cur != nil && *cur != "" && guard < 200; guard++ {
		info, ok := a.folders[*cur]
		if !ok {
			return LevelNone
		}
		if info.restricted {
			return LevelNone
		}
		if c, ok := a.configs[*cur]; ok {
			chain = append(chain, c)
		}
		cur = info.parent
	}
	if !domain.EvaluateAccess(chain, a.Actor.DepartmentID, false) {
		return LevelNone
	}
	if a.Actor.CanCreate || a.Actor.CanUpdate {
		return LevelEditor
	}
	return LevelViewer
}

// FolderLevel is the actor's level on a folder (nil is the root).
func (a *Access) FolderLevel(folderID *string) Level {
	if a.Actor.IsAdmin {
		return LevelOwner
	}
	if folderID == nil || *folderID == "" {
		if a.Actor.CanCreate {
			return LevelEditor
		}
		return LevelViewer
	}
	cur := folderID
	for guard := 0; cur != nil && *cur != "" && guard < 200; guard++ {
		if l := a.grantAt(*cur); l != LevelNone {
			return l
		}
		info, ok := a.folders[*cur]
		if !ok {
			return LevelNone
		}
		cur = info.parent
	}
	return a.baseline(folderID)
}

// Level is the actor's level on a node: owner for its creator, else its
// own grant, else the folder chain above it.
func (a *Access) Level(n *Node) Level {
	if a.Actor.IsAdmin || (n.CreatedBy != nil && *n.CreatedBy == a.Actor.UserID && a.Actor.UserID != "") {
		return LevelOwner
	}
	if n.Kind == "folder" {
		return a.FolderLevel(&n.ID)
	}
	if l := a.grantAt(n.ID); l != LevelNone {
		return l
	}
	return a.FolderLevel(n.ParentID)
}

// AllowsFolder reports whether the actor may open a folder (nil is root).
func (a *Access) AllowsFolder(folderID *string) bool { return a.FolderLevel(folderID) >= LevelViewer }

// AllowsNode reports whether the actor may see a node.
func (a *Access) AllowsNode(n *Node) bool { return a.Level(n) >= LevelViewer }

// Departments lists the HRIS departments.
func (s *Service) Departments(ctx context.Context) ([]DepartmentRef, error) {
	list, err := s.ports.Directory.Departments(ctx)
	if list == nil {
		list = []DepartmentRef{}
	}
	return list, err
}

// DepartmentsFor is the configured departments of each node that has any,
// by department name.
func (s *Service) DepartmentsFor(ctx context.Context, nodeIDs []string) (map[string][]DepartmentRef, error) {
	out := map[string][]DepartmentRef{}
	if len(nodeIDs) == 0 {
		return out, nil
	}
	rows, err := s.db.Query(ctx, `SELECT node_id::text, department_id::text FROM dataroom.folder_departments
	 WHERE node_id = ANY($1::uuid[])`, nodeIDs)
	if err != nil {
		if s.missingConfigTable(err) {
			return out, nil
		}
		return nil, err
	}
	byDept := map[string][]string{}
	var deptIDs []string
	var node, dept string
	if _, err := pgx.ForEachRow(rows, []any{&node, &dept}, func() error {
		if _, seen := byDept[dept]; !seen {
			deptIDs = append(deptIDs, dept)
		}
		byDept[dept] = append(byDept[dept], node)
		return nil
	}); err != nil {
		return nil, err
	}
	if len(deptIDs) == 0 {
		return out, nil
	}
	depts, err := s.ports.Directory.DepartmentsByID(ctx, deptIDs)
	if err != nil {
		return nil, err
	}
	for _, d := range depts {
		for _, n := range byDept[d.ID] {
			out[n] = append(out[n], d)
		}
	}
	return out, nil
}

// errConfigTableMissing is the message on an instance without the
// folder_departments table (a 500).
var errConfigTableMissing = errors.New("Pengaturan akses departemen belum aktif di server ini. Jalankan migration " +
	"20260905110000_dataroom_folder_departments.sql lebih dahulu.")

// SetDepartments replaces the folder's departments with the existing ones
// among ids (unique; empty opens the folder to everyone).
func (s *Service) SetDepartments(ctx context.Context, nodeID string, ids []string, userID string) error {
	existing := []string{}
	if len(ids) > 0 {
		depts, err := s.ports.Directory.DepartmentsByID(ctx, ids)
		if err != nil {
			return err
		}
		for _, d := range depts {
			existing = append(existing, d.ID)
		}
	}
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM dataroom.folder_departments WHERE node_id = $1`, nodeID); err != nil {
			return err
		}
		if len(existing) == 0 {
			return nil
		}
		_, err := tx.Exec(ctx, `INSERT INTO dataroom.folder_departments (node_id, department_id, created_by)
		 SELECT $1, unnest($2::uuid[]), $3 ON CONFLICT DO NOTHING`, nodeID, existing, userID)
		return err
	})
	if database.IsUndefinedTable(err) {
		return errConfigTableMissing
	}
	return err
}
