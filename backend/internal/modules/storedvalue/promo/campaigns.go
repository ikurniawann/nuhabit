package promo

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"nuhabit/backend/internal/modules/storedvalue/promo/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Campaigns and codes per venue (campaigns-server.ts, codes-server.ts).

// jsTime scans a timestamptz and marshals like a JS Date.
type jsTime struct{ httpx.JSTime }

func (t *jsTime) ScanTimestamptz(v pgtype.Timestamptz) error {
	t.JSTime = httpx.JSTime(v.Time)
	return nil
}

// campaignRow is CampaignListRow; numeric and bigint columns are text, as
// node-postgres returns them.
type campaignRow struct {
	ID                 string   `json:"id"`
	Name               string   `json:"name"`
	Description        *string  `json:"description"`
	DiscountType       string   `json:"discount_type"`
	Value              string   `json:"value"`
	MaxDiscount        *string  `json:"max_discount"`
	MinPurchase        string   `json:"min_purchase"`
	ValidFrom          *string  `json:"valid_from"`
	ValidUntil         *string  `json:"valid_until"`
	UsageLimit         *int     `json:"usage_limit"`
	PerPhoneLimit      *int     `json:"per_phone_limit"`
	Scope              string   `json:"scope"`
	IsActive           bool     `json:"is_active"`
	ShowInMemberPortal bool     `json:"show_in_member_portal"`
	TargetProductIDs   []string `json:"target_product_ids"`
	TargetCategoryIDs  []string `json:"target_category_ids"`
	Eligibility        string   `json:"eligibility"`
	NewMemberDays      *int     `json:"new_member_days"`
	CreatedAt          jsTime   `json:"created_at"`
	CodesCount         string   `json:"codes_count"`
	HeldCount          string   `json:"held_count"`
	CapturedCount      string   `json:"captured_count"`
	DiscountCaptured   string   `json:"discount_captured"`
}

type redemptionRow struct {
	ID             string  `json:"id"`
	Code           string  `json:"code"`
	ContextType    string  `json:"context_type"`
	ContextID      string  `json:"context_id"`
	Phone          *string `json:"phone"`
	DiscountAmount string  `json:"discount_amount"`
	Status         string  `json:"status"`
	CreatedAt      jsTime  `json:"created_at"`
}

type codeRow struct {
	ID         string `json:"id"`
	Code       string `json:"code"`
	UsageLimit *int   `json:"usage_limit"`
	UsageCount int    `json:"usage_count"`
	IsActive   bool   `json:"is_active"`
	CreatedAt  jsTime `json:"created_at"`
}

func collect[T any](rows pgx.Rows, err error) ([]T, error) {
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByPos[T])
	if out == nil && err == nil {
		out = []T{}
	}
	return out, err
}

func (s *Service) listCampaigns(ctx context.Context, v venue) ([]campaignRow, error) {
	rows, err := s.db.Query(ctx, `
		SELECT c.id, c.name, c.description, c.discount_type, c.value::text,
		       c.max_discount::text, c.min_purchase::text,
		       c.valid_from::text, c.valid_until::text,
		       c.usage_limit, c.per_phone_limit, c.scope, c.is_active,
		       c.show_in_member_portal,
		       c.target_product_ids::text[], c.target_category_ids::text[],
		       c.eligibility, c.new_member_days, c.created_at,
		       (SELECT COUNT(*) FROM promo.promo_codes k
		         WHERE k.campaign_id = c.id)::text,
		       (SELECT COUNT(*) FROM promo.promo_redemptions r
		         WHERE r.campaign_id = c.id AND r.status = 'held')::text,
		       (SELECT COUNT(*) FROM promo.promo_redemptions r
		         WHERE r.campaign_id = c.id AND r.status = 'captured')::text,
		       (SELECT COALESCE(SUM(r.discount_amount), 0)
		         FROM promo.promo_redemptions r
		         WHERE r.campaign_id = c.id AND r.status = 'captured')::text
		FROM promo.promo_campaigns c
		WHERE c.branch_id = $1 AND c.company_id = $2
		ORDER BY c.created_at DESC`, v.branchID, v.companyID)
	return collect[campaignRow](rows, err)
}

// campaignCreate is campaignCreateSchema after parsing (defaults applied).
type campaignCreate struct {
	Name              string
	Description       *string
	DiscountType      string
	Value             float64
	MaxDiscount       *float64
	MinPurchase       float64
	ValidFrom         *string
	ValidUntil        *string
	UsageLimit        *int
	PerPhoneLimit     *int
	Scope             string
	TargetProductIDs  []string
	TargetCategoryIDs []string
	Eligibility       string // "" = absent
	NewMemberDays     *int
	PublicCode        string // "" = absent
}

// createCampaign inserts the campaign and its optional public code in one
// transaction and returns the campaign id.
func (s *Service) createCampaign(ctx context.Context, v venue, userID string, b campaignCreate) (string, error) {
	var maxDiscount *float64
	if b.DiscountType == "percent" {
		maxDiscount = b.MaxDiscount
	}
	eligibility := b.Eligibility
	if eligibility == "" {
		eligibility = domain.EligibilityAll
	}
	var newMemberDays *int
	if eligibility == domain.EligibilityNewMember {
		newMemberDays = b.NewMemberDays
	}
	var id string
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			INSERT INTO promo.promo_campaigns
			  (company_id, branch_id, name, description, discount_type, value,
			   max_discount, min_purchase, valid_from, valid_until, usage_limit,
			   per_phone_limit, scope, created_by, target_product_ids,
			   target_category_ids, eligibility, new_member_days)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
			RETURNING id`,
			v.companyID, v.branchID, b.Name, b.Description, b.DiscountType, b.Value,
			maxDiscount, b.MinPurchase, b.ValidFrom, b.ValidUntil, b.UsageLimit,
			b.PerPhoneLimit, b.Scope, userID, orEmpty(b.TargetProductIDs),
			orEmpty(b.TargetCategoryIDs), eligibility, newMemberDays,
		).Scan(&id); err != nil {
			return err
		}
		if b.PublicCode == "" {
			return nil
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO promo.promo_codes (company_id, branch_id, campaign_id, code)
			VALUES ($1, $2, $3, $4)`, v.companyID, v.branchID, id, strings.ToUpper(b.PublicCode))
		return err
	})
	if database.IsUniqueViolation(err) {
		return "", httpx.Conflict("Kode sudah dipakai campaign lain — pilih kode lain")
	}
	return id, err
}

// updateCampaign applies a PATCH: the toggles always, the discount rules
// only while no redemption was captured.
func (s *Service) updateCampaign(ctx context.Context, v venue, id string, patch domain.CampaignPatch) error {
	var cur domain.CampaignSnapshot
	err := s.db.QueryRow(ctx, `
		SELECT c.discount_type, c.value::float8,
		       c.valid_from::text, c.valid_until::text,
		       (SELECT COUNT(*)::int FROM promo.promo_redemptions r
		         WHERE r.campaign_id = c.id AND r.status = 'captured')
		FROM promo.promo_campaigns c
		WHERE c.id = $1 AND c.branch_id = $2 AND c.company_id = $3`,
		id, v.branchID, v.companyID,
	).Scan(&cur.DiscountType, &cur.Value, &cur.ValidFrom, &cur.ValidUntil, &cur.CapturedCount)
	if database.IsNoRows(err) {
		return httpx.NotFound("Campaign tidak ditemukan")
	}
	if err != nil {
		return err
	}
	cols, err := domain.PlanCampaignUpdate(patch, cur)
	var planErr *domain.PlanError
	if errors.As(err, &planErr) {
		if planErr.Conflict {
			return httpx.Conflict(planErr.Message)
		}
		return httpx.BadRequest(planErr.Message)
	}
	sets := []string{"updated_at = now()"}
	args := make([]any, 0, len(cols)+3)
	for i, c := range cols {
		sets = append(sets, fmt.Sprintf("%s = $%d", c.Name, i+1))
		args = append(args, c.Value)
	}
	args = append(args, id, v.branchID, v.companyID)
	n := len(args)
	_, err = s.db.Exec(ctx, fmt.Sprintf(`UPDATE promo.promo_campaigns SET %s
		WHERE id = $%d AND branch_id = $%d AND company_id = $%d`, strings.Join(sets, ", "), n-2, n-1, n), args...)
	return err
}

// assertCampaign is a 404 when the campaign is not in this venue.
func (s *Service) assertCampaign(ctx context.Context, v venue, id string) error {
	var found string
	err := s.db.QueryRow(ctx, `SELECT id FROM promo.promo_campaigns
		WHERE id = $1 AND branch_id = $2 AND company_id = $3`, id, v.branchID, v.companyID).Scan(&found)
	if database.IsNoRows(err) {
		return httpx.NotFound("Campaign tidak ditemukan")
	}
	return err
}

// listRedemptions is the 100 latest uses of one campaign.
func (s *Service) listRedemptions(ctx context.Context, v venue, id string) ([]redemptionRow, error) {
	if err := s.assertCampaign(ctx, v, id); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT r.id, k.code, r.context_type, r.context_id, r.phone,
		       r.discount_amount::text, r.status, r.created_at
		FROM promo.promo_redemptions r
		JOIN promo.promo_codes k ON k.id = r.code_id
		WHERE r.campaign_id = $1
		ORDER BY r.created_at DESC
		LIMIT 100`, id)
	return collect[redemptionRow](rows, err)
}

/* ── codes ───────────────────────────────────────────────────────────── */

const duplicateCode = "Kode sudah dipakai — pilih kode lain"

func (s *Service) listCodes(ctx context.Context, v venue, campaignID string) ([]codeRow, error) {
	if err := s.assertCampaign(ctx, v, campaignID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT id, code, usage_limit, usage_count, is_active, created_at
		FROM promo.promo_codes
		WHERE campaign_id = $1
		ORDER BY created_at DESC, code
		LIMIT 2000`, campaignID)
	return collect[codeRow](rows, err)
}

// createSingleCode adds one public code (usageLimit nil = campaign limit).
func (s *Service) createSingleCode(ctx context.Context, v venue, campaignID, code string, usageLimit *int) (codeRow, error) {
	if err := s.assertCampaign(ctx, v, campaignID); err != nil {
		return codeRow{}, err
	}
	rows, err := s.db.Query(ctx, `
		INSERT INTO promo.promo_codes
		  (company_id, branch_id, campaign_id, code, usage_limit)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, code, usage_limit, usage_count, is_active, created_at`,
		v.companyID, v.branchID, campaignID, strings.ToUpper(code), usageLimit)
	if err != nil {
		return codeRow{}, err
	}
	row, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByPos[codeRow])
	if database.IsUniqueViolation(err) {
		return codeRow{}, httpx.Conflict(duplicateCode)
	}
	return row, err
}

// insertVoucherBatch inserts count single-use vouchers with the prefix,
// refilling collisions for up to 6 rounds.
func insertVoucherBatch(ctx context.Context, tx pgx.Tx, v venue, campaignID, prefix string, count int, verb string) ([]string, error) {
	codes, err := domain.FillUniqueCodes(count,
		func() string { return domain.GenerateVoucherCode(prefix) },
		func(candidates []string) ([]string, error) {
			rows, err := tx.Query(ctx, `
				INSERT INTO promo.promo_codes
				  (company_id, branch_id, campaign_id, code, usage_limit)
				SELECT $1, $2, $3, unnest($4::text[]), 1
				ON CONFLICT (branch_id, code) DO NOTHING
				RETURNING code`, v.companyID, v.branchID, campaignID, candidates)
			return collectStrings(rows, err)
		},
		func(created, need int) string {
			return fmt.Sprintf("Hanya %d/%d kode berhasil %s — coba prefix lain", created, need, verb)
		}, 0)
	var short *domain.ShortfallError
	if errors.As(err, &short) {
		return nil, httpx.Status(500, short.Message)
	}
	return codes, err
}

func (s *Service) createVoucherBatch(ctx context.Context, v venue, campaignID, prefix string, count int) ([]string, error) {
	if err := s.assertCampaign(ctx, v, campaignID); err != nil {
		return nil, err
	}
	var codes []string
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) (err error) {
		codes, err = insertVoucherBatch(ctx, tx, v, campaignID, strings.ToUpper(prefix), count, "dibuat")
		return err
	})
	return codes, err
}

type syncResult struct {
	Count   int `json:"count"`
	Added   int `json:"added"`
	Removed int `json:"removed"`
}

var voucherPrefix = regexp.MustCompile(`^[A-Z0-9]{2,12}$`)

// syncVoucherCount sets the campaign's voucher count to target while no
// voucher was used: fewer deletes the newest, more generates with the
// given prefix or the prefix of the existing codes.
func (s *Service) syncVoucherCount(ctx context.Context, v venue, campaignID string, target int, prefixInput *string) (syncResult, string, error) {
	if err := s.assertCampaign(ctx, v, campaignID); err != nil {
		return syncResult{}, "", err
	}
	var captured, usedCodes int
	if err := s.db.QueryRow(ctx, `
		SELECT
		  (SELECT COUNT(*)::int FROM promo.promo_redemptions r
		    WHERE r.campaign_id = $1 AND r.status = 'captured'),
		  (SELECT COUNT(*)::int FROM promo.promo_codes c
		    WHERE c.campaign_id = $1 AND c.usage_count > 0)`, campaignID).Scan(&captured, &usedCodes); err != nil {
		return syncResult{}, "", err
	}
	if captured > 0 || usedCodes > 0 {
		return syncResult{}, "", httpx.Conflict("Sudah ada voucher terpakai — jumlah tidak bisa diubah")
	}

	rows, err := s.db.Query(ctx, `
		SELECT id, code FROM promo.promo_codes
		WHERE campaign_id = $1 AND branch_id = $2 AND company_id = $3
		ORDER BY created_at DESC, code`, campaignID, v.branchID, v.companyID)
	type idCode struct{ ID, Code string }
	existing, err := collect[idCode](rows, err)
	if err != nil {
		return syncResult{}, "", err
	}
	current := len(existing)
	if target == current {
		return syncResult{Count: current}, "Jumlah voucher tidak berubah", nil
	}

	if target < current {
		remove := current - target
		ids := make([]string, remove)
		for i := range ids {
			ids[i] = existing[i].ID
		}
		err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `DELETE FROM promo.promo_redemptions
				WHERE code_id = ANY($1::uuid[]) AND status IN ('held', 'released')`, ids); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `DELETE FROM promo.promo_codes
				WHERE id = ANY($1::uuid[]) AND usage_count = 0`, ids)
			return err
		})
		if err != nil {
			return syncResult{}, "", err
		}
		return syncResult{Count: target, Removed: remove}, fmt.Sprintf("%d voucher dihapus", remove), nil
	}

	prefix := ""
	if prefixInput != nil {
		prefix = strings.ToUpper(*prefixInput)
	}
	if prefix == "" {
		codes := make([]string, current)
		for i, e := range existing {
			codes[i] = e.Code
		}
		prefix = domain.InferPrefix(codes)
	}
	prefix = strings.TrimSpace(prefix)
	if !voucherPrefix.MatchString(prefix) {
		return syncResult{}, "", httpx.BadRequest("Prefix tidak tersedia — pastikan kanal campaign valid atau isi prefix")
	}
	var created []string
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) (err error) {
		created, err = insertVoucherBatch(ctx, tx, v, campaignID, prefix, target-current, "ditambah")
		return err
	})
	if err != nil {
		return syncResult{}, "", err
	}
	return syncResult{Count: target, Added: len(created)}, fmt.Sprintf("%d voucher ditambah", len(created)), nil
}

// codePatch is codePatchSchema after parsing.
type codePatch struct {
	IsActive   *bool
	Code       *string
	UsageLimit domain.Field[*int]
}

func (s *Service) codeUsage(ctx context.Context, v venue, id string) (int, error) {
	var usage int
	err := s.db.QueryRow(ctx, `SELECT usage_count FROM promo.promo_codes
		WHERE id = $1 AND branch_id = $2 AND company_id = $3`, id, v.branchID, v.companyID).Scan(&usage)
	if database.IsNoRows(err) {
		return 0, httpx.NotFound("Kode tidak ditemukan")
	}
	return usage, err
}

// updateCode toggles a code any time; renaming or changing its limit only
// while the voucher is unused.
func (s *Service) updateCode(ctx context.Context, v venue, id string, b codePatch) error {
	if b.IsActive == nil && b.Code == nil && !b.UsageLimit.Set {
		return httpx.BadRequest("Tidak ada field yang diubah")
	}
	usage, err := s.codeUsage(ctx, v, id)
	if err != nil {
		return err
	}
	if (b.Code != nil || b.UsageLimit.Set) && usage > 0 {
		return httpx.Conflict("Voucher sudah terpakai — hanya status aktif yang boleh diubah")
	}
	sets := []string{"updated_at = now()"}
	var args []any
	add := func(column string, value any) {
		args = append(args, value)
		sets = append(sets, fmt.Sprintf("%s = $%d", column, len(args)))
	}
	if b.IsActive != nil {
		add("is_active", *b.IsActive)
	}
	if b.Code != nil {
		add("code", strings.ToUpper(*b.Code))
	}
	if b.UsageLimit.Set {
		add("usage_limit", b.UsageLimit.Value)
	}
	args = append(args, id, v.branchID, v.companyID)
	n := len(args)
	var updated string
	err = s.db.QueryRow(ctx, fmt.Sprintf(`UPDATE promo.promo_codes SET %s
		WHERE id = $%d AND branch_id = $%d AND company_id = $%d
		RETURNING id`, strings.Join(sets, ", "), n-2, n-1, n), args...).Scan(&updated)
	switch {
	case database.IsNoRows(err):
		return httpx.NotFound("Kode tidak ditemukan")
	case database.IsUniqueViolation(err):
		return httpx.Conflict(duplicateCode)
	}
	return err
}

// deleteCode removes an unused voucher with its orphan held/released
// redemptions. Like the TS, the two statements run outside a transaction.
func (s *Service) deleteCode(ctx context.Context, v venue, id string) error {
	usage, err := s.codeUsage(ctx, v, id)
	if err != nil {
		return err
	}
	if usage > 0 {
		return httpx.Conflict("Voucher sudah terpakai — tidak bisa dihapus")
	}
	if _, err := s.db.Exec(ctx, `DELETE FROM promo.promo_redemptions
		WHERE code_id = $1 AND status IN ('held', 'released')`, id); err != nil {
		return err
	}
	tag, err := s.db.Exec(ctx, `DELETE FROM promo.promo_codes
		WHERE id = $1 AND branch_id = $2 AND company_id = $3
		  AND usage_count = 0`, id, v.branchID, v.companyID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.Conflict("Gagal menghapus kode")
	}
	return nil
}

func collectStrings(rows pgx.Rows, err error) ([]string, error) {
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func orEmpty(ids []string) []string {
	if ids == nil {
		return []string{}
	}
	return ids
}
