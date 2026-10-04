package webhooks

import (
	"context"
	"crypto/subtle"
	"net/http"
	"time"

	"nuhabit/backend/internal/modules/integrations/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// POST /api/wa/inbound: messages.upsert events from the self-hosted
// WhatsApp gateway, authenticated by the shared WA_GATEWAY_TOKEN. The app
// is reachable from the internet, so: constant-time token compare, a global
// backoff after repeated wrong tokens, and caps on body size and batch.

const (
	inboundMaxBody    = 512 * 1024 // UTF-16 units, as raw.length counts
	inboundMaxBatch   = 200
	inboundFailLimit  = 10
	inboundFailWindow = time.Minute
)

// fail writes {success: false, error: msg}.
func fail(w http.ResponseWriter, status int, msg string) {
	_ = httpx.JSON(w, status, struct {
		Success bool   `json:"success"`
		Error   string `json:"error"`
	}{false, msg})
}

// inboundFailKey counts wrong wa/inbound tokens across every replica.
const inboundFailKey = "wa-inbound:auth-failures"

// tooManyFailures reports whether the wrong tokens of the last window
// reached the limit.
func (h *Handler) tooManyFailures(ctx context.Context, now time.Time) (bool, error) {
	n, err := h.limiter.SlidingCount(ctx, inboundFailKey, inboundFailWindow, now)
	return n >= inboundFailLimit, err
}

func (h *Handler) recordFailure(ctx context.Context, now time.Time) error {
	_, _, err := h.limiter.Sliding(ctx, inboundFailKey, inboundFailLimit, inboundFailWindow, now)
	return err
}

// tokenMatches compares in constant time once the lengths agree.
func tokenMatches(provided, expected string) bool {
	return provided != "" && len(provided) == len(expected) &&
		subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

func (h *Handler) waInbound(w http.ResponseWriter, r *http.Request) {
	token := h.getenv("WA_GATEWAY_TOKEN")
	if token == "" {
		fail(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	ctx, now := r.Context(), h.now()
	locked, err := h.tooManyFailures(ctx, now)
	if err != nil {
		h.log.ErrorContext(ctx, "[wa-inbound] Gagal membaca batas percobaan", "error", err)
		fail(w, http.StatusInternalServerError, "Terjadi kesalahan server")
		return
	}
	if locked {
		fail(w, http.StatusTooManyRequests, "Too many attempts")
		return
	}
	if !tokenMatches(r.Header.Get("x-gateway-token"), token) {
		if err := h.recordFailure(ctx, now); err != nil {
			h.log.ErrorContext(ctx, "[wa-inbound] Gagal mencatat token salah", "error", err)
		}
		fail(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	raw, err := readBody(r, 4*inboundMaxBody)
	if err != nil {
		fail(w, http.StatusBadRequest, "JSON tidak valid")
		return
	}
	if validate.UTF16Len(string(raw)) > inboundMaxBody {
		fail(w, http.StatusRequestEntityTooLarge, "Payload terlalu besar")
		return
	}
	parsed, ok := domain.ParseJSON(raw)
	if !ok {
		fail(w, http.StatusBadRequest, "JSON tidak valid")
		return
	}
	payloads, _ := domain.Obj(parsed)["messages"].([]any)
	payloads = payloads[:min(len(payloads), inboundMaxBatch)]

	stored, skipped := 0, 0
	for _, payload := range payloads {
		m := domain.NormalizeInbound(payload)
		if m == nil {
			skipped++
			continue
		}
		recorded, err := h.receive(r, *m)
		switch {
		case recorded:
			stored++
		case err == nil: // an echo of a message already stored
			skipped++
		}
		if err != nil {
			// One bad message must not fail the rest; the gateway does not
			// resend a batch answered 200.
			h.log.ErrorContext(r.Context(), "[wa-inbound] Gagal merekam pesan", "error", err)
		}
	}
	_ = httpx.JSON(w, http.StatusOK, struct {
		Success bool `json:"success"`
		Stored  int  `json:"stored"`
		Skipped int  `json:"skipped"`
	}{true, stored, skipped})
}

// receive stores one message and, for a customer's message, applies the
// CS rules and sends their auto-reply. recorded is true once the message is
// stored, even when a later step fails.
func (h *Handler) receive(r *http.Request, m domain.GatewayInbound) (recorded bool, err error) {
	ctx := r.Context()
	recorded, conversationID, err := h.ports.Inbox.Record(ctx, h.db, m)
	if err != nil || !recorded {
		return false, err
	}
	// CS rules apply to the customer's messages, not to manual replies
	// typed on the business phone (direction out).
	if m.Direction != "in" || conversationID == "" {
		return true, nil
	}
	at := h.now()
	if m.SentAt != nil {
		at = *m.SentAt
	}
	reply, err := h.ports.Inbox.OnInbound(ctx, h.db, conversationID, m.Body, at)
	if err != nil {
		return true, err
	}
	if reply != nil && *reply != "" && m.Channel == "whatsapp" && m.Phone != nil {
		h.ports.Inbox.AutoReply(ctx, h.db, *m.Phone, conversationID, *reply)
	}
	return true, nil
}
