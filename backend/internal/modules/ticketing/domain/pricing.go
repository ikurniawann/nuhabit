package domain

// Ticket price resolution v2 (pricing.ts): prices live on product
// variants (Regular and High Season), seasons and online blocks come from
// the ticket's own calendar, and a channel may override a price.

// Season kinds.
const (
	SeasonRegular = "regular"
	SeasonHigh    = "high"
)

// Price failure reasons.
const (
	ReasonDateBlocked  = "tanggal-diblok"
	ReasonPriceMissing = "harga-belum-diisi"
)

// ProductDateRange is one ticket_product_dates row.
type ProductDateRange struct {
	DateKind  string
	StartDate string
	EndDate   string
	IsActive  bool
}

// PricePair is a Regular/High pair; nil means not filled in (must reject).
type PricePair struct {
	Regular *float64
	High    *float64
}

func inRange(date string, r ProductDateRange) bool {
	return r.IsActive && r.StartDate <= date && date <= r.EndDate
}

// ResolveSeasonKind is resolveSeasonKind; ok=false for an invalid date
// (the TS throws).
func ResolveSeasonKind(visitDate string, dates []ProductDateRange) (string, bool) {
	if !IsValidCalendarDate(visitDate) {
		return "", false
	}
	for _, r := range dates {
		if r.DateKind == "high-season" && inRange(visitDate, r) {
			return SeasonHigh, true
		}
	}
	return SeasonRegular, true
}

// IsDateBlockedOnline is isDateBlockedOnline (invalid dates are not blocked;
// the TS throws and callers validate first).
func IsDateBlockedOnline(visitDate string, dates []ProductDateRange) bool {
	for _, r := range dates {
		if r.DateKind == "blok-online" && inRange(visitDate, r) {
			return true
		}
	}
	return false
}

func priceForSeason(pair *PricePair, season string) *float64 {
	if pair == nil {
		return nil
	}
	if season == SeasonHigh {
		return pair.High
	}
	return pair.Regular
}

// ResolveVariantPrice is resolveVariantPrice: a filled channel override
// wins, else the variant price; nil means no price.
func ResolveVariantPrice(variant PricePair, override *PricePair, season string) *float64 {
	if p := priceForSeason(override, season); p != nil {
		return p
	}
	return priceForSeason(&variant, season)
}

// PriceResult is resolveTicketPrice's result.
type PriceResult struct {
	OK         bool
	Price      float64
	SeasonKind string
	Reason     string
}

// ResolveTicketPrice is resolveTicketPrice: online block, season, price.
func ResolveTicketPrice(visitDate string, isOnline bool, dates []ProductDateRange, variant PricePair, override *PricePair) PriceResult {
	if isOnline && IsDateBlockedOnline(visitDate, dates) {
		return PriceResult{Reason: ReasonDateBlocked}
	}
	season, _ := ResolveSeasonKind(visitDate, dates)
	price := ResolveVariantPrice(variant, override, season)
	if price == nil {
		return PriceResult{Reason: ReasonPriceMissing}
	}
	return PriceResult{OK: true, Price: *price, SeasonKind: season}
}

// IsVariantPriceComplete is isVariantPriceComplete: both seasons priced.
func IsVariantPriceComplete(variant PricePair, override *PricePair) bool {
	return ResolveVariantPrice(variant, override, SeasonRegular) != nil &&
		ResolveVariantPrice(variant, override, SeasonHigh) != nil
}
