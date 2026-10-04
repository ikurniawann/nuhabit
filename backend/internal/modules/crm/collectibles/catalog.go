package collectibles

import (
	"context"
	"encoding/json"
	"net/http"

	"nuhabit/backend/internal/modules/crm/collectibles/domain"
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// aborted reports whether zod v4 would skip an object-level refine: an
// issue that is not a continuable check (a wrong type or enum value).
func aborted(issues []validate.Issue) bool {
	for _, is := range issues {
		switch is.Code {
		case "invalid_type", "invalid_value", "invalid_union":
			return true
		}
	}
	return false
}

// catalogID mirrors catalogId: the ?id query value, 400 when it is not
// UUID-shaped.
func catalogID(r *http.Request) (string, error) {
	id := r.URL.Query().Get("id")
	if !domain.IsCatalogID(id) {
		return "", httpx.BadRequest("ID tidak valid")
	}
	return id, nil
}

// saveCatalogRow mirrors upsertCatalogRow: UPDATE when id is set (404 when
// no row matched), else INSERT; both RETURNING *.
func saveCatalogRow(ctx context.Context, q database.Querier, id *string, update, insert string, args []any, notFound string) (*kit.Row, error) {
	var row *kit.Row
	var err error
	if id != nil {
		row, err = kit.QueryOne(ctx, q, update, append(args, *id)...)
	} else {
		row, err = kit.QueryOne(ctx, q, insert, args...)
	}
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, httpx.NotFound(notFound)
	}
	return row, nil
}

// deleteOrDeactivate mirrors deleteOrDeactivate: an item a member already
// owns is deactivated instead of deleted, and the message says so.
func deleteOrDeactivate(ctx context.Context, q database.Querier, id, owned, deactivate, remove, message string) (string, error) {
	rows, err := q.Query(ctx, owned, id)
	if err != nil {
		return "", err
	}
	isOwned := rows.Next()
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", err
	}
	if isOwned {
		_, err := q.Exec(ctx, deactivate, id)
		return message, err
	}
	_, err = q.Exec(ctx, remove, id)
	return "", err
}

// GET /api/crm/badges
func (h *handler) listBadges(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateSettings); err != nil {
		return err
	}
	rows, err := kit.Query(r.Context(), h.db, `SELECT b.*, (SELECT count(*)::int FROM crm.crm_member_badges mb WHERE mb.badge_id = b.id) AS awarded_count
       FROM crm.crm_badges b ORDER BY b.metric, COALESCE(b.threshold, b.min_lifetime_xp)`)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

// POST /api/crm/badges: lifetime_xp badges use min_lifetime_xp, the other
// metrics a threshold (manual badges neither).
func (h *handler) saveBadge(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateSettings); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	id := f.UUID("id", validate.Rule{Optional: true, Nullable: true})
	code := f.Str("code", validate.Rule{}, validate.StrOpts{Min: 2, Max: 60})
	name := f.Str("name", validate.Rule{}, validate.StrOpts{Min: 2, Max: 120})
	imageURL := f.Str("image_url", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Max: 500})
	metric := f.StrDefault("metric", "lifetime_xp", validate.StrOpts{Check: validate.EnumCheck(domain.BadgeMetrics)})
	minXP := intDefault(f.Int("min_lifetime_xp", validate.Rule{HasDefault: true}, validate.NumOpts{Min: validate.Bound(0)}), 0)
	threshold := f.Num("threshold", validate.Rule{Optional: true, Nullable: true}, validate.NumOpts{Positive: true, Max: validate.Bound(1_000_000_000)})
	bonusXP := intDefault(f.Int("bonus_xp", validate.Rule{HasDefault: true}, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(100_000)}), 0)
	isActive := f.BoolDefault("is_active", true)
	if !aborted(f.Issues()) && metric != "lifetime_xp" && metric != "manual" && (threshold == nil || *threshold <= 0) {
		f.Fail(nil, "custom", "Ambang wajib diisi untuk metrik ini")
	}
	if err := kit.CrmInputErr(f); err != nil {
		return err
	}

	usesXP := metric == "lifetime_xp"
	storedMinXP, storedThreshold := 0, threshold
	if usesXP {
		storedMinXP = minXP
	}
	if usesXP || metric == "manual" {
		storedThreshold = nil
	}
	row, err := saveCatalogRow(r.Context(), h.db, id,
		`UPDATE crm.crm_badges SET code=$1,name=$2,image_url=$3,min_lifetime_xp=$4,is_active=$5,
                      metric=$6,threshold=$7,bonus_xp=$8
                WHERE id=$9 RETURNING *`,
		`INSERT INTO crm.crm_badges (code,name,image_url,min_lifetime_xp,is_active,metric,threshold,bonus_xp)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
		[]any{*code, *name, imageURL, storedMinXP, isActive, metric, storedThreshold, bonusXP},
		"Badge tidak ditemukan")
	if err != nil {
		return err
	}
	return kit.OK(w, row)
}

// DELETE /api/crm/badges?id: a badge a member earned is proof of an
// achievement, so it is deactivated instead.
func (h *handler) deleteBadge(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateSettings); err != nil {
		return err
	}
	id, err := catalogID(r)
	if err != nil {
		return err
	}
	msg, err := deleteOrDeactivate(r.Context(), h.db, id,
		`SELECT 1 FROM crm.crm_member_badges WHERE badge_id=$1::text::uuid LIMIT 1`,
		`UPDATE crm.crm_badges SET is_active=false WHERE id=$1::text::uuid`,
		`DELETE FROM crm.crm_badges WHERE id=$1::text::uuid`,
		"Sudah diraih member — dinonaktifkan, bukan dihapus")
	if err != nil {
		return err
	}
	return kit.SuccessMessage(w, msg)
}

// GET /api/crm/wallpapers
func (h *handler) listWallpapers(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateSettings); err != nil {
		return err
	}
	rows, err := kit.Query(r.Context(), h.db, `SELECT w.*, t.name AS required_tier_name
       FROM crm.crm_collectible_wallpapers w
       LEFT JOIN crm.crm_membership_tiers t ON t.id = w.required_tier_id
      ORDER BY w.created_at DESC`)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

// POST /api/crm/wallpapers
func (h *handler) saveWallpaper(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateSettings); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	nullable := validate.Rule{Optional: true, Nullable: true}
	id := f.UUID("id", nullable)
	code := f.Str("code", validate.Rule{}, validate.StrOpts{Min: 2, Max: 60})
	name := f.Str("name", validate.Rule{}, validate.StrOpts{Min: 2, Max: 120})
	rarity := f.StrDefault("rarity", "common", validate.StrOpts{Check: validate.EnumCheck(domain.AvatarRarities)})
	imageURL := f.Str("image_url", validate.Rule{}, validate.StrOpts{Min: 1, Max: 500})
	thumbnail := f.Str("thumbnail_url", nullable, validate.StrOpts{Max: 500})
	minXP := f.Int("min_lifetime_xp", nullable, validate.NumOpts{Min: validate.Bound(0)})
	tierID := f.UUID("required_tier_id", nullable)
	stockTotal := f.Int("stock_total", nullable, validate.NumOpts{Min: validate.Bound(1)})
	isActive := f.BoolDefault("is_active", true)
	startsAt := f.Str("starts_at", nullable, validate.StrOpts{})
	endsAt := f.Str("ends_at", nullable, validate.StrOpts{})
	if err := kit.CrmInputErr(f); err != nil {
		return err
	}
	// Timestamps are cast server-side: an unparsable string fails in
	// PostgreSQL as it does for node-postgres.
	row, err := saveCatalogRow(r.Context(), h.db, id,
		`UPDATE crm.crm_collectible_wallpapers
                  SET code=$1,name=$2,rarity=$3,image_url=$4,thumbnail_url=$5,
                      min_lifetime_xp=$6,required_tier_id=$7,stock_total=$8,
                      is_active=$9,starts_at=$10::text::timestamptz,ends_at=$11::text::timestamptz,updated_at=now()
                WHERE id=$12 RETURNING *`,
		`INSERT INTO crm.crm_collectible_wallpapers
                 (code,name,rarity,image_url,thumbnail_url,min_lifetime_xp,
                  required_tier_id,stock_total,is_active,starts_at,ends_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text::timestamptz,$11::text::timestamptz) RETURNING *`,
		[]any{*code, *name, rarity, *imageURL, thumbnail, minXP, tierID, stockTotal, isActive, startsAt, endsAt},
		"Wallpaper tidak ditemukan")
	if err != nil {
		return err
	}
	return kit.OK(w, row)
}

// DELETE /api/crm/wallpapers?id: an owned wallpaper is deactivated so the
// member's collection keeps it.
func (h *handler) deleteWallpaper(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateSettings); err != nil {
		return err
	}
	id, err := catalogID(r)
	if err != nil {
		return err
	}
	msg, err := deleteOrDeactivate(r.Context(), h.db, id,
		`SELECT 1 FROM crm.crm_member_wallpaper_inventory WHERE wallpaper_id = $1::text::uuid LIMIT 1`,
		`UPDATE crm.crm_collectible_wallpapers SET is_active=false WHERE id=$1::text::uuid`,
		`DELETE FROM crm.crm_collectible_wallpapers WHERE id=$1::text::uuid`,
		"Sudah dimiliki member — dinonaktifkan, bukan dihapus")
	if err != nil {
		return err
	}
	return kit.SuccessMessage(w, msg)
}

// idleReport mirrors loadIdleEntitlementReport's result.
type idleReport struct {
	IntervalXP     int        `json:"interval_xp"`
	TotalIdle      float64    `json:"total_idle"`
	ActiveArtworks float64    `json:"active_artworks"`
	Members        []*kit.Row `json:"members"`
}

// GET /api/crm/collectibles/idle-report: members whose collectible
// entitlements are unused, so new artwork is planned before veterans run
// out of things to unlock.
func (h *handler) idleReport(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateReports); err != nil {
		return err
	}
	ctx := r.Context()
	var raw []byte
	err := h.db.QueryRow(ctx, `SELECT value FROM crm.crm_settings WHERE key = 'collectible_interval_xp'`).Scan(&raw)
	if err != nil && !database.IsNoRows(err) {
		return err
	}
	var setting any
	if raw != nil {
		_ = json.Unmarshal(raw, &setting)
	}
	interval := domain.ParseIntervalXP(setting)

	// Remaining entitlement uses the shared rule in SQL:
	// greatest(0, floor(total_xp / interval) - used).
	members, err := kit.Query(ctx, h.db, `SELECT c.id AS customer_id, c.name, c.phone, c.total_xp::int AS total_xp,
            floor(c.total_xp / $1)::int AS quota,
            COALESCE(e.used, 0)::int AS used,
            greatest(0, floor(c.total_xp / $1)::int - COALESCE(e.used, 0))::int AS idle
       FROM pos.pos_customers c
       LEFT JOIN (
         SELECT customer_id, count(*)::int AS used
           FROM crm.crm_member_entitlements
          GROUP BY customer_id
       ) e ON e.customer_id = c.id
      WHERE c.total_xp >= $1
      ORDER BY greatest(0, floor(c.total_xp / $1)::int - COALESCE(e.used, 0)) DESC, c.total_xp DESC
      LIMIT 100`, interval)
	if err != nil {
		return err
	}
	report := idleReport{IntervalXP: interval, Members: members}
	for _, m := range members {
		report.TotalIdle += m.Num("idle")
	}
	if err := h.db.QueryRow(ctx, `SELECT count(*)::float8 FROM crm.crm_collectible_avatars
      WHERE is_active AND (ends_at IS NULL OR ends_at >= now())`).Scan(&report.ActiveArtworks); err != nil {
		return err
	}
	return kit.OK(w, report)
}

func intDefault(p *int, def int) int {
	if p == nil {
		return def
	}
	return *p
}
