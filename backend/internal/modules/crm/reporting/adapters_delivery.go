package reporting

import (
	"context"
	"unicode/utf16"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/whatsapp"
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

// WhatsAppGateway is loadGatewayConfig and sendGatewayText of
// lib/whatsapp/gateway.ts on platform/whatsapp. No send is logged, like
// the TS.
type WhatsAppGateway struct{ Client *whatsapp.Client }

var _ WhatsApp = WhatsAppGateway{}

func (g WhatsAppGateway) Gateway(ctx context.Context, q database.Querier) TextSender {
	gateway := g.Client.LoadGateway(ctx, q)
	if gateway == nil {
		return nil
	}
	return func(ctx context.Context, target, message string) bool {
		return gateway.SendText(ctx, target, message).Success
	}
}
