package access

import (
	"strings"
	"time"

	"nuhabit/backend/internal/modules/configuration/kit"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// roleItem is mapRoleItem (lib/iam/role-mapper.ts).
type roleItem struct {
	ID                  string  `json:"id"`
	Code                string  `json:"code"`
	Name                string  `json:"name"`
	Description         *string `json:"description"`
	IsSystem            bool    `json:"isSystem"`
	IsActive            bool    `json:"isActive"`
	MenuPermissionCount int     `json:"menuPermissionCount"`
}

// roleRow is an iam.roles row with its active grant count.
type roleRow struct {
	roleItem
	CreatedAt time.Time
	UpdatedAt *time.Time
	Version   int
}

// roleDetail is mapRoleDetail.
type roleDetail struct {
	roleItem
	CreatedAt   httpx.JSTime     `json:"createdAt"`
	UpdatedAt   *httpx.JSTime    `json:"updatedAt"`
	Version     int              `json:"version"`
	Permissions []permissionView `json:"permissions"`
}

// permissionRow is one iam.menus row LEFT JOINed with the role's grant.
type permissionRow struct {
	MenuID             string
	MenuCode           string
	MenuName           string
	MenuType           string
	ParentID           *string
	Level              int
	OrderNumber        int
	PermissionContext  []byte
	GrantedActions     []byte
	PermissionID       *string
	PermissionIsActive *bool
}

// permissionView is one entry of mapRoleDetail(...).permissions.
type permissionView struct {
	MenuID           string  `json:"menuId"`
	MenuCode         string  `json:"menuCode"`
	MenuName         string  `json:"menuName"`
	MenuType         string  `json:"menuType"`
	ParentID         *string `json:"parentId"`
	Level            int     `json:"level"`
	OrderNumber      int     `json:"orderNumber"`
	AvailableActions any     `json:"availableActions"`
	GrantedActions   any     `json:"grantedActions"`
	IsGranted        bool    `json:"isGranted"`
}

func mapRoleDetail(row roleRow, perms []permissionRow) roleDetail {
	out := roleDetail{
		roleItem:    row.roleItem,
		CreatedAt:   httpx.JSTime(row.CreatedAt),
		UpdatedAt:   httpx.NewJSTime(row.UpdatedAt),
		Version:     row.Version,
		Permissions: make([]permissionView, len(perms)),
	}
	for i, p := range perms {
		isGranted := p.PermissionID != nil && p.PermissionIsActive != nil && *p.PermissionIsActive
		var granted any = []any{}
		if isGranted {
			if list, ok := decode(p.GrantedActions).([]any); ok {
				granted = list
			}
		}
		out.Permissions[i] = permissionView{
			MenuID: p.MenuID, MenuCode: p.MenuCode, MenuName: p.MenuName, MenuType: p.MenuType,
			ParentID: p.ParentID, Level: p.Level, OrderNumber: p.OrderNumber,
			AvailableActions: availableActions(p.PermissionContext),
			GrantedActions:   granted,
			IsGranted:        isGranted,
		}
	}
	return out
}

// availableActions is `permission_context?.actions` when it has a length,
// else ["read"].
func availableActions(raw []byte) any {
	if ctx, ok := decode(raw).(*kit.Row); ok {
		switch a := ctx.Get("actions").(type) {
		case []any:
			if len(a) > 0 {
				return a
			}
		case string:
			if a != "" {
				return a
			}
		}
	}
	return []string{"read"}
}

func decode(raw []byte) any {
	if raw == nil {
		return nil
	}
	v, _ := kit.DecodeJSON(raw)
	return v
}

// menuItem is mapMenuItem (lib/iam/menu-mapper.ts).
type menuItem struct {
	ID          string  `json:"id"`
	ParentID    *string `json:"parentId"`
	Code        string  `json:"code"`
	MenuName    string  `json:"menuName"`
	RoutePath   *string `json:"routePath"`
	Module      *string `json:"module"`
	MenuType    string  `json:"menuType"`
	Icon        *string `json:"icon"`
	OrderNumber int     `json:"orderNumber"`
	Level       int     `json:"level"`
	IsActive    bool    `json:"isActive"`
	IsVisible   bool    `json:"isVisible"`
}

// menuRow is an iam.menus row.
type menuRow struct {
	menuItem
	Description       *string
	PermissionContext []byte
	OpenInNewTab      bool
	CreatedAt         time.Time
	UpdatedAt         *time.Time
	Version           int
}

// menuDetail is mapMenuDetail.
type menuDetail struct {
	menuItem
	Description       *string       `json:"description"`
	PermissionContext any           `json:"permissionContext"`
	OpenInNewTab      bool          `json:"openInNewTab"`
	CreatedAt         httpx.JSTime  `json:"createdAt"`
	UpdatedAt         *httpx.JSTime `json:"updatedAt"`
	Version           int           `json:"version"`
}

func mapMenuDetail(row menuRow) menuDetail {
	return menuDetail{
		menuItem:          row.menuItem,
		Description:       row.Description,
		PermissionContext: decode(row.PermissionContext),
		OpenInNewTab:      row.OpenInNewTab,
		CreatedAt:         httpx.JSTime(row.CreatedAt),
		UpdatedAt:         httpx.NewJSTime(row.UpdatedAt),
		Version:           row.Version,
	}
}

// listFilter is the search/status/menuType query of the list routes,
// trimmed and lower-cased as the TS filters read them.
type listFilter struct{ search, status, menuType string }

func newListFilter(get func(string) string) listFilter {
	norm := func(key string) string { return strings.ToLower(validate.JSTrim(get(key))) }
	return listFilter{search: norm("search"), status: norm("status"), menuType: norm("menuType")}
}

func (f listFilter) statusAllows(active bool) bool {
	return !(f.status == "active" && !active) && !(f.status == "inactive" && active)
}

func contains(field, search string) bool { return strings.Contains(strings.ToLower(field), search) }

// filterRoles is filterRoleRows.
func filterRoles(rows []roleItem, f listFilter) []roleItem {
	out := []roleItem{}
	for _, r := range rows {
		if !f.statusAllows(r.IsActive) {
			continue
		}
		if f.search == "" || contains(r.Code, f.search) || contains(r.Name, f.search) || contains(kit.Deref(r.Description), f.search) {
			out = append(out, r)
		}
	}
	return out
}

// filterMenus is filterMenuRows.
func filterMenus(rows []menuItem, f listFilter) []menuItem {
	out := []menuItem{}
	for _, r := range rows {
		if !f.statusAllows(r.IsActive) || (f.menuType != "" && strings.ToLower(r.MenuType) != f.menuType) {
			continue
		}
		if f.search == "" || contains(r.MenuName, f.search) || contains(r.Code, f.search) ||
			contains(kit.Deref(r.RoutePath), f.search) || contains(kit.Deref(r.Module), f.search) {
			out = append(out, r)
		}
	}
	return out
}
