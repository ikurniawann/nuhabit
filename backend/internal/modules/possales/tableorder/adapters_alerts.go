package tableorder

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/possales/tableorder/domain"
	"nuhabit/backend/internal/platform/database"
)

// alertsSender is the stopgap Alerts: sendStaffAlert of
// lib/notifications/order-alert-server.ts (WhatsApp through the self-hosted
// gateway to employees with the configured roles, Telegram to every active
// subscriber). The notifications context should own it.
type alertsSender struct {
	db     database.Querier
	log    *slog.Logger
	client *http.Client
}

func newAlertsSender(db database.Querier, log *slog.Logger) *alertsSender {
	return &alertsSender{db: db, log: log, client: &http.Client{}}
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

// OrderAlert is fireOrderAlert: sends in the background and only logs.
func (a *alertsSender) OrderAlert(in domain.OrderAlert) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		result, err := a.send(ctx, domain.BuildOrderAlertMessage(in))
		switch {
		case err != nil:
			a.log.Error("[order-alert] "+in.OrderNumber+" gagal:", "error", err)
		case result.WA.Failed > 0 || result.Telegram.Failed > 0 || result.WA.SkippedNoPhone > 0:
			raw, _ := json.Marshal(result)
			a.log.Warn("[order-alert] "+in.OrderNumber+":", "result", string(raw))
		}
	}()
}

func (a *alertsSender) send(ctx context.Context, text string) (alertResult, error) {
	var result alertResult
	raw, err := appSetting(ctx, a.db, "order_alert_config")
	if err != nil {
		return result, err
	}
	cfg := domain.ParseAlertConfig(raw)

	if cfg.WAEnabled && len(cfg.WARoles) > 0 {
		phones, skipped, err := a.waRecipients(ctx, cfg.WARoles)
		if err != nil {
			return result, err
		}
		result.WA.SkippedNoPhone = skipped
		if base, token, timeout := a.gateway(ctx); token != "" {
			for _, phone := range phones {
				if a.sendGateway(ctx, base, token, timeout, phone, text) {
					result.WA.Sent++
				} else {
					result.WA.Failed++
				}
			}
		} else {
			result.WA.Failed += len(phones)
		}
	}

	if cfg.TelegramEnabled {
		token, err := appSetting(ctx, a.db, "telegram_bot_token")
		if err != nil {
			return result, err
		}
		if token = strings.TrimSpace(token); token != "" {
			chats, err := a.telegramChats(ctx)
			if err != nil {
				return result, err
			}
			for _, chat := range chats {
				status, err := a.sendTelegram(ctx, token, chat, text)
				if err == nil {
					result.Telegram.Sent++
					continue
				}
				result.Telegram.Failed++
				if status == http.StatusForbidden { // bot blocked or removed from the group
					_, _ = a.db.Exec(ctx, `UPDATE configuration.telegram_subscribers SET status = 'stopped', updated_at = now()
					   WHERE chat_id = $1::bigint`, chat)
				}
			}
		}
	}
	return result, nil
}

// waRecipients is loadWaRecipients: distinct phones of active employees whose
// user holds one of roles, and how many had no valid phone.
func (a *alertsSender) waRecipients(ctx context.Context, roles []string) ([]string, int, error) {
	rows, err := a.db.Query(ctx, `SELECT DISTINCT ON (e.id) e.phone
     FROM hris.employees e
     JOIN configuration.users u ON u.id = e.user_id
     LEFT JOIN iam.user_roles ur ON ur.user_id = u.id
     LEFT JOIN iam.roles r ON r.id = ur.role_id
     WHERE COALESCE(e.is_active, true) = true
       AND COALESCE(u.status, 'active') = 'active'
       AND (r.code = ANY($1::text[]) OR u.role = ANY($1::text[]))
     ORDER BY e.id, e.full_name`, roles)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var phones []string
	seen := map[string]bool{}
	skipped := 0
	for rows.Next() {
		var raw *string
		if err := rows.Scan(&raw); err != nil {
			return nil, 0, err
		}
		phone := ""
		if raw != nil {
			phone = domain.NormalizeWAPhone(*raw)
		}
		switch {
		case phone == "":
			skipped++
		case !seen[phone]:
			seen[phone] = true
			phones = append(phones, phone)
		}
	}
	return phones, skipped, rows.Err()
}

// gateway is loadGatewayConfig: app_settings first, then the env; token ""
// means not configured.
func (a *alertsSender) gateway(ctx context.Context) (base, token string, timeout time.Duration) {
	dbURL, _ := appSetting(ctx, a.db, "wa_gateway_url")
	dbToken, _ := appSetting(ctx, a.db, "wa_gateway_token")
	token = firstNonEmpty(strings.TrimSpace(dbToken), os.Getenv("WA_GATEWAY_TOKEN"))
	base = firstNonEmpty(strings.TrimSpace(dbURL), os.Getenv("WA_GATEWAY_URL"), "http://127.0.0.1:3471")
	ms, err := strconv.Atoi(os.Getenv("WA_GATEWAY_TIMEOUT_MS"))
	if err != nil || ms == 0 {
		ms = 20000
	}
	return base, token, time.Duration(ms) * time.Millisecond
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// sendGateway is sendGatewayText: POST {base}/send with x-gateway-token.
func (a *alertsSender) sendGateway(ctx context.Context, base, token string, timeout time.Duration, target, text string) bool {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	body, _ := json.Marshal(map[string]string{"target": target, "message": text})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/send", bytes.NewReader(body))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-gateway-token", token)
	res, err := a.client.Do(req)
	if err != nil {
		return false
	}
	res.Body.Close()
	return ok(res.StatusCode)
}

// telegramChats is loadTelegramSubscribers(true).
func (a *alertsSender) telegramChats(ctx context.Context) ([]string, error) {
	rows, err := a.db.Query(ctx, `SELECT chat_id::text FROM configuration.telegram_subscribers
     WHERE status = 'active' ORDER BY subscribed_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var chats []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		chats = append(chats, id)
	}
	return chats, rows.Err()
}

// sendTelegram is sendTelegramMessage (8 second timeout); it returns the
// HTTP status with the error.
func (a *alertsSender) sendTelegram(ctx context.Context, token, chatID, text string) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	body, _ := json.Marshal(map[string]any{"chat_id": chatID, "text": text, "disable_web_page_preview": true})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+token+"/sendMessage", bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := a.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	var reply struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
	}
	_ = json.NewDecoder(res.Body).Decode(&reply)
	if !ok(res.StatusCode) || !reply.OK {
		return res.StatusCode, fmt.Errorf("Telegram sendMessage gagal (%d) %s", res.StatusCode, reply.Description)
	}
	return res.StatusCode, nil
}
