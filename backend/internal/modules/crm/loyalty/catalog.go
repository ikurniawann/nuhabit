package loyalty

import (
	"math"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// payload collects the columns a parsed zod object would carry: required
// and defaulted fields always, optional ones only when the client sent them.
type payload struct {
	f    *validate.Form
	cols []kit.Col
}

func (p *payload) set(name string, v any) { p.cols = append(p.cols, kit.Col{Name: name, Value: v}) }

// opt adds an optional field when its key was sent (null included).
func (p *payload) opt(name string, v any) {
	if _, ok := p.f.Fields()[name]; ok {
		p.set(name, v)
	}
}

func strOrNil(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func numOrNil(x *float64) any {
	if x == nil {
		return nil
	}
	return *x
}

func intOrNil(x *int) any {
	if x == nil {
		return nil
	}
	return *x
}

var (
	nonneg   = validate.NumOpts{Min: validate.Bound(0)}
	nullOpt  = validate.Rule{Optional: true, Nullable: true}
	required = validate.Rule{}
	withDef  = validate.Rule{HasDefault: true}
)

func lowerCode(f *validate.Form, max int) string {
	s := f.Str("code", required, validate.StrOpts{Trim: true, Min: 1, Max: max})
	if s == nil {
		return ""
	}
	return strings.ToLower(*s)
}

func numDefault(f *validate.Form, key string, def float64, o validate.NumOpts) float64 {
	if x := f.Num(key, withDef, o); x != nil {
		return *x
	}
	return def
}

func intDefault(f *validate.Form, key string, def int, o validate.NumOpts) int {
	if x := f.Int(key, withDef, o); x != nil {
		return *x
	}
	return def
}

func datetimeOpt(f *validate.Form, key string) *string {
	return f.Str(key, nullOpt, validate.StrOpts{Check: kit.DatetimeZCheck})
}

// defaultTier is one CRM_DEFAULT_TIERS entry (served when the schema is missing).
type defaultTier struct {
	Code            string  `json:"code"`
	Name            string  `json:"name"`
	Rank            int     `json:"rank"`
	MinLifetimeXP   int     `json:"min_lifetime_xp"`
	MinTotalSpend   int     `json:"min_total_spend"`
	XPMultiplier    float64 `json:"xp_multiplier"`
	DiscountPercent int     `json:"discount_percent"`
	DisplayColor    string  `json:"display_color"`
}

var crmDefaultTiers = []defaultTier{
	{"regular", "Regular", 0, 0, 0, 1, 0, "#6B7280"},
	{"bronze", "Bronze", 1, 0, 0, 1, 0, "#B7791F"},
	{"silver", "Silver", 2, 10000, 2000000, 1.2, 5, "#94A3B8"},
	{"gold", "Gold", 3, 30000, 7000000, 1.5, 10, "#F59E0B"},
}

func (h *handler) listTiers(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.PosSession(r); err != nil {
		return err
	}
	rows, err := kit.Query(r.Context(), h.db, `SELECT * FROM crm.crm_membership_tiers ORDER BY "rank" ASC`)
	if err != nil {
		if kit.IsMissingCrmSchema(err) {
			return kit.WithMeta(w, crmDefaultTiers, false)
		}
		return err
	}
	return kit.WithMeta(w, rows, true)
}

func (h *handler) saveTier(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateSettings); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	p := &payload{f: f}
	p.set("code", lowerCode(f, 40))
	p.set("name", strOrNil(f.Str("name", required, validate.StrOpts{Trim: true, Min: 1, Max: 80})))
	p.set("rank", intOrNil(f.Int("rank", required, nonneg)))
	p.set("min_lifetime_xp", intDefault(f, "min_lifetime_xp", 0, nonneg))
	p.set("min_total_spend", numDefault(f, "min_total_spend", 0, nonneg))
	p.set("xp_multiplier", numDefault(f, "xp_multiplier", 1, nonneg))
	p.set("discount_percent", numDefault(f, "discount_percent", 0, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(100)}))
	benefits := f.Strings("benefits", withDef, math.MaxInt, validate.StrOpts{})
	if benefits == nil {
		benefits = []string{}
	}
	// benefits is jsonb: the TS stringifies the array itself.
	p.set("benefits", kit.JSONText(benefits))
	p.set("display_color", f.StrDefault("display_color", "#6B7280", validate.StrOpts{Trim: true, Min: 1}))
	p.set("is_active", f.BoolDefault("is_active", true))
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := kit.Upsert(r.Context(), h.db, "crm.crm_membership_tiers", "code", p.cols)
	if err != nil {
		return kit.CrmSchemaError(err)
	}
	return kit.OK(w, row)
}

func (h *handler) listXPRules(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.PosSession(r); err != nil {
		return err
	}
	sql := `SELECT * FROM crm.crm_xp_rules`
	var args []any
	if ch := r.URL.Query().Get("source_channel"); ch != "" {
		sql += ` WHERE source_channel = $1`
		args = append(args, ch)
	}
	rows, err := kit.Query(r.Context(), h.db, sql+` ORDER BY priority ASC, created_at DESC`, args...)
	if err != nil {
		if kit.IsMissingCrmSchema(err) {
			return kit.WithMeta(w, []any{}, false)
		}
		return err
	}
	return kit.WithMeta(w, rows, true)
}

func (h *handler) saveXPRule(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateSettings); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	p := &payload{f: f}
	p.set("code", lowerCode(f, 80))
	p.set("name", strOrNil(f.Str("name", required, validate.StrOpts{Trim: true, Min: 1, Max: 120})))
	p.set("source_channel", strOrNil(f.Enum("source_channel", required, []string{"pos", "photobooth", "studio_game", "manual", "campaign"})))
	p.set("source_type", strOrNil(f.Str("source_type", required, validate.StrOpts{Trim: true, Min: 1, Max: 80})))
	p.opt("source_id", strOrNil(f.Str("source_id", nullOpt, validate.StrOpts{Trim: true, Max: 120})))
	scope := "all"
	if s := f.Enum("outlet_scope", withDef, []string{"all", "specific"}); s != nil {
		scope = *s
	}
	p.set("outlet_scope", scope)
	outlet := f.UUID("outlet_id", nullOpt)
	p.opt("outlet_id", strOrNil(outlet))
	p.set("xp_mode", strOrNil(f.Enum("xp_mode", required, []string{"fixed", "per_item", "per_amount", "multiplier", "percentage"})))
	p.set("xp_value", numOrNil(f.Num("xp_value", required, nonneg)))
	p.set("amount_step", numDefault(f, "amount_step", 1, validate.NumOpts{Positive: true}))
	p.set("min_amount", numDefault(f, "min_amount", 0, nonneg))
	p.opt("max_xp_per_event", intOrNil(f.Int("max_xp_per_event", nullOpt, nonneg)))
	p.set("tier_multiplier_enabled", f.BoolDefault("tier_multiplier_enabled", true))
	p.set("priority", intDefault(f, "priority", 100, validate.NumOpts{}))
	p.opt("starts_at", strOrNil(datetimeOpt(f, "starts_at")))
	p.opt("ends_at", strOrNil(datetimeOpt(f, "ends_at")))
	p.set("is_active", f.BoolDefault("is_active", true))
	p.set("metadata", kit.JSONText(kit.RecordDefault(f, "metadata")))
	// The object refine runs only when every field parsed.
	if f.Valid() {
		hasOutlet := outlet != nil && *outlet != ""
		if (scope == "all") == hasOutlet {
			f.Fail("outlet_id", "custom", "outlet_id wajib diisi jika outlet_scope specific")
		}
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := kit.Upsert(r.Context(), h.db, "crm.crm_xp_rules", "code", p.cols)
	if err != nil {
		return kit.CrmSchemaError(err)
	}
	return kit.OK(w, row)
}

const rewardSelect = `SELECT *, (SELECT row_to_json(e) FROM (SELECT "code", "name", "rank" FROM crm.crm_membership_tiers
	WHERE "id" = crm_rewards."required_tier_id") e) AS "required_tier" FROM crm.crm_rewards`

func (h *handler) listRewards(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.PosSession(r); err != nil {
		return err
	}
	q := r.URL.Query()
	rewardType := q.Get("reward_type")
	sql, args := rewardSelect, []any{}
	switch {
	case rewardType != "":
		sql += ` WHERE "reward_type" = $1`
		args = append(args, rewardType)
	case q.Get("include_avatar_rewards") != "true":
		sql += ` WHERE "reward_type" <> 'avatar'`
	}
	rows, err := kit.Query(r.Context(), h.db, sql+` ORDER BY "created_at" DESC`, args...)
	if err != nil {
		if kit.IsMissingCrmSchema(err) {
			return kit.WithMeta(w, []any{}, false)
		}
		return err
	}
	return kit.WithMeta(w, rows, true)
}

func (h *handler) saveReward(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateSettings); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	p := &payload{f: f}
	p.set("code", lowerCode(f, 80))
	p.set("name", strOrNil(f.Str("name", required, validate.StrOpts{Trim: true, Min: 1, Max: 120})))
	p.set("reward_type", strOrNil(f.Enum("reward_type", required, []string{"discount", "merchandise", "avatar", "voucher", "ark_coin", "custom"})))
	p.set("min_xp", intOrNil(f.Int("min_xp", required, nonneg)))
	p.opt("required_tier_id", strOrNil(f.UUID("required_tier_id", nullOpt)))
	p.opt("linked_avatar_id", strOrNil(f.UUID("linked_avatar_id", nullOpt)))
	p.opt("stock_total", intOrNil(f.Int("stock_total", nullOpt, nonneg)))
	p.set("stock_redeemed", intDefault(f, "stock_redeemed", 0, nonneg))
	p.opt("max_redemptions_per_member", intOrNil(f.Int("max_redemptions_per_member", nullOpt, validate.NumOpts{Positive: true})))
	period := "total"
	if s := f.Enum("quota_period", withDef, []string{"total", "daily", "monthly", "yearly"}); s != nil {
		period = *s
	}
	p.set("quota_period", period)
	p.opt("image_url", strOrNil(f.Str("image_url", nullOpt, validate.StrOpts{Trim: true, Check: validate.URLCheck})))
	p.set("reward_data", kit.JSONText(kit.RecordDefault(f, "reward_data")))
	p.opt("starts_at", strOrNil(datetimeOpt(f, "starts_at")))
	p.opt("ends_at", strOrNil(datetimeOpt(f, "ends_at")))
	p.set("is_active", f.BoolDefault("is_active", true))
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := kit.Upsert(r.Context(), h.db, "crm.crm_rewards", "code", p.cols)
	if err != nil {
		return kit.CrmSchemaError(err)
	}
	return kit.OK(w, row)
}

func (h *handler) deleteReward(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateSettings); err != nil {
		return err
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		return httpx.BadRequest("Reward id wajib diisi")
	}
	err := database.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		_, err := tx.Exec(r.Context(), `DELETE FROM crm.crm_rewards WHERE "id" = $1::text::uuid`, id)
		return err
	})
	if err != nil {
		if database.PgCode(err) == "23503" {
			return httpx.Conflict("Reward sudah memiliki redemption dan tidak bisa dihapus. Nonaktifkan reward sebagai gantinya.")
		}
		return kit.CrmSchemaError(err)
	}
	return kit.Success(w)
}
