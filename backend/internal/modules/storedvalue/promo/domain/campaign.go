package domain

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"regexp"
	"strings"
)

// Field is a body field that may be absent (Set false). Nullable fields use
// a pointer T, so Set with a nil Value is an explicit null.
type Field[T any] struct {
	Set   bool
	Value T
}

// CampaignPatch is the parsed PATCH /api/promo/campaigns/{id} body
// (campaignPatchSchema), in schema order.
type CampaignPatch struct {
	Name               Field[string]
	Description        Field[*string]
	DiscountType       Field[string]
	Value              Field[float64]
	MaxDiscount        Field[*float64]
	MinPurchase        Field[float64]
	ValidFrom          Field[*string]
	ValidUntil         Field[*string]
	UsageLimit         Field[*int]
	PerPhoneLimit      Field[*int]
	Scope              Field[string]
	IsActive           Field[bool]
	ShowInMemberPortal Field[bool]
	TargetProductIDs   Field[[]string]
	TargetCategoryIDs  Field[[]string]
	Eligibility        Field[string]
	NewMemberDays      Field[*int]
}

// CampaignSnapshot is the stored campaign the edit plan checks against.
type CampaignSnapshot struct {
	DiscountType  string
	Value         float64
	ValidFrom     *string
	ValidUntil    *string
	CapturedCount int
}

// Column is one `column = value` of an UPDATE.
type Column struct {
	Name  string
	Value any
}

// PlanError is a rejected campaign edit: a 409 when Conflict, else a 400.
type PlanError struct {
	Conflict bool
	Message  string
}

func (e *PlanError) Error() string { return e.Message }

// PlanCampaignUpdate lists the columns a campaign PATCH sets
// (planCampaignUpdate). Only the toggles may change once a voucher was
// captured; percent stays <= 100; the end date is not before the start;
// max_discount is kept for percent only; new_member_days only for
// member_baru.
func PlanCampaignUpdate(b CampaignPatch, cur CampaignSnapshot) ([]Column, error) {
	nonToggle := b.Name.Set || b.Description.Set || b.DiscountType.Set || b.Value.Set || b.MaxDiscount.Set ||
		b.MinPurchase.Set || b.ValidFrom.Set || b.ValidUntil.Set || b.UsageLimit.Set || b.PerPhoneLimit.Set ||
		b.Scope.Set || b.TargetProductIDs.Set || b.TargetCategoryIDs.Set || b.Eligibility.Set || b.NewMemberDays.Set
	onlyToggles := !nonToggle && (b.IsActive.Set || b.ShowInMemberPortal.Set)
	if !onlyToggles && cur.CapturedCount > 0 {
		return nil, &PlanError{Conflict: true, Message: "Campaign sudah punya voucher terpakai — hanya status aktif yang boleh diubah"}
	}

	finalType := cur.DiscountType
	if b.DiscountType.Set {
		finalType = b.DiscountType.Value
	}
	finalValue := cur.Value
	if b.Value.Set {
		finalValue = b.Value.Value
	}
	if finalType == "percent" && finalValue > 100 {
		return nil, &PlanError{Message: "Diskon persen maksimal 100"}
	}
	finalFrom, finalUntil := cur.ValidFrom, cur.ValidUntil
	if b.ValidFrom.Set {
		finalFrom = b.ValidFrom.Value
	}
	if b.ValidUntil.Set {
		finalUntil = b.ValidUntil.Value
	}
	if truthy(finalFrom) && truthy(finalUntil) && *finalUntil < *finalFrom {
		return nil, &PlanError{Message: "Tanggal akhir sebelum tanggal mulai"}
	}

	var cols []Column
	add := func(name string, v any) { cols = append(cols, Column{name, v}) }
	if b.Name.Set {
		add("name", b.Name.Value)
	}
	if b.Description.Set {
		add("description", b.Description.Value)
	}
	if b.DiscountType.Set {
		add("discount_type", b.DiscountType.Value)
	}
	if b.Value.Set {
		add("value", b.Value.Value)
	}
	if b.MaxDiscount.Set {
		if finalType == "percent" {
			add("max_discount", b.MaxDiscount.Value)
		} else {
			add("max_discount", nil)
		}
	} else if b.DiscountType.Set && b.DiscountType.Value == "fixed" {
		add("max_discount", nil)
	}
	if b.MinPurchase.Set {
		add("min_purchase", b.MinPurchase.Value)
	}
	if b.ValidFrom.Set {
		add("valid_from", b.ValidFrom.Value)
	}
	if b.ValidUntil.Set {
		add("valid_until", b.ValidUntil.Value)
	}
	if b.UsageLimit.Set {
		add("usage_limit", b.UsageLimit.Value)
	}
	if b.PerPhoneLimit.Set {
		add("per_phone_limit", b.PerPhoneLimit.Value)
	}
	if b.Scope.Set {
		add("scope", b.Scope.Value)
	}
	if b.TargetProductIDs.Set {
		add("target_product_ids", b.TargetProductIDs.Value)
	}
	if b.TargetCategoryIDs.Set {
		add("target_category_ids", b.TargetCategoryIDs.Value)
	}
	if b.Eligibility.Set {
		add("eligibility", b.Eligibility.Value)
		if b.Eligibility.Value == EligibilityNewMember && b.NewMemberDays.Set {
			add("new_member_days", b.NewMemberDays.Value)
		} else {
			add("new_member_days", nil)
		}
	} else if b.NewMemberDays.Set {
		add("new_member_days", b.NewMemberDays.Value)
	}
	if b.IsActive.Set {
		add("is_active", b.IsActive.Value)
	}
	if b.ShowInMemberPortal.Set {
		add("show_in_member_portal", b.ShowInMemberPortal.Value)
	}
	return cols, nil
}

// codeCharset has no ambiguous characters (no 0/O/1/I).
const codeCharset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// GenerateVoucherCode is one random `PREFIX-XXXXXX` batch voucher code.
// Vouchers are bearer codes, so the suffix comes from crypto/rand.
func GenerateVoucherCode(prefix string) string {
	var suffix [6]byte
	n := big.NewInt(int64(len(codeCharset)))
	for i := range suffix {
		v, err := rand.Int(rand.Reader, n)
		if err != nil {
			panic(fmt.Sprintf("promo: crypto/rand failed: %v", err))
		}
		suffix[i] = codeCharset[v.Int64()]
	}
	return prefix + "-" + string(suffix[:])
}

// ShortfallError means FillUniqueCodes ran out of rounds; the TS answers
// it with a 500 carrying Message.
type ShortfallError struct{ Message string }

func (e *ShortfallError) Error() string { return e.Message }

// FillUniqueCodes inserts need unique codes: each round generates fresh
// candidates and insert returns those that went in (collisions skipped by
// ON CONFLICT). After rounds rounds (default 6) a shortfall is a
// *ShortfallError with shortMessage(created, need).
func FillUniqueCodes(need int, generate func() string, insert func([]string) ([]string, error),
	shortMessage func(created, need int) string, rounds int) ([]string, error) {
	if rounds <= 0 {
		rounds = 6
	}
	created := []string{}
	for round := 0; round < rounds && len(created) < need; round++ {
		var candidates []string
		seen := map[string]bool{}
		for len(candidates) < need-len(created) {
			if c := generate(); !seen[c] {
				seen[c] = true
				candidates = append(candidates, c)
			}
		}
		got, err := insert(candidates)
		if err != nil {
			return nil, err
		}
		created = append(created, got...)
	}
	if len(created) < need {
		return nil, &ShortfallError{Message: shortMessage(len(created), need)}
	}
	return created, nil
}

var prefixPattern = regexp.MustCompile(`^([A-Z0-9]{2,12})-`)

// InferPrefix is the voucher prefix of the first `PREFIX-XXXXXX` code, or
// "" when none matches.
func InferPrefix(codes []string) string {
	for _, code := range codes {
		if m := prefixPattern.FindStringSubmatch(strings.ToUpper(code)); m != nil {
			return m[1]
		}
	}
	return ""
}
