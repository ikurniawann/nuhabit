package dataroom

import (
	"context"
	"errors"
	"math"
	"net/http"
	"regexp"
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
// move file bytes live in http_files.go.
func (h *handler) Routes() []module.Route {
	route := func(pattern string, fn httpx.HandlerFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(fn)}
	}
	return []module.Route{
		route("GET /api/dataroom/departments", h.departments),
		route("GET /api/dataroom/tree", h.tree),
		route("GET /api/dataroom/nodes", h.listNodes),
		route("POST /api/dataroom/nodes", h.createFolder),
		route("PATCH /api/dataroom/nodes/{id}", h.updateNode),
		route("DELETE /api/dataroom/nodes/{id}", h.deleteNode),
		route("GET /api/dataroom/nodes/{id}/download", h.download),
		route("POST /api/dataroom/upload", h.upload),
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

// errBadJSON is `await request.json()` throwing inside validateBody: the
// SyntaxError reaches apiHandler as a 500.
var errBadJSON = errors.New("request body is not JSON")

// parse is validateBody.
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

func (h *handler) tree(w http.ResponseWriter, r *http.Request) error {
	u, err := h.guard.RequireMenuPrefix(r, iam.Dataroom...)
	if err != nil {
		return err
	}
	a, err := h.svc.access(r.Context(), u)
	if err != nil {
		return err
	}
	folders, err := h.svc.Folders(r.Context(), a)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, folders)
}

// folderItem is a listed node with its configured departments.
type folderItem struct {
	Node
	Departments []DepartmentRef `json:"departments"`
}

func (h *handler) listNodes(w http.ResponseWriter, r *http.Request) error {
	u, err := h.guard.RequireMenuPrefix(r, iam.Dataroom...)
	if err != nil {
		return err
	}
	ctx := r.Context()
	parentID := queryParam(r, "parent")
	var parent *Node
	if parentID != nil {
		if parent, err = h.svc.Node(ctx, *parentID); err != nil {
			return err
		}
		if parent == nil || parent.Kind != "folder" {
			return httpx.NotFound("Folder tidak ditemukan")
		}
	}
	a, err := h.svc.access(ctx, u)
	if err != nil {
		return err
	}
	if parentID != nil && !a.AllowsFolder(parentID) {
		return httpx.Forbidden("Folder ini tidak dibuka untuk departemen Anda")
	}
	children, err := h.svc.Children(ctx, parentID)
	if err != nil {
		return err
	}
	ancestors := []Crumb{}
	if parentID != nil {
		if ancestors, err = h.svc.Ancestors(ctx, *parentID); err != nil {
			return err
		}
	}
	used, err := h.svc.usedBytes(ctx)
	if err != nil {
		return err
	}
	perms := map[string]bool{}
	for _, action := range []string{"create", "update", "delete"} {
		if perms[action], err = h.guard.HasMenuAction(ctx, u, action, iam.Dataroom...); err != nil {
			return err
		}
	}
	var visible []Node
	var folderIDs []string
	for _, n := range children {
		if a.AllowsNode(&n) {
			visible = append(visible, n)
			if n.Kind == "folder" {
				folderIDs = append(folderIDs, n.ID)
			}
		}
	}
	depts, err := h.svc.DepartmentsFor(ctx, folderIDs)
	if err != nil {
		return err
	}
	items := make([]folderItem, len(visible))
	for i, n := range visible {
		items[i] = folderItem{Node: n, Departments: depts[n.ID]}
		if items[i].Departments == nil {
			items[i].Departments = []DepartmentRef{}
		}
	}
	type usage struct {
		Used    int64   `json:"used"`
		Quota   float64 `json:"quota"`
		MaxFile float64 `json:"max_file"`
	}
	type permissions struct {
		Create       bool `json:"create"`
		Update       bool `json:"update"`
		Delete       bool `json:"delete"`
		ManageAccess bool `json:"manage_access"`
	}
	type actor struct {
		IsAdmin        bool    `json:"is_admin"`
		DepartmentName *string `json:"department_name"`
	}
	return httpx.Data(w, http.StatusOK, struct {
		Parent      *Node        `json:"parent"`
		Items       []folderItem `json:"items"`
		Ancestors   []Crumb      `json:"ancestors"`
		Usage       usage        `json:"usage"`
		Permissions permissions  `json:"permissions"`
		Actor       actor        `json:"actor"`
	}{parent, items, ancestors,
		usage{used, h.svc.ports.QuotaBytes, h.svc.ports.MaxFileBytes},
		permissions{perms["create"], perms["update"], perms["delete"], a.Actor.IsAdmin},
		actor{a.Actor.IsAdmin, a.Actor.DepartmentName}})
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

func strOr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
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
	ctx := r.Context()
	if in.ParentID != nil {
		parent, err := h.svc.Node(ctx, *in.ParentID)
		if err != nil {
			return err
		}
		if parent == nil || parent.Kind != "folder" {
			return httpx.NotFound("Folder induk tidak ditemukan")
		}
		a, err := h.svc.access(ctx, u)
		if err != nil {
			return err
		}
		if !a.AllowsFolder(in.ParentID) {
			return httpx.Forbidden("Folder ini tidak dibuka untuk departemen Anda")
		}
	}
	node, err := h.svc.CreateFolder(ctx, in.ParentID, in.Name, u.ID, u.FullName)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, node)
}

type nodePatch struct {
	Name      *string
	ParentSet bool
	ParentID  *string
}

func nodePatchSchema(f *validate.Form) nodePatch {
	in := nodePatch{Name: f.Str("name", optional, validate.StrOpts{Trim: true, Min: 1, Max: 255})}
	_, in.ParentSet = f.Fields()["parent_id"]
	in.ParentID = f.UUID("parent_id", nullish)
	return in
}

func (h *handler) updateNode(w http.ResponseWriter, r *http.Request) error {
	u, err := h.guard.RequireMenuAction(r, "update", iam.Dataroom...)
	if err != nil {
		return err
	}
	in, err := parse(r, nodePatchSchema)
	if err != nil {
		return err
	}
	ctx := r.Context()
	node, err := h.svc.Node(ctx, r.PathValue("id"))
	if err != nil {
		return err
	}
	if node == nil {
		return httpx.NotFound("Item tidak ditemukan")
	}
	a, err := h.svc.access(ctx, u)
	if err != nil {
		return err
	}
	if !a.AllowsNode(node) {
		return httpx.Forbidden("Item ini tidak dibuka untuk departemen Anda")
	}
	if node, err = h.svc.MoveRename(ctx, a, node, in.ParentSet, in.ParentID, in.Name); err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, node)
}

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

func (h *handler) listShares(w http.ResponseWriter, r *http.Request) error {
	u, err := h.guard.RequireMenuPrefix(r, iam.Dataroom...)
	if err != nil {
		return err
	}
	a, err := h.svc.access(r.Context(), u)
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
			return "invalid_format", "PIN harus 4–6 digit angka", pinRe.MatchString(s)
		}}),
		Watermark: f.BoolDefault("watermark", false),
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
	a, err := h.svc.access(r.Context(), u)
	if err != nil {
		return err
	}
	out, err := h.svc.CreateShare(r.Context(), a, u.ID, u.FullName, in)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, out)
}

// shareOr404 is getShareById with the routes' 404.
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

// rateLimit is checkRateLimit(key, limit) answered with a 429 msg: a
// one-minute fixed window shared by every replica.
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
