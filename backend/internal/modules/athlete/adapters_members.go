package athlete

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/members"
)

// pgMembers implements Members: display fields through platform/members and
// the active-member search with the SQL of social() in
// athlete-community-server.ts.
type pgMembers struct{ q database.Querier }

func (m pgMembers) Athletes(ctx context.Context, ids []string) (map[string]Athlete, error) {
	found, err := members.GetMany(ctx, m.q, ids)
	out := make(map[string]Athlete, len(found))
	for id, mem := range found {
		a := Athlete{ID: id, Name: "Athlete", AvatarURL: mem.PhotoURL}
		if mem.Name != nil && *mem.Name != "" {
			a.Name = *mem.Name
		}
		out[id] = a
	}
	return out, err
}

func (m pgMembers) ActiveMemberIDs(ctx context.Context, search string) ([]string, error) {
	rows, err := m.q.Query(ctx,
		`SELECT id FROM pos.pos_customers
        WHERE COALESCE(is_active, true) AND ($1 = '' OR name ILIKE '%' || $1 || '%')
        ORDER BY created_at LIMIT 200`, search)
	return collect(rows, err, func(rs pgx.Rows) (string, error) {
		var id string
		return id, rs.Scan(&id)
	})
}
