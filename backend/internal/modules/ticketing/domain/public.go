package domain

import (
	"crypto/rand"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf16"
)

// The public booking flow (booking.ts, booking-checkout.ts,
// member-portal/phone.ts, lib/public/rate-limit.ts).

// Booking limits.
const (
	BookingMaxDaysAhead = 90
	// BookingMaxQty is the per-booking ticket cap (people), shared with the
	// loket redeem.
	BookingMaxQty      = 20
	GuestNameMaxLength = 120
)

// Visit date window outcomes.
const (
	WindowOK      = "ok"
	WindowPast    = "masa-lalu"
	WindowTooFar  = "terlalu-jauh"
	WindowInvalid = "tidak-valid"
)

// ValidateVisitDateWindow is validateVisitDateWindow: today through
// today + 90 days, inclusive.
func ValidateVisitDateWindow(visitDate, today string) string {
	switch {
	case !IsValidCalendarDate(visitDate):
		return WindowInvalid
	case visitDate < today:
		return WindowPast
	case visitDate > AddDaysISO(today, BookingMaxDaysAhead):
		return WindowTooFar
	}
	return WindowOK
}

var visitDateWindowErrors = map[string]string{
	WindowPast:    "Tanggal kunjungan sudah lewat",
	WindowTooFar:  "Tanggal kunjungan terlalu jauh ke depan",
	WindowInvalid: "Tanggal kunjungan tidak valid",
}

// VisitDateWindowError is visitDateWindowError ("" when bookable).
func VisitDateWindowError(visitDate, today string) string {
	return visitDateWindowErrors[ValidateVisitDateWindow(visitDate, today)]
}

// bookingCodeCharset has no 0/O/1/I/L: codes are read out over the phone.
const bookingCodeCharset = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

// GenerateBookingCode is generateBookingCode: BK- and 6 random characters;
// a collision is retried on 23505.
func GenerateBookingCode() string {
	var b strings.Builder
	b.WriteString("BK-")
	for range 6 {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(bookingCodeCharset))))
		b.WriteByte(bookingCodeCharset[n.Int64()])
	}
	return b.String()
}

// NormalizePhoneDigits is normalizePhoneDigits: digits with a leading 0
// turned into 62; "" unless 10..15 digits remain.
func NormalizePhoneDigits(phone string) string {
	var b strings.Builder
	for _, r := range phone {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	digits := b.String()
	if digits == "" {
		return ""
	}
	if strings.HasPrefix(digits, "0") {
		digits = "62" + digits[1:]
	}
	if len(digits) < 10 || len(digits) > 15 {
		return ""
	}
	return digits
}

// sliceUTF16 is String#slice(0, n).
func sliceUTF16(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if len(u) <= n {
		return s
	}
	return string(utf16.Decode(u[:n]))
}

// jsTrim is String#trim.
func jsTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool { return isJSSpace(r) })
}

// BuildGuestNames is buildGuestNames: one name per person; an empty name
// is the booker at position 1, else "Group {booker} - N".
func BuildGuestNames(customerName string, totalQty int, provided []*string) []string {
	base := jsTrim(customerName)
	names := make([]string, 0, totalQty)
	for position := 1; position <= totalQty; position++ {
		raw := ""
		if position-1 < len(provided) && provided[position-1] != nil {
			raw = jsTrim(*provided[position-1])
		}
		if raw == "" {
			if position == 1 {
				raw = base
			} else {
				raw = "Group " + base + " - " + strconv.Itoa(position)
			}
		}
		names = append(names, sliceUTF16(raw, GuestNameMaxLength))
	}
	return names
}

// CatalogVariant is a public catalog variant; Members is set only for
// bundles (the TS spreads `members` in only then).
type CatalogVariant struct {
	VariantID   string          `json:"variant_id"`
	VariantName string          `json:"variant_name"`
	Price       float64         `json:"price"`
	SeasonKind  string          `json:"season_kind"`
	Members     *[]BundleMember `json:"members,omitempty"`
}

// CatalogProduct is a public catalog product.
type CatalogProduct struct {
	TicketProductID string           `json:"ticket_product_id"`
	Code            string           `json:"code"`
	Name            string           `json:"name"`
	Description     *string          `json:"description"`
	ThumbnailURL    *string          `json:"thumbnail_url"`
	ProductKind     string           `json:"product_kind"`
	Variants        []CatalogVariant `json:"variants"`
}

// CartItem is a requested booking line.
type CartItem struct {
	VariantID  string
	Qty        int
	GuestNames []*string
}

// PricedItem is a cart line priced from the server catalog.
type PricedItem struct {
	CartItem
	ProductID      string
	ProductName    string
	VariantName    string
	Price          float64
	SeasonKind     string
	ProductKind    string
	Members        []BundleMember
	PersonsPerUnit int
	Subtotal       float64
}

// PricedCart is priceBookingCart's ok branch.
type PricedCart struct {
	Items      []PricedItem
	TotalQty   int
	Total      float64
	GuestNames []string
}

// PriceBookingCart is priceBookingCart: prices and eligibility come from
// the server catalog; quota and guest names count people (one bundle unit
// is several). msg is the 400 message when the cart is not bookable.
func PriceBookingCart(catalog []CatalogProduct, cart []CartItem, customerName string) (PricedCart, string) {
	type known struct {
		product CatalogProduct
		variant CatalogVariant
	}
	index := map[string]known{}
	for _, p := range catalog {
		for _, v := range p.Variants {
			index[v.VariantID] = known{p, v}
		}
	}
	var out PricedCart
	for _, item := range cart {
		k, ok := index[item.VariantID]
		if !ok {
			return PricedCart{}, "Ada tiket yang tidak tersedia untuk tanggal ini — muat ulang halaman"
		}
		pi := PricedItem{
			CartItem: item, ProductID: k.product.TicketProductID, ProductName: k.product.Name,
			VariantName: k.variant.VariantName, Price: k.variant.Price, SeasonKind: k.variant.SeasonKind,
			ProductKind: k.product.ProductKind, PersonsPerUnit: 1,
			Subtotal: Round2(float64(k.variant.Price * float64(item.Qty))),
		}
		if k.variant.Members != nil {
			pi.Members = *k.variant.Members
		}
		if pi.ProductKind == "bundle" {
			pi.PersonsPerUnit = len(pi.Members)
		}
		out.Items = append(out.Items, pi)
	}
	for _, it := range out.Items {
		if it.ProductKind == "bundle" && it.PersonsPerUnit == 0 {
			return PricedCart{}, "Ada paket yang tidak tersedia untuk tanggal ini — muat ulang halaman"
		}
	}
	for _, it := range out.Items {
		out.TotalQty += it.Qty * it.PersonsPerUnit
	}
	if out.TotalQty > BookingMaxQty {
		return PricedCart{}, "Maksimum " + strconv.Itoa(BookingMaxQty) + " tiket per booking"
	}
	var provided []*string
	for _, it := range out.Items {
		if len(it.GuestNames) > it.Qty*it.PersonsPerUnit {
			return PricedCart{}, "Jumlah nama anggota melebihi jumlah tiket"
		}
	}
	sum := 0.0
	for _, it := range out.Items {
		for k := range it.Qty * it.PersonsPerUnit {
			var name *string
			if k < len(it.GuestNames) {
				name = it.GuestNames[k]
			}
			provided = append(provided, name)
		}
		sum += it.Subtotal
	}
	out.GuestNames = BuildGuestNames(customerName, out.TotalQty, provided)
	out.Total = Round2(sum)
	return out, ""
}

// ClientIP is clientIpFromHeaders: cf-connecting-ip, the left-most
// x-forwarded-for, x-real-ip, else "unknown".
func ClientIP(h http.Header) string {
	if ip := strings.TrimSpace(h.Get("cf-connecting-ip")); ip != "" {
		return ip
	}
	if first := strings.TrimSpace(strings.Split(h.Get("x-forwarded-for"), ",")[0]); first != "" {
		return first
	}
	if ip := strings.TrimSpace(h.Get("x-real-ip")); ip != "" {
		return ip
	}
	return "unknown"
}
