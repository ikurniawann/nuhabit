package webhooks

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"slices"
	"time"

	"nuhabit/backend/internal/modules/integrations/domain"
	"nuhabit/backend/internal/modules/integrations/internal/appsettings"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// POST /api/integrations/telegram/webhook/{secret}: updates from the venue's
// order-alert bot (registered with setWebhook from the settings page),
// authenticated by the secret in the path and in
// X-Telegram-Bot-Api-Secret-Token. /start registers the chat as pending
// (an admin approves it), /stop and removing the bot stop it. The answer is
// always 200 so Telegram does not resend the update.

// secretMatches is the route's safeEqual: equal length, constant time.
func secretMatches(expected, given string) bool {
	return expected != "" && given != "" && len(expected) == len(given) &&
		subtle.ConstantTimeCompare([]byte(expected), []byte(given)) == 1
}

type okBody struct {
	OK bool `json:"ok"`
}

func (h *Handler) telegramWebhook(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	s, err := appsettings.GetMany(ctx, h.db, "telegram_bot_token", "telegram_webhook_secret")
	if err != nil {
		h.log.ErrorContext(ctx, "[telegram webhook] settings", "error", err)
		_ = httpx.JSON(w, http.StatusInternalServerError, struct {
			Error string `json:"error"`
		}{"Internal Server Error"})
		return
	}
	token, secret := s.Trimmed("telegram_bot_token"), s.Trimmed("telegram_webhook_secret")
	if !secretMatches(secret, r.PathValue("secret")) || !secretMatches(secret, r.Header.Get("X-Telegram-Bot-Api-Secret-Token")) {
		_ = httpx.JSON(w, http.StatusUnauthorized, okBody{false})
		return
	}
	var update domain.TelegramUpdate
	if raw, err := readBody(r, 1<<20); err == nil {
		_ = json.Unmarshal(raw, &update)
	}
	if err := h.handleTelegram(ctx, token, update); err != nil {
		h.log.ErrorContext(ctx, "[telegram webhook] gagal memproses update", "error", err)
	}
	_ = httpx.JSON(w, http.StatusOK, okBody{true})
}

func (h *Handler) handleTelegram(ctx context.Context, token string, update domain.TelegramUpdate) error {
	// The bot was removed or blocked: stop sending to that chat.
	if m := update.MyChatMember; m != nil && m.Chat != nil {
		status := "undefined"
		if m.NewChatMember != nil && m.NewChatMember.Status != nil {
			status = *m.NewChatMember.Status
		}
		if slices.Contains([]string{"left", "kicked"}, status) {
			_, err := setTelegramChatStatus(ctx, h.db, m.Chat.ID, "stopped")
			return err
		}
	}
	if update.Message == nil || update.Message.Chat == nil || token == "" {
		return nil
	}
	chat := *update.Message.Chat
	switch domain.TelegramCommand(update.Message.Text) {
	case "/start":
		status, err := registerTelegramChat(ctx, h.db, chat)
		if err != nil {
			return err
		}
		text := "⏳ Permintaan diterima. Admin " + h.brandName() + " perlu menyetujui chat ini dulu (Settings → Notifikasi WA → Notifikasi pesanan masuk). Ketik /stop untuk membatalkan."
		if status == "active" {
			text = "✅ Chat ini sudah menerima notifikasi pesanan masuk " + h.brandName() + ". Ketik /stop untuk berhenti."
		}
		return h.sendTelegram(ctx, token, chat.ID, text)
	case "/stop":
		if _, err := setTelegramChatStatus(ctx, h.db, chat.ID, "stopped"); err != nil {
			return err
		}
		return h.sendTelegram(ctx, token, chat.ID, "🛑 Notifikasi pesanan dihentikan. Ketik /start untuk mendaftar lagi.")
	}
	return nil
}

// registerTelegramChat: a new chat is pending; one that sent /stop is
// pending again; an approved chat stays active.
func registerTelegramChat(ctx context.Context, q database.Querier, chat domain.TelegramChat) (string, error) {
	var status string
	err := q.QueryRow(ctx, `INSERT INTO configuration.telegram_subscribers (chat_id, chat_type, title, username, status)
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT (chat_id) DO UPDATE SET
       chat_type = EXCLUDED.chat_type, title = EXCLUDED.title, username = EXCLUDED.username,
       status = CASE WHEN telegram_subscribers.status = 'active' THEN 'active' ELSE 'pending' END,
       updated_at = now()
     RETURNING status`, chat.ID, chat.Type, domain.ChatTitle(chat), chat.Username).Scan(&status)
	return status, err
}

func setTelegramChatStatus(ctx context.Context, q database.Querier, chatID int64, status string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE configuration.telegram_subscribers SET status = $2, updated_at = now()
     WHERE chat_id = $1::bigint`, chatID, status)
	return tag.RowsAffected() > 0, err
}

// sendTelegram is sendTelegramMessage (Bot API sendMessage, 8 s timeout).
func (h *Handler) sendTelegram(ctx context.Context, token string, chatID int64, text string) error {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	payload, _ := json.Marshal(map[string]any{"chat_id": chatID, "text": text, "disable_web_page_preview": true})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.telegram+"/bot"+token+"/sendMessage", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var reply struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
	}
	_ = json.Unmarshal(raw, &reply)
	if res.StatusCode < 200 || res.StatusCode > 299 || !reply.OK {
		if reply.Description != "" {
			return fmt.Errorf("%s", reply.Description)
		}
		return fmt.Errorf("Telegram sendMessage gagal (%d)", res.StatusCode)
	}
	return nil
}
