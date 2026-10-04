package inbox

import (
	"encoding/json"
	"net/http"

	"nuhabit/backend/internal/modules/crm/inbox/domain"
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/httpx"
)

// The Instagram Messaging webhook is public on purpose: Meta calls it
// without a session and authenticates with an HMAC over the raw body.

func plainText(w http.ResponseWriter, status int, contentType, body string) error {
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(status)
	_, err := w.Write([]byte(body))
	return err
}

// textPlain is what new NextResponse(string) sends.
const textPlain = "text/plain;charset=UTF-8"

// instagramHandshake answers Meta's subscription check with hub.challenge.
func (h *handler) instagramHandshake(w http.ResponseWriter, r *http.Request) error {
	cfg := h.Instagram.WebhookConfig(r.Context(), h.db)
	if cfg == nil {
		return plainText(w, http.StatusServiceUnavailable, textPlain, "Instagram belum dikonfigurasi")
	}
	challenge, ok := domain.SubscribeChallenge(r.URL.Query(), cfg.VerifyToken)
	if !ok {
		return plainText(w, http.StatusForbidden, textPlain, "Forbidden")
	}
	return plainText(w, http.StatusOK, "text/plain", challenge)
}

// instagramWebhook stores each message of a signed payload. It answers 200
// whenever the signature holds: a non-2xx makes Meta resend and finally
// disable the subscription, so one failing message is only logged.
func (h *handler) instagramWebhook(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	cfg := h.Instagram.WebhookConfig(ctx, h.db)
	if cfg == nil {
		return plainText(w, http.StatusServiceUnavailable, textPlain, "Instagram belum dikonfigurasi")
	}
	raw, err := kit.RawBody(r)
	if err != nil {
		return err
	}
	if !domain.VerifySignature(raw, r.Header.Get("X-Hub-Signature-256"), cfg.AppSecret) {
		return plainText(w, http.StatusUnauthorized, textPlain, "Signature tidak valid")
	}
	var payload any
	if json.Unmarshal(raw, &payload) != nil {
		// A malformed body will not improve on resend.
		return httpx.JSON(w, http.StatusOK, struct {
			Received bool `json:"received"`
		}{true})
	}
	stored := 0
	for _, m := range domain.NormalizeInstagramWebhook(payload) {
		ok, err := recordMessage(ctx, h.db, m)
		if err != nil {
			h.log.Error("Gagal menyimpan pesan Instagram", "error", err)
			continue
		}
		if ok {
			stored++
		}
	}
	return httpx.JSON(w, http.StatusOK, struct {
		Received bool `json:"received"`
		Stored   int  `json:"stored"`
	}{true, stored})
}
