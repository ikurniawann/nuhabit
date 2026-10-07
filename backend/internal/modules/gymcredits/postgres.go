package gymcredits

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcredits/domain"
	"nuhabit/backend/internal/platform/database"
)

// Postgres is the Repository over the gym credit tables. The SQL is ported
// from the TS libs; it touches only gym.credit_* and gym.business_rules.
type Postgres struct{}

var _ Repository = Postgres{}

// null maps "" to SQL NULL.
func null(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// LockMemberCredits serializes credit mutations of one member until the
// transaction ends (same key as the TS lockMemberCredits).
func (Postgres) LockMemberCredits(ctx context.Context, q database.Querier, customerID string) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('gym-credits:' || $1::text))`, customerID)
	return err
}

func (Postgres) Lots(ctx context.Context, q database.Querier, customerID string) ([]domain.Lot, error) {
	rows, err := q.Query(ctx,
		`SELECT id, package_id, credits, expires_at, created_at FROM gym.credit_lots WHERE customer_id = $1`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Lot, error) {
		var l domain.Lot
		var pkg *string
		err := row.Scan(&l.ID, &pkg, &l.Credits, &l.ExpiresAt, &l.CreatedAt)
		l.PackageID = deref(pkg)
		l.ExpiresAt = l.ExpiresAt.Truncate(time.Millisecond)
		l.CreatedAt = l.CreatedAt.Truncate(time.Millisecond)
		return l, err
	})
}

func (Postgres) Entries(ctx context.Context, q database.Querier, customerID string) ([]domain.Entry, error) {
	rows, err := q.Query(ctx,
		`SELECT id, type, amount, lot_id, reverses_entry_id, source_type, source_id, created_at
		   FROM gym.credit_ledger WHERE customer_id = $1 ORDER BY created_at, id`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanEntry)
}

func scanEntry(row pgx.CollectableRow) (domain.Entry, error) {
	var e domain.Entry
	var lot, reverses, sourceType, sourceID *string
	err := row.Scan(&e.ID, &e.Type, &e.Amount, &lot, &reverses, &sourceType, &sourceID, &e.CreatedAt)
	e.LotID, e.ReversesEntryID = deref(lot), deref(reverses)
	e.SourceType, e.SourceID = deref(sourceType), deref(sourceID)
	e.CreatedAt = e.CreatedAt.Truncate(time.Millisecond)
	return e, err
}

func (Postgres) InsertEntry(ctx context.Context, q database.Querier, e NewEntry) (string, error) {
	var id string
	err := q.QueryRow(ctx,
		`INSERT INTO gym.credit_ledger
		   (customer_id, type, amount, lot_id, source_type, source_id, reverses_entry_id, note, idempotency_key, created_by)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		 ON CONFLICT (idempotency_key) DO NOTHING
		 RETURNING id`,
		e.CustomerID, string(e.Type), e.Amount, null(e.LotID), null(e.SourceType), null(e.SourceID),
		null(e.ReversesEntryID), null(e.Note), null(e.IdempotencyKey), null(e.CreatedBy),
	).Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

func (Postgres) EntryIDByKey(ctx context.Context, q database.Querier, key string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id FROM gym.credit_ledger WHERE idempotency_key = $1`, key).Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

func (Postgres) InsertLot(ctx context.Context, q database.Querier, l NewLot) (string, error) {
	var id string
	err := q.QueryRow(ctx,
		`INSERT INTO gym.credit_lots (customer_id, package_id, purchase_id, credits, expires_at)
		 VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		l.CustomerID, null(l.PackageID), null(l.PurchaseID), l.Credits, l.ExpiresAt,
	).Scan(&id)
	return id, err
}

func (Postgres) Entry(ctx context.Context, q database.Querier, id string) (*StoredEntry, error) {
	rows, err := q.Query(ctx,
		`SELECT id, type, amount, lot_id, reverses_entry_id, source_type, source_id, created_at, customer_id
		   FROM gym.credit_ledger WHERE id = $1`, id)
	if err != nil {
		return nil, err
	}
	found, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (StoredEntry, error) {
		var s StoredEntry
		var lot, reverses, sourceType, sourceID *string
		err := row.Scan(&s.ID, &s.Type, &s.Amount, &lot, &reverses, &sourceType, &sourceID, &s.CreatedAt, &s.CustomerID)
		s.LotID, s.ReversesEntryID = deref(lot), deref(reverses)
		s.SourceType, s.SourceID = deref(sourceType), deref(sourceID)
		return s, err
	})
	if err != nil || len(found) == 0 {
		return nil, err
	}
	return &found[0], nil
}

func (Postgres) IsReversed(ctx context.Context, q database.Querier, entryID string) (bool, error) {
	var exists bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM gym.credit_ledger WHERE reverses_entry_id = $1)`, entryID).Scan(&exists)
	return exists, err
}

func (Postgres) PackageCoverage(ctx context.Context, q database.Querier) (map[string][]string, error) {
	rows, err := q.Query(ctx, `SELECT id, applicable_class_type_ids::text[] FROM gym.credit_packages`)
	if err != nil {
		return nil, err
	}
	out := map[string][]string{}
	var id string
	var ids []string
	_, err = pgx.ForEachRow(rows, []any{&id, &ids}, func() error {
		out[id] = ids
		ids = nil
		return nil
	})
	return out, err
}

func (Postgres) PackageNames(ctx context.Context, q database.Querier) (map[string]string, error) {
	rows, err := q.Query(ctx, `SELECT id, name FROM gym.credit_packages`)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	var id, name string
	_, err = pgx.ForEachRow(rows, []any{&id, &name}, func() error {
		out[id] = name
		return nil
	})
	return out, err
}

func (Postgres) RecentEntries(ctx context.Context, q database.Querier, customerID string, limit int) ([]RecentEntry, error) {
	rows, err := q.Query(ctx,
		`SELECT l.id, l.type, l.amount, l.lot_id, l.source_type, l.source_id, l.reverses_entry_id, l.note, l.created_by,
		        EXISTS (SELECT 1 FROM gym.credit_ledger r WHERE r.reverses_entry_id = l.id) AS reversed, l.created_at
		   FROM gym.credit_ledger l
		  WHERE l.customer_id = $1
		  ORDER BY l.created_at DESC, l.id DESC
		  LIMIT $2`, customerID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (RecentEntry, error) {
		var e RecentEntry
		err := row.Scan(&e.ID, &e.Type, &e.Amount, &e.LotID, &e.SourceType, &e.SourceID, &e.ReversesEntryID,
			&e.Note, &e.CreatedBy, &e.Reversed, &e.CreatedAt)
		return e, err
	})
}

func (Postgres) Balances(ctx context.Context, q database.Querier, customerIDs []string) (map[string]int, error) {
	out := map[string]int{}
	if len(customerIDs) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx,
		`SELECT customer_id, COALESCE(sum(amount), 0)::int FROM gym.credit_ledger
		  WHERE customer_id = ANY($1::uuid[]) GROUP BY customer_id`, customerIDs)
	if err != nil {
		return nil, err
	}
	var id string
	var balance int
	_, err = pgx.ForEachRow(rows, []any{&id, &balance}, func() error {
		out[id] = balance
		return nil
	})
	return out, err
}

func (Postgres) RecentlyActive(ctx context.Context, q database.Querier, limit int) ([]string, error) {
	rows, err := q.Query(ctx,
		`SELECT customer_id FROM gym.credit_ledger GROUP BY customer_id ORDER BY max(created_at) DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

/* ── Purchases ───────────────────────────────────────────────────────── */

func (Postgres) PackageForPurchase(ctx context.Context, q database.Querier, id string) (*PackageForPurchase, error) {
	var p PackageForPurchase
	err := q.QueryRow(ctx,
		`SELECT id, status, kind, credits, price_idr::float AS price_idr, purchase_limit_per_member, branch_id
		   FROM gym.credit_packages WHERE id = $1`, id,
	).Scan(&p.ID, &p.Status, &p.Kind, &p.Credits, &p.PriceIdr, &p.PurchaseLimitPerMember, &p.BranchID)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &p, err
}

func (Postgres) BranchPrice(ctx context.Context, q database.Querier, packageID, branchID string) (*float64, error) {
	var price float64
	err := q.QueryRow(ctx,
		`SELECT price_idr::float FROM gym.package_branch_prices WHERE package_id = $1 AND branch_id = $2`,
		packageID, branchID).Scan(&price)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &price, err
}

// LivePurchaseCounts counts toward the per-member limit: paid purchases and
// those still pending from the last hour (an abandoned QR does not lock the
// member out forever).
func (Postgres) LivePurchaseCounts(ctx context.Context, q database.Querier, customerID string) (map[string]int, error) {
	rows, err := q.Query(ctx,
		`SELECT package_id, count(*)::int AS n FROM gym.credit_purchases
		  WHERE customer_id = $1
		    AND (status = 'paid' OR (status = 'pending' AND created_at > now() - interval '1 hour'))
		  GROUP BY package_id`, customerID)
	if err != nil {
		return nil, err
	}
	out := map[string]int{}
	var id string
	var n int
	_, err = pgx.ForEachRow(rows, []any{&id, &n}, func() error {
		out[id] = n
		return nil
	})
	return out, err
}

func (Postgres) InsertPurchase(ctx context.Context, q database.Querier, p NewPurchase) (string, error) {
	var id string
	err := q.QueryRow(ctx,
		`INSERT INTO gym.credit_purchases
		   (customer_id, package_id, credits, price_idr, discount_idr, total_idr, channel, payment_method, branch_id, note, created_by)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
		p.CustomerID, p.PackageID, p.Credits, p.PriceIdr, p.DiscountIdr, p.TotalIdr, p.Channel, p.PaymentMethod,
		p.BranchID, p.Note, p.CreatedBy,
	).Scan(&id)
	return id, err
}

const purchaseSelect = `SELECT p.id, p.customer_id, p.package_id, pk.name AS package_name, pk.kind, p.credits, pk.validity_days,
       p.price_idr::float AS price_idr, p.discount_idr::float AS discount_idr, p.total_idr::float AS total_idr,
       p.channel, p.payment_method, p.status, p.external_id, p.payment_meta, p.branch_id, p.note,
       p.paid_at, p.refunded_at, p.created_by, p.created_at
  FROM gym.credit_purchases p JOIN gym.credit_packages pk ON pk.id = p.package_id`

func scanPurchase(row pgx.CollectableRow) (Purchase, error) {
	var p Purchase
	var paidAt, refundedAt *time.Time
	var createdAt time.Time
	err := row.Scan(&p.ID, &p.CustomerID, &p.PackageID, &p.PackageName, &p.Kind, &p.Credits, &p.ValidityDays, &p.PriceIdr, &p.DiscountIdr,
		&p.TotalIdr, &p.Channel, &p.PaymentMethod, &p.Status, &p.ExternalID, &p.PaymentMeta, &p.BranchID, &p.Note,
		&paidAt, &refundedAt, &p.CreatedBy, &createdAt)
	p.PaidAt, p.RefundedAt, p.CreatedAt = jsTimePtr(paidAt), jsTimePtr(refundedAt), JSTime(createdAt)
	return p, err
}

func (Postgres) Purchase(ctx context.Context, q database.Querier, id string, lock bool) (*Purchase, error) {
	if lock {
		if _, err := q.Exec(ctx, `SELECT 1 FROM gym.credit_purchases WHERE id = $1 FOR UPDATE`, id); err != nil {
			return nil, err
		}
	}
	rows, err := q.Query(ctx, purchaseSelect+` WHERE p.id = $1`, id)
	if err != nil {
		return nil, err
	}
	found, err := pgx.CollectRows(rows, scanPurchase)
	if err != nil || len(found) == 0 {
		return nil, err
	}
	return &found[0], nil
}

func (Postgres) PurchasesOf(ctx context.Context, q database.Querier, customerID string, limit int) ([]Purchase, error) {
	rows, err := q.Query(ctx, purchaseSelect+` WHERE p.customer_id = $1 ORDER BY p.created_at DESC LIMIT $2`, customerID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanPurchase)
}

func (Postgres) PurchaseIDByReference(ctx context.Context, q database.Querier, referenceID string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id FROM gym.credit_purchases WHERE external_id = $1`, referenceID).Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

func (Postgres) MarkPurchasePaid(ctx context.Context, q database.Querier, id string, meta map[string]any) (time.Time, int, error) {
	raw, err := json.Marshal(meta)
	if err != nil {
		return time.Time{}, 0, err
	}
	var paidAt time.Time
	var validity int
	err = q.QueryRow(ctx,
		`UPDATE gym.credit_purchases
		    SET status = 'paid', paid_at = now(), updated_at = now(), payment_meta = payment_meta || $2::jsonb
		  WHERE id = $1
		  RETURNING paid_at, (SELECT validity_days FROM gym.credit_packages WHERE id = package_id) AS validity_days`,
		id, string(raw),
	).Scan(&paidAt, &validity)
	return paidAt, validity, err
}

func (Postgres) ClosePurchase(ctx context.Context, q database.Querier, id, status string) error {
	_, err := q.Exec(ctx,
		`UPDATE gym.credit_purchases SET status = $2, updated_at = now() WHERE id = $1 AND status = 'pending'`, id, status)
	return err
}

func (Postgres) MarkPurchaseRefunded(ctx context.Context, q database.Querier, id, note string) error {
	_, err := q.Exec(ctx,
		`UPDATE gym.credit_purchases
		    SET status = 'refunded', refunded_at = now(), updated_at = now(),
		        note = concat_ws(' · ', note, $2::text)
		  WHERE id = $1`, id, note)
	return err
}

func (Postgres) AttachQR(ctx context.Context, q database.Querier, id, referenceID string, meta map[string]any) error {
	raw, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx,
		`UPDATE gym.credit_purchases SET external_id = $2, payment_meta = payment_meta || $3::jsonb, updated_at = now()
		  WHERE id = $1`, id, referenceID, string(raw))
	return err
}

/* ── Passes ──────────────────────────────────────────────────────────── */

func (Postgres) InsertPass(ctx context.Context, q database.Querier, p NewPass) (string, error) {
	var id string
	err := q.QueryRow(ctx,
		`INSERT INTO gym.member_passes (customer_id, package_id, purchase_id, starts_at, ends_at)
		 VALUES ($1,$2,$3,$4,$5)
		 ON CONFLICT (purchase_id) WHERE purchase_id IS NOT NULL DO NOTHING
		 RETURNING id`,
		p.CustomerID, p.PackageID, null(p.PurchaseID), p.StartsAt, p.EndsAt).Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

func (Postgres) ExpireLapsedPasses(ctx context.Context, q database.Querier, customerID string, now time.Time) error {
	_, err := q.Exec(ctx,
		`UPDATE gym.member_passes SET status = 'expired', updated_at = now()
		  WHERE customer_id = $1 AND status = 'active' AND ends_at <= $2`, customerID, now)
	return err
}

const passSelect = `SELECT mp.id, mp.customer_id, mp.package_id, pk.name, mp.purchase_id, mp.starts_at, mp.ends_at, mp.status
  FROM gym.member_passes mp JOIN gym.credit_packages pk ON pk.id = mp.package_id`

func scanPass(row pgx.CollectableRow) (PassRow, error) {
	var p PassRow
	err := row.Scan(&p.ID, &p.CustomerID, &p.PackageID, &p.PackageName, &p.PurchaseID, &p.StartsAt, &p.EndsAt, &p.Status)
	p.StartsAt, p.EndsAt = p.StartsAt.Truncate(time.Millisecond), p.EndsAt.Truncate(time.Millisecond)
	return p, err
}

func (Postgres) Passes(ctx context.Context, q database.Querier, customerID string) ([]PassRow, error) {
	rows, err := q.Query(ctx, passSelect+` WHERE mp.customer_id = $1 ORDER BY (mp.status = 'active') DESC, mp.ends_at DESC`, customerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanPass)
}

func (Postgres) ActivePassAt(ctx context.Context, q database.Querier, customerID string, at time.Time) (*PassRow, error) {
	rows, err := q.Query(ctx, passSelect+`
		 WHERE mp.customer_id = $1 AND mp.status = 'active' AND mp.starts_at <= $2 AND mp.ends_at > $2
		 ORDER BY mp.ends_at DESC LIMIT 1`, customerID, at)
	if err != nil {
		return nil, err
	}
	found, err := pgx.CollectRows(rows, scanPass)
	if err != nil || len(found) == 0 {
		return nil, err
	}
	return &found[0], nil
}

func (Postgres) RefundPassByPurchase(ctx context.Context, q database.Querier, purchaseID string) error {
	_, err := q.Exec(ctx,
		`UPDATE gym.member_passes SET status = 'refunded', updated_at = now() WHERE purchase_id = $1`, purchaseID)
	return err
}

/* ── Packages ────────────────────────────────────────────────────────── */

func (Postgres) Packages(ctx context.Context, q database.Querier) ([]PackageRow, error) {
	rows, err := q.Query(ctx,
		`SELECT p.id, p.name, p.description, p.kind, p.credits, p.price_idr::float AS price_idr, p.validity_days,
		        p.purchase_limit_per_member, p.applicable_class_type_ids::text[], p.branch_id, p.is_public, p.badge,
		        COALESCE((SELECT jsonb_agg(jsonb_build_object('branch_id', bp.branch_id, 'price_idr', bp.price_idr::float) ORDER BY bp.branch_id)
		                    FROM gym.package_branch_prices bp WHERE bp.package_id = p.id), '[]'::jsonb) AS branch_prices,
		        p.status, p.sort_order, p.created_at, p.updated_at,
		        (SELECT count(*)::int FROM gym.credit_purchases cp WHERE cp.package_id = p.id AND cp.status = 'paid') AS sold_count,
		        EXISTS (SELECT 1 FROM gym.credit_purchases cp WHERE cp.package_id = p.id)
		          OR EXISTS (SELECT 1 FROM gym.credit_lots l WHERE l.package_id = p.id) AS referenced
		   FROM gym.credit_packages p
		  ORDER BY (p.status = 'archived'), p.sort_order, p.price_idr`)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (PackageRow, error) {
		p := PackageRow{BranchPrices: []BranchPrice{}}
		var createdAt, updatedAt time.Time
		err := row.Scan(&p.ID, &p.Name, &p.Description, &p.Kind, &p.Credits, &p.PriceIdr, &p.ValidityDays,
			&p.PurchaseLimitPerMember, &p.ApplicableClassTypeIDs, &p.BranchID, &p.IsPublic, &p.Badge, &p.BranchPrices,
			&p.Status, &p.SortOrder, &createdAt, &updatedAt, &p.SoldCount, &p.Referenced)
		p.CreatedAt, p.UpdatedAt = JSTime(createdAt), JSTime(updatedAt)
		return p, err
	})
	if out == nil && err == nil {
		out = []PackageRow{}
	}
	return out, err
}

func (Postgres) ActivePackages(ctx context.Context, q database.Querier) ([]PortalPackageRow, error) {
	rows, err := q.Query(ctx,
		`SELECT id, name, description, kind, credits, price_idr::float AS price_idr, validity_days,
		        purchase_limit_per_member, applicable_class_type_ids::text[], branch_id, badge, status
		   FROM gym.credit_packages WHERE status = 'active' ORDER BY sort_order, price_idr`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (PortalPackageRow, error) {
		var p PortalPackageRow
		err := row.Scan(&p.ID, &p.Name, &p.Description, &p.Kind, &p.Credits, &p.PriceIdr, &p.ValidityDays,
			&p.PurchaseLimitPerMember, &p.ApplicableClassTypeIDs, &p.BranchID, &p.Badge, &p.Status)
		return p, err
	})
}

func (Postgres) PublicPackages(ctx context.Context, q database.Querier, branchID *string) ([]PublicPlan, error) {
	rows, err := q.Query(ctx,
		`SELECT p.id, p.name, p.kind, p.description, p.credits, p.validity_days,
		        COALESCE(bp.price_idr, p.price_idr)::float AS price_idr, p.badge, p.sort_order
		   FROM gym.credit_packages p
		   LEFT JOIN gym.package_branch_prices bp ON bp.package_id = p.id AND bp.branch_id = $1::uuid
		  WHERE p.status = 'active' AND p.is_public AND (p.branch_id IS NULL OR p.branch_id = $1::uuid)
		  ORDER BY p.sort_order, p.price_idr`, branchID)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByPos[PublicPlan])
	if out == nil && err == nil {
		out = []PublicPlan{}
	}
	return out, err
}

func (Postgres) SavePackage(ctx context.Context, q database.Querier, p PackageInput, actorID string) (string, error) {
	args := []any{p.Name, p.Description, p.Credits, p.PriceIdr, p.ValidityDays, p.PurchaseLimitPerMember,
		p.ApplicableClassTypeIDs, p.BranchID, p.SortOrder, p.Kind, p.IsPublic, p.Badge}
	var row pgx.Row
	if p.ID != nil {
		row = q.QueryRow(ctx,
			`UPDATE gym.credit_packages
			    SET name=$1, description=$2, credits=$3, price_idr=$4, validity_days=$5, purchase_limit_per_member=$6,
			        applicable_class_type_ids=$7::text[]::uuid[], branch_id=$8, sort_order=$9, kind=$10, is_public=$11, badge=$12,
			        updated_at=now()
			  WHERE id=$13 RETURNING id`, append(args, *p.ID)...)
	} else {
		row = q.QueryRow(ctx,
			`INSERT INTO gym.credit_packages
			   (name, description, credits, price_idr, validity_days, purchase_limit_per_member,
			    applicable_class_type_ids, branch_id, sort_order, kind, is_public, badge, created_by)
			 VALUES ($1,$2,$3,$4,$5,$6,$7::text[]::uuid[],$8,$9,$10,$11,$12,$13) RETURNING id`, append(args, actorID)...)
	}
	var id string
	err := row.Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

func (Postgres) ReplaceBranchPrices(ctx context.Context, q database.Querier, packageID string, prices []BranchPrice) error {
	if _, err := q.Exec(ctx, `DELETE FROM gym.package_branch_prices WHERE package_id = $1`, packageID); err != nil {
		return err
	}
	for _, bp := range prices {
		if _, err := q.Exec(ctx,
			`INSERT INTO gym.package_branch_prices (package_id, branch_id, price_idr) VALUES ($1, $2, $3)
			 ON CONFLICT (package_id, branch_id) DO UPDATE SET price_idr = EXCLUDED.price_idr`,
			packageID, bp.BranchID, bp.PriceIdr); err != nil {
			return err
		}
	}
	return nil
}

func (Postgres) SetPackageStatus(ctx context.Context, q database.Querier, id, status string) (*PackageStatus, error) {
	var out PackageStatus
	err := q.QueryRow(ctx,
		`UPDATE gym.credit_packages SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, status`, id, status,
	).Scan(&out.ID, &out.Status)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &out, err
}

func (Postgres) DeleteUnusedPackage(ctx context.Context, q database.Querier, id string) (deleted, exists bool, err error) {
	tag, err := q.Exec(ctx,
		`DELETE FROM gym.credit_packages p
		  WHERE p.id = $1
		    AND NOT EXISTS (SELECT 1 FROM gym.credit_purchases WHERE package_id = p.id)
		    AND NOT EXISTS (SELECT 1 FROM gym.credit_lots WHERE package_id = p.id)`, id)
	if err != nil || tag.RowsAffected() > 0 {
		return err == nil, true, err
	}
	err = q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM gym.credit_packages WHERE id = $1)`, id).Scan(&exists)
	return false, exists, err
}

/* ── Rules ───────────────────────────────────────────────────────────── */

func collectRules(rows pgx.Rows, err error) ([]RulesRow, error) {
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (RulesRow, error) {
		var r RulesRow
		err := row.Scan(&r.BranchID, &r.Rules)
		return r, err
	})
}

func (Postgres) RulesFor(ctx context.Context, q database.Querier, branchID *string) ([]RulesRow, error) {
	return collectRules(q.Query(ctx,
		`SELECT branch_id, rules FROM gym.business_rules WHERE branch_id IS NULL OR branch_id = $1`, branchID))
}

func (Postgres) AllRules(ctx context.Context, q database.Querier) ([]RulesRow, error) {
	return collectRules(q.Query(ctx, `SELECT branch_id, rules FROM gym.business_rules`))
}

func (Postgres) SaveGlobalRules(ctx context.Context, q database.Querier, rules json.RawMessage, actorID string) error {
	tag, err := q.Exec(ctx,
		`UPDATE gym.business_rules SET rules = $1::jsonb, updated_by = $2, updated_at = now() WHERE branch_id IS NULL`,
		string(rules), actorID)
	if err != nil || tag.RowsAffected() > 0 {
		return err
	}
	_, err = q.Exec(ctx, `INSERT INTO gym.business_rules (branch_id, rules, updated_by) VALUES (NULL, $1::jsonb, $2)`,
		string(rules), actorID)
	return err
}

func (Postgres) SaveBranchRules(ctx context.Context, q database.Querier, branchID string, rules json.RawMessage, actorID string) error {
	_, err := q.Exec(ctx,
		`INSERT INTO gym.business_rules (branch_id, rules, updated_by) VALUES ($3, $1::jsonb, $2)
		 ON CONFLICT (branch_id) DO UPDATE SET rules = EXCLUDED.rules, updated_by = EXCLUDED.updated_by, updated_at = now()`,
		string(rules), actorID, branchID)
	return err
}

func (Postgres) DeleteBranchRules(ctx context.Context, q database.Querier, branchID string) error {
	_, err := q.Exec(ctx, `DELETE FROM gym.business_rules WHERE branch_id = $1`, branchID)
	return err
}
