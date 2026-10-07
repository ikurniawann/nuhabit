// Package collectibles is the CRM collectible catalog admin: badges,
// avatars, wallpapers, member avatar inventory and the idle entitlement
// report (api/crm/badges, avatars, avatar-inventory, wallpapers,
// collectibles/idle-report) and the avatar artwork upload.
package collectibles

import (
	"time"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/storage"
)

// Ports are the capabilities of other bounded contexts this area uses;
// internal/app/adapters_crm_collectibles.go provides them. The area only
// touches CRM tables and the member columns of pos_customers, so it needs
// none yet.
type Ports struct{}

type handler struct {
	db    database.DB
	guard kit.Guard
	store *storage.Store
	now   func() time.Time
}

// Routes mounts the area's routes.
func Routes(d module.Deps, _ *xp.Engine, _ Ports) []module.Route {
	return newHandler(d.DB, d).routes()
}

func newHandler(db database.DB, d module.Deps) *handler {
	now := d.Now
	if now == nil {
		now = time.Now
	}
	return &handler{db: db, guard: kit.Guard{Auth: d.Auth, DB: db}, store: storage.FromEnv(), now: now}
}

func (h *handler) routes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/crm/badges", Handler: httpx.Handle(h.listBadges)},
		{Pattern: "POST /api/crm/badges", Handler: httpx.Handle(h.saveBadge)},
		{Pattern: "DELETE /api/crm/badges", Handler: httpx.Handle(h.deleteBadge)},
		{Pattern: "GET /api/crm/wallpapers", Handler: httpx.Handle(h.listWallpapers)},
		{Pattern: "POST /api/crm/wallpapers", Handler: httpx.Handle(h.saveWallpaper)},
		{Pattern: "DELETE /api/crm/wallpapers", Handler: httpx.Handle(h.deleteWallpaper)},
		{Pattern: "GET /api/crm/collectibles/idle-report", Handler: httpx.Handle(h.idleReport)},
		{Pattern: "GET /api/crm/avatars", Handler: httpx.Handle(h.listAvatars)},
		{Pattern: "POST /api/crm/avatars", Handler: httpx.Handle(h.saveAvatar)},
		{Pattern: "DELETE /api/crm/avatars", Handler: httpx.Handle(h.deleteAvatar)},
		{Pattern: "POST /api/crm/avatars/upload", Handler: httpx.Handle(h.uploadAvatar)},
		{Pattern: "GET /api/crm/avatar-inventory", Handler: httpx.Handle(h.listInventory)},
		{Pattern: "POST /api/crm/avatar-inventory", Handler: httpx.Handle(h.grantAvatar)},
		{Pattern: "PATCH /api/crm/avatar-inventory", Handler: httpx.Handle(h.equipAvatar)},
	}
}
