package members

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/members/domain"
	"nuhabit/backend/internal/platform/audit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
	"nuhabit/backend/internal/platform/whatsapp"
)

// passwordLength is the generated member password the front desk hands over.
const passwordLength = 10

// PasswordMessenger sends the new password to the member's WhatsApp number
// (platform/whatsapp through internal/app). An error means nothing reached
// the member.
type PasswordMessenger interface {
	SendText(ctx context.Context, q database.Querier, target, message, sentByUserID string) error
}

type passwordIssued struct {
	Password string `json:"password"`
}

type passwordSent struct {
	Sent bool `json:"sent"`
}

// POST /api/crm/members/{id}/password { send_whatsapp? } sets a fresh
// password on the member, ends the member's portal sessions and records
// the reset. The password is answered once, or sent by WhatsApp instead
// when send_whatsapp is true.
func (h *handler) resetPassword(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.Auth.RequireMenuAction(r, "update", iam.CrmMembers...)
	if err != nil {
		return err
	}
	// A missing body means no options.
	body, present := validate.ReadBody(r)
	if !present {
		body = map[string]any{}
	}
	f := validate.New(body, true)
	sendWhatsApp := f.BoolDefault("send_whatsapp", false)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	password, err := auth.GeneratePassword(passwordLength)
	if err != nil {
		return err
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	err = database.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		ctx := r.Context()
		customerID, err := resolveCustomerID(ctx, tx, r.PathValue("id"))
		if err != nil {
			return err
		}
		var name *string
		var phone string
		err = tx.QueryRow(ctx, `UPDATE pos.pos_customers SET password_hash = $2, updated_at = now()
			WHERE id = $1 RETURNING name, phone`, customerID, hash).Scan(&name, &phone)
		if database.IsNoRows(err) {
			return httpx.NotFound("Member not found")
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM crm.member_portal_sessions WHERE customer_id = $1`, customerID); err != nil {
			return err
		}
		if sendWhatsApp {
			target := whatsapp.NormalizeRecipient(phone)
			if target == "" {
				return httpx.BadRequest("This member has no WhatsApp number")
			}
			if err := h.ports.WhatsApp.SendText(ctx, tx, target, "Your NüHabit password: "+password, user.ID); err != nil {
				return httpx.Status(http.StatusBadGateway, "The WhatsApp message could not be sent. Reset again and read the password to the member.")
			}
		}
		return audit.Write(ctx, tx, audit.Entry{
			ActorID: user.ID, ActorName: &user.FullName, Action: "member.password_reset",
			Entity: "pos_customers", EntityID: &customerID, EntityLabel: name,
			After: map[string]any{"sent_whatsapp": sendWhatsApp},
		}.WithRequest(r))
	})
	if err != nil {
		return err
	}
	if sendWhatsApp {
		return httpx.Data(w, http.StatusOK, passwordSent{Sent: true})
	}
	return httpx.Data(w, http.StatusOK, passwordIssued{Password: password})
}

// resolveCustomerID accepts the ids the member pages use: a profile id, a
// customer id or "pos-<customer id>".
func resolveCustomerID(ctx context.Context, q database.Querier, id string) (string, error) {
	id = domain.CustomerIDOf(id)
	if !domain.IsUUIDv1to5(id) {
		return "", httpx.NotFound("Member not found")
	}
	profile, err := findProfile(ctx, q, id)
	if err != nil {
		return "", err
	}
	if profile != nil {
		return profile.Str("customer_id"), nil
	}
	return id, nil
}
