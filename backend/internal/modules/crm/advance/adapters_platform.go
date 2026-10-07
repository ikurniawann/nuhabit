package advance

import (
	"context"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/whatsapp"
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

// WhatsAppGateway is loadGatewayConfig on platform/whatsapp.
type WhatsAppGateway struct{ Client *whatsapp.Client }

func (g WhatsAppGateway) LoadGateway(ctx context.Context, q database.Querier) *whatsapp.Gateway {
	return g.Client.LoadGateway(ctx, q)
}
