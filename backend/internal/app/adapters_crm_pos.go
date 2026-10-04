package app

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/crm"
	"nuhabit/backend/internal/modules/crm/xp"
	xpdomain "nuhabit/backend/internal/modules/crm/xp/domain"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// crmLoyaltyForPos adapts the CRM XP engine to the XP part of pos-sales'
// Loyalty port (AwardOrderXP, AwardSplitXP, TotalXP, ArkCoinEnabled,
// CheckProductPrivileges). pos-sales wires it, adding its own
// ValidateKolComp, e.g. struct{ crmLoyaltyForPos; kolComp }.
// The engine awards inside a savepoint on the sale's transaction, so a
// failed award never aborts the sale (status "error" in the result).
type crmLoyaltyForPos struct{ engine *xp.Engine }

func newCrmLoyaltyForPos(d module.Deps) crmLoyaltyForPos {
	return crmLoyaltyForPos{engine: crm.NewEngine(d, crmPosReads{})}
}

func asDB(q database.Querier) (database.DB, error) {
	db, ok := q.(database.DB)
	if !ok {
		return nil, fmt.Errorf("crm loyalty: querier %T cannot open a savepoint", q)
	}
	return db, nil
}

func xpAward(r xp.Result) ports.XPAward {
	return ports.XPAward{Status: r.Status, XPAwarded: r.XPAwarded, Reason: r.Reason, LedgerIDs: r.LedgerIDs}
}

// AwardOrderXP is awardCrmXpForPosOrder.
func (a crmLoyaltyForPos) AwardOrderXP(ctx context.Context, q database.Querier, in ports.OrderXP) (ports.XPAward, error) {
	db, err := asDB(q)
	if err != nil {
		return ports.XPAward{}, err
	}
	items := make([]xpdomain.Item, len(in.Items))
	for i, it := range in.Items {
		items[i] = xpdomain.Item{ProductID: it.ProductID, Quantity: it.Quantity, TotalAmount: it.TotalAmount, Subtotal: it.Subtotal, UnitPrice: it.UnitPrice}
	}
	return xpAward(a.engine.AwardPosOrder(ctx, db, xp.PosOrder{
		OrderID: in.OrderID, CustomerID: in.CustomerID, TotalAmount: in.TotalAmount, Items: items,
		OutletID: in.OutletID, PaymentMethod: in.PaymentMethod,
	})), nil
}

// AwardSplitXP is awardCrmXpForSplitPayment.
func (a crmLoyaltyForPos) AwardSplitXP(ctx context.Context, q database.Querier, in ports.SplitXP) (ports.XPAward, error) {
	db, err := asDB(q)
	if err != nil {
		return ports.XPAward{}, err
	}
	return xpAward(a.engine.AwardSplitPayment(ctx, db, xp.SplitPayment{
		OrderID: in.OrderID, SplitID: in.SplitID, CustomerID: in.CustomerID, TotalAmount: in.TotalAmount,
		OutletID: in.OutletID, PaymentMethod: in.PaymentMethod,
	})), nil
}

// TotalXP is pos_customers.total_xp (nil when the customer is unknown).
func (crmLoyaltyForPos) TotalXP(ctx context.Context, q database.Querier, customerID string) (*float64, error) {
	var v *float64
	err := q.QueryRow(ctx, `SELECT total_xp::float8 FROM pos.pos_customers WHERE id = $1`, customerID).Scan(&v)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return v, err
}

// ArkCoinEnabled is getLoyaltyFeatures().arkCoin: enabled unless
// crm_settings.ark_coin_enabled says otherwise; read failures keep it on.
func (crmLoyaltyForPos) ArkCoinEnabled(ctx context.Context, q database.Querier) bool {
	var raw *string
	err := readInSavepoint(ctx, q, func(q database.Querier) error {
		return q.QueryRow(ctx, `SELECT value #>> '{}' FROM crm.crm_settings WHERE key = 'ark_coin_enabled'`).Scan(&raw)
	})
	if err != nil || raw == nil {
		return true
	}
	switch *raw {
	case "false", "0":
		return false
	}
	return true
}

// CheckProductPrivileges is lib/crm/product-privilege.ts: products with a
// min_xp need a member whose lifetime XP reaches it (XP is not deducted).
func (crmLoyaltyForPos) CheckProductPrivileges(ctx context.Context, q database.Querier, productIDs []string, customerID string) (bool, string, error) {
	seen := map[string]bool{}
	var ids []string
	for _, id := range productIDs {
		if id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return true, "", nil
	}
	type product struct {
		name  string
		minXP float64
	}
	var privileged []product
	err := readInSavepoint(ctx, q, func(q database.Querier) error {
		rows, err := q.Query(ctx, `SELECT name, min_xp::float8 FROM pos.pos_products
			WHERE id::text = ANY($1::text[]) AND min_xp IS NOT NULL AND min_xp > 0`, ids)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var p product
			var name *string
			if err := rows.Scan(&name, &p.minXP); err != nil {
				return err
			}
			if name != nil {
				p.name = *name
			}
			privileged = append(privileged, p)
		}
		return rows.Err()
	})
	if err != nil {
		// The TS ignored the query error (data null): nothing privileged.
		return true, "", nil
	}
	if len(privileged) == 0 {
		return true, "", nil
	}
	names := make([]string, len(privileged))
	for i, p := range privileged {
		names[i] = p.name
	}
	if customerID == "" {
		return false, "Produk khusus member (" + strings.Join(names, ", ") + ") — pilih member terlebih dulu", nil
	}
	var total float64
	var v *float64
	if err := q.QueryRow(ctx, `SELECT total_xp::float8 FROM pos.pos_customers WHERE id::text = $1`, customerID).Scan(&v); err == nil && v != nil {
		total = *v
	}
	var blocked []string
	for _, p := range privileged {
		if total < p.minXP {
			blocked = append(blocked, fmt.Sprintf("%s (butuh %s XP)", p.name, jsNumber(p.minXP)))
		}
	}
	if len(blocked) == 0 {
		return true, "", nil
	}
	return false, "XP member belum cukup untuk: " + strings.Join(blocked, ", ") + ". XP member saat ini: " + jsNumber(total) + ".", nil
}

// jsNumber formats like String(number) for the values these messages carry.
func jsNumber(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
