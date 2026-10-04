package posops

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/validate"
)

/* ── Receipt settings and gift card config ───────────────────────────── */

// ReceiptSettings mirrors GET /api/pos/receipt-settings: every active row,
// normalized. updated_at is a Date in node-postgres, so it renders null.
func (s *Service) ReceiptSettings(ctx context.Context) ([]*Obj, error) {
	rows, err := ReceiptStore{}.ActiveRows(ctx, s.db)
	if err != nil {
		return nil, err
	}
	out := make([]*Obj, len(rows))
	for i, r := range rows {
		out[i] = NewObj("id", r.ID, "branch_id", r.BranchID, "warehouse_id", r.WarehouseID,
			"header_lines", domain.ReceiptLines(r.HeaderLines), "footer_lines", domain.ReceiptLines(r.FooterLines),
			"show_stall_name", r.ShowStallName, "updated_at", nil)
	}
	return out, nil
}

// GiftCardConfig mirrors GET /api/pos/gift-card-config (presets and
// allow_custom; the cashier never sees the expiry).
func (s *Service) GiftCardConfig(ctx context.Context) (domain.GiftCardConfig, error) {
	raw, err := s.ports.Directory.Setting(ctx, s.db, "giftcard_config")
	if err != nil {
		return domain.GiftCardConfig{}, err
	}
	var parsed any
	if raw != nil && *raw != "" && json.Unmarshal([]byte(*raw), &parsed) != nil {
		parsed = nil
	}
	return domain.ParseGiftCardConfig(parsed), nil
}

/* ── Loyalty settings ────────────────────────────────────────────────── */

const loyaltySingletonID = "a0000000-0000-4000-8000-000000000001"

// jsDateString is String(date) on a UTC server.
func jsDateString(t time.Time) string {
	return t.UTC().Format("Mon Jan 02 2006 15:04:05") + " GMT+0000 (Coordinated Universal Time)"
}

// loyaltyView is normalizeLoyaltySettings of a pos_loyalty_settings row.
func loyaltyView(row *Obj) *Obj {
	num := func(key string, fallback float64) float64 {
		f := domain.Number(row.Get(key))
		if !domain.Finite(f) {
			return fallback
		}
		return f
	}
	boolOf := func(key string, fallback bool) bool {
		switch v := row.Get(key).(type) {
		case bool:
			return v
		case nil:
			return fallback
		case string:
			switch strings.ToLower(strings.TrimSpace(v)) {
			case "true", "1":
				return true
			case "false", "0":
				return false
			}
		}
		return domain.Truthy(row.Get(key))
	}
	if row == nil {
		return NewObj("id", nil, "ark_rate", 1000, "topup_min_amount", 10000, "topup_presets", domain.DefaultTopupPresets,
			"topup_xp_enabled", true, "topup_xp_mode", "per_amount", "topup_xp_value", 1, "topup_xp_amount_step", 10000,
			"spend_xp_enabled", true, "spend_xp_amount_step", 10000, "spend_xp_min", 1, "updated_at", nil)
	}
	mode := "per_amount"
	if strings.ToLower(domain.String(firstTruthy(row.Get("topup_xp_mode"), "per_amount"))) == "fixed" {
		mode = "fixed"
	}
	var presets []any
	if raw, ok := row.Get("topup_presets").(json.RawMessage); ok {
		_ = json.Unmarshal(raw, &presets)
	}
	var updated any
	if t, ok := row.Get("updated_at").(httpx.JSTime); ok {
		updated = jsDateString(time.Time(t))
	}
	return NewObj(
		"id", row.Get("id"),
		"ark_rate", math.Max(1, num("ark_rate", 1000)),
		"topup_min_amount", math.Max(0, num("topup_min_amount", 10000)),
		"topup_presets", domain.TopupPresets(presets),
		"topup_xp_enabled", boolOf("topup_xp_enabled", true),
		"topup_xp_mode", mode,
		"topup_xp_value", math.Max(0, num("topup_xp_value", 1)),
		"topup_xp_amount_step", math.Max(1, num("topup_xp_amount_step", 10000)),
		"spend_xp_enabled", boolOf("spend_xp_enabled", true),
		"spend_xp_amount_step", math.Max(1, num("spend_xp_amount_step", 10000)),
		"spend_xp_min", math.Max(0, math.Floor(num("spend_xp_min", 1))),
		"updated_at", updated,
	)
}

// LoyaltySettings mirrors GET /api/pos/loyalty-settings.
func (s *Service) LoyaltySettings(ctx context.Context) (*Obj, error) {
	row, err := QueryObj(ctx, s.db, `SELECT * FROM pos.pos_loyalty_settings WHERE is_active = true ORDER BY updated_at DESC LIMIT 1`)
	if err != nil && !database.IsUndefinedTable(err) {
		return nil, err
	}
	return loyaltyView(row), nil
}

// loyaltyInput is the PUT body.
type loyaltyInput struct {
	ArkRate, TopupMinAmount         float64
	TopupPresets                    []float64
	TopupXpEnabled                  bool
	TopupXpMode                     string
	TopupXpValue, TopupXpAmountStep float64
	SpendXpEnabled                  bool
	SpendXpAmountStep               float64
	SpendXpMin                      int
}

func parseLoyaltyInput(body any) (loyaltyInput, error) {
	f := validate.New(body, true)
	num := func(key string, o validate.NumOpts) float64 {
		if v := f.Num(key, validate.Rule{}, o); v != nil {
			return *v
		}
		return 0
	}
	positive, nonNeg := validate.NumOpts{Positive: true}, validate.NumOpts{Min: validate.Bound(0)}
	var in loyaltyInput
	in.ArkRate = num("ark_rate", positive)
	in.TopupMinAmount = num("topup_min_amount", nonNeg)
	items := f.List("topup_presets", validate.Rule{}, math.MaxInt, func(sub *validate.Form, i int, v any) {
		x, _ := sub.CheckNumber(i, v, positive)
		in.TopupPresets = append(in.TopupPresets, x)
	})
	if items != nil && len(items) == 0 {
		f.Fail("topup_presets", "too_small", "Too small: expected array to have >=1 items")
	}
	in.TopupXpEnabled = deref(f.Bool("topup_xp_enabled", validate.Rule{}))
	in.TopupXpMode = deref(f.Enum("topup_xp_mode", validate.Rule{}, []string{"fixed", "per_amount"}))
	in.TopupXpValue = num("topup_xp_value", nonNeg)
	in.TopupXpAmountStep = num("topup_xp_amount_step", positive)
	in.SpendXpEnabled = deref(f.Bool("spend_xp_enabled", validate.Rule{}))
	in.SpendXpAmountStep = num("spend_xp_amount_step", positive)
	in.SpendXpMin = deref(f.Int("spend_xp_min", validate.Rule{}, nonNeg))
	return in, f.Err("Invalid payload")
}

func deref[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}

// SaveLoyaltySettings mirrors PUT /api/pos/loyalty-settings: the singleton
// row is updated or created.
func (s *Service) SaveLoyaltySettings(ctx context.Context, userID string, body any) (*Obj, error) {
	in, err := parseLoyaltyInput(body)
	if err != nil {
		return nil, err
	}
	presets := make([]any, len(in.TopupPresets))
	for i, p := range in.TopupPresets {
		presets[i] = p
	}
	presetJSON, _ := json.Marshal(domain.TopupPresets(presets))
	var row *Obj
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		row, err = QueryObj(ctx, tx, `INSERT INTO pos.pos_loyalty_settings
			(id, ark_rate, topup_min_amount, topup_presets, topup_xp_enabled, topup_xp_mode, topup_xp_value,
			 topup_xp_amount_step, spend_xp_enabled, spend_xp_amount_step, spend_xp_min, is_active, updated_by, updated_at)
			VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, true, $12, $13)
			ON CONFLICT (id) DO UPDATE SET ark_rate = EXCLUDED.ark_rate, topup_min_amount = EXCLUDED.topup_min_amount,
			  topup_presets = EXCLUDED.topup_presets, topup_xp_enabled = EXCLUDED.topup_xp_enabled,
			  topup_xp_mode = EXCLUDED.topup_xp_mode, topup_xp_value = EXCLUDED.topup_xp_value,
			  topup_xp_amount_step = EXCLUDED.topup_xp_amount_step, spend_xp_enabled = EXCLUDED.spend_xp_enabled,
			  spend_xp_amount_step = EXCLUDED.spend_xp_amount_step, spend_xp_min = EXCLUDED.spend_xp_min,
			  is_active = true, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
			RETURNING *`,
			loyaltySingletonID, in.ArkRate, in.TopupMinAmount, string(presetJSON), in.TopupXpEnabled, in.TopupXpMode,
			in.TopupXpValue, in.TopupXpAmountStep, in.SpendXpEnabled, in.SpendXpAmountStep, in.SpendXpMin, userID, s.now())
		return err
	})
	if err != nil {
		return nil, err
	}
	return loyaltyView(row), nil
}

/* ── Payment methods ─────────────────────────────────────────────────── */

// PaymentMethods mirrors GET /api/pos/payment-methods; the active list
// hides ARK Coin when CRM switched the feature off.
func (s *Service) PaymentMethods(ctx context.Context, activeOnly bool) ([]paymentMethod, error) {
	methods, err := listPaymentMethods(ctx, s.db, activeOnly)
	if err != nil || !activeOnly || s.ports.CRM.ArkCoinEnabled(ctx, s.db) {
		return methods, err
	}
	out := methods[:0]
	for _, m := range methods {
		if m.Code != "ark_coin" {
			out = append(out, m)
		}
	}
	return out, nil
}

// UpdatePaymentMethod mirrors PATCH /api/pos/payment-methods.
func (s *Service) UpdatePaymentMethod(ctx context.Context, body any, present bool) (*paymentMethod, error) {
	f := validate.New(body, present)
	code := deref(f.Str("code", validate.Rule{}, validate.StrOpts{Min: 2, Max: 40}))
	opt := validate.Rule{Optional: true}
	name := f.Str("name", opt, validate.StrOpts{Trim: true, Min: 2, Max: 80})
	description := f.Str("description", opt, validate.StrOpts{Trim: true, Max: 200})
	active := f.Bool("is_active", opt)
	sortOrder := f.Int("sort_order", opt, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(10_000)})
	newCode := f.Str("new_code", opt, validate.StrOpts{Trim: true, Min: 2, Max: 40})
	if err := f.Err("Validation failed"); err != nil {
		return nil, err
	}
	if !domain.ValidPaymentCode(code) && domain.SlugPaymentCode(code) == "" {
		return nil, fail(http.StatusBadRequest, "Kode metode tidak dikenali")
	}
	if name == nil && description == nil && active == nil && sortOrder == nil && newCode == nil {
		return nil, fail(http.StatusBadRequest, "Tidak ada field yang diubah")
	}
	normalized := domain.SlugPaymentCode(code)
	if normalized == "" || !domain.ValidPaymentCode(normalized) {
		return nil, nil
	}
	var cols domain.Columns
	if name != nil {
		cols.Set("name", *name)
	}
	if description != nil {
		cols.Set("description", *description)
	}
	if active != nil {
		cols.Set("is_active", *active)
	}
	if sortOrder != nil {
		cols.Set("sort_order", *sortOrder)
	}
	if newCode != nil {
		next := domain.SlugPaymentCode(*newCode)
		switch {
		case len(next) < 2 || !domain.ValidPaymentCode(next):
			return nil, &jsError{msg: "Kode metode tidak valid"}
		case domain.IsBuiltInPaymentCode(normalized):
			return nil, &jsError{msg: "Kode metode bawaan tidak bisa diubah"}
		case domain.IsBuiltInPaymentCode(next):
			return nil, &jsError{msg: "Kode itu dipakai metode bawaan"}
		}
		if next != normalized {
			taken, err := paymentCodeTaken(ctx, s.db, next)
			if err != nil {
				return nil, err
			}
			if taken {
				return nil, &jsError{msg: "Kode metode sudah dipakai"}
			}
			cols.Set("code", next)
		}
	}
	if len(cols) == 0 {
		return paymentMethodByCode(ctx, s.db, normalized)
	}
	return updatePaymentMethod(ctx, s.db, normalized, cols)
}

// CreatePaymentMethod mirrors POST /api/pos/payment-methods: a manual
// (cash or card) method; a taken or built-in code gets a _2, _3 … suffix.
func (s *Service) CreatePaymentMethod(ctx context.Context, body any, present bool) (*paymentMethod, error) {
	f := validate.New(body, present)
	name := deref(f.Str("name", validate.Rule{}, validate.StrOpts{Trim: true, Min: 2, Max: 80}))
	code := f.Str("code", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Max: 40})
	description := f.Str("description", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Max: 200})
	handler := deref(f.Enum("handler", validate.Rule{}, []string{"cash", "credit"}))
	if err := f.Err("Validation failed"); err != nil {
		return nil, err
	}
	source := name
	if code != nil && *code != "" {
		source = *code
	}
	base := domain.SlugPaymentCode(source)
	if len(base) < 2 || !domain.ValidPaymentCode(base) {
		return nil, &jsError{msg: "Kode metode tidak valid"}
	}
	existing, err := paymentCodesLike(ctx, s.db, base)
	if err != nil {
		return nil, err
	}
	final := base
	for i := 2; slices.Contains(existing, final) || domain.IsBuiltInPaymentCode(final); i++ {
		final = base + "_" + strconv.Itoa(i)
		if len(final) > 40 {
			final = final[:40]
		}
	}
	m, err := insertPaymentMethod(ctx, s.db, final, name, domain.TrimJS(deref(description)), handler)
	if err != nil {
		return nil, err
	}
	if m == nil {
		return nil, &jsError{msg: "Gagal menyimpan metode bayar"}
	}
	return m, nil
}

// DeletePaymentMethod mirrors DELETE /api/pos/payment-methods?code=…;
// built-in methods are protected.
func (s *Service) DeletePaymentMethod(ctx context.Context, code string) (bool, error) {
	if !domain.ValidPaymentCode(code) {
		return false, fail(http.StatusBadRequest, "Kode metode tidak valid")
	}
	if domain.IsBuiltInPaymentCode(code) {
		return false, &jsError{msg: "Metode bawaan tidak bisa dihapus — nonaktifkan saja"}
	}
	return deletePaymentMethod(ctx, s.db, code)
}

/* ── Sales channels and channel prices ───────────────────────────────── */

var roundingSteps = []float64{1, 100, 500, 1000}

// UpdateSalesChannel mirrors PUT /api/pos/sales-channels/{code}.
func (s *Service) UpdateSalesChannel(ctx context.Context, userID, code string, body any) (*channelRule, error) {
	rule, err := salesChannel(ctx, s.db, code)
	if err != nil {
		return nil, err
	}
	if rule == nil {
		return nil, fail(http.StatusNotFound, "Channel tidak dikenal")
	}
	markup, mOK := jsonNumber(field(body, "markup_percent"))
	step, sOK := jsonNumber(field(body, "rounding_step"))
	mode, _ := field(body, "rounding_mode").(string)
	active, aOK := field(body, "is_active").(bool)
	valid := mOK && markup >= 0 && markup <= 300 && sOK && slices.Contains(roundingSteps, step) &&
		(mode == "up" || mode == "nearest" || mode == "down") && aOK
	if !valid {
		return nil, fail(http.StatusBadRequest, "Aturan harga tidak valid")
	}
	if err := updateSalesChannel(ctx, s.db, code, domain.Round2(markup), step, mode, active, userID); err != nil {
		return nil, err
	}
	return salesChannel(ctx, s.db, code)
}

// jsonNumber is a finite JSON number (z.number()).
func jsonNumber(v any) (float64, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	f := domain.Number(n)
	return f, domain.Finite(f)
}

// ChannelPrices mirrors GET /api/pos/channel-prices?channel=…: every
// channel, the chosen (or first) one, and the sellable products with
// their manual price on it.
func (s *Service) ChannelPrices(ctx context.Context, requested string) (*Obj, error) {
	channels, err := listSalesChannels(ctx, s.db)
	if err != nil {
		return nil, err
	}
	var channel *channelRule
	for i := range channels {
		if channels[i].Code == requested {
			channel = &channels[i]
			break
		}
	}
	if channel == nil && len(channels) > 0 {
		channel = &channels[0]
	}
	if channel == nil {
		return NewObj("channels", channels, "channel", nil, "products", []any{}), nil
	}
	products, err := channelProducts(ctx, s.db)
	if err != nil {
		return nil, err
	}
	overrides, err := channelOverrides(ctx, s.db, channel.Code)
	if err != nil {
		return nil, err
	}
	for _, p := range products {
		p.Set("base_price", domain.ToNumber(p.Get("base_price")))
		if price, ok := overrides[p.Str("id")]; ok {
			p.Set("override_price", price)
		} else {
			p.Set("override_price", nil)
		}
	}
	return NewObj("channels", channels, "channel", channel, "products", products), nil
}

// channelPriceInput is the PUT body: reset_all, or prices to set/clear.
type channelPriceInput struct {
	Channel  string
	ResetAll bool
	Clear    []string
	IDs      []string
	Prices   []float64
}

func parseChannelPrices(body any) (channelPriceInput, bool) {
	var in channelPriceInput
	ch, ok := field(body, "channel").(string)
	if !ok {
		return in, false
	}
	in.Channel = domain.TrimJS(ch)
	if n := domain.Len16(in.Channel); n < 1 || n > 32 {
		return in, false
	}
	if field(body, "reset_all") == true {
		in.ResetAll = true
		return in, true
	}
	list, ok := field(body, "prices").([]any)
	if !ok || len(list) < 1 || len(list) > 1000 {
		return in, false
	}
	for _, item := range list {
		m, ok := item.(map[string]any)
		if !ok {
			return in, false
		}
		id, ok := m["product_id"].(string)
		if !ok || !validate.IsUUID(id) {
			return in, false
		}
		raw, present := m["price"]
		if !present {
			return in, false
		}
		if raw == nil {
			in.Clear = append(in.Clear, id)
			continue
		}
		price, ok := jsonNumber(raw)
		if !ok || price != math.Trunc(price) || price <= 0 || price > 100_000_000 {
			return in, false
		}
		in.IDs, in.Prices = append(in.IDs, id), append(in.Prices, price)
	}
	return in, true
}

// SaveChannelPrices mirrors PUT /api/pos/channel-prices.
func (s *Service) SaveChannelPrices(ctx context.Context, userID string, body any) (*Obj, error) {
	in, ok := parseChannelPrices(body)
	if !ok {
		return nil, fail(http.StatusBadRequest, "Data harga tidak valid (harga harus bilangan bulat > 0)")
	}
	rule, err := salesChannel(ctx, s.db, in.Channel)
	if err != nil {
		return nil, err
	}
	if rule == nil {
		return nil, fail(http.StatusNotFound, "Channel tidak dikenal")
	}
	var saved, cleared int64
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if in.ResetAll {
			cleared, err = clearChannelPrices(ctx, tx, in.Channel, nil)
			return err
		}
		if len(in.Clear) > 0 {
			if cleared, err = clearChannelPrices(ctx, tx, in.Channel, in.Clear); err != nil {
				return err
			}
		}
		if len(in.IDs) > 0 {
			saved, err = saveChannelPrices(ctx, tx, in.Channel, in.IDs, in.Prices, userID)
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return NewObj("saved", saved, "cleared", cleared), nil
}

/* ── Billing settings ────────────────────────────────────────────────── */

// ResolveBillingProfile picks the stall profile, then the branch one, then
// the system default.
func (s *Service) ResolveBillingProfile(ctx context.Context, branchID, warehouseID string) (domain.BillingProfile, error) {
	branchID, warehouseID = strings.TrimSpace(branchID), strings.TrimSpace(warehouseID)
	const cols = `SELECT ` + billingProfileColumns + ` FROM pos.pos_billing_profiles WHERE is_active = true`
	if branchID != "" && warehouseID != "" {
		p, err := firstProfile(ctx, s.db, cols+` AND branch_id = $1::text::uuid AND warehouse_id = $2::text::uuid LIMIT 1`, branchID, warehouseID)
		if err != nil || p != nil {
			return deref(p), err
		}
	}
	if branchID != "" {
		p, err := firstProfile(ctx, s.db, cols+` AND branch_id = $1::text::uuid AND warehouse_id IS NULL LIMIT 1`, branchID)
		if err != nil || p != nil {
			return deref(p), err
		}
	}
	p, err := activeProfileByID(ctx, s.db, domain.SystemBillingProfileID)
	if err != nil || p != nil {
		return deref(p), err
	}
	p, err = firstProfile(ctx, s.db, cols+` AND branch_id IS NULL AND warehouse_id IS NULL ORDER BY created_at ASC LIMIT 1`)
	if err != nil || p != nil {
		return deref(p), err
	}
	return domain.DefaultBillingProfile(), nil
}

// sessionBillingScope is the cashier's branch (profile, else first
// assigned stall's) and stall (the active one, else the first assigned).
func (s *Service) sessionBillingScope(ctx context.Context, c Caller) (branchID, warehouseID string, err error) {
	sc, err := scope.Load(ctx, s.db, c.UserID)
	if err != nil {
		return "", "", err
	}
	assigned, err := s.ports.Stalls.Assigned(ctx, s.db, c.UserID)
	if err != nil {
		return "", "", err
	}
	active, err := s.activeStall(ctx, c.ActiveStall)
	if err != nil {
		return "", "", err
	}
	if sc.BranchID != nil {
		branchID = *sc.BranchID
	} else if len(assigned) > 0 && assigned[0].BranchID != nil {
		branchID = *assigned[0].BranchID
	}
	switch active.Mode {
	case domain.StallModeStall:
		warehouseID = active.Stall.ID
	case domain.StallModeUnset:
		if len(assigned) > 0 {
			warehouseID = assigned[0].ID
		}
	}
	return branchID, warehouseID, nil
}

// BillingSettings mirrors GET /api/pos/billing-settings?mode=…
func (s *Service) BillingSettings(ctx context.Context, c Caller, mode, branchID, warehouseID, subtotal, enabledCodes string) (any, error) {
	switch mode {
	case "options":
		branches, err := s.ports.Directory.ActiveBranches(ctx, s.db)
		if err != nil {
			return nil, err
		}
		stalls, err := s.ports.Stalls.BranchByName(ctx, s.db, nonEmptyPtr(&branchID))
		if err != nil {
			return nil, err
		}
		warehouses := make([]*Obj, len(stalls))
		for i, st := range stalls {
			warehouses[i] = NewObj("id", st.ID, "name", st.Name, "code", st.Code, "branch_id", st.BranchID)
		}
		profiles, err := listBillingProfiles(ctx, s.db)
		if err != nil {
			return nil, err
		}
		return NewObj("branches", branches, "warehouses", warehouses, "profiles", profiles), nil
	case "list":
		return listBillingProfiles(ctx, s.db)
	}
	if branchID == "" && warehouseID == "" {
		var err error
		if branchID, warehouseID, err = s.sessionBillingScope(ctx, c); err != nil {
			return nil, err
		}
	}
	profile, err := s.ResolveBillingProfile(ctx, branchID, warehouseID)
	if err != nil {
		return nil, err
	}
	if subtotal == "" {
		subtotal = "0"
	}
	var preview any
	if sub := domain.Number(subtotal); sub > 0 {
		var codes []string
		for _, code := range strings.Split(enabledCodes, ",") {
			if code = strings.TrimSpace(code); code != "" {
				codes = append(codes, code)
			}
		}
		preview = domain.CalculateBillCharges(sub, profile.Charges, codes)
	}
	return NewObj("profile", profile, "preview", preview), nil
}

// billingChargeInput is one validated charge of the PUT body.
type billingChargeInput struct {
	Code, Name, Kind, Method, Base string
	Rate, Amount                   float64
	ApplyOrder                     int
	Enabled, Optional              bool
}

// SaveBillingProfile mirrors PUT /api/pos/billing-settings: update the
// profile by id, or replace the active one of the same scope, then
// rewrite its charges.
func (s *Service) SaveBillingProfile(ctx context.Context, userID string, body any) (domain.BillingProfile, error) {
	f := validate.New(body, true)
	id := f.UUID("id", validate.Rule{Optional: true, Nullable: true})
	branchID := f.UUID("branch_id", validate.Rule{Nullable: true})
	warehouseID := f.UUID("warehouse_id", validate.Rule{Nullable: true})
	name := deref(f.Str("name", validate.Rule{}, validate.StrOpts{Min: 1, Max: 120}))
	var charges []billingChargeInput
	items := f.List("charges", validate.Rule{}, math.MaxInt, func(sub *validate.Form, i int, v any) {
		c := sub.Item(i, v)
		nonNeg := validate.NumOpts{Min: validate.Bound(0)}
		charges = append(charges, billingChargeInput{
			Code:       deref(c.Str("code", validate.Rule{}, validate.StrOpts{Min: 1, Max: 40})),
			Name:       deref(c.Str("name", validate.Rule{}, validate.StrOpts{Min: 1, Max: 120})),
			Kind:       deref(c.Enum("charge_kind", validate.Rule{}, []string{"tax", "service", "fee", "rounding"})),
			Method:     deref(c.Enum("calc_method", validate.Rule{}, []string{"percent", "fixed", "round_nearest", "round_up"})),
			Rate:       deref(c.Num("rate", validate.Rule{}, nonNeg)),
			Amount:     deref(c.Num("amount", validate.Rule{}, nonNeg)),
			ApplyOrder: deref(c.Int("apply_order", validate.Rule{}, validate.NumOpts{})),
			Enabled:    deref(c.Bool("is_enabled", validate.Rule{})),
			Optional:   deref(c.Bool("is_optional", validate.Rule{})),
			Base:       deref(c.Enum("base", validate.Rule{}, []string{"subtotal_after_discount", "subtotal_plus_fees"})),
		})
	})
	if items != nil && len(items) == 0 {
		f.Fail("charges", "too_small", "Too small: expected array to have >=1 items")
	}
	if err := f.Err("Invalid payload"); err != nil {
		return domain.BillingProfile{}, err
	}
	seen := map[string]bool{}
	for i := range charges {
		charges[i].Code = strings.ToUpper(domain.TrimJS(charges[i].Code))
		if seen[charges[i].Code] {
			return domain.BillingProfile{}, fail(http.StatusBadRequest, "Charge codes must be unique within a profile")
		}
		seen[charges[i].Code] = true
	}
	if name = domain.TrimJS(name); name == "" {
		name = "Billing Profile"
	}
	now := s.now()
	var profile *domain.BillingProfile
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		profileID := ""
		if id != nil {
			profileID = strings.TrimSpace(*id)
		}
		if profileID != "" {
			if _, err := tx.Exec(ctx, `UPDATE pos.pos_billing_profiles SET name = $2, branch_id = $3, warehouse_id = $4,
				is_active = true, updated_by = $5, updated_at = $6 WHERE id = $1`,
				profileID, name, branchID, warehouseID, userID, now); err != nil {
				return err
			}
		} else {
			if _, err := tx.Exec(ctx, `UPDATE pos.pos_billing_profiles SET is_active = false, updated_at = $3, updated_by = $4
				WHERE is_active = true
				  AND COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
				  AND COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
				branchID, warehouseID, now, userID); err != nil {
				return err
			}
			if err := tx.QueryRow(ctx, `INSERT INTO pos.pos_billing_profiles (branch_id, warehouse_id, name, is_active, updated_by, updated_at)
				VALUES ($1, $2, $3, true, $4, $5) RETURNING id::text`, branchID, warehouseID, name, userID, now).Scan(&profileID); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `DELETE FROM pos.pos_billing_charges WHERE profile_id = $1`, profileID); err != nil {
			return err
		}
		for _, c := range charges {
			if c.Code == "" {
				continue
			}
			chargeName := domain.TrimJS(firstTruthy(c.Name, c.Code).(string))
			if _, err := tx.Exec(ctx, `INSERT INTO pos.pos_billing_charges (profile_id, code, name, charge_kind, calc_method,
				rate, amount, apply_order, is_enabled, is_optional, base, updated_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
				profileID, c.Code, chargeName, c.Kind, c.Method, c.Rate, c.Amount, c.ApplyOrder, c.Enabled, c.Optional, c.Base, now); err != nil {
				return err
			}
		}
		var err error
		if profile, err = activeProfileByID(ctx, tx, profileID); err != nil {
			return err
		}
		if profile == nil {
			return plainError("Billing profile not found after save")
		}
		return nil
	})
	if err != nil {
		return domain.BillingProfile{}, err
	}
	return *profile, nil
}
