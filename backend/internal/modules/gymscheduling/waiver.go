package gymscheduling

import (
	"context"
	"net/http"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/audit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Waiver: booking and gate entry need the current waiver when the branch
// rule requireWaiver is on. Members accept it in the app; staff can record
// an acceptance at the front desk, which keeps the staff account and time.

// errorCode tags an httpx.Error (in Details) so a client can react to the
// failure, such as the member app linking a waiver denial to the waiver screen.
type errorCode string

const codeWaiverRequired errorCode = "waiver_required"

// eligibilityError is the 409 for a booking denial, tagged when the waiver
// is missing.
func eligibilityError(in domain.EligibilityInput, reason domain.BookingDenialReason) error {
	err := schedulingError(in.DenialMessage(reason))
	if reason == domain.DenyWaiverRequired {
		err.Details = codeWaiverRequired
	}
	return err
}

// requireWaiver fails when the branch rules need a waiver the member has
// not accepted in its current version.
func (s *Service) requireWaiver(ctx context.Context, q Q, customerID string, branchID *string) error {
	rules, err := s.Rules.ForBranch(ctx, q, branchID)
	if err != nil {
		return err
	}
	member, err := s.Members.Get(ctx, q, customerID)
	if err != nil {
		return err
	}
	if s.waiverMissing(rules, member) {
		err := schedulingError("Waiver member belum disetujui. Catat persetujuan waiver di front desk dulu.")
		err.Details = codeWaiverRequired
		return err
	}
	return nil
}

// WaiverRecord is the stored acceptance after the desk records it.
type WaiverRecord struct {
	Version    string    `json:"version"`
	AcceptedAt time.Time `json:"accepted_at"`
	AcceptedBy string    `json:"accepted_by"`
}

// RecordWaiverAtDesk stores the current waiver as accepted by the member,
// with the staff account and time, and writes an audit row.
func (s *Service) RecordWaiverAtDesk(ctx context.Context, customerID string, staff *auth.User, r *http.Request) (out WaiverRecord, err error) {
	now := s.now()
	version := s.WaiverVersion
	if version == "" {
		return out, schedulingError("Versi waiver belum diatur", http.StatusInternalServerError)
	}
	err = s.inTx(ctx, func(q Q) error {
		var name *string
		var before struct {
			Version    *string    `json:"version"`
			AcceptedAt *time.Time `json:"accepted_at"`
		}
		err := q.QueryRow(ctx, `SELECT name, waiver_version, waiver_accepted_at FROM pos.pos_customers WHERE id = $1 FOR UPDATE`,
			customerID).Scan(&name, &before.Version, &before.AcceptedAt)
		if database.IsNoRows(err) {
			return schedulingError("Member tidak ditemukan", http.StatusNotFound)
		}
		if err != nil {
			return err
		}
		if _, err := q.Exec(ctx, `UPDATE pos.pos_customers
		    SET waiver_version = $2, waiver_accepted_at = $3, waiver_accepted_by = $4, updated_at = now()
		  WHERE id = $1`, customerID, version, now, staff.ID); err != nil {
			return err
		}
		out = WaiverRecord{Version: version, AcceptedAt: now, AcceptedBy: staff.ID}
		entityID := customerID
		return audit.Write(ctx, q, audit.Entry{
			ActorID: staff.ID, Action: "gym.waiver.record_at_desk", Entity: "pos_customers",
			EntityID: &entityID, EntityLabel: name, Before: before, After: out,
		}.WithRequest(r))
	})
	return out, err
}

// recordWaiver is POST /api/gym/checkin/members/{id}/waiver {accepted: true}:
// the member read and accepted the waiver at the desk.
func (h *handler) recordWaiver(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	id, err := requireUUID(r.PathValue("id"))
	if err != nil {
		return err
	}
	f := form(r)
	accepted := f.Bool("accepted", validate.Rule{})
	if err := invalid(f); err != nil {
		return err
	}
	if !*accepted {
		return httpx.BadRequest("Centang persetujuan waiver dulu")
	}
	out, err := h.svc.RecordWaiverAtDesk(r.Context(), id, user, r)
	if err != nil {
		return err
	}
	return ok(w, out)
}
