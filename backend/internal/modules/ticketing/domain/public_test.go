package domain

import (
	"reflect"
	"regexp"
	"strings"
	"testing"
)

func sp(s string) *string { return &s }

// Ported from lib/ticketing/booking.test.ts.
func TestPublicBookingHelpers(t *testing.T) {
	code := regexp.MustCompile(`^BK-[2-9A-HJ-NP-Z]{6}$`)
	seen := map[string]bool{}
	for range 50 {
		c := GenerateBookingCode()
		if !code.MatchString(c) {
			t.Fatalf("code %q", c)
		}
		seen[c] = true
	}
	if len(seen) <= 45 {
		t.Error("codes should differ")
	}

	const today = "2026-07-22"
	for date, want := range map[string]string{
		"2026-07-22": WindowOK, "2026-07-23": WindowOK, "2026-07-21": WindowPast,
		"2026-10-20": WindowOK, "2026-10-21": WindowTooFar, "2026-02-30": WindowInvalid, "22-07-2026": WindowInvalid,
	} {
		if got := ValidateVisitDateWindow(date, today); got != want {
			t.Errorf("window(%s) = %s, want %s", date, got, want)
		}
	}
	for date, want := range map[string]string{
		"2026-10-04": "", "2026-10-03": "Tanggal kunjungan sudah lewat",
		"2027-10-04": "Tanggal kunjungan terlalu jauh ke depan", "2026-02-30": "Tanggal kunjungan tidak valid",
	} {
		if got := VisitDateWindowError(date, "2026-10-04"); got != want {
			t.Errorf("error(%s) = %q", date, got)
		}
	}

	eqNames := func(got, want []string) {
		t.Helper()
		if !reflect.DeepEqual(got, want) {
			t.Errorf("names = %q, want %q", got, want)
		}
	}
	eqNames(BuildGuestNames("Ilham", 3, nil), []string{"Ilham", "Group Ilham - 2", "Group Ilham - 3"})
	eqNames(BuildGuestNames("Ilham", 4, []*string{sp(""), sp("Budi"), nil, sp("  ")}), []string{"Ilham", "Budi", "Group Ilham - 3", "Group Ilham - 4"})
	long := strings.Repeat("x", 200)
	eqNames(BuildGuestNames("Ilham", 1, []*string{sp("  " + long + "  ")}), []string{long[:120]})
	eqNames(BuildGuestNames("  Ilham  ", 1, nil), []string{"Ilham"})

	for in, want := range map[string]string{"0812-3456-7890": "6281234567890", "+62 812 3456": "", "123": "", "": ""} {
		if got := NormalizePhoneDigits(in); got != want {
			t.Errorf("phone(%q) = %q", in, got)
		}
	}
}

// Ported from lib/ticketing/booking-checkout.test.ts.
func TestPriceBookingCart(t *testing.T) {
	w := func(f float64) *float64 { return &f }
	members := []BundleMember{
		{ComponentVariantID: "adult", MemberLabel: "Kolam — Adult", WeightPrice: w(25000)},
		{ComponentVariantID: "adult", MemberLabel: "Kolam — Adult", WeightPrice: w(25000)},
		{ComponentVariantID: "child", MemberLabel: "Kolam — Child", WeightPrice: w(15000)},
	}
	empty := []BundleMember{}
	catalog := []CatalogProduct{
		{TicketProductID: "kolam", Name: "Kolam", ProductKind: "single", Variants: []CatalogVariant{
			{VariantID: "adult", VariantName: "Adult", Price: 25000.333, SeasonKind: "regular"},
			{VariantID: "child", VariantName: "Child", Price: 15000, SeasonKind: "regular"},
		}},
		{TicketProductID: "paket", Name: "Paket Keluarga", ProductKind: "bundle", Variants: []CatalogVariant{
			{VariantID: "paket-v", VariantName: "Paket", Price: 60000, SeasonKind: "regular", Members: &members},
			{VariantID: "paket-kosong", VariantName: "Kosong", Price: 1, SeasonKind: "regular", Members: &empty},
		}},
	}
	cart, msg := PriceBookingCart(catalog, []CartItem{{VariantID: "adult", Qty: 3}}, "Budi")
	if msg != "" || cart.Items[0].ProductID != "kolam" || cart.Items[0].Subtotal != 75001 || cart.Total != 75001 || cart.TotalQty != 3 || cart.Items[0].PersonsPerUnit != 1 {
		t.Errorf("cart = %+v %q", cart, msg)
	}

	cart, msg = PriceBookingCart(catalog, []CartItem{
		{VariantID: "child", Qty: 1, GuestNames: []*string{sp("Ani")}},
		{VariantID: "paket-v", Qty: 1, GuestNames: []*string{nil, sp("Cici")}},
	}, "Budi")
	if msg != "" || cart.TotalQty != 4 || cart.Items[1].PersonsPerUnit != 3 || cart.Total != 75000 ||
		!reflect.DeepEqual(cart.GuestNames, []string{"Ani", "Group Budi - 2", "Cici", "Group Budi - 4"}) {
		t.Errorf("bundle cart = %+v %q", cart, msg)
	}

	for _, c := range []struct {
		items []CartItem
		msg   string
	}{
		{[]CartItem{{VariantID: "x", Qty: 1}}, "Ada tiket yang tidak tersedia untuk tanggal ini — muat ulang halaman"},
		{[]CartItem{{VariantID: "paket-kosong", Qty: 1}}, "Ada paket yang tidak tersedia untuk tanggal ini — muat ulang halaman"},
		{[]CartItem{{VariantID: "paket-v", Qty: BookingMaxQty/3 + 2}}, "Maksimum 20 tiket per booking"},
		{[]CartItem{{VariantID: "adult", Qty: 1, GuestNames: []*string{sp("A"), sp("B")}}}, "Jumlah nama anggota melebihi jumlah tiket"},
	} {
		if _, msg := PriceBookingCart(catalog, c.items, "Budi"); msg != c.msg {
			t.Errorf("msg = %q, want %q", msg, c.msg)
		}
	}
}
