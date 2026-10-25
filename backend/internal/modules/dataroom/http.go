package dataroom

import (
	"context"
	"errors"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"nuhabit/backend/internal/modules/dataroom/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/featureflags"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/ratelimit"
	"nuhabit/backend/internal/platform/validate"
)

// Guard is the slice of platform/auth the handlers use; tests swap it.
type Guard interface {
	RequireMenuPrefix(r *http.Request, prefixes ...string) (*auth.User, error)
	RequireMenuAction(r *http.Request, action string, prefixes ...string) (*auth.User, error)
	HasMenuAction(ctx context.Context, u *auth.User, action string, prefixes ...string) (bool, error)
}

type handler struct {
	svc     *Service
	guard   Guard
	limiter *ratelimit.Limiter
}

// Routes lists every /api/dataroom and /api/share route; the ones that
// move file bytes live in http_files.go, the public link ones in
// http_share.go.
func (h *handler) Routes() []module.Route {
	route := func(pattern string, fn httpx.HandlerFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(fn)}
	}
	return []module.Route{
		route("GET /api/dataroom/departments", h.departments),
		route("GET /api/dataroom/people", h.people),
		route("GET /api/dataroom/tags", h.tags),
		route("GET /api/dataroom/tree", h.tree),
		route("GET /api/dataroom/search", h.search),
		route("GET /api/dataroom/activity", h.rootActivity),
		route("GET /api/dataroom/nodes", h.listNodes),
		route("POST /api/dataroom/nodes", h.createFolder),
		route("GET /api/dataroom/nodes/{id}", h.getNode),
		route("PATCH /api/dataroom/nodes/{id}", h.updateNode),
		route("DELETE /api/dataroom/nodes/{id}", h.trashNode),
		route("POST /api/dataroom/nodes/{id}/restore", h.restoreNode),
		route("DELETE /api/dataroom/nodes/{id}/purge", h.purgeNode),
		route("POST /api/dataroom/nodes/{id}/copy", h.copyNode),
		route("PUT /api/dataroom/nodes/{id}/star", h.star(true)),
		route("DELETE /api/dataroom/nodes/{id}/star", h.star(false)),
		route("PUT /api/dataroom/nodes/{id}/lock", h.lock),
		route("DELETE /api/dataroom/nodes/{id}/lock", h.unlock),
		route("GET /api/dataroom/nodes/{id}/download", h.download),
		route("GET /api/dataroom/nodes/{id}/text", h.nodeText),
		route("GET /api/dataroom/nodes/{id}/versions", h.listVersions),
		route("POST /api/dataroom/nodes/{id}/versions", h.uploadVersion),
		route("GET /api/dataroom/nodes/{id}/versions/{versionId}/download", h.downloadVersion),
		route("POST /api/dataroom/nodes/{id}/versions/{versionId}/restore", h.restoreVersion),
		route("GET /api/dataroom/nodes/{id}/comments", h.listComments),
		route("POST /api/dataroom/nodes/{id}/comments", h.addComment),
		route("DELETE /api/dataroom/comments/{id}", h.deleteComment),
		route("GET /api/dataroom/nodes/{id}/activity", h.nodeActivity),
		route("GET /api/dataroom/nodes/{id}/permissions", h.getPermissions),
		route("PUT /api/dataroom/nodes/{id}/permissions", h.putPermissions),
		route("POST /api/dataroom/upload", h.upload),
		route("POST /api/dataroom/uploads", h.startUpload),
		route("GET /api/dataroom/uploads/{id}", h.uploadStatus),
		route("PUT /api/dataroom/uploads/{id}/chunk", h.uploadChunk),
		route("POST /api/dataroom/uploads/{id}/complete", h.completeUpload),
		route("DELETE /api/dataroom/uploads/{id}", h.abandonUpload),
		route("GET /api/dataroom/nodes/{id}/access", h.getAccess),
		route("PUT /api/dataroom/nodes/{id}/access", h.putAccess),
		route("GET /api/dataroom/shares", h.listShares),
		route("POST /api/dataroom/shares", h.createShare),
		route("GET /api/dataroom/shares/{id}", h.shareLogs),
		route("DELETE /api/dataroom/shares/{id}", h.revokeShare),

		route("GET /api/share/{token}", h.shareInfo),
		route("GET /api/share/{token}/list", h.shareList),
		route("POST /api/share/{token}/request-code", h.requestCode),
		route("POST /api/share/{token}/verify", h.verify),
		route("GET /api/share/{token}/files/{nodeId}", h.shareFile),
	}
}

var (
	required = validate.Rule{}
	optional = validate.Rule{Optional: true}
	nullish  = validate.Rule{Optional: true, Nullable: true}
	defaults = validate.Rule{Optional: true, HasDefault: true}
)

// errBadJSON is a body that is not JSON (a 500, as the TS SyntaxError was).
var errBadJSON = errors.New("request body is not JSON")

// parse validates a JSON body against schema.
func parse[T any](r *http.Request, schema func(*validate.Form) T) (T, error) {
	var zero T
	body, present := validate.ReadBody(r)
	if !present {
		return zero, errBadJSON
	}
	f := validate.New(body, true)
	in := schema(f)
	if err := f.Err("Validation failed"); err != nil {
		return zero, err
	}
	return in, nil
}

// queryParam is `searchParams.get(key) || null`.
func queryParam(r *http.Request, key string) *string {
	if v := r.URL.Query().Get(key); v != "" {
		return &v
	}
	return nil
}

func strOr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// access builds the resolver for the caller with the IAM menu actions.
func (h *handler) access(r *http.Request, u *auth.User) (*Access, error) {
	ctx := r.Context()
	a, err := h.svc.access(ctx, u)
	if err != nil {
		return nil, err
	}
	for action, dst := range map[string]*bool{"create": &a.Actor.CanCreate, "update": &a.Actor.CanUpdate, "delete": &a.Actor.CanDelete} {
		if *dst, err = h.guard.HasMenuAction(ctx, u, action, iam.Dataroom...); err != nil {
			return nil, err
		}
	}
	return a, nil
}

// nodeCtx is a request's caller, resolver and target node.
type nodeCtx struct {
	u    *auth.User
	a    *Access
	node *Node
}

var (
	errNodeNotFound = httpx.NotFound("Item tidak ditemukan")
	errNoAccess     = httpx.Forbidden("Item ini tidak dibuka untuk departemen Anda")
)

// nodeAt loads the node in {id} and refuses below the level the action
// needs. Trashed nodes are visible only when allowTrash is set.
func (h *handler) nodeAt(r *http.Request, need Level, allowTrash bool) (*nodeCtx, error) {
	u, err := h.guard.RequireMenuPrefix(r, iam.Dataroom...)
	if err != nil {
		return nil, err
	}
	node, err := h.svc.Node(r.Context(), r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	if node == nil || (node.TrashedAt != nil && !allowTrash) {
		return nil, errNodeNotFound
	}
	a, err := h.access(r, u)
	if err != nil {
		return nil, err
	}
	level := a.Level(node)
	if level < LevelViewer {
		return nil, errNoAccess
	}
	if level < need {
		return nil, httpx.Forbidden(needMessage(need))
	}
	return &nodeCtx{u, a, node}, nil
}

func needMessage(need Level) string {
	switch need {
	case LevelOwner:
		return "Hanya pemilik yang bisa melakukan ini"
	case LevelEditor:
		return "Anda tidak punya hak mengedit item ini"
	case LevelCommenter:
		return "Anda tidak punya hak berkomentar di item ini"
	}
	return "Insufficient permissions"
}

func (h *handler) departments(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.Dataroom...); err != nil {
		return err
	}
	list, err := h.svc.Departments(r.Context())
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, list)
}

// people is GET /api/dataroom/people?q= for grant and mention pickers.
func (h *handler) people(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.Dataroom...); err != nil {
		return err
	}
	list, err := h.svc.ports.People.Search(r.Context(), r.URL.Query().Get("q"), 30)
	if err != nil {
		return err
	}
	if list == nil {
		list = []Person{}
	}
	return httpx.Data(w, http.StatusOK, list)
}

func (h *handler) tags(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.Dataroom...); err != nil {
		return err
	}
	list, err := h.svc.Tags(r.Context())
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, list)
}

func (h *handler) tree(w http.ResponseWriter, r *http.Request) error {
	u, err := h.guard.RequireMenuPrefix(r, iam.Dataroom...)
	if err != nil {
		return err
	}
	a, err := h.access(r, u)
	if err != nil {
		return err
	}
	folders, err := h.svc.Folders(r.Context(), a)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, folders)
}

// listedNode is a listed node with its departments, star and the caller's
// level.
type listedNode struct {
	Node
	Departments []DepartmentRef `json:"departments"`
	Starred     bool            `json:"starred"`
	MyLevel     string          `json:"my_level"`
	Path        []Crumb         `json:"path,omitempty"`
}

// decorate keeps the nodes the actor may see and adds departments, stars
// and levels.
func (h *handler) decorate(ctx context.Context, a *Access, nodes []Node, withPath bool) ([]listedNode, error) {
	var visible []Node
	var folderIDs, ids []string
	for _, n := range nodes {
		if a.AllowsNode(&n) {
			visible = append(visible, n)
			ids = append(ids, n.ID)
			if n.Kind == "folder" {
				folderIDs = append(folderIDs, n.ID)
			}
		}
	}
	depts, err := h.svc.DepartmentsFor(ctx, folderIDs)
	if err != nil {
		return nil, err
	}
	stars, err := h.svc.StarredIDs(ctx, a.Actor.UserID, ids)
	if err != nil {
		return nil, err
	}
	items := make([]listedNode, len(visible))
	for i, n := range visible {
		items[i] = listedNode{Node: n, Departments: depts[n.ID], Starred: stars[n.ID], MyLevel: a.Level(&n).String()}
		if items[i].Departments == nil {
			items[i].Departments = []DepartmentRef{}
		}
		if withPath {
			trail, err := h.svc.Ancestors(ctx, n.ID)
			if err != nil {
				return nil, err
			}
			items[i].Path = trail[:max(0, len(trail)-1)]
		}
	}
	return items, nil
}

type usage struct {
	Used       int64   `json:"used"`
	Quota      float64 `json:"quota"`
	MaxFile    float64 `json:"max_file"`
	MaxChunked float64 `json:"max_chunked"`
}

func (h *handler) usage(ctx context.Context) (usage, error) {
	used, err := h.svc.usedBytes(ctx)
	return usage{used, h.svc.ports.QuotaBytes, h.svc.ports.MaxFileBytes, h.svc.ports.MaxChunkedBytes}, err
}

// listing is the GET /api/dataroom/nodes answer.
type listing struct {
	Parent      *Node        `json:"parent"`
	Items       []listedNode `json:"items"`
	Ancestors   []Crumb      `json:"ancestors"`
	Usage       usage        `json:"usage"`
	Permissions struct {
		Create       bool `json:"create"`
		Update       bool `json:"update"`
		Delete       bool `json:"delete"`
		ManageAccess bool `json:"manage_access"`
		// Level is the caller's level on the open folder (root: editor
		// with the create action).
		Level string `json:"level"`
	} `json:"permissions"`
	Actor struct {
		UserID         string  `json:"user_id"`
		IsAdmin        bool    `json:"is_admin"`
		DepartmentName *string `json:"department_name"`
	} `json:"actor"`
	View string `json:"view"`
}

// listNodes is GET /api/dataroom/nodes?parent= or ?view=starred|recent|
// shared|trash.
func (h *handler) listNodes(w http.ResponseWriter, r *http.Request) error {
	u, err := h.guard.RequireMenuPrefix(r, iam.Dataroom...)
	if err != nil {
		return err
	}
	ctx := r.Context()
	a, err := h.access(r, u)
	if err != nil {
		return err
	}
	out := listing{Ancestors: []Crumb{}, View: r.URL.Query().Get("view")}
	parentID := queryParam(r, "parent")
	var nodes []Node
	level := a.FolderLevel(nil)
	switch out.View {
	case "starred":
		nodes, err = h.svc.Starred(ctx, u.ID)
	case "recent":
		nodes, err = h.svc.Recent(ctx, u.ID)
	case "shared":
		nodes, err = h.svc.SharedWithMe(ctx, u.ID, u.Role)
	case "trash":
		nodes, err = h.svc.Trash(ctx)
	case "":
		if parentID != nil {
			if out.Parent, err = h.svc.LiveFolder(ctx, *parentID); err != nil {
				return err
			}
			if out.Parent == nil {
				return httpx.NotFound("Folder tidak ditemukan")
			}
			if level = a.Level(out.Parent); level < LevelViewer {
				return httpx.Forbidden("Folder ini tidak dibuka untuk departemen Anda")
			}
			if out.Ancestors, err = h.svc.Ancestors(ctx, *parentID); err != nil {
				return err
			}
		}
		nodes, err = h.svc.Children(ctx, parentID)
	default:
		return httpx.BadRequest("Tampilan tidak dikenal")
	}
	if err != nil {
		return err
	}
	if out.Items, err = h.decorate(ctx, a, nodes, out.View != ""); err != nil {
		return err
	}
	if out.Usage, err = h.usage(ctx); err != nil {
		return err
	}
	out.Permissions.Create, out.Permissions.Update, out.Permissions.Delete = a.Actor.CanCreate, a.Actor.CanUpdate, a.Actor.CanDelete
	out.Permissions.ManageAccess, out.Permissions.Level = a.Actor.IsAdmin, level.String()
	out.Actor.UserID, out.Actor.IsAdmin, out.Actor.DepartmentName = u.ID, a.Actor.IsAdmin, a.Actor.DepartmentName
	return httpx.Data(w, http.StatusOK, out)
}

// search is GET /api/dataroom/search?q=&tag=.
func (h *handler) search(w http.ResponseWriter, r *http.Request) error {
	u, err := h.guard.RequireMenuPrefix(r, iam.Dataroom...)
	if err != nil {
		return err
	}
	a, err := h.access(r, u)
	if err != nil {
		return err
	}
	nodes, err := h.svc.Search(r.Context(), r.URL.Query().Get("q"), r.URL.Query().Get("tag"))
	if err != nil {
		return err
	}
	items, err := h.decorate(r.Context(), a, nodes, true)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, struct {
		Items []listedNode `json:"items"`
	}{items})
}

// getNode is GET /api/dataroom/nodes/{id}: one node with its path.
func (h *handler) getNode(w http.ResponseWriter, r *http.Request) error {
	c, err := h.nodeAt(r, LevelViewer, true)
	if err != nil {
		return err
	}
	items, err := h.decorate(r.Context(), c.a, []Node{*c.node}, true)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, items[0])
}

type folderInput struct {
	Name     string
	ParentID *string
}

func folderSchema(f *validate.Form) folderInput {
	return folderInput{
		Name:     strOr(f.Str("name", required, validate.StrOpts{Trim: true, Min: 1, Max: 255})),
		ParentID: f.UUID("parent_id", nullish),
	}
}

// parentFolder checks that the actor may write into parent (nil is root).
func (h *handler) parentFolder(r *http.Request, a *Access, parentID *string) error {
	if parentID == nil {
		if !a.Actor.CanCreate && !a.Actor.IsAdmin {
			return httpx.Forbidden("Anda tidak punya hak menulis di root")
		}
		return nil
	}
	parent, err := h.svc.LiveFolder(r.Context(), *parentID)
	if err != nil {
		return err
	}
	if parent == nil {
		return httpx.NotFound("Folder tujuan tidak ditemukan")
	}
	switch level := a.Level(parent); {
	case level < LevelViewer:
		return httpx.Forbidden("Folder ini tidak dibuka untuk departemen Anda")
	case level < LevelEditor:
		return httpx.Forbidden("Anda tidak punya hak menulis di folder ini")
	}
	return nil
}

func (h *handler) createFolder(w http.ResponseWriter, r *http.Request) error {
	u, err := h.guard.RequireMenuAction(r, "create", iam.Dataroom...)
	if err != nil {
		return err
	}
	in, err := parse(r, folderSchema)
	if err != nil {
		return err
	}
	a, err := h.access(r, u)
	if err != nil {
		return err
	}
	if in.ParentID != nil {
		parent, err := h.svc.LiveFolder(r.Context(), *in.ParentID)
		if err != nil {
			return err
		}
		if parent == nil {
			return httpx.NotFound("Folder induk tidak ditemukan")
		}
		if a.Level(parent) < LevelEditor {
			return httpx.Forbidden("Folder ini tidak dibuka untuk departemen Anda")
		}
	}
	node, err := h.svc.CreateFolder(r.Context(), in.ParentID, in.Name, u.ID, u.FullName)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, node)
}

func nodePatchSchema(f *validate.Form) NodePatch {
	in := NodePatch{Name: f.Str("name", optional, validate.StrOpts{Trim: true, Min: 1, Max: 255})}
	fields := f.Fields()
	_, in.ParentSet = fields["parent_id"]
	in.ParentID = f.UUID("parent_id", nullish)
	_, in.DescSet = fields["description"]
	in.Description = f.Str("description", nullish, validate.StrOpts{Trim: true, Max: 2000})
	if _, ok := fields["tags"]; ok {
		in.Tags = f.Strings("tags", required, 50, validate.StrOpts{Max: 60})
		if in.Tags == nil {
			in.Tags = []string{}
		}
	}
	return in
}

func (h *handler) updateNode(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuAction(r, "update", iam.Dataroom...); err != nil {
		return err
	}
	in, err := parse(r, nodePatchSchema)
	if err != nil {
		return err
	}
	c, err := h.nodeAt(r, LevelEditor, false)
	if err != nil {
		return err
	}
	node, err := h.svc.Patch(r.Context(), c.a, c.node, in)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, node)
}

// trashNode is DELETE /api/dataroom/nodes/{id}: to the trash.
func (h *handler) trashNode(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuAction(r, "delete", iam.Dataroom...); err != nil {
		return err
	}
	c, err := h.nodeAt(r, LevelEditor, false)
	if err != nil {
		return err
	}
	if err := h.svc.TrashNode(r.Context(), c.a, c.node); err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, struct {
		Trashed string `json:"trashed"`
	}{c.node.ID})
}

func (h *handler) restoreNode(w http.ResponseWriter, r *http.Request) error {
	c, err := h.nodeAt(r, LevelEditor, true)
	if err != nil {
		return err
	}
	node, err := h.svc.RestoreNode(r.Context(), c.a, c.node)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, node)
}

// purgeNode is DELETE /api/dataroom/nodes/{id}/purge: gone for good, with
// its files and versions (owner).
func (h *handler) purgeNode(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuAction(r, "delete", iam.Dataroom...); err != nil {
		return err
	}
	c, err := h.nodeAt(r, LevelOwner, true)
	if err != nil {
		return err
	}
	removed, err := h.svc.PurgeNode(r.Context(), c.node, c.u.ID, c.u.FullName)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, struct {
		Deleted      string `json:"deleted"`
		FilesRemoved int    `json:"files_removed"`
	}{c.node.ID, removed})
}

func (h *handler) copyNode(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuAction(r, "create", iam.Dataroom...); err != nil {
		return err
	}
	parentID, err := parse(r, func(f *validate.Form) *string { return f.UUID("parent_id", nullish) })
	if err != nil {
		return err
	}
	c, err := h.nodeAt(r, LevelViewer, false)
	if err != nil {
		return err
	}
	if err := h.parentFolder(r, c.a, parentID); err != nil {
		return err
	}
	node, err := h.svc.Copy(r.Context(), c.a, c.node, parentID)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, node)
}

func (h *handler) star(on bool) httpx.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		c, err := h.nodeAt(r, LevelViewer, false)
		if err != nil {
			return err
		}
		if err := h.svc.SetStar(r.Context(), c.u.ID, c.node.ID, on); err != nil {
			return err
		}
		return httpx.Data(w, http.StatusOK, struct {
			Starred bool `json:"starred"`
		}{on})
	}
}

func (h *handler) lock(w http.ResponseWriter, r *http.Request) error {
	c, err := h.nodeAt(r, LevelEditor, false)
	if err != nil {
		return err
	}
	node, err := h.svc.Lock(r.Context(), c.a, c.node)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, node)
}

func (h *handler) unlock(w http.ResponseWriter, r *http.Request) error {
	c, err := h.nodeAt(r, LevelEditor, false)
	if err != nil {
		return err
	}
	node, err := h.svc.Unlock(r.Context(), c.a, c.node)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, node)
}

/* ── Comments, activity, permissions ─────────────────────────────────── */

func (h *handler) listComments(w http.ResponseWriter, r *http.Request) error {
	c, err := h.nodeAt(r, LevelViewer, false)
	if err != nil {
		return err
	}
	list, err := h.svc.Comments(r.Context(), c.node.ID)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, list)
}

type commentInput struct {
	Body     string
	ParentID *string
	Mentions []string
}

func commentSchema(f *validate.Form) commentInput {
	return commentInput{
		Body:     strOr(f.Str("body", required, validate.StrOpts{Trim: true, Min: 1, Max: MaxCommentLen})),
		ParentID: f.UUID("parent_id", nullish),
		Mentions: f.Strings("mention_user_ids", defaults, 20, validate.StrOpts{Check: validate.UUIDCheck}),
	}
}

func (h *handler) addComment(w http.ResponseWriter, r *http.Request) error {
	in, err := parse(r, commentSchema)
	if err != nil {
		return err
	}
	c, err := h.nodeAt(r, LevelCommenter, false)
	if err != nil {
		return err
	}
	comment, err := h.svc.AddComment(r.Context(), c.a, c.node, in.ParentID, in.Body, in.Mentions)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, comment)
}

func (h *handler) deleteComment(w http.ResponseWriter, r *http.Request) error {
	u, err := h.guard.RequireMenuPrefix(r, iam.Dataroom...)
	if err != nil {
		return err
	}
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return httpx.NotFound("Komentar tidak ditemukan")
	}
	comment, node, err := h.svc.CommentNode(r.Context(), id)
	if err != nil {
		return err
	}
	if comment == nil || node == nil {
		return httpx.NotFound("Komentar tidak ditemukan")
	}
	a, err := h.access(r, u)
	if err != nil {
		return err
	}
	if a.Level(node) < LevelViewer {
		return errNoAccess
	}
	if comment.CreatedBy != u.ID && a.Level(node) < LevelOwner {
		return httpx.Forbidden("Hanya penulis atau pemilik yang bisa menghapus komentar")
	}
	if err := h.svc.DeleteComment(r.Context(), id); err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, struct {
		Deleted string `json:"deleted"`
	}{id})
}

func (h *handler) nodeActivity(w http.ResponseWriter, r *http.Request) error {
	c, err := h.nodeAt(r, LevelViewer, true)
	if err != nil {
		return err
	}
	list, err := h.svc.Activity(r.Context(), &c.node.ID, c.a.Level(c.node) >= LevelOwner)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, list)
}

func (h *handler) rootActivity(w http.ResponseWriter, r *http.Request) error {
	u, err := h.guard.RequireMenuPrefix(r, iam.Dataroom...)
	if err != nil {
		return err
	}
	a, err := h.access(r, u)
	if err != nil {
		return err
	}
	list, err := h.svc.Activity(r.Context(), nil, a.Actor.IsAdmin)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, list)
}

func (h *handler) getPermissions(w http.ResponseWriter, r *http.Request) error {
	c, err := h.nodeAt(r, LevelViewer, false)
	if err != nil {
		return err
	}
	grants, err := h.svc.Grants(r.Context(), c.node.ID)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, struct {
		Grants    []Grant `json:"grants"`
		CanManage bool    `json:"can_manage"`
		MyLevel   string  `json:"my_level"`
	}{grants, c.a.Level(c.node) >= LevelOwner, c.a.Level(c.node).String()})
}

var grantRoles = []string{"viewer", "commenter", "editor", "owner"}

func grantsSchema(f *validate.Form) []GrantInput {
	out := []GrantInput{}
	f.List("grants", required, 200, func(items *validate.Form, i int, v any) {
		g := items.Item(i, v)
		out = append(out, GrantInput{
			SubjectType: strOr(g.Enum("subject_type", required, []string{"user", "role"})),
			SubjectID:   strOr(g.Str("subject_id", required, validate.StrOpts{Trim: true, Min: 1, Max: 80})),
			Role:        strOr(g.Enum("role", required, grantRoles)),
		})
	})
	return out
}

func (h *handler) putPermissions(w http.ResponseWriter, r *http.Request) error {
	in, err := parse(r, grantsSchema)
	if err != nil {
		return err
	}
	c, err := h.nodeAt(r, LevelOwner, false)
	if err != nil {
		return err
	}
	grants, err := h.svc.SetGrants(r.Context(), c.a, c.node, in)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, struct {
		Grants []Grant `json:"grants"`
	}{grants})
}

/* ── Department access (super admin) ─────────────────────────────────── */

// folderOr404 loads a folder for the access routes.
func (h *handler) folderOr404(ctx context.Context, id string) error {
	node, err := h.svc.Node(ctx, id)
	if err != nil {
		return err
	}
	if node == nil || node.Kind != "folder" {
		return httpx.NotFound("Folder tidak ditemukan")
	}
	return nil
}

func (h *handler) writeAccess(w http.ResponseWriter, ctx context.Context, id string) error {
	depts, err := h.svc.DepartmentsFor(ctx, []string{id})
	if err != nil {
		return err
	}
	list := depts[id]
	if list == nil {
		list = []DepartmentRef{}
	}
	return httpx.Data(w, http.StatusOK, struct {
		NodeID      string          `json:"node_id"`
		Departments []DepartmentRef `json:"departments"`
	}{id, list})
}

func (h *handler) getAccess(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.Dataroom...); err != nil {
		return err
	}
	id := r.PathValue("id")
	if err := h.folderOr404(r.Context(), id); err != nil {
		return err
	}
	return h.writeAccess(w, r.Context(), id)
}

func (h *handler) putAccess(w http.ResponseWriter, r *http.Request) error {
	u, err := h.guard.RequireMenuPrefix(r, iam.Dataroom...)
	if err != nil {
		return err
	}
	if !domain.IsAdminRole(u.Role) {
		return httpx.Forbidden("Hanya super admin yang bisa mengatur akses departemen")
	}
	id := r.PathValue("id")
	if err := h.folderOr404(r.Context(), id); err != nil {
		return err
	}
	ids, err := parse(r, func(f *validate.Form) []string {
		return f.Strings("department_ids", required, 200, validate.StrOpts{Check: validate.UUIDCheck})
	})
	if err != nil {
		return err
	}
	unique := []string{}
	seen := map[string]bool{}
	for _, d := range ids {
		if !seen[d] {
			seen[d] = true
			unique = append(unique, d)
		}
	}
	if err := h.svc.SetDepartments(r.Context(), id, unique, u.ID); err != nil {
		return err
	}
	return h.writeAccess(w, r.Context(), id)
}

/* ── Share links (dashboard side) ────────────────────────────────────── */

func (h *handler) listShares(w http.ResponseWriter, r *http.Request) error {
	u, err := h.guard.RequireMenuPrefix(r, iam.Dataroom...)
	if err != nil {
		return err
	}
	a, err := h.access(r, u)
	if err != nil {
		return err
	}
	list, err := h.svc.Shares(r.Context(), a, queryParam(r, "node_id"))
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, list)
}

var pinRe = regexp.MustCompile(`^\d{4,6}$`)

func shareSchema(f *validate.Form) ShareInput {
	in := ShareInput{
		NodeID:     strOr(f.UUID("node_id", required)),
		AccessType: strOr(f.Enum("access_type", required, []string{"public", "email"})),
		Emails:     f.Strings("emails", defaults, math.MaxInt, validate.StrOpts{}),
		Pin: f.Str("pin", nullish, validate.StrOpts{Check: func(s string) (string, string, bool) {
			return "invalid_format", "PIN harus 4 sampai 6 digit angka", pinRe.MatchString(s)
		}}),
		Watermark:     f.BoolDefault("watermark", false),
		AllowDownload: f.BoolDefault("allow_download", true),
	}
	in.ExpiresDays = 7
	if n := f.Int("expires_days", defaults, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(domain.MaxExpiryDays)}); n != nil {
		in.ExpiresDays = *n
	}
	in.SendEmail = f.BoolDefault("send_email", false)
	return in
}

func (h *handler) createShare(w http.ResponseWriter, r *http.Request) error {
	u, err := h.guard.RequireMenuAction(r, "create", iam.Dataroom...)
	if err != nil {
		return err
	}
	in, err := parse(r, shareSchema)
	if err != nil {
		return err
	}
	if in.AccessType == "email" && !featureflags.OTPEnabled() {
		return httpx.Status(http.StatusServiceUnavailable, "Link dengan verifikasi email sedang tidak tersedia")
	}
	a, err := h.access(r, u)
	if err != nil {
		return err
	}
	out, err := h.svc.CreateShare(r.Context(), a, u.ID, u.FullName, in)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, out)
}

// shareOr404 loads a share for the dashboard routes.
func (h *handler) shareOr404(ctx context.Context, id string) error {
	sh, err := h.svc.ShareByID(ctx, id)
	if err == nil && sh == nil {
		err = httpx.NotFound("Link tidak ditemukan")
	}
	return err
}

func (h *handler) shareLogs(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.Dataroom...); err != nil {
		return err
	}
	id := r.PathValue("id")
	if err := h.shareOr404(r.Context(), id); err != nil {
		return err
	}
	logs, err := h.svc.ShareLogs(r.Context(), id)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, struct {
		Logs []AccessLog `json:"logs"`
	}{logs})
}

func (h *handler) revokeShare(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuAction(r, "update", iam.Dataroom...); err != nil {
		return err
	}
	id := r.PathValue("id")
	if err := h.shareOr404(r.Context(), id); err != nil {
		return err
	}
	if err := h.svc.RevokeShare(r.Context(), id); err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, struct {
		Revoked string `json:"revoked"`
	}{id})
}

// now is the service clock (rate limit windows).
func (h *handler) now() time.Time { return h.svc.now() }

// rateLimit answers a one-minute fixed window shared by every replica with
// a 429 msg.
func (h *handler) rateLimit(r *http.Request, key string, limit int, msg string) error {
	w, err := h.limiter.Fixed(r.Context(), key, limit, time.Minute, h.now())
	if err != nil {
		return err
	}
	if !w.Allowed {
		return httpx.TooManyRequests(msg)
	}
	return nil
}

// headerInt reads a non-negative integer header, -1 when absent or bad.
func headerInt(r *http.Request, key string) int64 {
	v, err := strconv.ParseInt(r.Header.Get(key), 10, 64)
	if err != nil || v < 0 {
		return -1
	}
	return v
}
