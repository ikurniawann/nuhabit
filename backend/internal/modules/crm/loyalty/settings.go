package loyalty

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/loyalty/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/validate"
)

// editableKeys mirrors EDITABLE_KEYS in lib/crm/settings-server.ts.
var editableKeys = []string{
	"ark_coin_enabled", "xp_enabled", "topup_bonus_percent", "profile_completion_free_xp",
	"cs_sla_response_minutes", "cs_sla_resolution_minutes", "cs_business_hours_start", "cs_business_hours_end",
	"cs_auto_reply_enabled", "cs_auto_reply_text", "cs_csat_enabled", "cs_csat_text",
}

// orderedJSON is a JSON object whose keys keep the row order.
type orderedJSON struct {
	keys []string
	vals map[string]json.RawMessage
}

func (o orderedJSON) MarshalJSON() ([]byte, error) {
	row := kit.NewRow()
	for _, k := range o.keys {
		row.Set(k, o.vals[k])
	}
	return row.MarshalJSON()
}

func (h *handler) readSettings(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.PosSession(r); err != nil {
		return err
	}
	rows, err := h.db.Query(r.Context(), `SELECT key, value FROM crm.crm_settings WHERE key = ANY($1::text[])`, editableKeys)
	if err != nil {
		if kit.IsMissingCrmSchema(err) {
			return kit.WithMeta(w, struct{}{}, false)
		}
		return err
	}
	out := orderedJSON{vals: map[string]json.RawMessage{}}
	defer rows.Close()
	for rows.Next() {
		var key string
		var value []byte
		if err := rows.Scan(&key, &value); err != nil {
			return err
		}
		if _, dup := out.vals[key]; !dup {
			out.keys = append(out.keys, key)
		}
		out.vals[key] = kit.JSJSON(value)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return kit.WithMeta(w, out, true)
}

// settingsUpdate validates crmSettingsUpdateSchema in schema order and
// returns the sent keys with their parsed values.
func settingsUpdate(f *validate.Form) map[string]any {
	opt := validate.Rule{Optional: true}
	out := map[string]any{}
	keep := func(key string, v any, ok bool) {
		if ok {
			out[key] = v
		}
	}
	intRange := func(key string, min, max float64) {
		o := validate.NumOpts{Min: validate.Bound(min)}
		if max > 0 {
			o.Max = validate.Bound(max)
		}
		if x := f.Int(key, opt, o); x != nil {
			keep(key, *x, true)
		}
	}
	boolean := func(key string) {
		if b := f.Bool(key, opt); b != nil {
			keep(key, *b, true)
		}
	}
	text := func(key string) {
		if s := f.Str(key, opt, validate.StrOpts{Trim: true, Min: 1, Max: 1000}); s != nil {
			keep(key, *s, true)
		}
	}
	boolean("ark_coin_enabled")
	boolean("xp_enabled")
	if x := f.Num("topup_bonus_percent", opt, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(100)}); x != nil {
		keep("topup_bonus_percent", *x, true)
	}
	intRange("profile_completion_free_xp", 0, 0)
	intRange("cs_sla_response_minutes", 1, 1440)
	intRange("cs_sla_resolution_minutes", 1, 10080)
	intRange("cs_business_hours_start", 0, 23)
	intRange("cs_business_hours_end", 0, 23)
	boolean("cs_auto_reply_enabled")
	text("cs_auto_reply_text")
	boolean("cs_csat_enabled")
	text("cs_csat_text")
	// The object refine counts the parsed keys (unknown keys are stripped).
	if f.Valid() && len(out) == 0 {
		f.Fail(nil, "custom", "Minimal satu setting harus diisi")
	}
	return out
}

func (h *handler) updateSettings(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.Require(r, kit.GateSettings)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	values := settingsUpdate(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	now := h.now()
	err = database.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		for _, key := range editableKeys {
			v, ok := values[key]
			if !ok {
				continue
			}
			raw, _ := kit.MarshalNoEscape(v)
			if _, err := tx.Exec(r.Context(), `UPDATE crm.crm_settings SET value = $1::jsonb, updated_by = $2, updated_at = $3 WHERE key = $4`,
				string(raw), user.ID, now, key); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return kit.CrmSchemaError(err)
	}
	return kit.Success(w)
}

func (h *handler) loyaltyFeatures(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.PosSession(r); err != nil {
		return err
	}
	return kit.OK(w, loadFeatures(r, h.db))
}

// loadFeatures mirrors getLoyaltyFeatures: any read failure falls back to
// both features enabled.
func loadFeatures(r *http.Request, q database.Querier) domain.Features {
	rows, err := q.Query(r.Context(), `SELECT key, value FROM crm.crm_settings WHERE key = ANY($1::text[])`,
		[]string{domain.ArkCoinSettingKey, domain.XPSettingKey})
	if err != nil {
		return domain.DefaultFeatures
	}
	defer rows.Close()
	values := map[string]json.RawMessage{}
	for rows.Next() {
		var key string
		var value []byte
		if rows.Scan(&key, &value) != nil {
			return domain.DefaultFeatures
		}
		values[key] = value
	}
	if rows.Err() != nil {
		return domain.DefaultFeatures
	}
	return domain.ParseFeatures(values)
}
