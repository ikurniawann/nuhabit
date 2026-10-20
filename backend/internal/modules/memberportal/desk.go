package memberportal

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Front desk accounts: staff register and edit a member with the rules of
// self registration (phone, name, email, birth date) and the same rows, the
// pos_customers row plus the CRM profile. Staff skip the OTP, so the number
// is not marked WhatsApp verified. internal/app adapts these for gym-desk.

// DeskMember is a member registered by staff.
type DeskMember struct {
	Name, Phone, Email string
}

// DeskProfile is a staff edit of a member. Nil fields keep their value; an
// empty Email or BirthDate clears it. With EmergencyContactSet, a nil
// EmergencyContact clears the contact.
type DeskProfile struct {
	Name, Phone, Email, BirthDate *string
	EmergencyContactSet           bool
	EmergencyContact              map[string]any
}

// RegisterAtDesk creates the member and returns its id. Invalid input is a
// 400 naming the field; a phone or email that another member already has is
// a 409 whose details name that member.
func RegisterAtDesk(ctx context.Context, db database.DB, in DeskMember, now time.Time) (string, error) {
	reg, err := validateDesk(in.Name, in.Phone, in.Email, "", now)
	if err != nil {
		return "", err
	}
	var id string
	err = database.WithTx(ctx, db, func(tx pgx.Tx) error {
		s := &store{q: tx}
		if err := s.LockRegistration(ctx, reg.PhoneDigits); err != nil {
			return err
		}
		if err := rejectDuplicate(ctx, tx, "", reg.PhoneDigits, or(reg.Email, "")); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx,
			`INSERT INTO pos.pos_customers (phone, name, email, member_type) VALUES ($1, $2, $3, 'registered') RETURNING id::text`,
			reg.PhoneLocal, reg.Name, reg.Email).Scan(&id); err != nil {
			return err
		}
		return insertCRMProfile(ctx, tx, id, "gym_front_desk")
	})
	return id, err
}

// UpdateAtDesk applies a staff edit. A missing member is a 404; invalid
// input and duplicates answer as in RegisterAtDesk.
func UpdateAtDesk(ctx context.Context, db database.DB, customerID string, p DeskProfile, now time.Time) error {
	return database.WithTx(ctx, db, func(tx pgx.Tx) error {
		var name, phone, email, birth string
		err := tx.QueryRow(ctx,
			`SELECT COALESCE(name, ''), COALESCE(phone, ''), COALESCE(email, ''), COALESCE(to_char(birth_date, 'YYYY-MM-DD'), '')
			   FROM pos.pos_customers WHERE id = $1 FOR UPDATE`, customerID).Scan(&name, &phone, &email, &birth)
		if database.IsNoRows(err) {
			return httpx.NotFound("Member tidak ditemukan")
		}
		if err != nil {
			return err
		}
		reg, err := validateDesk(or(p.Name, name), or(p.Phone, phone), or(p.Email, email), or(p.BirthDate, birth), now)
		if err != nil {
			return err
		}
		// An unchanged number keeps its stored spelling; only a new one is
		// checked for duplicates and stored as 08xx.
		var newDigits string
		if reg.PhoneDigits != domain.NormalizePhoneDigits(phone) {
			newDigits, phone = reg.PhoneDigits, reg.PhoneLocal
		}
		if err := rejectDuplicate(ctx, tx, customerID, newDigits, or(reg.Email, "")); err != nil {
			return err
		}
		var contact any
		if p.EmergencyContactSet && p.EmergencyContact != nil {
			c, valid := emergencyContact(p.EmergencyContact)
			if !valid {
				return httpx.BadRequest("Kontak darurat belum lengkap", map[string]string{"field": "emergency_contact"})
			}
			raw, _ := json.Marshal(c)
			contact = string(raw)
		}
		_, err = tx.Exec(ctx,
			`UPDATE pos.pos_customers
			    SET name = $2, phone = $3, email = $4, birth_date = $5::date,
			        emergency_contact = CASE WHEN $6 THEN $7::jsonb ELSE emergency_contact END,
			        updated_at = now()
			  WHERE id = $1`,
			customerID, reg.Name, phone, reg.Email, reg.BirthDate, p.EmergencyContactSet, contact)
		return err
	})
}

// validateDesk runs the self registration rules and turns a failure into a
// 400 that names the field.
func validateDesk(name, phone, email, birth string, now time.Time) (domain.Registration, error) {
	reg, verr := domain.ValidateRegistration(domain.RegistrationInput{Phone: phone, Name: name, Email: email, BirthDate: birth}, now)
	if verr != nil {
		return reg, httpx.BadRequest(verr.Message, map[string]string{"field": verr.Field})
	}
	return reg, nil
}

// rejectDuplicate is a 409 when another member has the phone digits or the
// email; an empty value is not checked. Numbers are stored as 08xx or 62xx.
func rejectDuplicate(ctx context.Context, q database.Querier, exceptID, digits, email string) error {
	var id, name, field string
	err := q.QueryRow(ctx,
		`SELECT id::text, COALESCE(name, ''),
		        CASE WHEN $2 <> '' AND regexp_replace(COALESCE(phone, ''), '\D', '', 'g') IN ($2, '0' || substring($2 from 3))
		             THEN 'phone' ELSE 'email' END AS field
		   FROM pos.pos_customers
		  WHERE id::text <> $1
		    AND (($2 <> '' AND regexp_replace(COALESCE(phone, ''), '\D', '', 'g') IN ($2, '0' || substring($2 from 3)))
		      OR ($3 <> '' AND lower(email) = $3))
		  ORDER BY field DESC
		  LIMIT 1`, exceptID, digits, email).Scan(&id, &name, &field)
	if database.IsNoRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	msg := "Nomor HP ini sudah terdaftar"
	if field == "email" {
		msg = "Email ini sudah dipakai member lain"
	}
	if name != "" {
		msg += " atas nama " + name
	}
	return &httpx.Error{Status: http.StatusConflict, Message: msg + ".", Details: map[string]string{
		"field": field, "member_id": id, "member_name": name,
	}}
}

// or is *s, or fallback when s is nil.
func or(s *string, fallback string) string {
	if s == nil {
		return fallback
	}
	return *s
}
