package reporting

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/database"
)

// NotificationsSQL is a stopgap adapter: it moves to the notifications
// context. It ports notifyUsers in lib/crm/workflow-engine.ts (one 'alert'
// row in public.notifications per distinct user).
type NotificationsSQL struct{}

var _ Notifier = NotificationsSQL{}

// sliceUTF16 is String.prototype.slice(0, n).
func sliceUTF16(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if len(u) <= n {
		return s
	}
	return string(utf16.Decode(u[:n]))
}

func (NotificationsSQL) NotifyUsers(ctx context.Context, q database.Querier, userIDs []string, title, message, link string, metadata any) (int, error) {
	n := 0
	seen := map[string]bool{}
	for _, uid := range userIDs {
		if seen[uid] {
			continue
		}
		seen[uid] = true
		if _, err := q.Exec(ctx, `INSERT INTO public.notifications (user_id, title, message, type, link, metadata, is_read)
       VALUES ($1::text::uuid, $2, $3, 'alert', $4, $5::jsonb, false)`,
			uid, sliceUTF16(title, 150), sliceUTF16(message, 1000), link, kit.JSONText(metadata)); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// EmployeesSQL is a stopgap adapter: it moves to hris. It ports the
// employee phone lookup of lib/crm/report-schedule-watcher.ts.
type EmployeesSQL struct{}

var _ StaffPhones = EmployeesSQL{}

func (EmployeesSQL) EmployeePhone(ctx context.Context, q database.Querier, userID string) (string, error) {
	var phone string
	err := q.QueryRow(ctx, `SELECT phone FROM hris.employees WHERE user_id = $1::text::uuid AND phone IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`, userID).Scan(&phone)
	if database.IsNoRows(err) {
		return "", nil
	}
	return phone, err
}

// WhatsAppGateway is a stopgap adapter: it moves to the WhatsApp /
// notifications context. It ports loadGatewayConfig and sendGatewayText of
// lib/whatsapp/gateway.ts: configuration.app_settings first, then the env;
// POST {baseUrl}/send with x-gateway-token. No send is logged, like the TS.
type WhatsAppGateway struct {
	Getenv func(string) string
	Client *http.Client
}

var _ WhatsApp = WhatsAppGateway{}

func (g WhatsAppGateway) Gateway(ctx context.Context, q database.Querier) TextSender {
	stored := map[string]string{}
	// A settings read failure falls back to the env, like the TS.
	if rows, err := q.Query(ctx, `SELECT key, value FROM configuration.app_settings WHERE key = ANY($1)`,
		[]string{"wa_gateway_url", "wa_gateway_token"}); err == nil {
		for rows.Next() {
			var key string
			var value *string
			if rows.Scan(&key, &value) == nil && value != nil {
				stored[key] = strings.TrimSpace(*value)
			}
		}
		rows.Close()
	}
	token := stored["wa_gateway_token"]
	if token == "" {
		token = g.Getenv("WA_GATEWAY_TOKEN")
	}
	if token == "" {
		return nil
	}
	base := stored["wa_gateway_url"]
	if base == "" {
		base = g.Getenv("WA_GATEWAY_URL")
	}
	if base == "" {
		base = "http://127.0.0.1:3471"
	}
	timeoutMs, err := strconv.Atoi(g.Getenv("WA_GATEWAY_TIMEOUT_MS"))
	if err != nil || timeoutMs == 0 {
		timeoutMs = 20000
	}
	client := g.Client
	if client == nil {
		client = http.DefaultClient
	}
	return func(ctx context.Context, target, message string) bool {
		ctx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
		defer cancel()
		body, _ := json.Marshal(struct {
			Target  string `json:"target"`
			Message string `json:"message"`
		}{target, message})
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/send", bytes.NewReader(body))
		if err != nil {
			return false
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-gateway-token", token)
		resp, err := client.Do(req)
		if err != nil {
			return false
		}
		resp.Body.Close()
		return resp.StatusCode >= 200 && resp.StatusCode <= 299
	}
}
