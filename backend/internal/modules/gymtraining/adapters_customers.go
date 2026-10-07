package gymtraining

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"nuhabit/backend/internal/platform/members"
)

// CustomersSQL serves the Customers port from platform/members.
type CustomersSQL struct{ DB *pgxpool.Pool }

// Contacts returns name and phone per customer id (race-admin-server.ts).
func (a CustomersSQL) Contacts(ctx context.Context, ids []string) (map[string]Contact, error) {
	found, err := members.GetMany(ctx, a.DB, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[string]Contact, len(found))
	for id, m := range found {
		out[id] = Contact{ID: id, Name: m.Name, Phone: &m.Phone}
	}
	return out, nil
}
