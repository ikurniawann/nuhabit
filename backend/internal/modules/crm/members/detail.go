package members

import (
	"context"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/members/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

var (
	detailProfileSelect = profileSelect(`"id", "code", "name", "rank", "xp_multiplier", "discount_percent", "min_lifetime_xp", "min_total_spend"`)
	// detailCustomerColumns adds the KOL flag so the edit form does not
	// overwrite it with an empty value.
	detailCustomerColumns = domain.CustomerColumns + `, is_kol, kol_monthly_limit_idr::float8`
)

type detailMemberOut struct {
	profileOut
	Customer *domain.DetailCustomer `json:"customer"`
}

type syntheticDetailOut struct {
	domain.SyntheticBase
	ActiveAvatarID any                   `json:"active_avatar_id"`
	JoinedAt       any                   `json:"joined_at"`
	LastActivityAt any                   `json:"last_activity_at"`
	Status         string                `json:"status"`
	Metadata       struct{}              `json:"metadata"`
	Customer       domain.DetailCustomer `json:"customer"`
}

// detailOut is loadMemberDetail's result.
type detailOut struct {
	Member       any        `json:"member"`
	XPLedger     []*kit.Row `json:"xpLedger"`
	RecentOrders []*kit.Row `json:"recentOrders"`
}

// findProfile mirrors findProfile: the profile by profile id or customer id;
// 409 when the CRM schema is missing.
func findProfile(ctx context.Context, q database.Querier, id string) (*kit.Row, error) {
	row, err := kit.QueryOne(ctx, q, detailProfileSelect+` WHERE ("id" = $1 OR "customer_id" = $1)`, id)
	if err != nil && kit.IsMissingCrmSchema(err) {
		return nil, httpx.Conflict("CRM schema belum aktif")
	}
	return row, err
}

// findCustomer reads the detail customer; the id is cast server-side so a
// malformed id fails as 22P02 like node-postgres.
func findCustomer(ctx context.Context, q database.Querier, customerID string) (*domain.Customer, error) {
	customers, err := queryCustomers(ctx, q, detailCustomerColumns, `WHERE "id" = $1::text::uuid`, customerID)
	if err != nil || len(customers) == 0 {
		return nil, err
	}
	return &customers[0], nil
}

func (h *handler) recentOrders(ctx context.Context, db database.DB, customerID string) []*kit.Row {
	orders := []*kit.Row{}
	quietly(ctx, db, func(q database.Querier) error {
		rows, err := h.ports.Orders.RecentOrders(ctx, q, customerID)
		if rows != nil {
			orders = rows
		}
		return err
	})
	return orders
}

// syntheticDetail is the detail of a customer without a CRM profile; 404
// when the customer does not exist either.
func (h *handler) syntheticDetail(ctx context.Context, db database.DB, customerID string) (detailOut, error) {
	c, err := findCustomer(ctx, db, customerID)
	if err != nil {
		return detailOut{}, err
	}
	if c == nil {
		return detailOut{}, httpx.NotFound("Member tidak ditemukan")
	}
	dc := domain.NewDetailCustomer(*c)
	member := syntheticDetailOut{
		SyntheticBase: domain.NewSyntheticBase(dc.NormalizedCustomer),
		Status:        domain.ActiveStatus(dc.NormalizedCustomer),
		Customer:      dc,
	}
	return detailOut{Member: member, XPLedger: []*kit.Row{}, RecentOrders: h.recentOrders(ctx, db, customerID)}, nil
}

// detailMember mirrors detailMember; the customer read ignores errors.
func detailMember(ctx context.Context, db database.DB, profile *kit.Row) detailMemberOut {
	out := detailMemberOut{profileOut: newProfileOut(profile)}
	quietly(ctx, db, func(q database.Querier) error {
		c, err := findCustomer(ctx, q, profile.Str("customer_id"))
		if c != nil {
			dc := domain.NewDetailCustomer(*c)
			out.Customer = &dc
		}
		return err
	})
	return out
}

// GET /api/crm/members/{id}
func (h *handler) detail(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.PosSession(r); err != nil {
		return err
	}
	data, err := h.loadMemberDetail(r.Context(), h.db, r.PathValue("id"))
	if err != nil {
		return err
	}
	return kit.WithMeta(w, data, true)
}

// loadMemberDetail mirrors loadMemberDetail: profile, customer, the last 50
// XP ledger rows and the last 10 orders.
func (h *handler) loadMemberDetail(ctx context.Context, db database.DB, id string) (detailOut, error) {
	if !domain.IsUUIDv1to5(id) {
		return h.syntheticDetail(ctx, db, domain.CustomerIDOf(id))
	}
	profile, err := findProfile(ctx, db, id)
	if err != nil {
		return detailOut{}, err
	}
	if profile == nil {
		return h.syntheticDetail(ctx, db, domain.CustomerIDOf(id))
	}
	member := detailMember(ctx, db, profile)
	ledger, err := kit.Query(ctx, db, `SELECT "id", "direction", "source_channel", "source_type", "source_id", "xp_delta",
		"balance_after", "description", "reference_table", "reference_id", "created_at"
		FROM crm.crm_xp_ledger WHERE "member_id" = $1 ORDER BY "created_at" DESC LIMIT 50`, profile.Str("id"))
	if err != nil {
		return detailOut{}, err
	}
	for _, row := range ledger {
		row.Set("xp_delta", row.Num("xp_delta"))
		row.Set("balance_after", row.Num("balance_after"))
	}
	return detailOut{Member: member, XPLedger: ledger, RecentOrders: h.recentOrders(ctx, db, profile.Str("customer_id"))}, nil
}

// zod v4's email regex without its two lookaheads, which checkEmail applies.
var emailPattern = regexp.MustCompile(`^([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`)

func isEmail(s string) bool {
	return !strings.HasPrefix(s, ".") && !strings.Contains(s, "..") && emailPattern.MatchString(s)
}

// optChild validates an optional nested object: nil when absent.
func optChild(f *validate.Form, key string) *validate.Form {
	if f.Fields() == nil {
		return nil
	}
	if _, sent := f.Fields()[key]; !sent {
		return nil
	}
	return f.Child(key)
}

// memberUpdate is the parsed updateMemberSchema: payload columns in schema
// order, plus whether each object was sent.
type memberUpdate struct {
	customer   []kit.Col
	emailSent  bool
	memberSent bool
	member     []kit.Col
	tierID     *string
}

func parseMemberUpdate(f *validate.Form) memberUpdate {
	var u memberUpdate
	if c := optChild(f, "customer"); c != nil {
		sent := func(key string) bool {
			_, ok := c.Fields()[key]
			return ok
		}
		if s := c.Str("name", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Min: 1, Max: 160}); s != nil {
			u.customer = append(u.customer, kit.Col{Name: "name", Value: *s})
		}
		if s := c.Str("phone", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Trim: true, Max: 40}); s != nil || sent("phone") {
			u.customer = append(u.customer, kit.Col{Name: "phone", Value: s})
		}
		if sent("email") {
			u.emailSent = true
			// The TS writes "" as NULL; its position follows the schema.
			var v any
			if email := parseEmail(c); email != nil && *email != "" {
				v = *email
			}
			u.customer = append(u.customer, kit.Col{Name: "email", Value: v})
		}
		for _, key := range []string{"is_active", "is_kol"} {
			if b := c.Bool(key, validate.Rule{Optional: true}); b != nil {
				u.customer = append(u.customer, kit.Col{Name: key, Value: *b})
			}
		}
		limit := c.Num("kol_monthly_limit_idr", validate.Rule{Optional: true, Nullable: true},
			validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(999_999_999)})
		if limit != nil || sent("kol_monthly_limit_idr") {
			u.customer = append(u.customer, kit.Col{Name: "kol_monthly_limit_idr", Value: limit})
		}
	}
	if m := optChild(f, "member"); m != nil {
		u.memberSent = true
		if id := m.UUID("tier_id", validate.Rule{Optional: true}); id != nil {
			u.tierID = id
			u.member = append(u.member, kit.Col{Name: "tier_id", Value: *id})
		}
		if s := m.Enum("status", validate.Rule{Optional: true}, []string{"active", "inactive", "suspended", "merged"}); s != nil {
			u.member = append(u.member, kit.Col{Name: "status", Value: *s})
		}
	}
	return u
}

// parseEmail validates z.string().trim().email().or(z.literal("")).nullable():
// nil for null. A string that is not an email fails with the email issue (the
// one non-aborted union branch), anything else with invalid_union.
func parseEmail(c *validate.Form) *string {
	v := c.Fields()["email"]
	if v == nil {
		return nil
	}
	s, ok := v.(string)
	if !ok {
		c.Fail("email", "invalid_union", "Invalid input")
		return nil
	}
	trimmed := validate.JSTrim(s)
	switch {
	case isEmail(trimmed):
		return &trimmed
	case s == "":
		return &s
	}
	c.Fail("email", "invalid_format", "Invalid email address")
	return nil
}

// PATCH /api/crm/members/{id}
func (h *handler) update(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.PosSession(r); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	u := parseMemberUpdate(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	var data any
	err = database.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		data, err = h.updateMemberDetail(r.Context(), tx, r.PathValue("id"), u)
		return err
	})
	if err != nil {
		return err
	}
	return kit.WithMeta(w, data, true)
}

// updateMemberDetail mirrors updateMemberDetail: edit the customer and/or
// the profile; a tier change copies the tier code to pos_customers. It
// returns the fresh member (the full synthetic detail for a customer
// without a profile).
func (h *handler) updateMemberDetail(ctx context.Context, tx pgx.Tx, id string, u memberUpdate) (any, error) {
	var profile *kit.Row
	if domain.IsUUIDv1to5(id) {
		var err error
		if profile, err = findProfile(ctx, tx, id); err != nil {
			return nil, err
		}
	}
	customerID := domain.CustomerIDOf(id)
	if profile != nil {
		customerID = profile.Str("customer_id")
	}

	if len(u.customer) > 0 {
		cols := u.customer
		if !u.emailSent {
			// `{ ...payload.customer, email: undefined }`: the shim writes
			// the absent email as NULL (a TS quirk kept for parity).
			cols = append(cols, kit.Col{Name: "email", Value: nil})
		}
		if err := updateCustomer(ctx, tx, cols, customerID); err != nil {
			return nil, err
		}
	}

	if u.memberSent && profile != nil {
		cols := append(append([]kit.Col{}, u.member...), kit.Col{Name: "last_activity_at", Value: h.now()})
		if _, err := kit.Update(ctx, tx, "crm.crm_member_profiles", cols, "id", profile.Str("id")); err != nil {
			return nil, err
		}
	}

	if u.tierID != nil {
		quietly(ctx, tx, func(q database.Querier) error {
			var code *string
			if err := q.QueryRow(ctx, `SELECT "code" FROM crm.crm_membership_tiers WHERE "id" = $1`, *u.tierID).Scan(&code); err != nil {
				return err
			}
			if code == nil || *code == "" {
				return nil
			}
			return updateCustomer(ctx, q, []kit.Col{{Name: "membership_tier", Value: *code}}, customerID)
		})
	}

	detailID := customerID
	switch {
	case profile != nil:
		detailID = profile.Str("id")
	case strings.HasPrefix(id, "pos-"):
		detailID = id
	}
	if !domain.IsUUIDv1to5(detailID) {
		return h.syntheticDetail(ctx, tx, domain.CustomerIDOf(detailID))
	}
	updated, err := findProfile(ctx, tx, detailID)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return h.syntheticDetail(ctx, tx, domain.CustomerIDOf(detailID))
	}
	return struct {
		Member detailMemberOut `json:"member"`
	}{detailMember(ctx, tx, updated)}, nil
}

// updateCustomer is the shim's update(cols).eq("id", customerID) on
// pos_customers, with the id cast server-side like node-postgres.
func updateCustomer(ctx context.Context, q database.Querier, cols []kit.Col, customerID string) error {
	sets := make([]string, len(cols))
	args := make([]any, 0, len(cols)+1)
	for i, c := range cols {
		args = append(args, c.Value)
		sets[i] = quoteIdent(c.Name) + " = $" + strconv.Itoa(i+1)
	}
	args = append(args, customerID)
	_, err := q.Exec(ctx, `UPDATE pos.pos_customers SET `+strings.Join(sets, ", ")+` WHERE "id" = $`+strconv.Itoa(len(args))+`::text::uuid`, args...)
	return err
}
