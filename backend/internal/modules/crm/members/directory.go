package members

import (
	"context"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/members/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// profileSelect is the shim's `*, tier:crm_membership_tiers(<cols>)` select
// on crm_member_profiles.
func profileSelect(tierCols string) string {
	return `SELECT *, (SELECT row_to_json(e) FROM (SELECT ` + tierCols + ` FROM "crm"."crm_membership_tiers"
		WHERE "id" = "crm_member_profiles"."tier_id") e) AS "tier" FROM crm.crm_member_profiles`
}

var listProfileSelect = profileSelect(`"id", "code", "name", "rank", "xp_multiplier", "discount_percent"`)

// profileOut mirrors profileFields: the profile fields shared by the list
// and the detail.
type profileOut struct {
	ID             string  `json:"id"`
	CustomerID     string  `json:"customer_id"`
	MemberCode     any     `json:"member_code"`
	Tier           any     `json:"tier"`
	LifetimeXP     float64 `json:"lifetime_xp"`
	LoyaltyScore   float64 `json:"loyalty_score"`
	ActiveAvatarID any     `json:"active_avatar_id"`
	JoinedAt       any     `json:"joined_at"`
	LastActivityAt any     `json:"last_activity_at"`
	Status         any     `json:"status"`
	Metadata       any     `json:"metadata"`
}

func newProfileOut(p *kit.Row) profileOut {
	meta := p.Get("metadata")
	if meta == nil {
		meta = struct{}{}
	}
	return profileOut{
		ID: p.Str("id"), CustomerID: p.Str("customer_id"), MemberCode: p.Get("member_code"),
		Tier: p.Get("tier"), LifetimeXP: p.Num("lifetime_xp"), LoyaltyScore: p.Num("loyalty_score"),
		ActiveAvatarID: p.Get("active_avatar_id"), JoinedAt: p.Get("joined_at"),
		LastActivityAt: p.Get("last_activity_at"), Status: p.Get("status"), Metadata: meta,
	}
}

type listMemberOut struct {
	profileOut
	Source   string                     `json:"source"`
	Customer *domain.NormalizedCustomer `json:"customer"`
}

func listMember(p *kit.Row, c *domain.Customer) listMemberOut {
	out := listMemberOut{profileOut: newProfileOut(p), Source: "crm_member_profiles"}
	if c != nil {
		n := domain.NormalizeCustomer(*c)
		out.Customer = &n
	}
	return out
}

type syntheticListOut struct {
	domain.SyntheticBase
	Status   string                    `json:"status"`
	Source   string                    `json:"source"`
	Customer domain.NormalizedCustomer `json:"customer"`
}

func syntheticListMember(c domain.Customer) syntheticListOut {
	n := domain.NormalizeCustomer(c)
	return syntheticListOut{SyntheticBase: domain.NewSyntheticBase(n), Status: domain.ActiveStatus(n), Source: "pos_customers", Customer: n}
}

func queryCustomers(ctx context.Context, q database.Querier, columns, where string, args ...any) ([]domain.Customer, error) {
	rows, err := q.Query(ctx, `SELECT `+columns+` FROM pos.pos_customers `+where, args...)
	if err != nil {
		return nil, err
	}
	detail := columns != domain.CustomerColumns
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Customer, error) {
		var c domain.Customer
		targets := c.ScanTargets()
		if detail {
			targets = append(targets, &c.IsKol, &c.KolMonthlyLimitIdr)
		}
		return c, r.Scan(targets...)
	})
}

// savepointQuery runs kit.Query in a savepoint so a failure the caller
// recovers from (a missing CRM table) leaves its transaction usable.
func savepointQuery(ctx context.Context, db database.DB, sql string, args ...any) ([]*kit.Row, error) {
	var rows []*kit.Row
	err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
		var err error
		rows, err = kit.Query(ctx, tx, sql, args...)
		return err
	})
	return rows, err
}

// GET /api/crm/members?search&tier&limit
func (h *handler) list(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.PosSession(r); err != nil {
		return err
	}
	q := r.URL.Query()
	data, ready, err := h.listMembers(r.Context(), q.Get("search"), q.Get("tier"), q.Get("limit"))
	if err != nil {
		return err
	}
	return kit.WithMeta(w, data, ready)
}

// listMembers mirrors listMembers in member-directory-server.ts: CRM
// profiles by lifetime XP, searchable by member code and customer
// name/phone/email; active POS customers stand in as synthetic members when
// there is no profile (or no CRM schema, schemaReady false).
func (h *handler) listMembers(ctx context.Context, search, tier, rawLimit string) (any, bool, error) {
	limitN := domain.ListLimit(rawLimit)
	limit := domain.JSString(limitN)
	customerSearch := ""
	if search != "" {
		customerSearch = "name.ilike.%" + search + "%,phone.ilike.%" + search + "%,email.ilike.%" + search + "%"
	}

	var tierID *string
	if tier != "" {
		rows, err := savepointQuery(ctx, h.db, `SELECT "id" FROM crm.crm_membership_tiers WHERE "code" = $1`, tier)
		if err != nil && !kit.IsMissingCrmSchema(err) {
			return nil, false, err
		}
		if len(rows) > 0 {
			tierID = rows[0].StrPtr("id")
		}
	}

	profileQuery := func(filter string, arg any) ([]*kit.Row, error) {
		var where []string
		var args []any
		if tierID != nil {
			args = append(args, *tierID)
			where = append(where, `"tier_id" = $1`)
		}
		if filter != "" {
			args = append(args, arg)
			where = append(where, strings.ReplaceAll(filter, "$?", "$"+strconv.Itoa(len(args))))
		}
		sql := listProfileSelect
		if len(where) > 0 {
			sql += " WHERE " + strings.Join(where, " AND ")
		}
		args = append(args, limit)
		sql += ` ORDER BY "lifetime_xp" DESC LIMIT $` + strconv.Itoa(len(args)) + `::text::bigint`
		return savepointQuery(ctx, h.db, sql, args...)
	}

	customerFallback := func(orderBy string) ([]syntheticListOut, error) {
		args := []any{true}
		where := []string{`"is_active" = $1`}
		if tier != "" {
			args = append(args, tier)
			where = append(where, `"membership_tier" = $2`)
		}
		if customerSearch != "" {
			where = append(where, shimOr(customerSearch, &args))
		}
		args = append(args, limit)
		customers, err := queryCustomers(ctx, h.db, domain.CustomerColumns,
			`WHERE `+strings.Join(where, " AND ")+` ORDER BY "`+orderBy+`" DESC LIMIT $`+strconv.Itoa(len(args))+`::text::bigint`, args...)
		if err != nil {
			return nil, err
		}
		out := make([]syntheticListOut, len(customers))
		for i, c := range customers {
			out[i] = syntheticListMember(c)
		}
		return out, nil
	}

	var profiles []*kit.Row
	var profileErr error
	if customerSearch != "" {
		var matchedIDs []string
		quietly(ctx, h.db, func(q database.Querier) error {
			var args []any
			where := shimOr(customerSearch, &args)
			rows, err := q.Query(ctx, `SELECT "id"::text FROM pos.pos_customers WHERE `+where+` LIMIT 200`, args...)
			if err != nil {
				return err
			}
			matchedIDs, err = pgx.CollectRows(rows, pgx.RowTo[string])
			return err
		})
		byCode, err := profileQuery(`"member_code" ILIKE $?`, "%"+search+"%")
		if err != nil {
			profileErr = err
		} else {
			merged := byCode
			index := map[string]int{}
			for i, row := range byCode {
				index[row.Str("id")] = i
			}
			if len(matchedIDs) > 0 {
				byCustomer, err := profileQuery(`"customer_id" = ANY($?::uuid[])`, matchedIDs)
				if err != nil {
					profileErr = err
				}
				for _, row := range byCustomer {
					if i, ok := index[row.Str("id")]; ok {
						merged[i] = row
						continue
					}
					index[row.Str("id")] = len(merged)
					merged = append(merged, row)
				}
			}
			if profileErr == nil {
				sort.SliceStable(merged, func(i, j int) bool { return merged[i].Num("lifetime_xp") > merged[j].Num("lifetime_xp") })
				profiles = merged[:sliceEnd(len(merged), limitN)]
			}
		}
	} else {
		profiles, profileErr = profileQuery("", nil)
	}

	if profileErr != nil {
		if !kit.IsMissingCrmSchema(profileErr) {
			return nil, false, profileErr
		}
		data, err := customerFallback("total_xp")
		return data, false, err
	}
	if len(profiles) == 0 {
		data, err := customerFallback("total_spent")
		return data, true, err
	}

	ids := make([]string, len(profiles))
	for i, p := range profiles {
		ids[i] = p.Str("customer_id")
	}
	byID := map[string]domain.Customer{}
	quietly(ctx, h.db, func(q database.Querier) error {
		customers, err := queryCustomers(ctx, q, domain.CustomerColumns, `WHERE "id" = ANY($1::uuid[])`, ids)
		for _, c := range customers {
			byID[c.ID] = c
		}
		return err
	})
	out := make([]listMemberOut, len(profiles))
	for i, p := range profiles {
		var c *domain.Customer
		if found, ok := byID[p.Str("customer_id")]; ok {
			c = &found
		}
		out[i] = listMember(p, c)
	}
	return out, true, nil
}

// sliceEnd is the end index of Array.slice(0, limit).
func sliceEnd(n int, limit float64) int {
	if math.IsNaN(limit) || limit <= 0 {
		return 0
	}
	if limit < float64(n) {
		return int(limit)
	}
	return n
}

// POST /api/crm/members
func (h *handler) enroll(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.PosSession(r); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	customerID := f.UUID("customer_id", validate.Rule{})
	tierCode := f.Str("tier_code", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Min: 1, Max: 40})
	metadata := kit.RecordDefault(f, "metadata")
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	var data listMemberOut
	err = database.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		data, err = h.enrollMember(r.Context(), tx, *customerID, tierCode, metadata)
		return err
	})
	if err != nil {
		return err
	}
	return kit.OK(w, data)
}

// enrollMember mirrors enrollMember: enrol a POS customer on the requested
// tier (else the customer's tier, else regular, falling back to regular).
func (h *handler) enrollMember(ctx context.Context, tx pgx.Tx, customerID string, tierCode *string, metadata map[string]any) (listMemberOut, error) {
	customers, err := queryCustomers(ctx, tx, domain.CustomerColumns, `WHERE "id" = $1`, customerID)
	if err != nil {
		return listMemberOut{}, err
	}
	if len(customers) == 0 {
		return listMemberOut{}, httpx.NotFound("Customer tidak ditemukan")
	}
	customer := customers[0]
	code := "regular"
	switch {
	case tierCode != nil:
		code = *tierCode
	case customer.MembershipTier != nil:
		code = *customer.MembershipTier
	}
	code = strings.ToLower(code)

	const tierSQL = `SELECT "id"::text FROM crm.crm_membership_tiers WHERE "code" = $1 LIMIT 1`
	var tierID string
	err = tx.QueryRow(ctx, tierSQL, code).Scan(&tierID)
	if err != nil && !database.IsNoRows(err) {
		return listMemberOut{}, kit.CrmSchemaError(err)
	}
	if tierID == "" && code != "regular" {
		if err := tx.QueryRow(ctx, tierSQL, "regular").Scan(&tierID); err != nil && !database.IsNoRows(err) {
			return listMemberOut{}, err
		}
	}
	if tierID == "" {
		return listMemberOut{}, httpx.NotFound("Tier CRM tidak ditemukan")
	}

	totalXP := domain.NormalizeCustomer(customer).TotalXP
	profile, err := kit.Upsert(ctx, tx, "crm.crm_member_profiles", "customer_id", []kit.Col{
		{Name: "customer_id", Value: customerID},
		{Name: "tier_id", Value: tierID},
		{Name: "lifetime_xp", Value: int64(totalXP)},
		{Name: "loyalty_score", Value: totalXP},
		{Name: "status", Value: "active"},
		{Name: "metadata", Value: kit.JSONText(metadata)},
		{Name: "last_activity_at", Value: h.now()},
	})
	if err != nil {
		return listMemberOut{}, err
	}
	return listMember(profile, &customer), nil
}
