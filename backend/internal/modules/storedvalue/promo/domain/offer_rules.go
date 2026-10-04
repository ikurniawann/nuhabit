package domain

import (
	"regexp"
	"slices"
)

// SalesChannelCodes mirrors SALES_CHANNEL_CODES in lib/pos/sales-channels.
var SalesChannelCodes = []string{"pos", "self_order", "gofood", "grabfood", "shopeefood"}

// OfferRuleItemInput is one target row: exactly one of ProductID and
// CategoryID.
type OfferRuleItemInput struct {
	Role       string
	ProductID  *string
	CategoryID *string
	Qty        *float64
	SortOrder  *int
}

// OfferRuleInput is the body of an offer rule create or update
// (offerRuleBodySchema after parsing).
type OfferRuleInput struct {
	OfferType     string
	Name          string
	Description   *string
	ValidFrom     *string
	ValidUntil    *string
	IsActive      *bool
	BundlePrice   *float64
	BuyQty        *int
	GetQty        *int
	GetMode       *string
	VolumeBasis   *string
	VolumeMin     *float64
	DiscountType  *string
	DiscountValue *float64
	// SalesChannels nil or empty = every channel.
	SalesChannels    []string
	MaxUses          *int
	MaxUsesPerMember *int
	IsExclusive      *bool
	Priority         *int
	// UnlockCode set = the offer is active only after the cashier types it.
	UnlockCode *string
	Items      []OfferRuleItemInput
}

var unlockCodeFormat = regexp.MustCompile(`^[A-Za-z0-9-]{3,40}$`)

func positiveIntOrNil(v *int) bool { return v == nil || *v > 0 }

// positive is `Number(v) > 0` for a nullable number.
func positive(v *float64) bool { return v != nil && *v > 0 }

// validateOfferCommon checks targets, channels, quotas, priority and code.
func validateOfferCommon(in OfferRuleInput) string {
	for _, i := range in.Items {
		if truthy(i.ProductID) == truthy(i.CategoryID) {
			return "Setiap baris wajib memilih produk ATAU kategori"
		}
	}
	for _, c := range in.SalesChannels {
		if !slices.Contains(SalesChannelCodes, c) {
			return "Channel penjualan tidak dikenal"
		}
	}
	if !positiveIntOrNil(in.MaxUses) {
		return "Kuota total wajib bilangan bulat > 0"
	}
	if !positiveIntOrNil(in.MaxUsesPerMember) {
		return "Kuota per member wajib bilangan bulat > 0"
	}
	if p := deref(in.Priority); p < 0 || p > 1000 {
		return "Prioritas wajib angka 0–1000"
	}
	if in.UnlockCode != nil {
		if code := jsTrim(*in.UnlockCode); code != "" && !unlockCodeFormat.MatchString(code) {
			return "Kode pembuka: huruf/angka/strip, 3–40 karakter"
		}
	}
	return ""
}

// ValidateOfferRule returns the first business rule the input breaks, or
// "" (validateOfferRule).
func ValidateOfferRule(in OfferRuleInput) string {
	if jsTrim(in.Name) == "" {
		return "Nama wajib diisi"
	}
	if truthy(in.ValidFrom) && truthy(in.ValidUntil) && *in.ValidFrom > *in.ValidUntil {
		return "Tanggal mulai tidak boleh setelah tanggal selesai"
	}
	if msg := validateOfferCommon(in); msg != "" {
		return msg
	}
	byRole := func(role string) []OfferRuleItemInput {
		var out []OfferRuleItemInput
		for _, i := range in.Items {
			if i.Role == role {
				out = append(out, i)
			}
		}
		return out
	}

	switch in.OfferType {
	case OfferBundle:
		components := byRole("component")
		for _, c := range components {
			if truthy(c.CategoryID) {
				return "Komponen bundling harus produk, bukan kategori"
			}
		}
		if len(components) < 2 {
			return "Bundling minimal 2 produk komponen"
		}
		if !positive(in.BundlePrice) {
			return "Harga bundling wajib > 0"
		}
		for _, c := range components {
			if !positive(c.Qty) {
				return "Qty tiap komponen wajib > 0"
			}
		}
		return ""
	case OfferBxgy:
		if deref(in.BuyQty) <= 0 {
			return "Qty beli wajib > 0"
		}
		if deref(in.GetQty) <= 0 {
			return "Qty gratis wajib > 0"
		}
		if len(byRole("buy")) < 1 {
			return "Pilih minimal 1 produk yang dibeli (atau kategori)"
		}
		if deref(in.GetMode) == "specific_products" && len(byRole("get")) < 1 {
			return "Pilih minimal 1 produk gratis (atau kategori)"
		}
		return ""
	case OfferVolume:
		if !truthy(in.VolumeBasis) {
			return "Basis volume wajib (qty / belanja)"
		}
		if !positive(in.VolumeMin) {
			return "Minimum qty/belanja wajib > 0"
		}
		if !truthy(in.DiscountType) {
			return "Tipe diskon wajib"
		}
		if !positive(in.DiscountValue) {
			return "Nilai diskon wajib > 0"
		}
		if *in.DiscountType == "percent" && *in.DiscountValue > 100 {
			return "Diskon persen maksimal 100"
		}
		return ""
	}
	return "Tipe offer tidak dikenal"
}
