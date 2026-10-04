package settings

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"time"

	"nuhabit/backend/internal/modules/integrations/domain"
	"nuhabit/backend/internal/modules/integrations/internal/appsettings"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
	"nuhabit/backend/internal/platform/whatsapp"
)

// The self-hosted WhatsApp gateway (services/wa-gateway) page: stored URL
// and token, live status and pairing QR (super_admin: the QR is the
// WhatsApp session credential), the message log, and the owner
// notification settings with their test send.

const (
	waGatewayURL   = "wa_gateway_url"
	waGatewayToken = "wa_gateway_token"
	// shiftReportRecipients is POS_SHIFT_REPORT_WA_RECIPIENTS.
	shiftReportRecipients = "pos_shift_report_wa_recipients"
)

// gateway is loadGatewayConfig read fresh: a new client has an empty
// cache, which is what invalidateGatewayConfigCache gives the TS.
func (h *Handler) gateway(ctx context.Context) *whatsapp.Gateway {
	c := whatsapp.New(h.log)
	c.Getenv = h.getenv
	return c.LoadGateway(ctx, h.db)
}

// gatewayGet is callGateway(GET path): the status and the raw reply; err
// when the request failed or timed out.
func gatewayGet(ctx context.Context, g *whatsapp.Gateway, path string, timeout time.Duration) (int, []byte, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, g.BaseURL+path, nil)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-gateway-token", g.Token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return 0, nil, err
	}
	return res.StatusCode, raw, nil
}

// gatewayStatus is getGatewayStatus: the /health object as sent, whatever
// the HTTP status; nil when the gateway is unreachable or answers something
// else. connected is its `connected` field.
func gatewayStatus(ctx context.Context, g *whatsapp.Gateway) (status json.RawMessage, connected bool) {
	_, raw, err := gatewayGet(ctx, g, "/health", g.Timeout)
	if err != nil {
		return nil, false
	}
	data, _ := domain.ParseJSON(raw)
	switch data.(type) {
	case map[string]any, []any: // typeof [] === "object" passes too
		return bytes.TrimSpace(raw), domain.Truthy(domain.Obj(data)["connected"])
	}
	return nil, false
}

// pairingQR is fetchPairingQr: the gateway's QR string, nil when absent.
func pairingQR(ctx context.Context, g *whatsapp.Gateway) *string {
	status, raw, err := gatewayGet(ctx, g, "/qr", 5*time.Second)
	if err != nil || status < 200 || status > 299 {
		return nil
	}
	data, _ := domain.ParseJSON(raw)
	qr, isString := domain.Obj(data)["qr"].(string)
	if !isString {
		return nil
	}
	return &qr
}

type waGatewaySettings struct {
	URL          string  `json:"url"`
	TokenMasked  *string `json:"token_masked"`
	TokenFromEnv bool    `json:"token_from_env"`
}

// GET /api/settings/wa-gateway
func (h *Handler) getWaGateway(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requireSuperAdmin(r); err != nil {
		return err
	}
	ctx := r.Context()
	stored, err := appsettings.GetMany(ctx, h.db, waGatewayURL, waGatewayToken)
	if err != nil {
		return err
	}
	settings := waGatewaySettings{
		URL:          stored.Str(waGatewayURL),
		TokenMasked:  appsettings.Mask(stored[waGatewayToken]),
		TokenFromEnv: stored.Str(waGatewayToken) == "" && h.getenv("WA_GATEWAY_TOKEN") != "",
	}
	g := h.gateway(ctx)
	if g == nil {
		return httpx.Data(w, http.StatusOK, struct {
			Configured bool              `json:"configured"`
			Status     any               `json:"status"`
			QR         any               `json:"qr"`
			Settings   waGatewaySettings `json:"settings"`
		}{false, nil, nil, settings})
	}
	type live struct {
		Configured bool              `json:"configured"`
		Reachable  bool              `json:"reachable"`
		Status     json.RawMessage   `json:"status"`
		QR         *string           `json:"qr"`
		Settings   waGatewaySettings `json:"settings"`
	}
	status, connected := gatewayStatus(ctx, g)
	if status == nil {
		return httpx.Data(w, http.StatusOK, live{true, false, nil, nil, settings})
	}
	var qr *string
	if !connected {
		qr = pairingQR(ctx, g)
	}
	return httpx.Data(w, http.StatusOK, live{true, true, status, qr, settings})
}

var httpURL = regexp.MustCompile(`^https?://`)

// PATCH /api/settings/wa-gateway: an empty token means "keep"; an empty URL
// falls back to the env/default.
func (h *Handler) patchWaGateway(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requireSuperAdmin(r); err != nil {
		return err
	}
	body, ok := lenientBody(r)
	if !ok {
		body = map[string]any{}
	}
	f := validate.New(body, true)
	url := f.Str("url", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Max: 300})
	token := f.Str("token", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Max: 300})
	if !f.Valid() {
		return httpx.BadRequest("Payload tidak valid")
	}
	ctx := r.Context()
	if url != nil {
		if *url != "" && !httpURL.MatchString(*url) {
			return httpx.BadRequest("URL harus diawali http:// atau https://")
		}
		if err := appsettings.Set(ctx, h.db, waGatewayURL, appsettings.Ptr(*url)); err != nil {
			return err
		}
	}
	if token != nil && *token != "" {
		if err := appsettings.Set(ctx, h.db, waGatewayToken, token); err != nil {
			return err
		}
	}
	g := h.gateway(ctx)
	var status json.RawMessage
	if g != nil {
		status, _ = gatewayStatus(ctx, g)
	}
	return httpx.Data(w, http.StatusOK, struct {
		Configured bool            `json:"configured"`
		Reachable  bool            `json:"reachable"`
		Status     json.RawMessage `json:"status"`
	}{g != nil, status != nil, status})
}

/* ── message log ─────────────────────────────────────────────────────── */

// MessageFilter is the log page's query.
type MessageFilter struct {
	Direction, Type, Status, Search string
	// Limit is the SQL LIMIT as the TS passes it (a JS number).
	Limit string
}

// MessageRow is one crm.wa_messages row of the log.
type MessageRow struct {
	ID                string        `json:"id"`
	Direction         string        `json:"direction"`
	MessageType       string        `json:"message_type"`
	Phone             *string       `json:"phone"`
	Body              *string       `json:"body"`
	MediaType         *string       `json:"media_type"`
	Status            string        `json:"status"`
	Provider          *string       `json:"provider"`
	ProviderMessageID *string       `json:"provider_message_id"`
	ErrorReason       *string       `json:"error_reason"`
	WaFromMe          bool          `json:"wa_from_me"`
	CreatedAt         *httpx.JSTime `json:"created_at"`
	CustomerName      *string       `json:"customer_name"`
}

// MessageSummary counts the whole log.
type MessageSummary struct {
	TotalOut    int `json:"total_out"`
	TotalIn     int `json:"total_in"`
	TotalFailed int `json:"total_failed"`
}

// OutboundMessage is the row a resend reads.
type OutboundMessage struct {
	ID             string
	Phone          *string
	Body           *string
	MessageType    string
	Status         string
	ConversationID *string
}

// messageLimit is the TS limit: a positive finite number capped at 200,
// else 100.
func messageLimit(raw *string) string {
	if raw != nil {
		if n := domain.StringNumber(*raw); n > 0 && n <= 1e308 {
			return validate.JSNumber(min(n, 200))
		}
	}
	return "100"
}

// GET /api/settings/wa-gateway/messages (super_admin: phone numbers and
// message bodies are PII).
func (h *Handler) listMessages(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requireSuperAdmin(r); err != nil {
		return err
	}
	q := r.URL.Query()
	var limit *string
	if q.Has("limit") {
		v := q.Get("limit")
		limit = &v
	}
	f := MessageFilter{Direction: q.Get("direction"), Type: q.Get("type"), Status: q.Get("status"),
		Search: validate.JSTrim(q.Get("search")), Limit: messageLimit(limit)}
	rows, summary, err := h.ports.Messages.List(r.Context(), h.db, f)
	if err != nil {
		return err
	}
	type page struct {
		Messages []MessageRow   `json:"messages"`
		Summary  MessageSummary `json:"summary"`
	}
	return httpx.Data(w, http.StatusOK, page{rows, summary})
}

// POST /api/settings/wa-gateway/messages {id}: resend a failed outbound
// message once. OTPs are excluded: their code is stale.
func (h *Handler) resendMessage(w http.ResponseWriter, r *http.Request) error {
	user, err := h.requireSuperAdmin(r)
	if err != nil {
		return err
	}
	raw, err := strictBody(r)
	if err != nil {
		return err
	}
	f := validate.New(raw, true)
	id := f.UUID("id", validate.Rule{})
	if !f.Valid() {
		return httpx.BadRequest("Payload tidak valid")
	}
	ctx := r.Context()
	original, err := h.ports.Messages.Outbound(ctx, h.db, *id)
	if err != nil {
		return err
	}
	switch {
	case original == nil:
		return httpx.NotFound("Pesan tidak ditemukan")
	case original.Status != "failed":
		return httpx.Conflict("Hanya pesan berstatus gagal yang bisa dikirim ulang")
	case original.MessageType == "otp" || original.Body == nil || *original.Body == "":
		return httpx.Conflict("OTP tidak bisa dikirim ulang — minta member request ulang dari portal")
	}
	res := h.ports.Messages.Resend(ctx, h.db, *original, user.ID)
	if !res.Success {
		reason := res.Reason
		if reason == "" {
			reason = "Pengiriman ulang gagal"
		}
		return httpx.Status(http.StatusBadGateway, reason)
	}
	if err := h.ports.Messages.MarkResent(ctx, h.db, original.ID); err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, struct {
		MessageID *string `json:"messageId,omitempty"`
	}{res.MessageID})
}

/* ── owner notifications ─────────────────────────────────────────────── */

func (h *Handler) loadWaNotif(ctx context.Context) (domain.WaNotifConfig, error) {
	raw, err := appsettings.Get(ctx, h.db, domain.WaNotifSettingKey)
	return domain.ParseWaNotifConfig(raw), err
}

// GET /api/settings/wa-notifications: the config, the type catalog and the
// shift-report recipients (a separate audience: supervisors, finance).
func (h *Handler) getWaNotif(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.SettingsIntegrations...); err != nil {
		return err
	}
	cfg, err := h.loadWaNotif(r.Context())
	if err != nil {
		return err
	}
	shift, err := appsettings.Get(r.Context(), h.db, shiftReportRecipients)
	if err != nil {
		return err
	}
	type view struct {
		Config                domain.WaNotifConfig `json:"config"`
		Catalog               []domain.WaNotifType `json:"catalog"`
		ShiftReportRecipients []string             `json:"shift_report_recipients"`
	}
	return httpx.JSON(w, http.StatusOK, struct {
		Data view `json:"data"`
	}{view{cfg, domain.WaNotifTypes, domain.ParseShiftReportRecipients(shift)}})
}

// PUT /api/settings/wa-notifications: a partial update over the stored
// config; nothing is written when a field is invalid.
func (h *Handler) putWaNotif(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.SettingsIntegrations...); err != nil {
		return err
	}
	raw, err := strictBody(r)
	if err != nil {
		return err
	}
	body := domain.Obj(raw)
	ctx := r.Context()
	current, err := h.loadWaNotif(ctx)
	if err != nil {
		return err
	}
	cfg, msg := domain.ApplyWaNotifUpdate(current, body)
	if msg != "" {
		return httpx.BadRequest(msg)
	}
	if v, sent := body["shift_report_recipients"]; sent {
		cleaned, ok := domain.CleanShiftReportRecipients(v)
		if !ok {
			return httpx.BadRequest("shift_report_recipients tidak valid")
		}
		var stored *string
		if len(cleaned) > 0 {
			list, _ := json.Marshal(cleaned)
			stored = appsettings.Ptr(string(list))
		}
		if err := appsettings.Set(ctx, h.db, shiftReportRecipients, stored); err != nil {
			return err
		}
	}
	encoded, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	if err := appsettings.Set(ctx, h.db, domain.WaNotifSettingKey, appsettings.Ptr(string(encoded))); err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, struct {
		Data struct {
			Config domain.WaNotifConfig `json:"config"`
		} `json:"data"`
	}{struct {
		Config domain.WaNotifConfig `json:"config"`
	}{cfg}})
}

var isoDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

type testResult struct {
	Target  string  `json:"target"`
	Success bool    `json:"success"`
	Reason  *string `json:"reason"`
}

// POST /api/settings/wa-notifications/test: send a test message (or, with
// flash, today's real Daily Flash Report) to every saved recipient through
// the gateway the real notifications use.
func (h *Handler) testWaNotif(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.RequireMenuPrefix(r, iam.SettingsIntegrations...); err != nil {
		return err
	}
	ctx := r.Context()
	cfg, err := h.loadWaNotif(ctx)
	if err != nil {
		return err
	}
	if len(cfg.Recipients) == 0 {
		return httpx.BadRequest("Belum ada nomor penerima. Simpan nomornya dulu.")
	}
	g := h.gateway(ctx)
	if g == nil {
		return httpx.BadRequest("WA Gateway belum dikonfigurasi (Settings → Integrasi atau WA_GATEWAY_URL/TOKEN)")
	}
	raw, _ := lenientBody(r)
	body := domain.Obj(raw)
	now := domain.NowLabel(h.now())
	message := h.brandName() + " OS — pesan uji notifikasi.\nNomor ini akan menerima notifikasi bisnis otomatis.\n" + now + " WIB"
	if domain.Truthy(body["flash"]) {
		dateWib := domain.TodayWib(h.now())
		if d, ok := body["date"].(string); ok && isoDate.MatchString(d) {
			dateWib = d
		}
		data, err := h.ports.Flash.Gather(ctx, h.db, dateWib)
		if err != nil {
			return err
		}
		message = domain.BuildFlashReportMessage(data, dateWib, h.brandName()) + "\n\n_(uji kirim manual " + now + " WIB — data " + dateWib + ")_"
	}
	results := []testResult{}
	allOK := true
	for _, target := range cfg.Recipients {
		res := g.SendText(ctx, target, message)
		results = append(results, testResult{target, res.Success, appsettings.Ptr(res.Reason)})
		allOK = allOK && res.Success
	}
	return httpx.JSON(w, http.StatusOK, struct {
		Data struct {
			Results []testResult `json:"results"`
			AllOK   bool         `json:"allOk"`
		} `json:"data"`
	}{struct {
		Results []testResult `json:"results"`
		AllOK   bool         `json:"allOk"`
	}{results, allOK}})
}
