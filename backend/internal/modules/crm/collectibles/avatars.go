package collectibles

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/collectibles/domain"
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// requiredTierEmbed is the shim's `required_tier:crm_membership_tiers(code,
// name, rank)` embed on crm_collectible_avatars.
const requiredTierEmbed = `(SELECT row_to_json(e) FROM (SELECT "code", "name", "rank" FROM "crm"."crm_membership_tiers"
	WHERE "id" = "crm_collectible_avatars"."required_tier_id") e) AS "required_tier"`

// GET /api/crm/avatars?rarity
func (h *handler) listAvatars(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.PosSession(r); err != nil {
		return err
	}
	sql := `SELECT *, ` + requiredTierEmbed + ` FROM crm.crm_collectible_avatars`
	var args []any
	if rarity := r.URL.Query().Get("rarity"); rarity != "" {
		sql += ` WHERE "rarity" = $1`
		args = append(args, rarity)
	}
	rows, err := kit.Query(r.Context(), h.db, sql+` ORDER BY "created_at" DESC`, args...)
	if err != nil {
		if kit.IsMissingCrmSchema(err) {
			return kit.WithMeta(w, []*kit.Row{}, false)
		}
		return err
	}
	return kit.WithMeta(w, rows, true)
}

// POST /api/crm/avatars: upsert by code.
func (h *handler) saveAvatar(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateSettings); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	nullable := validate.Rule{Optional: true, Nullable: true}
	var cols []kit.Col
	// add keeps a field in the payload when zod's output has it: always for
	// defaults, when sent (even null) for optional fields.
	add := func(name string, value any, always bool) {
		if _, sent := f.Fields()[name]; always || sent {
			cols = append(cols, kit.Col{Name: name, Value: value})
		}
	}
	code := f.Str("code", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 80})
	if code != nil {
		add("code", strings.ToLower(*code), true)
	}
	if name := f.Str("name", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 120}); name != nil {
		add("name", *name, true)
	}
	add("rarity", f.StrDefault("rarity", "common", validate.StrOpts{Check: validate.EnumCheck(domain.AvatarRarities)}), true)
	if image := f.Str("image_url", validate.Rule{}, validate.StrOpts{Trim: true, Check: validate.URLCheck}); image != nil {
		add("image_url", *image, true)
	}
	add("thumbnail_url", f.Str("thumbnail_url", nullable, validate.StrOpts{Trim: true, Check: validate.URLCheck}), false)
	add("required_tier_id", f.UUID("required_tier_id", nullable), false)
	add("xp_cost", intDefault(f.Int("xp_cost", validate.Rule{HasDefault: true}, validate.NumOpts{Min: validate.Bound(0)}), 0), true)
	add("stock_total", f.Int("stock_total", nullable, validate.NumOpts{Min: validate.Bound(0)}), false)
	add("stock_redeemed", intDefault(f.Int("stock_redeemed", validate.Rule{HasDefault: true}, validate.NumOpts{Min: validate.Bound(0)}), 0), true)
	add("starts_at", f.Str("starts_at", nullable, validate.StrOpts{Check: kit.DatetimeZCheck}), false)
	add("ends_at", f.Str("ends_at", nullable, validate.StrOpts{Check: kit.DatetimeZCheck}), false)
	add("is_active", f.BoolDefault("is_active", true), true)
	add("metadata", kit.JSONText(kit.RecordDefault(f, "metadata")), true)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := kit.Upsert(r.Context(), h.db, "crm.crm_collectible_avatars", "code", cols)
	if err != nil {
		return kit.CrmSchemaError(err)
	}
	return kit.OK(w, row)
}

// DELETE /api/crm/avatars?id
func (h *handler) deleteAvatar(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateSettings); err != nil {
		return err
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		return httpx.BadRequest("Avatar id wajib diisi")
	}
	_, err := h.db.Exec(r.Context(), `DELETE FROM crm.crm_collectible_avatars WHERE "id" = $1::text::uuid`, id)
	if err != nil {
		if database.PgCode(err) == "23503" {
			return httpx.Conflict("Avatar sudah terhubung dengan member/reward. Nonaktifkan avatar sebagai gantinya.")
		}
		return kit.CrmSchemaError(err)
	}
	return kit.Success(w)
}

// activeMember mirrors loadMember in avatar-inventory-server.ts: the active
// CRM profile by profile id (byID) or customer id; nil when there is none.
type activeMember struct {
	ID             string
	CustomerID     *string
	ActiveAvatarID *string
}

func loadActiveMember(ctx context.Context, q database.Querier, byID bool, id string) (*activeMember, error) {
	col := `"customer_id"`
	if byID {
		col = `"id"`
	}
	var m activeMember
	err := q.QueryRow(ctx, `SELECT id::text, customer_id::text, active_avatar_id::text FROM crm.crm_member_profiles
		WHERE "status" = 'active' AND `+col+` = $1::text::uuid LIMIT 1`, id).Scan(&m.ID, &m.CustomerID, &m.ActiveAvatarID)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// GET /api/crm/avatar-inventory?member_id|customer_id
func (h *handler) listInventory(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.PosSession(r); err != nil {
		return err
	}
	ctx := r.Context()
	memberID, customerID := r.URL.Query().Get("member_id"), r.URL.Query().Get("customer_id")
	if memberID == "" && customerID == "" {
		return httpx.BadRequest("member_id atau customer_id wajib diisi")
	}
	if memberID == "" {
		m, err := loadActiveMember(ctx, h.db, false, customerID)
		if err != nil {
			return err
		}
		if m == nil {
			return kit.WithMeta(w, []*kit.Row{}, true)
		}
		memberID = m.ID
	}
	rows, err := kit.Query(ctx, h.db, `SELECT *, (SELECT row_to_json(e) FROM (SELECT *, `+requiredTierEmbed+`
		FROM "crm"."crm_collectible_avatars" WHERE "id" = "crm_member_avatar_inventory"."avatar_id") e) AS "avatar"
		FROM crm.crm_member_avatar_inventory WHERE "member_id" = $1::text::uuid ORDER BY "acquired_at" DESC`, memberID)
	if err != nil {
		if kit.IsMissingCrmSchema(err) {
			return kit.WithMeta(w, []*kit.Row{}, false)
		}
		return err
	}
	return kit.WithMeta(w, rows, true)
}

// POST /api/crm/avatar-inventory: an admin grant. Redeeming avatars with
// XP is retired (EPIC-011): XP is a lifetime score that never goes down.
func (h *handler) grantAvatar(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.PosSession(r); err != nil {
		return err
	}
	body, err := kit.ReadJSON(r)
	if err != nil {
		return err
	}
	if obj, _ := body.(map[string]any); obj == nil || obj["action"] != "grant" {
		return httpx.Status(http.StatusGone, "Redeem avatar dengan XP sudah dipensiunkan — gunakan grant admin (EPIC-011)")
	}
	f := validate.New(body, true)
	memberID := f.UUID("member_id", validate.Rule{})
	avatarID := f.UUID("avatar_id", validate.Rule{})
	source := f.StrDefault("acquisition_source", "manual", validate.StrOpts{Check: validate.EnumCheck([]string{"manual", "campaign", "partner"})})
	equip := f.BoolDefault("equip", false)
	note := f.Str("note", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Max: 240})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	var inventory *kit.Row
	err = database.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		var err error
		inventory, err = h.grant(r.Context(), tx, *memberID, *avatarID, source, equip, note)
		return err
	})
	if err != nil {
		return err
	}
	return kit.OK(w, inventory)
}

// grant mirrors grantAvatar: the tier and XP thresholds hold on this path
// too; the avatar is equipped when asked or when the member has none.
func (h *handler) grant(ctx context.Context, tx pgx.Tx, memberID, avatarID, source string, equip bool, note *string) (*kit.Row, error) {
	member, err := loadActiveMember(ctx, tx, true, memberID)
	if err != nil {
		return nil, err
	}
	if member == nil {
		return nil, httpx.Conflict("Member CRM belum aktif. Aktifkan member terlebih dahulu.")
	}
	var existing string
	err = tx.QueryRow(ctx, `SELECT id::text FROM crm.crm_member_avatar_inventory WHERE member_id = $1 AND avatar_id = $2 LIMIT 1`,
		member.ID, avatarID).Scan(&existing)
	switch {
	case err == nil:
		return nil, httpx.Conflict("Member sudah memiliki avatar ini")
	case !database.IsNoRows(err) && !kit.IsMissingCrmSchema(err):
		return nil, err
	}

	var isActive bool
	var stockTotal *int
	var stockRedeemed int
	err = tx.QueryRow(ctx, `SELECT is_active, stock_total, stock_redeemed FROM crm.crm_collectible_avatars WHERE id = $1`, avatarID).
		Scan(&isActive, &stockTotal, &stockRedeemed)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Avatar tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	if !isActive {
		return nil, httpx.BadRequest("Avatar sedang tidak aktif")
	}
	if stockTotal != nil && stockRedeemed >= *stockTotal {
		return nil, httpx.BadRequest("Stok avatar sudah habis")
	}
	if member.CustomerID != nil {
		allowed, reason, err := checkAvatarEligibility(ctx, tx, avatarID, *member.CustomerID, h.now())
		if err != nil {
			return nil, err
		}
		if !allowed {
			return nil, httpx.Forbidden("Member belum memenuhi syarat: " + reason)
		}
	}

	shouldEquip := equip || member.ActiveAvatarID == nil
	if shouldEquip {
		if _, err := tx.Exec(ctx, `UPDATE crm.crm_member_avatar_inventory SET "is_equipped" = false WHERE "member_id" = $1`, member.ID); err != nil {
			return nil, err
		}
	}
	inventory, err := kit.Insert(ctx, tx, "crm.crm_member_avatar_inventory", []kit.Col{
		{Name: "member_id", Value: member.ID},
		{Name: "avatar_id", Value: avatarID},
		{Name: "redemption_id", Value: nil},
		{Name: "acquisition_source", Value: source},
		{Name: "is_equipped", Value: shouldEquip},
		{Name: "metadata", Value: kit.JSONText(map[string]any{"granted_by": "crm_admin", "note": note})},
	})
	if err != nil {
		return nil, err
	}
	active := member.ActiveAvatarID
	if shouldEquip {
		active = &avatarID
	}
	if _, err := kit.Update(ctx, tx, "crm.crm_member_profiles", []kit.Col{
		{Name: "active_avatar_id", Value: active},
		{Name: "last_activity_at", Value: h.now()},
	}, "id", member.ID); err != nil {
		return nil, err
	}
	if stockTotal != nil {
		if _, err := tx.Exec(ctx, `UPDATE crm.crm_collectible_avatars SET "stock_redeemed" = $2 WHERE "id" = $1`, avatarID, stockRedeemed+1); err != nil {
			return nil, err
		}
	}
	return inventory, nil
}

// checkAvatarEligibility mirrors checkAvatarEligibility in
// collectibles-server.ts.
func checkAvatarEligibility(ctx context.Context, q database.Querier, avatarID, customerID string, now time.Time) (bool, string, error) {
	var row domain.Eligibility
	err := q.QueryRow(ctx, `SELECT a.is_active, a.starts_at, a.ends_at, a.stock_total, a.stock_redeemed,
            a.min_lifetime_xp::int AS min_lifetime_xp,
            t.name AS required_tier_name,
            t.min_lifetime_xp::int AS required_tier_min_xp,
            c.total_xp::int AS total_xp
       FROM crm.crm_collectible_avatars a
       LEFT JOIN crm.crm_membership_tiers t ON t.id = a.required_tier_id
       CROSS JOIN pos.pos_customers c
      WHERE a.id = $1 AND c.id = $2`, avatarID, customerID).
		Scan(&row.IsActive, &row.StartsAt, &row.EndsAt, &row.StockTotal, &row.StockRedeemed,
			&row.MinLifetimeXP, &row.RequiredTierName, &row.RequiredTierMinXP, &row.TotalXP)
	if database.IsNoRows(err) {
		return false, "Artwork atau member tidak ditemukan", nil
	}
	if err != nil {
		return false, "", err
	}
	allowed, reason := domain.CheckEligibility(row, now)
	return allowed, reason, nil
}

// PATCH /api/crm/avatar-inventory: equip an avatar the member owns.
func (h *handler) equipAvatar(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.PosSession(r); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	memberID := f.UUID("member_id", validate.Rule{})
	inventoryID := f.UUID("inventory_id", validate.Rule{Optional: true})
	avatarID := f.UUID("avatar_id", validate.Rule{Optional: true})
	if !aborted(f.Issues()) && (inventoryID == nil || *inventoryID == "") && (avatarID == nil || *avatarID == "") {
		f.Fail("inventory_id", "custom", "inventory_id atau avatar_id wajib diisi")
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	col, value := `"avatar_id"`, avatarID
	if inventoryID != nil && *inventoryID != "" {
		col, value = `"id"`, inventoryID
	}
	var owned *kit.Row
	err = database.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		ctx := r.Context()
		var err error
		owned, err = kit.QueryOne(ctx, tx, `SELECT "id", "member_id", "avatar_id" FROM crm.crm_member_avatar_inventory
			WHERE "member_id" = $1 AND `+col+` = $2 LIMIT 1`, *memberID, *value)
		if err != nil {
			return err
		}
		if owned == nil {
			return httpx.NotFound("Avatar belum dimiliki member")
		}
		if _, err := tx.Exec(ctx, `UPDATE crm.crm_member_avatar_inventory SET "is_equipped" = false WHERE "member_id" = $1`, *memberID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE crm.crm_member_avatar_inventory SET "is_equipped" = true WHERE "id" = $1`, owned.Str("id")); err != nil {
			return err
		}
		_, err = kit.Update(ctx, tx, "crm.crm_member_profiles", []kit.Col{
			{Name: "active_avatar_id", Value: owned.Str("avatar_id")},
			{Name: "last_activity_at", Value: h.now()},
		}, "id", *memberID)
		return err
	})
	if err != nil {
		return err
	}
	return kit.OK(w, owned)
}
