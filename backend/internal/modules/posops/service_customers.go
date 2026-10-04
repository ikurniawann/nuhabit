package posops

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	posopsevents "nuhabit/backend/internal/contracts/posops"
	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/outbox"
)

// normalizeNfcUID is the card UID as stored: trimmed upper case, nil when empty.
func normalizeNfcUID(v any) *string {
	if domain.IsNullish(v) {
		v = ""
	}
	uid := strings.ToUpper(domain.TrimJS(domain.String(v)))
	if uid == "" {
		return nil
	}
	return &uid
}

// tierDiscounts reads the active tier discounts; a failing read means no
// discounts, as the TS treats a missing crm schema.
func (s *Service) tierDiscounts(ctx context.Context) map[string]float64 {
	d, err := s.ports.CRM.TierDiscounts(ctx, s.db)
	if err != nil {
		return map[string]float64{}
	}
	return d
}

// withTierDiscount appends discount_percent for the customer's tier.
func withTierDiscount(c *Obj, discounts map[string]float64) *Obj {
	tier := c.Get("membership_tier")
	if tier == nil {
		tier = ""
	}
	return c.Set("discount_percent", discounts[strings.ToLower(domain.String(tier))])
}

// ListCustomers mirrors GET /api/pos/customers.
func (s *Service) ListCustomers(ctx context.Context, f customerFilter) ([]*Obj, error) {
	rows, err := listCustomers(ctx, s.db, f)
	if err != nil {
		return nil, err
	}
	discounts := s.tierDiscounts(ctx)
	for _, c := range rows {
		withTierDiscount(c, discounts)
	}
	return rows, nil
}

// SavedCustomer is POST /api/pos/customers' outcome.
type SavedCustomer struct {
	Customer *Obj
	Created  bool
}

// SaveCustomer mirrors POST /api/pos/customers: upsert by phone, a linked
// NFC card makes the customer a card member. enroll_member publishes
// pos.customer.enrolled for CRM in the same transaction.
func (s *Service) SaveCustomer(ctx context.Context, userID string, body any) (*SavedCustomer, error) {
	phoneRaw, nameRaw, emailRaw := field(body, "phone"), field(body, "name"), field(body, "email")
	text := func(v any) string {
		if !domain.Truthy(v) {
			return ""
		}
		return domain.String(v)
	}
	phone := normalizeCustomerPhone(text(phoneRaw))
	name := domain.TrimJS(text(nameRaw))
	email := domain.TrimJS(text(emailRaw))
	nfc := normalizeNfcUID(field(body, "nfc_uid"))
	tierRaw := defaultTo(field(body, "membership_tier"), "regular")
	if !domain.Truthy(tierRaw) {
		tierRaw = "regular"
	}
	tier := strings.ToLower(domain.TrimJS(domain.String(tierRaw)))
	notes := field(body, "notes")
	kol, hasKol := field(body, "is_kol").(bool)

	if phone == "" {
		return nil, fail(http.StatusBadRequest, "Nomor HP wajib diisi")
	}
	if nfc != nil {
		if owner := customerByNfc(ctx, s.db, *nfc); owner != nil && owner.Get("phone") != phone {
			return nil, fail(http.StatusConflict, "Card ID sudah terdaftar pada member lain")
		}
	}
	existing := customerByPhone(ctx, s.db, phone)
	now := s.now()

	var saved *Obj
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		var err error
		if existing != nil {
			cols := domain.Columns{
				{Name: "name", Value: firstTruthy(name, existing.Get("name"))},
				{Name: "email", Value: firstTruthy(email, existing.Get("email"))},
				{Name: "membership_tier", Value: tier},
				{Name: "notes", Value: firstTruthy(notes, existing.Get("notes"))},
			}
			uid := existing.Get("nfc_uid")
			if nfc != nil {
				uid = *nfc
			}
			cols.Set("nfc_uid", uid)
			if nfc != nil && existing.Get("member_type") != "card" {
				cols.Set("member_type", "card")
				cols.Set("card_issued_at", now)
			}
			if hasKol {
				cols.Set("is_kol", kol)
			}
			saved, err = updateCustomer(ctx, tx, existing.Str("id"), cols)
			if err == nil && saved == nil {
				err = plainError("No rows found")
			}
		} else {
			cols := domain.Columns{
				{Name: "phone", Value: phone},
				{Name: "name", Value: name},
				{Name: "email", Value: nilIfEmpty(email)},
				{Name: "membership_tier", Value: tier},
				{Name: "notes", Value: firstTruthy(notes, nil)},
				{Name: "nfc_uid", Value: derefOrNil(nfc)},
			}
			if nfc != nil {
				cols.Set("member_type", "card")
				cols.Set("card_issued_at", now)
			}
			if hasKol {
				cols.Set("is_kol", kol)
			}
			saved, err = insertRow(ctx, tx, "pos.pos_customers", cols, customerColumns)
		}
		if err != nil {
			return err
		}
		if !domain.Truthy(field(body, "enroll_member")) || saved.Str("id") == "" {
			return nil
		}
		return outbox.Publish(ctx, tx, posopsevents.TopicCustomerEnrolled, saved.Str("id"), posopsevents.CustomerEnrolled{
			CustomerID: saved.Str("id"), TierCode: tier, LifetimeXp: orZeroNum(domain.Number(firstTruthy(saved.Get("total_xp"), 0.0))),
			EnrolledBy: userID, EnrolledAt: now.UTC().Format(time.RFC3339Nano),
		})
	})
	if err != nil {
		return nil, err
	}
	return &SavedCustomer{Customer: withTierDiscount(saved, s.tierDiscounts(ctx)), Created: existing == nil}, nil
}

// firstTruthy is `a || b`.
func firstTruthy(a, b any) any {
	if domain.Truthy(a) {
		return a
	}
	return b
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
