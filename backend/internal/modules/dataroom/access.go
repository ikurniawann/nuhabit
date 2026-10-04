package dataroom

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/dataroom/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
)

// Department access to folders (lib/dataroom/access.ts): super admin sees
// everything; other users take their department from HRIS. A folder
// without configuration is open; a configured one is open only to the
// listed departments, and the rule applies to everything below it.

// Actor is DataroomActor.
type Actor struct {
	UserID         string
	IsAdmin        bool
	DepartmentID   *string
	DepartmentName *string
}

// resolveActor is resolveActor; a failed department lookup counts as no
// department, as the TS .catch(() => null) does.
func (s *Service) resolveActor(ctx context.Context, u *auth.User) Actor {
	a := Actor{UserID: u.ID, IsAdmin: domain.IsAdminRole(u.Role)}
	if id, name, err := s.ports.Directory.ActorDepartment(ctx, u.ID); err == nil {
		a.DepartmentID, a.DepartmentName = id, name
	}
	return a
}

// Access is createAccessResolver: every folder's parent and configuration
// loaded once, then checked up the chain without more queries.
type Access struct {
	Actor    Actor
	parentOf map[string]*string
	configs  map[string][]string
}

// access builds the resolver for the caller.
func (s *Service) access(ctx context.Context, u *auth.User) (*Access, error) {
	a := &Access{Actor: s.resolveActor(ctx, u), parentOf: map[string]*string{}, configs: map[string][]string{}}
	if !a.Actor.IsAdmin {
		rows, err := s.db.Query(ctx, `SELECT id::text, parent_id::text FROM dataroom.nodes WHERE kind = 'folder'`)
		if err != nil {
			return nil, err
		}
		var id string
		var parent *string
		if _, err := pgx.ForEachRow(rows, []any{&id, &parent}, func() error { a.parentOf[id] = parent; return nil }); err != nil {
			return nil, err
		}
	}
	rows, err := s.db.Query(ctx, `SELECT node_id::text, department_id::text FROM dataroom.folder_departments`)
	if err != nil {
		if s.missingConfigTable(err) {
			return a, nil
		}
		return nil, err
	}
	var node, dept string
	_, err = pgx.ForEachRow(rows, []any{&node, &dept}, func() error { a.configs[node] = append(a.configs[node], dept); return nil })
	if err != nil && s.missingConfigTable(err) {
		return a, nil
	}
	return a, err
}

// AllowsFolder is allowsFolder: nil is the root, always open.
func (a *Access) AllowsFolder(folderID *string) bool {
	if a.Actor.IsAdmin || folderID == nil {
		return true
	}
	var chain [][]string
	cur := folderID
	for guard := 0; cur != nil && *cur != "" && guard < 200; guard++ {
		if c, ok := a.configs[*cur]; ok {
			chain = append(chain, c)
		}
		cur = a.parentOf[*cur]
	}
	return domain.EvaluateAccess(chain, a.Actor.DepartmentID, false)
}

// Allows is allows: a folder by itself, a file by its parent folder.
func (a *Access) Allows(id string, parentID *string, kind string) bool {
	if kind == "folder" {
		return a.AllowsFolder(&id)
	}
	return a.AllowsFolder(parentID)
}

// AllowsNode is Allows for a node.
func (a *Access) AllowsNode(n *Node) bool { return a.Allows(n.ID, n.ParentID, n.Kind) }

// Departments is listDepartments.
func (s *Service) Departments(ctx context.Context) ([]DepartmentRef, error) {
	list, err := s.ports.Directory.Departments(ctx)
	if list == nil {
		list = []DepartmentRef{}
	}
	return list, err
}

// DepartmentsFor is getDepartmentsForNodes: the configured departments of
// each node that has any, by department name.
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

// errConfigTableMissing is setNodeDepartments' message on an instance
// without the folder_departments table (a 500, as in TS).
var errConfigTableMissing = errors.New("Pengaturan akses departemen belum aktif di server ini. Jalankan migration " +
	"20260905110000_dataroom_folder_departments.sql lebih dahulu.")

// SetDepartments is setNodeDepartments: replace the folder's departments
// with the existing ones among ids (unique; empty opens the folder to
// everyone).
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
