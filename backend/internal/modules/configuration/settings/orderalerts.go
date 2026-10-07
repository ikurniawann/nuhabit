package settings

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"nuhabit/backend/internal/modules/configuration/kit"
	"nuhabit/backend/internal/modules/configuration/settings/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

/* ── Telegram Bot API (lib/telegram/client.ts) ───────────────────────── */

const telegramTimeout = 8 * time.Second

// telegramError is TelegramApiError: Telegram answered, but not ok.
type telegramError struct {
	message string
	status  int
}

func (e *telegramError) Error() string { return e.message }

// telegram calls one Bot API method and decodes its result into out (may
// be nil). Transport failures are plain errors, as fetch's are.
func (h *handler) telegram(ctx context.Context, token, method string, body any, out any) error {
	ctx, cancel := context.WithTimeout(ctx, telegramTimeout)
	defer cancel()
	raw, err := kit.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.urls.Telegram+"/bot"+token+"/"+method, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	var reply struct {
		OK          bool            `json:"ok"`
		Result      json.RawMessage `json:"result"`
		Description string          `json:"description"`
	}
	_ = json.Unmarshal(data, &reply)
	if res.StatusCode < 200 || res.StatusCode > 299 || !reply.OK {
		msg := reply.Description
		if msg == "" {
			msg = "Telegram " + method + " gagal (" + strconv.Itoa(res.StatusCode) + ")"
		}
		return &telegramError{message: msg, status: res.StatusCode}
	}
	if out != nil && len(reply.Result) > 0 {
		_ = json.Unmarshal(reply.Result, out)
	}
	return nil
}

func (h *handler) sendTelegram(ctx context.Context, token, chatID, text string) error {
	return h.telegram(ctx, token, "sendMessage", struct {
		ChatID                string `json:"chat_id"`
		Text                  string `json:"text"`
		DisableWebPagePreview bool   `json:"disable_web_page_preview"`
	}{chatID, text, true}, nil)
}

// rethrowTelegram makes a Telegram API error a 502 so the admin sees the
// bot is the problem.
func rethrowTelegram(err error) error {
	var te *telegramError
	if errors.As(err, &te) {
		return httpx.Status(http.StatusBadGateway, "Telegram: "+te.message)
	}
	return err
}

/* ── storage (lib/notifications/order-alert-server.ts) ───────────────── */

type telegramSettings struct{ token, webhookSecret, username string }

func (h *handler) loadTelegramSettings(ctx context.Context) (telegramSettings, error) {
	s, err := h.settings.GetMany(ctx, h.db, []string{"telegram_bot_token", "telegram_webhook_secret", "telegram_bot_username"})
	if err != nil {
		return telegramSettings{}, err
	}
	trim := func(k string) string { return validate.JSTrim(kit.Deref(s[k])) }
	return telegramSettings{trim("telegram_bot_token"), trim("telegram_webhook_secret"), trim("telegram_bot_username")}, nil
}

func (h *handler) loadOrderAlertConfig(ctx context.Context) (domain.OrderAlertConfig, error) {
	raw, err := h.settings.Get(ctx, h.db, domain.OrderAlertKey)
	return domain.ParseOrderAlertConfig(raw), err
}

// loadWaRecipients is loadWaRecipients with phones normalized.
func (h *handler) loadWaRecipients(ctx context.Context, roles []string) ([]WaRecipient, error) {
	if len(roles) == 0 {
		return nil, nil
	}
	rows, err := h.staff.WaRecipients(ctx, h.db, roles)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		rows[i].Phone = domain.NormalizeWaPhone(rows[i].Phone)
	}
	return rows, nil
}

// loadTelegramSubscribers lists every chat not stopped (settings page) or
// only the active ones (sending).
func (h *handler) loadTelegramSubscribers(ctx context.Context, onlyActive bool) ([]*kit.Row, error) {
	where := "WHERE status <> 'stopped'"
	if onlyActive {
		where = "WHERE status = 'active'"
	}
	return kit.Query(ctx, h.db, `SELECT chat_id::text AS chat_id, title, username, chat_type, status, subscribed_at
     FROM configuration.telegram_subscribers
     `+where+`
     ORDER BY subscribed_at`)
}

func (h *handler) setTelegramChatStatus(ctx context.Context, chatID, status string) (bool, error) {
	tag, err := h.db.Exec(ctx, `UPDATE configuration.telegram_subscribers SET status = $2, updated_at = now()
     WHERE chat_id = $1::bigint RETURNING chat_id::text`, chatID, status)
	return tag.RowsAffected() > 0, err
}

// ensureTelegramWebhookSecret creates the webhook path and header secret
// once.
func (h *handler) ensureTelegramWebhookSecret(ctx context.Context) (string, error) {
	current, err := h.loadTelegramSettings(ctx)
	if err != nil || current.webhookSecret != "" {
		return current.webhookSecret, err
	}
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	secret := hex.EncodeToString(b)
	return secret, h.settings.Set(ctx, h.db, "telegram_webhook_secret", secret)
}

type alertResult struct {
	WA struct {
		Sent           int `json:"sent"`
		Failed         int `json:"failed"`
		SkippedNoPhone int `json:"skippedNoPhone"`
	} `json:"wa"`
	Telegram struct {
		Sent   int `json:"sent"`
		Failed int `json:"failed"`
	} `json:"telegram"`
}

// sendStaffAlert is sendStaffAlert: WhatsApp to employees of the configured
// roles through the gateway, then every active Telegram chat. A chat that
// blocked the bot (403) stops receiving.
func (h *handler) sendStaffAlert(ctx context.Context, text string) (alertResult, error) {
	var out alertResult
	cfg, err := h.loadOrderAlertConfig(ctx)
	if err != nil {
		return out, err
	}
	if cfg.WaEnabled {
		recipients, err := h.loadWaRecipients(ctx, cfg.WaRoles)
		if err != nil {
			return out, err
		}
		gateway := h.wa.LoadGateway(ctx, h.db)
		var phones []string
		seen := map[string]bool{}
		for _, r := range recipients {
			if r.Phone == nil {
				out.WA.SkippedNoPhone++
			} else if !seen[*r.Phone] {
				seen[*r.Phone] = true
				phones = append(phones, *r.Phone)
			}
		}
		if gateway == nil {
			out.WA.Failed += len(phones)
		} else {
			for _, phone := range phones {
				if gateway.SendText(ctx, phone, text).Success {
					out.WA.Sent++
				} else {
					out.WA.Failed++
				}
			}
		}
	}
	if cfg.TelegramEnabled {
		tg, err := h.loadTelegramSettings(ctx)
		if err != nil {
			return out, err
		}
		if tg.token != "" {
			chats, err := h.loadTelegramSubscribers(ctx, true)
			if err != nil {
				return out, err
			}
			for _, chat := range chats {
				err := h.sendTelegram(ctx, tg.token, chat.Str("chat_id"), text)
				if err == nil {
					out.Telegram.Sent++
					continue
				}
				out.Telegram.Failed++
				var te *telegramError
				if errors.As(err, &te) && te.status == http.StatusForbidden {
					_, _ = h.setTelegramChatStatus(ctx, chat.Str("chat_id"), "stopped")
				}
			}
		}
	}
	return out, nil
}

/* ── routes ──────────────────────────────────────────────────────────── */

type waRecipientView struct {
	Name        string  `json:"name"`
	Role        string  `json:"role"`
	PhoneMasked *string `json:"phone_masked"`
	HasPhone    bool    `json:"has_phone"`
}

type orderAlertSnapshot struct {
	Config              domain.OrderAlertConfig `json:"config"`
	RoleOptions         []domain.RoleOption     `json:"role_options"`
	WaGatewayConfigured bool                    `json:"wa_gateway_configured"`
	WaRecipients        []waRecipientView       `json:"wa_recipients"`
	Telegram            struct {
		Connected   bool    `json:"connected"`
		TokenMasked *string `json:"token_masked"`
		Username    *string `json:"username"`
	} `json:"telegram"`
	TelegramChats []*kit.Row `json:"telegram_chats"`
}

func (h *handler) snapshot(ctx context.Context) (orderAlertSnapshot, error) {
	var s orderAlertSnapshot
	var err error
	if s.Config, err = h.loadOrderAlertConfig(ctx); err != nil {
		return s, err
	}
	tg, err := h.loadTelegramSettings(ctx)
	if err != nil {
		return s, err
	}
	s.RoleOptions = domain.OrderAlertRoles
	s.WaGatewayConfigured = h.wa.LoadGateway(ctx, h.db) != nil
	recipients, err := h.loadWaRecipients(ctx, domain.OrderAlertRoleCodes())
	if err != nil {
		return s, err
	}
	s.WaRecipients = make([]waRecipientView, len(recipients))
	for i, r := range recipients {
		s.WaRecipients[i] = waRecipientView{Name: r.Name, Role: r.Role, PhoneMasked: domain.MaskPhone(r.Phone), HasPhone: r.Phone != nil}
	}
	s.Telegram.Connected = tg.token != ""
	s.Telegram.TokenMasked = kit.MaskSecret(&tg.token)
	if tg.username != "" {
		s.Telegram.Username = &tg.username
	}
	s.TelegramChats, err = h.loadTelegramSubscribers(ctx, false)
	return s, err
}

func (h *handler) respondSnapshot(w http.ResponseWriter, r *http.Request) error {
	s, err := h.snapshot(r.Context())
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, s)
}

func (h *handler) getOrderAlerts(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsIntegrations...); err != nil {
		return err
	}
	return h.respondSnapshot(w, r)
}

// connectTelegram checks the token with getMe, points the webhook at this
// app, then stores the token and bot username.
func (h *handler) connectTelegram(r *http.Request, token string) error {
	ctx := r.Context()
	var me struct {
		Username *string `json:"username"`
	}
	if err := h.telegram(ctx, token, "getMe", map[string]any{}, &me); err != nil {
		return rethrowTelegram(err)
	}
	secret, err := h.ensureTelegramWebhookSecret(ctx)
	if err != nil {
		return err
	}
	if err := h.telegram(ctx, token, "setWebhook", struct {
		URL                string   `json:"url"`
		SecretToken        string   `json:"secret_token"`
		AllowedUpdates     []string `json:"allowed_updates"`
		DropPendingUpdates bool     `json:"drop_pending_updates"`
	}{appOrigin(r) + "/api/integrations/telegram/webhook/" + secret, secret, []string{"message", "my_chat_member"}, true}, nil); err != nil {
		return rethrowTelegram(err)
	}
	if err := h.settings.Set(ctx, h.db, "telegram_bot_token", token); err != nil {
		return err
	}
	return h.settings.Set(ctx, h.db, "telegram_bot_username", kit.Deref(me.Username))
}

func (h *handler) putOrderAlerts(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsIntegrations...); err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	waEnabled := f.Bool("wa_enabled", validate.Rule{})
	roles := f.List("wa_roles", validate.Rule{}, 5, func(items *validate.Form, i int, v any) {
		s, ok := v.(string)
		if code, msg, valid := validate.EnumCheck(domain.OrderAlertRoleCodes())(s); !ok || !valid {
			items.Fail(i, code, msg)
		}
	})
	telegramEnabled := f.Bool("telegram_enabled", validate.Rule{})
	token := f.Str("telegram_bot_token", validate.Rule{Optional: true}, validate.StrOpts{Trim: true, Max: 100})
	if !f.Valid() {
		return httpx.BadRequest("Data tidak valid")
	}
	if token != nil && *token != "" {
		if !domain.IsTelegramBotToken(*token) {
			return httpx.BadRequest("Format token bot Telegram tidak valid")
		}
		if err := h.connectTelegram(r, *token); err != nil {
			return err
		}
	}
	cfg := domain.OrderAlertConfig{WaEnabled: *waEnabled, WaRoles: make([]string, len(roles)), TelegramEnabled: *telegramEnabled}
	for i, v := range roles {
		cfg.WaRoles[i] = v.(string)
	}
	stored, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	if err := h.settings.Set(r.Context(), h.db, domain.OrderAlertKey, string(stored)); err != nil {
		return err
	}
	return h.respondSnapshot(w, r)
}

func (h *handler) postOrderAlerts(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsIntegrations...); err != nil {
		return err
	}
	body, _ := validate.ReadBody(r)
	obj, _ := body.(map[string]any)
	action, _ := obj["action"].(string)
	chatID, _ := obj["chat_id"].(string)
	switch action {
	case "approve", "remove":
		if !domain.TelegramChatID.MatchString(chatID) {
			return httpx.BadRequest("Aksi tidak valid")
		}
	case "test", "reconnect":
	default:
		return httpx.BadRequest("Aksi tidak valid")
	}
	ctx := r.Context()
	tg, err := h.loadTelegramSettings(ctx)
	if err != nil {
		return err
	}

	switch action {
	case "approve", "remove":
		status := "stopped"
		if action == "approve" {
			status = "active"
		}
		changed, err := h.setTelegramChatStatus(ctx, chatID, status)
		if err != nil {
			return err
		}
		if !changed {
			return httpx.NotFound("Chat tidak ditemukan")
		}
		if action == "approve" && tg.token != "" {
			_ = h.sendTelegram(ctx, tg.token, chatID, "✅ Disetujui. Chat ini sekarang menerima notifikasi pesanan masuk "+
				brandName()+". Ketik /stop untuk berhenti.")
		}
		return h.respondSnapshot(w, r)
	case "reconnect":
		if tg.token == "" {
			return httpx.BadRequest("Token bot Telegram belum diisi")
		}
		if err := h.connectTelegram(r, tg.token); err != nil {
			return err
		}
		return h.respondSnapshot(w, r)
	}
	result, err := h.sendStaffAlert(ctx, "🧪 Tes notifikasi pesanan masuk "+brandName()+
		".\nKalau pesan ini sampai, notifikasi pesanan baru akan dikirim ke sini.")
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, map[string]alertResult{"result": result})
}
