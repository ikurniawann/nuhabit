package loyalty

import (
	"context"
	"net/http"
	"sort"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/loyalty/domain"
	"nuhabit/backend/internal/platform/database"
)

// customerColumns is POS_CUSTOMER_COLUMNS in lib/crm/dashboard-server.ts.
const customerColumns = `id, name, phone, email, membership_tier, ark_coin_balance, total_xp, total_spent, visit_count, is_active`

type dashboardCustomer struct {
	ID             any     `json:"id"`
	Name           any     `json:"name"`
	Phone          any     `json:"phone"`
	Email          any     `json:"email"`
	MembershipTier any     `json:"membership_tier"`
	ArkCoinBalance float64 `json:"ark_coin_balance"`
	TotalXP        float64 `json:"total_xp"`
	TotalSpent     float64 `json:"total_spent"`
	VisitCount     float64 `json:"visit_count"`
	IsActive       bool    `json:"is_active"`
}

func orDefault(v any, def string) any {
	if v == nil {
		return def
	}
	return v
}

func normalizeCustomer(r *kit.Row) dashboardCustomer {
	active, isBool := r.Get("is_active").(bool)
	return dashboardCustomer{
		ID: r.Get("id"), Name: orDefault(r.Get("name"), "Walk-in Customer"), Phone: orDefault(r.Get("phone"), ""),
		Email: orDefault(r.Get("email"), ""), MembershipTier: orDefault(r.Get("membership_tier"), "regular"),
		ArkCoinBalance: r.Num("ark_coin_balance"), TotalXP: r.Num("total_xp"), TotalSpent: r.Num("total_spent"),
		VisitCount: r.Num("visit_count"), IsActive: !isBool || active,
	}
}

type arkSpender struct {
	Customer     *dashboardCustomer `json:"customer"`
	ArkCoinsUsed float64            `json:"ark_coins_used"`
}

type dashboardStats struct {
	TotalCustomers     int64   `json:"totalCustomers"`
	TotalMembers       int64   `json:"totalMembers"`
	CardMembers        float64 `json:"cardMembers"`
	RegisteredMembers  float64 `json:"registeredMembers"`
	ArkOutstanding     float64 `json:"arkOutstanding"`
	TierCount          int64   `json:"tierCount"`
	XPRuleCount        int64   `json:"xpRuleCount"`
	RewardCount        int64   `json:"rewardCount"`
	AvatarCount        int64   `json:"avatarCount"`
	RedemptionCount    int64   `json:"redemptionCount"`
	ExternalEventCount int64   `json:"externalEventCount"`
}

type dashboardData struct {
	Stats                  dashboardStats      `json:"stats"`
	TopLoyalMembers        []dashboardCustomer `json:"topLoyalMembers"`
	TopTransactionSpenders []dashboardCustomer `json:"topTransactionSpenders"`
	TopArkSpenders         []arkSpender        `json:"topArkSpenders"`
	RecentXPActivity       []*kit.Row          `json:"recentXpActivity"`
}

// countTable mirrors countTable: a missing CRM table counts 0, not ready.
func countTable(ctx context.Context, q database.DB, table string) (int64, bool, error) {
	var n int64
	err := database.WithTx(ctx, q, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*)::int FROM crm.`+table).Scan(&n)
	})
	if err != nil {
		if kit.IsMissingCrmSchema(err) {
			return 0, false, nil
		}
		return 0, false, err
	}
	return n, true, nil
}

func (h *handler) topCustomersBy(ctx context.Context, column string) ([]dashboardCustomer, error) {
	rows, err := kit.Query(ctx, h.db, `SELECT `+customerColumns+` FROM pos.pos_customers WHERE is_active = true ORDER BY `+column+` DESC LIMIT 5`)
	if err != nil {
		return nil, err
	}
	out := []dashboardCustomer{}
	for _, r := range rows {
		out = append(out, normalizeCustomer(r))
	}
	return out, nil
}

// topArkSpenders mirrors topArkSpenders: totals over the last 1000 ARK
// orders (unordered, as the TS read them), top 5 by total.
func (h *handler) topArkSpenders(ctx context.Context) ([]arkSpender, error) {
	usage, _ := h.orders.ArkUsage(ctx, h.db) // the TS ignored this read's error
	totals := map[string]float64{}
	var order []string
	for _, u := range usage {
		if _, seen := totals[u.CustomerID]; !seen {
			order = append(order, u.CustomerID)
		}
		totals[u.CustomerID] += u.ArkCoinsUsed
	}
	sort.SliceStable(order, func(i, j int) bool { return totals[order[i]] > totals[order[j]] })
	if len(order) > 5 {
		order = order[:5]
	}
	byID := map[string]dashboardCustomer{}
	if len(order) > 0 {
		rows, err := kit.Query(ctx, h.db, `SELECT `+customerColumns+` FROM pos.pos_customers WHERE id::text = ANY($1::text[])`, order)
		if err == nil {
			for _, r := range rows {
				byID[r.Str("id")] = normalizeCustomer(r)
			}
		}
	}
	out := []arkSpender{}
	for _, id := range order {
		s := arkSpender{ArkCoinsUsed: totals[id]}
		if c, ok := byID[id]; ok {
			s.Customer = &c
		}
		out = append(out, s)
	}
	return out, nil
}

// recentXPActivity mirrors recentXpActivity: the 8 newest ledger rows with
// old UUID descriptions humanized; a read failure is an empty list.
func (h *handler) recentXPActivity(ctx context.Context) []*kit.Row {
	rows, err := kit.Query(ctx, h.db, `SELECT "id", "direction", "source_channel", "source_type", "xp_delta", "balance_after",
		"description", "created_at", "reference_table", "reference_id", "metadata",
		(SELECT row_to_json(e) FROM (SELECT "member_code", "customer_id" FROM crm.crm_member_profiles
			WHERE "id" = crm_xp_ledger."member_id") e) AS "member"
		FROM crm.crm_xp_ledger ORDER BY "created_at" DESC LIMIT 8`)
	if err != nil {
		return []*kit.Row{}
	}
	ledger := make([]domain.LedgerRow, len(rows))
	for i, r := range rows {
		var amount any
		if meta, ok := r.JSON("metadata").(map[string]any); ok {
			amount = meta["amount"]
		}
		ledger[i] = domain.LedgerRow{Description: r.StrPtr("description"), ReferenceTable: r.StrPtr("reference_table"),
			ReferenceID: r.StrPtr("reference_id"), Amount: amount}
	}
	numbers := map[string]string{}
	if ids := domain.LedgerOrderIDs(ledger); len(ids) > 0 {
		numbers = h.orders.OrderNumbers(ctx, h.db, ids)
	}
	for i, r := range rows {
		if desc := domain.HumanizeLedgerDescription(ledger[i], numbers); desc != r.Str("description") {
			r.Set("description", desc)
		}
	}
	return rows
}

func (h *handler) dashboard(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.PosSession(r); err != nil {
		return err
	}
	ctx := r.Context()
	var out dashboardData
	if err := h.db.QueryRow(ctx, `SELECT count(*)::int FROM pos.pos_customers WHERE is_active = true`).Scan(&out.Stats.TotalCustomers); err != nil {
		return err
	}
	summary, err := kit.QueryOne(ctx, h.db, `SELECT
       COUNT(*) FILTER (WHERE member_type = 'card') AS card_members,
       COUNT(*) FILTER (WHERE member_type = 'registered') AS registered_members,
       COALESCE(SUM(ark_coin_balance), 0) AS ark_outstanding
     FROM pos.pos_customers WHERE is_active`)
	if err != nil {
		return err
	}
	out.Stats.CardMembers = summary.Num("card_members")
	out.Stats.RegisteredMembers = summary.Num("registered_members")
	out.Stats.ArkOutstanding = summary.Num("ark_outstanding")

	ready := true
	var memberCount int64
	for _, c := range []struct {
		table string
		dst   *int64
	}{
		{"crm_member_profiles", &memberCount}, {"crm_membership_tiers", &out.Stats.TierCount},
		{"crm_xp_rules", &out.Stats.XPRuleCount}, {"crm_rewards", &out.Stats.RewardCount},
		{"crm_collectible_avatars", &out.Stats.AvatarCount}, {"crm_redemptions", &out.Stats.RedemptionCount},
		{"crm_external_events", &out.Stats.ExternalEventCount},
	} {
		n, ok, err := countTable(ctx, h.db, c.table)
		if err != nil {
			return err
		}
		*c.dst, ready = n, ready && ok
	}
	if out.TopLoyalMembers, err = h.topCustomersBy(ctx, "total_xp"); err != nil {
		return err
	}
	if out.TopTransactionSpenders, err = h.topCustomersBy(ctx, "total_spent"); err != nil {
		return err
	}
	if out.TopArkSpenders, err = h.topArkSpenders(ctx); err != nil {
		return err
	}
	var withXP int64
	if err := h.db.QueryRow(ctx, `SELECT count(*)::int FROM pos.pos_customers WHERE is_active = true AND total_xp > 0`).Scan(&withXP); err != nil {
		return err
	}
	out.RecentXPActivity = []*kit.Row{}
	out.Stats.TotalMembers = withXP
	if ready {
		out.Stats.TotalMembers = memberCount
		out.RecentXPActivity = h.recentXPActivity(ctx)
	}
	return kit.WithMeta(w, out, ready)
}
