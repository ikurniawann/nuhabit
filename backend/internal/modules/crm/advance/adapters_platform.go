package advance

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/platform/database"
)

// NotificationsSQL is a stopgap adapter: moves to the notifications
// context (in no migration wave yet). It writes public.notifications like
// notifyUsers in lib/crm/workflow-engine.ts.
type NotificationsSQL struct{}

func (NotificationsSQL) Notify(ctx context.Context, q database.Querier, userID, title, message string, link *string, metadata string) error {
	_, err := q.Exec(ctx, `INSERT INTO public.notifications (user_id, title, message, type, link, metadata, is_read)
       VALUES ($1, $2, $3, 'alert', $4, $5::text::jsonb, false)`, userID, title, message, link, metadata)
	return err
}

// EmployeesSQL is a stopgap adapter: moves to hris (employee contact
// reads). It reads hris.employees.
type EmployeesSQL struct{}

func (EmployeesSQL) Phone(ctx context.Context, q database.Querier, userID string) (*string, error) {
	var phone *string
	err := q.QueryRow(ctx, `SELECT e.phone FROM hris.employees e WHERE e.user_id = $1 AND e.phone IS NOT NULL
     ORDER BY e.created_at DESC LIMIT 1`, userID).Scan(&phone)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return phone, err
}

// WhatsAppSettingsSQL is a stopgap adapter: moves to the settings /
// WhatsApp context (in no migration wave yet). It reads the gateway URL and
// token from configuration.app_settings, then the environment, like
// loadGatewayConfig (without its 30 second cache). A settings read failure
// falls back to the environment.
type WhatsAppSettingsSQL struct {
	Getenv func(string) string
}

func (s WhatsAppSettingsSQL) LoadGateway(ctx context.Context, q database.Querier) *Gateway {
	var dbURL, dbToken string
	if rows, err := q.Query(ctx, `SELECT key, value FROM configuration.app_settings WHERE key = ANY($1)`,
		[]string{"wa_gateway_url", "wa_gateway_token"}); err == nil {
		for rows.Next() {
			var key string
			var value *string
			if rows.Scan(&key, &value) == nil && value != nil {
				switch key {
				case "wa_gateway_url":
					dbURL = strings.TrimSpace(*value)
				case "wa_gateway_token":
					dbToken = strings.TrimSpace(*value)
				}
			}
		}
		rows.Close()
	}
	token := dbToken
	if token == "" {
		token = s.Getenv("WA_GATEWAY_TOKEN")
	}
	if token == "" {
		return nil
	}
	base := dbURL
	if base == "" {
		base = s.Getenv("WA_GATEWAY_URL")
	}
	if base == "" {
		base = "http://127.0.0.1:3471"
	}
	timeoutMs, err := strconv.Atoi(s.Getenv("WA_GATEWAY_TIMEOUT_MS"))
	if err != nil || timeoutMs <= 0 {
		timeoutMs = 20000
	}
	return &Gateway{BaseURL: base, Token: token, Timeout: time.Duration(timeoutMs) * time.Millisecond, Client: &http.Client{}}
}
