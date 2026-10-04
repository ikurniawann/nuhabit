package partners

import (
	"context"
	"strings"

	"nuhabit/backend/internal/modules/crm/partners/domain"
	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/validate"
)

// Events stores and settles loyalty partner events (lib/crm/
// partners-server.ts). The loyalty-events webhook of the integrations
// module reaches it through internal/app.
type Events struct{ engine *xp.Engine }

// NewEvents builds the service; XP goes through the CRM engine.
func NewEvents(engine *xp.Engine) Events { return Events{engine: engine} }

// Partner is the part of a crm_integration_partners row the webhook reads.
type Partner struct {
	ID            string
	IsActive      bool
	SigningSecret string
}

// FindPartner is findPartnerByCode (code trimmed and upper-cased); nil when
// no partner has it.
func (Events) FindPartner(ctx context.Context, q database.Querier, code string) (*Partner, error) {
	var p Partner
	var secret *string
	err := q.QueryRow(ctx, `SELECT id::text, is_active, signing_secret FROM crm.crm_integration_partners WHERE code = $1`,
		strings.ToUpper(validate.JSTrim(code))).Scan(&p.ID, &p.IsActive, &secret)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if secret != nil {
		p.SigningSecret = *secret
	}
	return &p, nil
}

// Event is ingestPartnerEvent's input.
type Event struct {
	ExternalID string
	EventType  string
	Subject    *string
	OccurredAt *string
	// Payload is the event's JSON object.
	Payload []byte
}

// Ingested is the stored event and whether it was a resend.
type Ingested struct {
	ID        string
	Status    string
	XPAwarded int
	Duplicate bool
}

// Ingest is ingestPartnerEvent: the event is stored first and always (an
// unknown member is still a fact), once per external id, then settled
// (member match and XP). A resend returns the stored event.
func (s Events) Ingest(ctx context.Context, db database.DB, partnerID string, e Event) (Ingested, error) {
	var partnerType string
	if err := db.QueryRow(ctx, `SELECT partner_type FROM crm.crm_integration_partners WHERE id = $1`, partnerID).Scan(&partnerType); err != nil {
		return Ingested{}, err
	}
	var id string
	err := db.QueryRow(ctx, `INSERT INTO crm.crm_external_events
       (partner_id, external_event_id, source_channel, event_type, customer_identifier, occurred_at, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (partner_id, external_event_id) DO NOTHING
     RETURNING id::text`, partnerID, e.ExternalID, domain.EventChannel(partnerType), e.EventType, e.Subject, e.OccurredAt, string(e.Payload)).Scan(&id)
	if database.IsNoRows(err) {
		out := Ingested{Duplicate: true}
		err = db.QueryRow(ctx, `SELECT id::text, processing_status, xp_awarded FROM crm.crm_external_events
         WHERE partner_id = $1 AND external_event_id = $2`, partnerID, e.ExternalID).Scan(&out.ID, &out.Status, &out.XPAwarded)
		return out, err
	}
	if err != nil {
		return Ingested{}, err
	}
	settled, err := s.settle(ctx, db, id, nil, nil)
	if err != nil || settled == nil {
		return Ingested{}, err
	}
	return Ingested{ID: settled.ID, Status: settled.Status, XPAwarded: settled.XPAwarded}, nil
}
