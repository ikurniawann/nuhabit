package resort

import (
	"errors"
	"net/http"
	"regexp"

	"nuhabit/backend/internal/modules/resort/domain"
	"nuhabit/backend/internal/platform/validate"
)

// Request bodies (lib/resort/schemas.ts), read in schema order.

var (
	required = validate.Rule{}
	optional = validate.Rule{Optional: true}
	nullish  = validate.Rule{Optional: true, Nullable: true}
	defaults = validate.Rule{HasDefault: true}
)

func text(min, max int) validate.StrOpts { return validate.StrOpts{Trim: true, Min: min, Max: max} }

// zodEmail is zod v4's z.string().email() pattern.
var zodEmail = regexp.MustCompile(`^(?:[A-Za-z0-9_'+\-]+(?:\.[A-Za-z0-9_'+\-]+)*)@(?:[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$`)

var email = validate.StrOpts{Trim: true, Max: 150, Check: func(s string) (string, string, bool) {
	return "invalid_format", "Invalid email address", zodEmail.MatchString(s)
}}

// errBadJSON is `await request.json()` throwing: validateBody lets the
// SyntaxError through, so the route answers 500.
var errBadJSON = errors.New("request body is not JSON")

// readForm is validateBody's parse step.
func readForm(r *http.Request) (*validate.Form, error) {
	body, present := validate.ReadBody(r)
	if !present {
		return nil, errBadJSON
	}
	return validate.New(body, true), nil
}

func intOr(n *int, def int) int {
	if n == nil {
		return def
	}
	return *n
}

func numOr(n *float64, def float64) float64 {
	if n == nil {
		return def
	}
	return *n
}

func strOr(s *string, def string) string {
	if s == nil {
		return def
	}
	return *s
}

// Patch builders: a key the body sends lands in the SET clause; null only
// for nullable keys.

func (p *patch) str(f *validate.Form, key string, nullable bool, o validate.StrOpts) {
	raw, sent := f.Fields()[key]
	if s := f.Str(key, validate.Rule{Optional: true, Nullable: nullable}, o); s != nil {
		p.add(key, *s)
	} else if nullable && sent && raw == nil {
		p.add(key, nil)
	}
}

func (p *patch) int(f *validate.Form, key string, o validate.NumOpts) {
	if n := f.Int(key, optional, o); n != nil {
		p.add(key, *n)
	}
}

func (p *patch) num(f *validate.Form, key string, o validate.NumOpts) {
	if n := f.Num(key, optional, o); n != nil {
		p.add(key, *n)
	}
}

func (p *patch) bool(f *validate.Form, key string) {
	if b := f.Bool(key, optional); b != nil {
		p.add(key, *b)
	}
}

func roomTypeCreate(f *validate.Form) RoomTypeInput {
	in := RoomTypeInput{
		Code:        strOr(f.Str("code", required, text(1, 30)), ""),
		Name:        strOr(f.Str("name", required, text(1, 120)), ""),
		Description: f.Str("description", nullish, text(0, 2000)),
		Zone:        f.Str("zone", nullish, text(0, 60)),
	}
	in.CapacityAdults = intOr(f.Int("capacity_adults", defaults, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(50)}), 2)
	in.CapacityChildren = intOr(f.Int("capacity_children", defaults, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(50)}), 0)
	in.ExtraBedCapacity = intOr(f.Int("extra_bed_capacity", defaults, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(10)}), 0)
	in.RateWeekday = numOr(f.Num("rate_weekday", defaults, validate.NumOpts{Min: validate.Bound(0)}), 0)
	in.RateWeekend = numOr(f.Num("rate_weekend", defaults, validate.NumOpts{Min: validate.Bound(0)}), 0)
	in.ExtraBedRate = numOr(f.Num("extra_bed_rate", defaults, validate.NumOpts{Min: validate.Bound(0)}), 0)
	in.Amenities = f.Strings("amenities", defaults, 30, text(0, 60))
	if in.Amenities == nil {
		in.Amenities = []string{}
	}
	in.SortOrder = intOr(f.Int("sort_order", defaults, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(999)}), 0)
	return in
}

func roomTypePatch(f *validate.Form) *patch {
	p := &patch{}
	p.str(f, "name", false, text(1, 120))
	p.str(f, "description", true, text(0, 2000))
	p.str(f, "zone", true, text(0, 60))
	p.int(f, "capacity_adults", validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(50)})
	p.int(f, "capacity_children", validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(50)})
	p.int(f, "extra_bed_capacity", validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(10)})
	p.num(f, "rate_weekday", validate.NumOpts{Min: validate.Bound(0)})
	p.num(f, "rate_weekend", validate.NumOpts{Min: validate.Bound(0)})
	p.num(f, "extra_bed_rate", validate.NumOpts{Min: validate.Bound(0)})
	if a := f.Strings("amenities", optional, 30, text(0, 60)); a != nil {
		p.add("amenities", a)
	}
	p.int(f, "sort_order", validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(999)})
	p.bool(f, "is_active")
	return p
}

func roomCreate(f *validate.Form) RoomInput {
	return RoomInput{
		RoomTypeID: strOr(f.UUID("room_type_id", required), ""),
		Code:       strOr(f.Str("code", required, text(1, 30)), ""),
		Name:       strOr(f.Str("name", required, text(1, 120)), ""),
		Zone:       f.Str("zone", nullish, text(0, 60)),
		Notes:      f.Str("notes", nullish, text(0, 500)),
	}
}

var roomStatuses = []string{"siap", "kotor", "perbaikan", "ditutup"}

func roomPatch(f *validate.Form) *patch {
	p := &patch{}
	p.str(f, "name", false, text(1, 120))
	p.str(f, "zone", true, text(0, 60))
	if s := f.Enum("status", optional, roomStatuses); s != nil {
		p.add("status", *s)
	}
	p.str(f, "notes", true, text(0, 500))
	p.bool(f, "is_active")
	p.str(f, "room_type_id", false, validate.StrOpts{Check: validate.UUIDCheck})
	return p
}

func reservationCreate(f *validate.Form) ReservationInput {
	in := ReservationInput{
		GuestName:  strOr(f.Str("guest_name", required, text(2, 150)), ""),
		GuestPhone: strOr(f.Str("guest_phone", required, text(6, 30)), ""),
		GuestEmail: f.Str("guest_email", nullish, email),
		CheckIn:    strOr(f.Str("check_in", required, validate.StrOpts{}), ""),
		CheckOut:   strOr(f.Str("check_out", required, validate.StrOpts{}), ""),
	}
	in.Adults = intOr(f.Int("adults", defaults, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(50)}), 2)
	in.Children = intOr(f.Int("children", defaults, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(50)}), 0)
	in.Source = strOr(f.Enum("source", defaults, domain.Sources), "walk-in")
	in.Status = strOr(f.Enum("status", defaults, []string{domain.StatusAwaitingPayment, domain.StatusConfirmed}), domain.StatusAwaitingPayment)
	in.DiscountAmount = numOr(f.Num("discount_amount", defaults, validate.NumOpts{Min: validate.Bound(0)}), 0)
	in.Notes = f.Str("notes", nullish, text(0, 1000))
	in.SpecialRequest = f.Str("special_request", nullish, text(0, 1000))
	items := f.List("rooms", required, 20, func(sub *validate.Form, i int, v any) {
		item := sub.Item(i, v)
		in.Rooms = append(in.Rooms, domain.RoomRequest{
			RoomTypeID: strOr(item.UUID("room_type_id", required), ""),
			Qty:        intOr(item.Int("qty", defaults, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(20)}), 1),
			ExtraBed:   intOr(item.Int("extra_bed", defaults, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(10)}), 0),
			GuestName:  item.Str("guest_name", nullish, text(0, 150)),
			RoomID:     item.UUID("room_id", nullish),
		})
	})
	if items != nil && len(items) < 1 {
		f.Fail("rooms", "too_small", "Too small: expected array to have >=1 items")
	}
	return in
}

func reservationPatch(f *validate.Form) *patch {
	p := &patch{}
	p.str(f, "guest_name", false, text(2, 150))
	p.str(f, "guest_phone", false, text(6, 30))
	p.str(f, "guest_email", true, email)
	p.str(f, "notes", true, text(0, 1000))
	p.str(f, "special_request", true, text(0, 1000))
	return p
}

func statusChange(f *validate.Form) StatusChange {
	in := StatusChange{Action: strOr(f.Enum("action", required, domain.StatusActionNames), "")}
	f.List("assignments", optional, 20, func(sub *validate.Form, i int, v any) {
		item := sub.Item(i, v)
		in.Assignments = append(in.Assignments, Assignment{
			ReservationRoomID: strOr(item.UUID("reservation_room_id", required), ""),
			RoomID:            strOr(item.UUID("room_id", required), ""),
		})
	})
	in.Reason = f.Str("reason", nullish, text(0, 500))
	if b := f.Bool("force", optional); b != nil {
		in.Force = *b
	}
	return in
}

func folioCharge(f *validate.Form) FolioChargeInput {
	return FolioChargeInput{
		ChargeType:    strOr(f.Enum("charge_type", required, domain.FolioChargeTypes), ""),
		Description:   strOr(f.Str("description", required, text(2, 200)), ""),
		Amount:        numOr(f.Num("amount", required, validate.NumOpts{Positive: true, Max: validate.Bound(1_000_000_000)}), 0),
		PaymentMethod: f.Str("payment_method", nullish, text(0, 30)),
	}
}
