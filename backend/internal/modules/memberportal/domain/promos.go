package domain

// PromoRow is one campaign code joined with its usage counts.
type PromoRow struct {
	CampaignID         string
	Name               string
	Description        *string
	DiscountType       string
	Value              float64
	MaxDiscount        *float64
	MinPurchase        float64
	ValidFrom          *string
	ValidUntil         *string
	UsageLimit         *int64
	PerPhoneLimit      *int64
	Scope              string
	IsActive           bool
	ShowInMemberPortal bool
	Code               string
	CodeIsActive       bool
	CodeUsageLimit     *int64
	CodeUsageCount     int64
	CampaignUsedCount  int64
	MyUsedCount        int64
}

// MemberPromo is what the portal shows.
type MemberPromo struct {
	Code           string   `json:"code"`
	Name           string   `json:"name"`
	Description    *string  `json:"description"`
	DiscountType   string   `json:"discount_type"`
	Value          float64  `json:"value"`
	MaxDiscount    *float64 `json:"max_discount"`
	MinPurchase    float64  `json:"min_purchase"`
	ValidFrom      *string  `json:"valid_from"`
	ValidUntil     *string  `json:"valid_until"`
	Scope          string   `json:"scope"`
	PerMemberLimit *int64   `json:"per_member_limit"`
	UsedUp         bool     `json:"used_up"`
}

// IsMemberVisiblePromo: flagged for the portal, active, in period, with
// quota left. Single-use voucher codes belong to one recipient and never show.
func IsMemberVisiblePromo(row PromoRow, today string) bool {
	if !row.ShowInMemberPortal || !row.IsActive || !row.CodeIsActive {
		return false
	}
	if row.ValidFrom != nil && today < *row.ValidFrom {
		return false
	}
	if row.ValidUntil != nil && today > *row.ValidUntil {
		return false
	}
	if row.CodeUsageLimit != nil && *row.CodeUsageLimit <= 1 {
		return false
	}
	if row.CodeUsageLimit != nil && row.CodeUsageCount >= *row.CodeUsageLimit {
		return false
	}
	if row.CodeUsageLimit == nil && row.UsageLimit != nil && row.CampaignUsedCount >= *row.UsageLimit {
		return false
	}
	return true
}

// SelectMemberPromos keeps one public code per campaign, in input order.
func SelectMemberPromos(rows []PromoRow, today string) []MemberPromo {
	seen := map[string]bool{}
	promos := []MemberPromo{}
	for _, row := range rows {
		if seen[row.CampaignID] || !IsMemberVisiblePromo(row, today) {
			continue
		}
		seen[row.CampaignID] = true
		var maxDiscount *float64
		if row.DiscountType == "percent" {
			maxDiscount = row.MaxDiscount
		}
		promos = append(promos, MemberPromo{
			Code:           row.Code,
			Name:           row.Name,
			Description:    row.Description,
			DiscountType:   row.DiscountType,
			Value:          row.Value,
			MaxDiscount:    maxDiscount,
			MinPurchase:    row.MinPurchase,
			ValidFrom:      row.ValidFrom,
			ValidUntil:     row.ValidUntil,
			Scope:          row.Scope,
			PerMemberLimit: row.PerPhoneLimit,
			UsedUp:         row.PerPhoneLimit != nil && row.MyUsedCount >= *row.PerPhoneLimit,
		})
	}
	return promos
}
