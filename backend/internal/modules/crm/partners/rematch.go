package partners

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"unicode/utf16"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/partners/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// discriminatorIssue is zod's issue for a discriminated union without a
// matching option.
type discriminatorIssue struct {
	Code          string   `json:"code"`
	Errors        []any    `json:"errors"`
	Note          string   `json:"note"`
	Discriminator string   `json:"discriminator"`
	Options       []string `json:"options"`
	Path          []any    `json:"path"`
	Message       string   `json:"message"`
}

// rematch matches events again: one event to a member found by phone or
// email (manual), or every pending event (auto). XP is awarded when the
// partner is active and awards XP.
func (h *handler) rematch(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.Require(r, kit.GatePartners)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	if err := kit.CrmInputErr(f); err != nil {
		return err // not an object
	}
	ctx := r.Context()
	switch mode, _ := f.Fields()["mode"].(string); mode {
	case "manual":
		eventID := f.UUID("event_id", required)
		identifier := f.Str("identifier", required, validate.StrOpts{Trim: true, Min: 5, Max: 200})
		if err := kit.CrmInputErr(f); err != nil {
			return err
		}
		customerID, err := findMember(ctx, h.db, *identifier)
		if err != nil {
			return err
		}
		if customerID == "" {
			return httpx.NotFound("Member dengan telepon/email itu tidak ditemukan (atau lebih dari satu)")
		}
		event, err := h.events.settle(ctx, h.db, *eventID, &customerID, &user.ID)
		if err != nil {
			return err
		}
		if event == nil {
			return httpx.NotFound("Event tidak ditemukan")
		}
		return kit.OK(w, event, "Event dicocokkan ke member")
	case "auto":
		partnerID := f.UUID("partner_id", validate.Rule{Optional: true, Nullable: true})
		if err := kit.CrmInputErr(f); err != nil {
			return err
		}
		result, err := h.rematchPending(ctx, partnerID)
		if err != nil {
			return err
		}
		return kit.OK(w, result, fmt.Sprintf("%d dari %d event berhasil dicocokkan", result.Matched, result.Checked))
	}
	return httpx.BadRequest("Data tidak valid", []discriminatorIssue{{
		Code: "invalid_union", Errors: []any{}, Note: "No matching discriminator", Discriminator: "mode",
		Options: []string{"manual", "auto"}, Path: []any{"mode"}, Message: "Invalid discriminator value. Expected 'manual' | 'auto'",
	}})
}

// findMember mirrors findMemberForSubject: the member a subject means, or
// "" when none or more than one fits.
func findMember(ctx context.Context, q database.Querier, subject string) (string, error) {
	value := validate.JSTrim(subject)
	if value == "" {
		return "", nil
	}
	rows, err := q.Query(ctx, `SELECT id::text, email, phone FROM pos.pos_customers
      WHERE is_active IS DISTINCT FROM false
        AND (lower(email) = lower($1)
             OR ($2::text IS NOT NULL AND right(regexp_replace(phone, '\D', '', 'g'), 8) = $2))
      LIMIT 10`, value, domain.PhoneTail(value))
	if err != nil {
		return "", err
	}
	candidates, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.MatchCandidate, error) {
		var c domain.MatchCandidate
		err := row.Scan(&c.CustomerID, &c.Email, &c.Phone)
		return c, err
	})
	if err != nil {
		return "", err
	}
	return domain.MatchSubject(value, candidates), nil
}

type settledEvent struct {
	ID         string  `json:"id"`
	Status     string  `json:"status"`
	CustomerID *string `json:"customer_id"`
	XPAwarded  int     `json:"xp_awarded"`
}

// settle mirrors settleEvent: match one event (customerID set = a
// manual match by actorID) and award XP when due. The award is idempotent
// per event, so settling again is safe. nil when the event does not exist.
func (s Events) settle(ctx context.Context, db database.DB, eventID string, customerID, actorID *string) (*settledEvent, error) {
	var eventType, partnerName, partnerType string
	var identifier *string
	var partner domain.Partner
	err := db.QueryRow(ctx, `SELECT e.event_type, e.customer_identifier, p.name, p.partner_type,
            p.is_active, p.awards_xp, p.xp_per_event::float8
       FROM crm.crm_external_events e
       JOIN crm.crm_integration_partners p ON p.id = e.partner_id
      WHERE e.id = $1`, eventID).Scan(&eventType, &identifier, &partnerName, &partnerType,
		&partner.IsActive, &partner.AwardsXP, &partner.XPPerEvent)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if customerID == nil && identifier != nil {
		found, err := findMember(ctx, db, *identifier)
		if err != nil {
			return nil, err
		}
		if found != "" {
			customerID = &found
		}
	}
	decision := domain.DecideEvent(partner, customerID != nil)
	status := decision.Status
	xpAwarded := 0
	var ledgerID, errorMessage *string
	if customerID != nil && decision.XP > 0 {
		// The TS ran the award outside any transaction and caught its error;
		// a savepoint keeps a failed award from leaving partial rows.
		err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
			venue := kit.DefaultVenue(ctx, tx)
			res, err := s.engine.AwardPartnerEventXP(ctx, tx, *customerID, eventID, domain.LedgerChannel(partnerType),
				partnerName+": "+eventType, float64(decision.XP), venue)
			if err == nil && res.Status == "posted" {
				xpAwarded = int(res.XPAwarded)
				if len(res.LedgerIDs) > 0 {
					ledgerID = &res.LedgerIDs[0]
				}
			}
			return err
		})
		if err != nil {
			status = "failed"
			xpAwarded, ledgerID = 0, nil
			msg := errorText(err)
			errorMessage = &msg
		}
	}
	var out settledEvent
	err = db.QueryRow(ctx, `UPDATE crm.crm_external_events
        SET customer_id = $2,
            member_id = (SELECT id FROM crm.crm_member_profiles WHERE customer_id = $2),
            processing_status = $3,
            xp_awarded = CASE WHEN $4::int > 0 THEN $4 ELSE xp_awarded END,
            xp_ledger_id = COALESCE($5, xp_ledger_id),
            error_message = $6,
            matched_by = COALESCE($7, matched_by),
            processed_at = now()
      WHERE id = $1
      RETURNING id::text, processing_status, customer_id::text, xp_awarded`,
		eventID, customerID, status, xpAwarded, ledgerID, errorMessage, actorID).
		Scan(&out.ID, &out.Status, &out.CustomerID, &out.XPAwarded)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// errorText is the JS error.message (a pg error's message without the
// SQLSTATE suffix), cut at 300 UTF-16 units.
func errorText(err error) string {
	msg := err.Error()
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		msg = pgErr.Message
	}
	if units := utf16.Encode([]rune(msg)); len(units) > 300 {
		msg = string(utf16.Decode(units[:300]))
	}
	return msg
}

type rematchResult struct {
	Checked int `json:"checked"`
	Matched int `json:"matched"`
}

// rematchPending settles every unmatched, failed or pending event again
// (optionally one partner's), oldest first, at most 500.
func (h *handler) rematchPending(ctx context.Context, partnerID *string) (rematchResult, error) {
	rows, err := h.db.Query(ctx, `SELECT id::text FROM crm.crm_external_events
      WHERE processing_status IN ('unmatched', 'failed', 'pending')
        AND ($1::uuid IS NULL OR partner_id = $1)
      ORDER BY received_at
      LIMIT 500`, partnerID)
	if err != nil {
		return rematchResult{}, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return rematchResult{}, err
	}
	result := rematchResult{Checked: len(ids)}
	for _, id := range ids {
		settled, err := h.events.settle(ctx, h.db, id, nil, nil)
		if err != nil {
			return rematchResult{}, err
		}
		if settled != nil && settled.Status == "processed" {
			result.Matched++
		}
	}
	return result, nil
}
