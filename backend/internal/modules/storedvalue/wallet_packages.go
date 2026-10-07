package storedvalue

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/storedvalue/domain"
	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Top-up packages and the online payment console (lib/wallet/topup.ts,
// lib/wallet/payments.ts).

// TopupPackage is a pos.pos_topup_packages row (PACKAGE_COLUMNS).
type TopupPackage struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	PriceIdr        float64  `json:"price_idr"`
	CreditIdr       float64  `json:"credit_idr"`
	ValidityDays    *float64 `json:"validity_days"`
	IsActive        bool     `json:"is_active"`
	AvailableOnline bool     `json:"available_online"`
	BranchIDs       []string `json:"branch_ids"`
	Sort            int      `json:"sort"`
}

const packageColumns = `id, name, description, price_idr::float AS price_idr, credit_idr::float AS credit_idr,
  validity_days::float, is_active, available_online, branch_ids::text[], sort`

func scanPackage(row pgx.Row) (TopupPackage, error) {
	var p TopupPackage
	err := row.Scan(&p.ID, &p.Name, &p.Description, &p.PriceIdr, &p.CreditIdr, &p.ValidityDays,
		&p.IsActive, &p.AvailableOnline, &p.BranchIDs, &p.Sort)
	return p, err
}

// ListPackages mirrors listPackages: admin sees all, the cashier the active
// packages sold at its branch.
func (w *Wallet) ListPackages(ctx context.Context, cashier bool, branchID *string) ([]TopupPackage, error) {
	where := ""
	if cashier {
		where = "WHERE is_active"
	}
	rows, err := w.db.Query(ctx, `SELECT `+packageColumns+` FROM pos.pos_topup_packages `+where+` ORDER BY sort, price_idr, name`)
	if err != nil {
		return nil, err
	}
	all, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (TopupPackage, error) { return scanPackage(r) })
	if err != nil {
		return nil, err
	}
	out := []TopupPackage{}
	for _, p := range all {
		if !cashier || domain.PackageAvailableAt(p.IsActive, p.BranchIDs, branchID) {
			out = append(out, p)
		}
	}
	return out, nil
}

// PackageInput is packageInputSchema's output.
type PackageInput struct {
	Name            string
	Description     string
	PriceIdr        int
	CreditIdr       int
	ValidityDays    *int
	IsActive        bool
	AvailableOnline bool
	BranchIDs       []string
	Sort            int
}

// SavePackage mirrors savePackage: insert when id is empty, else update
// (404 "Paket tidak ditemukan").
func (w *Wallet) SavePackage(ctx context.Context, id string, in PackageInput, actorID string) (TopupPackage, error) {
	var branchIDs any
	if len(in.BranchIDs) > 0 {
		branchIDs = in.BranchIDs
	}
	args := []any{in.Name, in.Description, in.PriceIdr, in.CreditIdr, in.ValidityDays, in.IsActive,
		in.AvailableOnline, branchIDs, in.Sort, actorID}
	var row pgx.Row
	if id != "" {
		row = w.db.QueryRow(ctx,
			`UPDATE pos.pos_topup_packages
			    SET name=$1, description=$2, price_idr=$3, credit_idr=$4, validity_days=$5, is_active=$6,
			        available_online=$7, branch_ids=$8::uuid[], sort=$9, updated_by=$10, updated_at=now()
			  WHERE id=$11 RETURNING `+packageColumns, append(args, id)...)
	} else {
		row = w.db.QueryRow(ctx,
			`INSERT INTO pos.pos_topup_packages
			   (name, description, price_idr, credit_idr, validity_days, is_active, available_online, branch_ids,
			    sort, created_by, updated_by)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8::uuid[],$9,$10,$10) RETURNING `+packageColumns, args...)
	}
	p, err := scanPackage(row)
	if database.IsNoRows(err) {
		return p, httpx.NotFound("Paket tidak ditemukan")
	}
	return p, err
}

// DeactivatePackage mirrors deactivatePackage.
func (w *Wallet) DeactivatePackage(ctx context.Context, id, actorID string) error {
	tag, err := w.db.Exec(ctx,
		`UPDATE pos.pos_topup_packages SET is_active = false, updated_by = $2, updated_at = now() WHERE id = $1`, id, actorID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Paket tidak ditemukan")
	}
	return nil
}

// packageForSale mirrors getPackageForSale for the cashier channel.
func (w *Wallet) packageForSale(ctx context.Context, id string, branchID *string) (*TopupPackage, error) {
	p, err := scanPackage(w.db.QueryRow(ctx, `SELECT `+packageColumns+` FROM pos.pos_topup_packages WHERE id = $1`, id))
	if database.IsNoRows(err) || (err == nil && !domain.PackageAvailableAt(p.IsActive, p.BranchIDs, branchID)) {
		return nil, httpx.NotFound("Paket top-up tidak tersedia")
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// packageTopup is packageTopupFields: price paid, bonus and the metadata
// the top-up row carries.
type packageTopup struct {
	Amount   float64
	Bonus    float64
	Metadata map[string]any
}

func packageTopupFields(p *TopupPackage) packageTopup {
	bonus := domain.PackageBonus(p.PriceIdr, p.CreditIdr)
	return packageTopup{
		Amount: p.PriceIdr,
		Bonus:  bonus,
		Metadata: map[string]any{
			"package_id": p.ID, "package_name": p.Name, "bonus_idr": bonus, "validity_days": p.ValidityDays,
		},
	}
}

// creditTopupBonus mirrors creditTopupBonus: the package bonus is its own
// lot (topup_bonus) with the same expiry.
func creditTopupBonus(ctx context.Context, q database.Querier, customerID, topupID string, bonusIdr float64,
	expiresAt *time.Time, packageMeta map[string]any, arkRate float64, companyID, branchID *string) (float64, error) {
	customer, err := lockCustomer(ctx, q, customerID)
	if err != nil {
		return 0, err
	}
	after := domain.RoundIdr(customer.Balance + bonusIdr)
	meta := map[string]any{}
	for k, v := range packageMeta {
		meta[k] = v
	}
	meta["source_topup_id"] = topupID
	name := ""
	if v, has := packageMeta["package_name"]; has && v != nil {
		name = domain.JSString(v)
	}
	pkgID := ""
	if v, has := packageMeta["package_id"]; has && v != nil {
		pkgID = domain.JSString(v)
	}
	row := newWalletRow{
		CustomerID: customerID, Type: "topup_bonus", Amount: bonusIdr,
		BalanceBefore: customer.Balance, BalanceAfter: after, ArkRate: arkRate,
		Notes: strings.TrimSpace("Bonus paket " + name), Metadata: meta,
		ExpiresAt: expiresAt, PackageID: kit.NullIfEmpty(pkgID), CompanyID: companyID, BranchID: branchID,
	}
	if _, err := insertWalletRow(ctx, q, row); err != nil {
		return 0, err
	}
	return after, setCustomerBalance(ctx, q, customerID, after)
}
