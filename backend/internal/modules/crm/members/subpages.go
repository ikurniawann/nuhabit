package members

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/members/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// activitySQL mirrors ACTIVITY_SQL in member-detail-server.ts; the wallet
// tab reads stored-value through Ports.Wallet.
var activitySQL = map[string]string{
	"checkins": `SELECT k.id, k.decision, k.reason, k.created_at, u.full_name AS cashier_name
               FROM crm.member_checkins k
               LEFT JOIN configuration.users u ON u.id = k.scanned_by
              WHERE k.customer_id = $1 ORDER BY k.created_at DESC LIMIT 100`,
	"bookings": `SELECT b.id, b.status, b.waitlist_position, b.late_cancel, b.created_at, b.cancelled_at,
                    e.id AS event_id, e.title, e.starts_at, e.location, e.price_idr::float AS price_idr
               FROM crm.event_bookings b JOIN crm.events e ON e.id = b.event_id
              WHERE b.customer_id = $1 ORDER BY e.starts_at DESC LIMIT 100`,
	"challenges": `SELECT c.id, c.title, c.metric, c.target::float AS target, c.starts_at, c.ends_at,
                      c.reward_xp, c.reward_ark_idr::float AS reward_ark_idr, j.joined_at, j.rewarded_at
                 FROM crm.challenge_joins j JOIN crm.challenges c ON c.id = j.challenge_id
                WHERE j.customer_id = $1 ORDER BY j.joined_at DESC LIMIT 100`,
	"notifications": `SELECT n.id, n.type, n.title, n.body, n.created_at, n.read_at, n.opened_at, n.clicked_at,
                         k.name AS campaign_name
                    FROM crm.member_notifications n
                    LEFT JOIN crm.crm_campaigns k ON k.id = n.campaign_id
                   WHERE n.customer_id = $1 ORDER BY n.created_at DESC LIMIT 100`,
}

// GET /api/crm/members/{id}/activity?tab=checkins|bookings|challenges|notifications|wallet
func (h *handler) activity(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateMemberRead); err != nil {
		return err
	}
	tab := r.URL.Query().Get("tab")
	sql, known := activitySQL[tab]
	if !known && tab != "wallet" {
		return httpx.BadRequest("Tab tidak dikenal")
	}
	ctx := r.Context()
	customerID, err := kit.RequireMemberCustomerID(ctx, h.db, r.PathValue("id"))
	if err != nil {
		return err
	}
	var rows []*kit.Row
	if tab == "wallet" {
		rows, err = h.ports.Wallet.Transactions(ctx, h.db, customerID)
	} else {
		rows, err = kit.Query(ctx, h.db, sql, customerID)
	}
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

// consentOut mirrors readConsent's result.
type consentOut struct {
	WaConsent       bool `json:"wa_consent"`
	WaVerifiedAt    any  `json:"wa_verified_at"`
	MarketingOptOut bool `json:"marketing_opt_out"`
	OptoutSource    any  `json:"optout_source"`
	OptoutNote      any  `json:"optout_note"`
	OptoutAt        any  `json:"optout_at"`
}

// readConsent mirrors readConsent: the portal wa_consent and the venue's
// marketing opt-out side by side; nil when the customer is missing.
func readConsent(ctx context.Context, q database.Querier, customerID string, branchID *string) (*consentOut, error) {
	row, err := kit.QueryOne(ctx, q, `SELECT c.wa_consent, c.wa_verified_at, c.phone,
            o.id AS optout_id, o.source AS optout_source, o.note AS optout_note, o.created_at AS optout_at
       FROM pos.pos_customers c
       LEFT JOIN crm.crm_marketing_optouts o
              ON o.branch_id = $2::text::uuid
             AND `+domain.SamePhoneSQL("o.phone", "c.phone")+`
      WHERE c.id = $1`, customerID, branchID)
	if err != nil || row == nil {
		return nil, err
	}
	return &consentOut{
		WaConsent:       row.Bool("wa_consent"),
		WaVerifiedAt:    row.Get("wa_verified_at"),
		MarketingOptOut: row.Get("optout_id") != nil,
		OptoutSource:    row.Get("optout_source"),
		OptoutNote:      row.Get("optout_note"),
		OptoutAt:        row.Get("optout_at"),
	}, nil
}

// GET /api/crm/members/{id}/consent
func (h *handler) consent(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateMemberRead); err != nil {
		return err
	}
	ctx := r.Context()
	customerID, err := kit.RequireMemberCustomerID(ctx, h.db, r.PathValue("id"))
	if err != nil {
		return err
	}
	data, err := readConsent(ctx, h.db, customerID, kit.DefaultVenue(ctx, h.db).BranchID)
	if err != nil {
		return err
	}
	return kit.OK(w, data)
}

// PUT /api/crm/members/{id}/consent
func (h *handler) updateConsent(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.Require(r, kit.GateMemberRead)
	if err != nil {
		return err
	}
	ctx := r.Context()
	customerID, err := kit.RequireMemberCustomerID(ctx, h.db, r.PathValue("id"))
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	waConsent := f.Bool("wa_consent", validate.Rule{Optional: true})
	optOut := f.Bool("marketing_opt_out", validate.Rule{Optional: true})
	note := f.Str("note", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Max: 300})
	if err := kit.CrmInputErr(f); err != nil {
		return err
	}

	var data *consentOut
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		venue := kit.DefaultVenue(ctx, tx)
		if waConsent != nil {
			if _, err := tx.Exec(ctx, `UPDATE pos.pos_customers SET wa_consent = $2, updated_at = now() WHERE id = $1`,
				customerID, *waConsent); err != nil {
				return err
			}
		}
		if optOut != nil {
			if venue.CompanyID == nil || venue.BranchID == nil {
				return httpx.BadRequest("Venue belum dikonfigurasi")
			}
			var phone *string
			if err := tx.QueryRow(ctx, `SELECT phone FROM pos.pos_customers WHERE id = $1`, customerID).Scan(&phone); err != nil && !database.IsNoRows(err) {
				return err
			}
			digits := ""
			if phone != nil {
				digits = domain.NormalizePhoneDigits(*phone)
			}
			if digits == "" {
				return httpx.BadRequest("Nomor member tidak valid untuk opt-out")
			}
			if *optOut {
				text := "Dari detail member"
				if note != nil && *note != "" {
					text = *note
				}
				if _, err := tx.Exec(ctx, `INSERT INTO crm.crm_marketing_optouts (company_id, branch_id, phone, customer_id, source, note, created_by)
         VALUES ($1::text::uuid, $2::text::uuid, $3, $4, 'manual', $5, $6)
         ON CONFLICT (branch_id, phone) DO NOTHING`,
					*venue.CompanyID, *venue.BranchID, digits, customerID, text, user.ID); err != nil {
					return err
				}
			} else if _, err := tx.Exec(ctx, `DELETE FROM crm.crm_marketing_optouts WHERE branch_id = $1::text::uuid AND `+
				domain.SamePhoneSQL("phone", "$2"), *venue.BranchID, digits); err != nil {
				return err
			}
		}
		var err error
		data, err = readConsent(ctx, tx, customerID, venue.BranchID)
		return err
	})
	if err != nil {
		return err
	}
	return kit.OK(w, data, "Persetujuan disimpan")
}

// GET /api/crm/members/{id}/badges: every active badge (plus owned ones)
// with the member's owned/revoked state.
func (h *handler) badges(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateMemberRead); err != nil {
		return err
	}
	ctx := r.Context()
	customerID, err := kit.RequireMemberCustomerID(ctx, h.db, r.PathValue("id"))
	if err != nil {
		return err
	}
	rows, err := kit.Query(ctx, h.db, `SELECT b.id, b.code, b.name, b.image_url, b.metric, b.threshold::float AS threshold,
            b.min_lifetime_xp, b.bonus_xp, b.is_active,
            mb.awarded_at, mb.source, rv.revoked_at, rv.reason AS revoke_reason
       FROM crm.crm_badges b
       LEFT JOIN crm.crm_member_badges mb ON mb.badge_id = b.id AND mb.customer_id = $1
       LEFT JOIN crm.crm_member_badge_revocations rv ON rv.badge_id = b.id AND rv.customer_id = $1
      WHERE b.is_active OR mb.id IS NOT NULL
      ORDER BY (mb.id IS NULL), b.name`, customerID)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

// POST /api/crm/members/{id}/badges: award or revoke a badge manually.
func (h *handler) badgeAction(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.Require(r, kit.GateMemberLoyaltyWrite)
	if err != nil {
		return err
	}
	ctx := r.Context()
	customerID, err := kit.RequireMemberCustomerID(ctx, h.db, r.PathValue("id"))
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	badgeID := f.UUID("badge_id", validate.Rule{})
	action := f.Enum("action", validate.Rule{}, []string{"award", "revoke"})
	reason := f.Str("reason", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Trim: true, Max: 300})
	if err := kit.CrmInputErr(f); err != nil {
		return err
	}

	if *action == "award" {
		var awarded bool
		err := database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
			var err error
			awarded, err = h.awardBadgeManually(ctx, tx, customerID, *badgeID, user.ID)
			return err
		})
		if err != nil {
			return err
		}
		msg := "Member sudah memiliki badge ini"
		if awarded {
			msg = "Badge diberikan"
		}
		return kit.OK(w, struct {
			Awarded bool `json:"awarded"`
		}{awarded}, msg)
	}

	var revokeReason *string
	if reason != nil && *reason != "" {
		revokeReason = reason
	}
	var revoked bool
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM crm.crm_member_badges WHERE customer_id = $1 AND badge_id = $2`, customerID, *badgeID)
		if err != nil {
			return err
		}
		revoked = tag.RowsAffected() > 0
		_, err = tx.Exec(ctx, `INSERT INTO crm.crm_member_badge_revocations (customer_id, badge_id, reason, revoked_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (customer_id, badge_id)
       DO UPDATE SET reason = EXCLUDED.reason, revoked_by = EXCLUDED.revoked_by, revoked_at = now()`,
			customerID, *badgeID, revokeReason, user.ID)
		return err
	})
	if err != nil {
		return err
	}
	return kit.OK(w, struct {
		Revoked bool `json:"revoked"`
	}{revoked}, "Badge dicabut")
}

// awardBadgeManually mirrors awardBadgeManually: clear an earlier
// revocation, record the badge, and post its bonus XP once per member
// through the XP engine (in the same transaction).
func (h *handler) awardBadgeManually(ctx context.Context, tx pgx.Tx, customerID, badgeID, actorID string) (bool, error) {
	var name string
	var bonusXP float64
	err := tx.QueryRow(ctx, `SELECT name, bonus_xp::float8 FROM crm.crm_badges WHERE id = $1`, badgeID).Scan(&name, &bonusXP)
	if database.IsNoRows(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM crm.crm_member_badge_revocations WHERE customer_id = $1 AND badge_id = $2`, customerID, badgeID); err != nil {
		return false, err
	}
	tag, err := tx.Exec(ctx, `INSERT INTO crm.crm_member_badges (customer_id, member_id, badge_id, source, awarded_by)
       SELECT $1, (SELECT id FROM crm.crm_member_profiles WHERE customer_id = $1), $2, 'manual', $3
       ON CONFLICT (customer_id, badge_id) DO NOTHING`, customerID, badgeID, actorID)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}
	if bonusXP > 0 {
		if _, err := h.engine.AwardBadgeBonusXP(ctx, tx, customerID, badgeID, name, bonusXP, kit.DefaultVenue(ctx, tx)); err != nil {
			return false, err
		}
	}
	return true, nil
}
