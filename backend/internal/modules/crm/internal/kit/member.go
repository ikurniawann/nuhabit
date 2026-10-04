package kit

import (
	"context"
	"regexp"
	"strings"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// uuidLoose is the plain 8-4-4-4-12 hex check several CRM libs use (no
// version/variant rule, unlike zod's uuid()).
var uuidLoose = regexp.MustCompile(`^(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// RequireMemberCustomerID mirrors requireMemberCustomerId: the URL id may be
// a CRM profile id, a POS customer id, or "pos-<customerId>"; 404
// "Member tidak ditemukan" when none matches.
func RequireMemberCustomerID(ctx context.Context, q database.Querier, idParam string) (string, error) {
	id := strings.TrimPrefix(idParam, "pos-")
	if uuidLoose.MatchString(id) {
		var customerID string
		err := q.QueryRow(ctx, `SELECT customer_id::text FROM crm.crm_member_profiles WHERE id = $1 OR customer_id = $1
         UNION ALL
         SELECT id::text FROM pos.pos_customers WHERE id = $1
         LIMIT 1`, id).Scan(&customerID)
		if err == nil {
			return customerID, nil
		}
		if !database.IsNoRows(err) {
			return "", err
		}
	}
	return "", httpx.NotFound("Member tidak ditemukan")
}
