package webhooks

import (
	"encoding/json"
	"net/http"

	"nuhabit/backend/internal/modules/integrations/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// POST /api/integrations/loyalty-events/{partner}: events from loyalty
// partners (photobooth, game studio). X-Timestamp (Unix seconds, within 5
// minutes) and X-Signature (sha256=<hex HMAC of the raw body>) are
// required. Idempotent per external_id: a resend awards no second XP.

const partnerMaxBody = 64 * 1024

func (h *Handler) loyaltyEvent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	raw, err := readBody(r, partnerMaxBody)
	if err != nil {
		raw = nil
	}
	if len(raw) > partnerMaxBody {
		fail(w, http.StatusRequestEntityTooLarge, "Payload terlalu besar")
		return
	}
	partner, err := h.ports.Partners.FindByCode(ctx, h.db, r.PathValue("partner"))
	if err != nil {
		h.log.ErrorContext(ctx, "[loyalty-events] partner lookup", "error", err)
		fail(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	// An inactive partner, or one without a secret, can send nothing.
	if partner == nil || !partner.IsActive || !domain.IsTimestampFresh(r.Header.Get(domain.PartnerTimestampHeader), h.now()) ||
		!domain.VerifyPartnerSignature(raw, r.Header.Get(domain.PartnerSignatureHeader), partner.SigningSecret) {
		fail(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	body, ok := domain.ParseJSON(raw)
	if !ok {
		fail(w, http.StatusBadRequest, "Body bukan JSON")
		return
	}
	event, ok := parsePartnerEvent(body)
	if !ok {
		fail(w, http.StatusBadRequest, "Data event tidak valid")
		return
	}
	res, err := h.ports.Partners.Ingest(ctx, h.db, *partner, event)
	if err != nil {
		h.log.ErrorContext(ctx, "[loyalty-events] ingest error", "error", err)
		fail(w, http.StatusInternalServerError, "Gagal memproses event")
		return
	}
	type view struct {
		ID        string `json:"id"`
		Status    string `json:"status"`
		XPAwarded int    `json:"xp_awarded"`
		Duplicate bool   `json:"duplicate"`
	}
	_ = httpx.Data(w, http.StatusOK, view{res.ID, res.Status, res.XPAwarded, res.Duplicate})
}

// parsePartnerEvent is the route's zod schema plus the subject pick
// (email, else phone, else subject).
func parsePartnerEvent(body any) (PartnerEvent, bool) {
	f := validate.New(body, true)
	externalID := f.Str("external_id", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 200})
	eventType := f.Str("event_type", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 80})
	opt := validate.Rule{Optional: true, Nullable: true}
	email := f.Str("email", opt, validate.StrOpts{Trim: true, Max: 200})
	phone := f.Str("phone", opt, validate.StrOpts{Trim: true, Max: 40})
	subject := f.Str("subject", opt, validate.StrOpts{Trim: true, Max: 200})
	occurredAt := f.Str("occurred_at", opt, validate.StrOpts{Check: validate.DatetimeCheck})
	payload := []byte("{}")
	if v, sent := f.Fields()["payload"]; sent {
		if p, isObject := v.(map[string]any); isObject {
			payload, _ = json.Marshal(p)
		} else {
			f.Fail("payload", "invalid_type", "Invalid input: expected record")
		}
	}
	if !f.Valid() {
		return PartnerEvent{}, false
	}
	e := PartnerEvent{ExternalID: *externalID, EventType: *eventType, OccurredAt: occurredAt, Payload: payload}
	for _, s := range []*string{email, phone, subject} {
		if s != nil && *s != "" {
			e.Subject = s
			break
		}
	}
	return e, true
}
