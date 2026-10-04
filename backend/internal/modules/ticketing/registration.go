package ticketing

import (
	"context"
	"strconv"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Walk-in registration (visit-registration-server.ts): single bands plus
// bundle purchases (each unit explodes into one band per person), postpaid
// or prepaid with an opening deposit. One transaction: daily capacity,
// walk-in channel, band locks, variant/bundle checks, then the inserts.

// RegisterVisitInput is registerVisitSchema after parsing.
type RegisterVisitInput struct {
	ContactName  string
	ContactPhone *string
	PaymentMode  string
	CreditLimit  *float64
	Deposit      *DepositInput
	Bands        []BandVariant
	Bundles      []BundlePurchase
}

// DepositInput is an opening deposit or a payment line.
type DepositInput struct {
	Amount float64
	Method string
}

// BandVariant is one single-ticket band.
type BandVariant struct {
	NfcUID    string
	VariantID string
}

// BundlePurchase is one bundle unit with its member bands in order.
type BundlePurchase struct {
	BundleVariantID string
	BandUIDs        []string
}

// fallbackCreditLimit is the postpaid limit when the venue has no settings row.
const fallbackCreditLimit = 500000

// requireDistinctNfcUIDs is requireDistinctNfcUids.
func requireDistinctNfcUIDs(raws []string) ([]string, error) {
	uids := make([]string, len(raws))
	seen := map[string]bool{}
	for i, raw := range raws {
		uids[i] = domain.NormalizeNfcUID(raw)
		if !domain.IsValidNfcUID(uids[i]) {
			return nil, httpx.BadRequest("Ada UID gelang yang tidak valid")
		}
	}
	for _, uid := range uids {
		if seen[uid] {
			return nil, httpx.BadRequest("Ada gelang yang di-tap dua kali")
		}
		seen[uid] = true
	}
	return uids, nil
}

// lockAvailableBands is lockAvailableBands: deterministic ORDER BY id
// locks (no deadlock with a concurrent registration or redeem); every UID
// must be registered and 'tersedia'.
func lockAvailableBands(ctx context.Context, q database.Querier, v Venue, uids []string) (map[string]string, error) {
	type band struct{ id, status string }
	byUID := map[string]band{}
	err := scanAll(ctx, q, `SELECT id::text, nfc_uid, status FROM ticketing.ticket_bands
		WHERE branch_id = $1 AND company_id = $2 AND nfc_uid = ANY($3)
		ORDER BY id
		FOR UPDATE`, []any{v.BranchID, v.CompanyID, uids}, func(scan func(...any) error) error {
		var b band
		var uid string
		err := scan(&b.id, &uid, &b.status)
		byUID[uid] = b
		return err
	})
	if err != nil {
		return nil, err
	}
	ids := map[string]string{}
	for _, uid := range uids {
		b, ok := byUID[uid]
		if !ok {
			return nil, httpx.BadRequest("Gelang " + uid + " belum terdaftar di registry")
		}
		if b.status != "tersedia" {
			return nil, httpx.Conflict("Gelang " + uid + ` berstatus "` + b.status + `" — tidak bisa dipakai`)
		}
		ids[uid] = b.id
	}
	return ids, nil
}

type bundleBand struct {
	uid, componentVariantID, bundleProductID string
	unitNo                                   int
	allocatedPrice                           float64
	memberLabel                              string
}

// prepareBundleBands resolves each bundle's price today on the walk-in
// channel and prorates it over its members; the share is snapshotted on
// the visit band so the gate charges it without resolving again.
func (s *Service) prepareBundleBands(ctx context.Context, q database.Querier, v Venue, channelID string, bundles []BundlePurchase) ([]bundleBand, error) {
	if len(bundles) == 0 {
		return nil, nil
	}
	visitDate := s.today()
	var variantIDs []string
	seen := map[string]bool{}
	for _, b := range bundles {
		if !seen[b.BundleVariantID] {
			seen[b.BundleVariantID] = true
			variantIDs = append(variantIDs, b.BundleVariantID)
		}
	}
	type bundleVariant struct{ productID, name string }
	byID := map[string]bundleVariant{}
	err := scanAll(ctx, q, `SELECT pv.id::text, pv.ticket_product_id::text, tp.name
		FROM ticketing.ticket_product_variants pv
		JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
		JOIN ticketing.ticket_product_channels pc
		  ON pc.ticket_product_id = tp.id AND pc.channel_id = $4 AND pc.is_distributed = true
		WHERE pv.branch_id = $1 AND pv.company_id = $2 AND pv.id = ANY($3)
		  AND pv.is_active = true AND tp.status = 'active' AND tp.product_kind = 'bundle'`,
		[]any{v.BranchID, v.CompanyID, variantIDs, channelID}, func(scan func(...any) error) error {
			var id string
			var bv bundleVariant
			err := scan(&id, &bv.productID, &bv.name)
			byID[id] = bv
			return err
		})
	if err != nil {
		return nil, err
	}
	if len(byID) != len(variantIDs) {
		return nil, httpx.BadRequest("Ada paket yang tidak dikenal / nonaktif / belum didistribusi ke POS")
	}

	var prepared []bundleBand
	unitNo := 0
	for _, purchase := range bundles {
		bv := byID[purchase.BundleVariantID]
		composition, err := loadBundleComposition(ctx, q, v, bv.productID)
		if err != nil {
			return nil, err
		}
		if issue := domain.BundleCompositionIssue(composition); issue != "" {
			return nil, httpx.BadRequest(`Paket "` + bv.name + `" tidak layak jual: ` + issue)
		}
		price, err := resolveVariantPriceOnDate(ctx, q, v, purchase.BundleVariantID, channelID, visitDate)
		if err != nil {
			return nil, err
		}
		if !price.OK {
			return nil, httpx.BadRequest(`Harga paket "` + bv.name + `" belum diisi — lengkapi di Master Ticket`)
		}
		members := domain.ExpandBundleMembers(domain.ToBundleComponents(composition, price.SeasonKind))
		if len(purchase.BandUIDs) != len(members) {
			return nil, httpx.BadRequest(`Paket "` + bv.name + `" butuh ` + strconv.Itoa(len(members)) +
				" gelang per unit — di-tap " + strconv.Itoa(len(purchase.BandUIDs)))
		}
		weights := make([]*float64, len(members))
		for i, m := range members {
			weights[i] = m.WeightPrice
		}
		shares := domain.AllocateBundlePrice(price.Price, weights)
		unitNo++
		for i, m := range members {
			prepared = append(prepared, bundleBand{
				uid: domain.NormalizeNfcUID(purchase.BandUIDs[i]), componentVariantID: m.ComponentVariantID,
				bundleProductID: bv.productID, unitNo: unitNo, allocatedPrice: shares[i],
				memberLabel: bv.name + " — " + m.MemberLabel,
			})
		}
	}
	return prepared, nil
}

// RegisterVisit is registerVisit; it returns the new visit id.
func (s *Service) RegisterVisit(ctx context.Context, v Venue, in RegisterVisitInput) (string, error) {
	if len(in.Bands) == 0 && len(in.Bundles) == 0 {
		return "", httpx.BadRequest("Minimal satu gelang harus di-tap")
	}
	var raws []string
	for _, b := range in.Bands {
		raws = append(raws, b.NfcUID)
	}
	for _, b := range in.Bundles {
		raws = append(raws, b.BandUIDs...)
	}
	uids, err := requireDistinctNfcUIDs(raws)
	if err != nil {
		return "", err
	}
	if in.PaymentMode == "prepaid" && in.Deposit == nil {
		return "", httpx.BadRequest("Mode prepaid wajib top-up deposit awal")
	}

	var visitID string
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		// Walk-ins count against today's capacity: one band = one person.
		if err := assertCapacityAvailable(ctx, tx, v, s.today(), len(uids)); err != nil {
			return err
		}
		var defaultLimit float64 = fallbackCreditLimit
		err := tx.QueryRow(ctx, `SELECT default_credit_limit::float8 FROM ticketing.ticket_settings
			WHERE branch_id = $1 AND company_id = $2`, v.BranchID, v.CompanyID).Scan(&defaultLimit)
		if err != nil && !database.IsNoRows(err) {
			return err
		}
		var channelID string
		err = tx.QueryRow(ctx, `SELECT id::text FROM ticketing.ticket_channels
			WHERE branch_id = $1 AND company_id = $2 AND code = 'walk-in' AND is_active = true`,
			v.BranchID, v.CompanyID).Scan(&channelID)
		if database.IsNoRows(err) {
			return httpx.BadRequest("Kanal walk-in belum aktif — buka Pengaturan Tiket dulu")
		}
		if err != nil {
			return err
		}

		bandIDs, err := lockAvailableBands(ctx, tx, v, uids)
		if err != nil {
			return err
		}

		// Single variants must belong to the venue, be active, sit on an
		// active SINGLE product and be distributed to walk-in.
		var variantIDs []string
		seen := map[string]bool{}
		for _, b := range in.Bands {
			if !seen[b.VariantID] {
				seen[b.VariantID] = true
				variantIDs = append(variantIDs, b.VariantID)
			}
		}
		if len(variantIDs) > 0 {
			var n int
			if err := tx.QueryRow(ctx, `SELECT COUNT(*)
				FROM ticketing.ticket_product_variants pv
				JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
				JOIN ticketing.ticket_product_channels pc
				  ON pc.ticket_product_id = tp.id AND pc.channel_id = $4 AND pc.is_distributed = true
				WHERE pv.branch_id = $1 AND pv.company_id = $2 AND pv.id = ANY($3)
				  AND pv.is_active = true AND tp.status = 'active' AND tp.product_kind = 'single'`,
				v.BranchID, v.CompanyID, variantIDs, channelID).Scan(&n); err != nil {
				return err
			}
			if n != len(variantIDs) {
				return httpx.BadRequest("Ada varian ticket yang tidak dikenal / nonaktif / belum didistribusi ke POS")
			}
		}

		bundleBands, err := s.prepareBundleBands(ctx, tx, v, channelID, in.Bundles)
		if err != nil {
			return err
		}

		var creditLimit *float64
		if in.PaymentMode == "postpaid" {
			limit := defaultLimit
			if in.CreditLimit != nil {
				limit = *in.CreditLimit
			}
			creditLimit = &limit
		}
		if err := tx.QueryRow(ctx, `INSERT INTO ticketing.ticket_visits
			(company_id, branch_id, contact_name, contact_phone, channel_id, payment_mode, credit_limit, created_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING id::text`,
			v.CompanyID, v.BranchID, in.ContactName, orNil(in.ContactPhone), channelID, in.PaymentMode, creditLimit, v.UserID).
			Scan(&visitID); err != nil {
			return err
		}

		markInUse := func(bandID string) error {
			_, err := tx.Exec(ctx, `UPDATE ticketing.ticket_bands SET status = 'dipakai', updated_at = now() WHERE id = $1`, bandID)
			return err
		}
		for _, b := range in.Bands {
			bandID := bandIDs[domain.NormalizeNfcUID(b.NfcUID)]
			if _, err := tx.Exec(ctx, `INSERT INTO ticketing.ticket_visit_bands
				(company_id, branch_id, visit_id, band_id, variant_id) VALUES ($1, $2, $3, $4, $5)`,
				v.CompanyID, v.BranchID, visitID, bandID, b.VariantID); err != nil {
				return err
			}
			if err := markInUse(bandID); err != nil {
				return err
			}
		}
		for _, m := range bundleBands {
			bandID := bandIDs[m.uid]
			if _, err := tx.Exec(ctx, `INSERT INTO ticketing.ticket_visit_bands
				(company_id, branch_id, visit_id, band_id, variant_id, bundle_product_id, bundle_unit_no, allocated_price, member_label)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
				v.CompanyID, v.BranchID, visitID, bandID, m.componentVariantID, m.bundleProductID, m.unitNo, m.allocatedPrice, m.memberLabel); err != nil {
				return err
			}
			if err := markInUse(bandID); err != nil {
				return err
			}
		}

		if in.PaymentMode == "prepaid" && in.Deposit != nil {
			_, err := tx.Exec(ctx, `INSERT INTO ticketing.ticket_visit_charges
				(company_id, branch_id, visit_id, charge_type, direction, description, amount, payment_method, created_by)
				VALUES ($1, $2, $3, 'deposit', 'kredit', $4, $5, $6, $7)`,
				v.CompanyID, v.BranchID, visitID, "Top-up deposit awal ("+in.Deposit.Method+")",
				domain.Round2(in.Deposit.Amount), in.Deposit.Method, v.UserID)
			return err
		}
		return nil
	})
	return visitID, err
}
