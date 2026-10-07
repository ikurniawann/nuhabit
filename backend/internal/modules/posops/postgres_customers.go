package posops

import (
	"context"
	"regexp"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/database"
)

const customerColumns = `id, name, phone, email, membership_tier, member_type, ark_coin_balance, total_xp, visit_count, is_active, nfc_uid, is_kol`

// customerFilter is GET /api/pos/customers' filters.
type customerFilter struct {
	Search, Phone, NfcUID, Tier *string
}

func listCustomers(ctx context.Context, q database.Querier, f customerFilter) ([]*Obj, error) {
	args := []any{}
	arg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	clauses := []string{"is_active = true"}
	if f.Phone != nil {
		clauses = append(clauses, "phone = "+arg(*f.Phone))
	}
	if f.NfcUID != nil {
		clauses = append(clauses, "nfc_uid = "+arg(*f.NfcUID))
	}
	if f.Tier != nil {
		clauses = append(clauses, "membership_tier = "+arg(*f.Tier))
	}
	if f.Search != nil {
		s := *f.Search
		clauses = append(clauses, shimOr("name.ilike.%"+s+"%,email.ilike.%"+s+"%,phone.ilike.%"+s+"%,nfc_uid.ilike.%"+s+"%", arg))
	}
	limit := 500
	if f.Phone != nil || f.NfcUID != nil {
		limit = 1
	}
	return QueryObjs(ctx, q, `SELECT `+customerColumns+` FROM pos.pos_customers WHERE `+strings.Join(clauses, " AND ")+
		` ORDER BY name ASC LIMIT `+arg(limit), args...)
}

var orOperators = map[string]string{"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<=", "like": "LIKE", "ilike": "ILIKE"}

// shimOr ports QueryBuilder.or("col.op.value,..."): the expression is split
// on top-level commas and dots exactly as the TS does, so a search text
// containing a comma or a dot builds the same (possibly failing) SQL.
func shimOr(expr string, arg func(any) string) string {
	parts := splitTopLevel(expr)
	sql := make([]string, len(parts))
	for i, p := range parts {
		segs := strings.Split(p, ".")
		col := quoteIdent(segs[0])
		op, val := "", ""
		if len(segs) > 1 {
			op = segs[1]
		}
		if len(segs) > 2 {
			val = strings.Join(segs[2:], ".")
		}
		if op == "is" {
			if val == "not.null" {
				sql[i] = col + " IS NOT NULL"
			} else {
				sql[i] = col + " IS NULL"
			}
			continue
		}
		sqlOp, ok := orOperators[op]
		if !ok {
			sqlOp = "="
		}
		sql[i] = col + " " + sqlOp + " " + arg(strings.ReplaceAll(val, "*", "%"))
	}
	return "(" + strings.Join(sql, " OR ") + ")"
}

// splitTopLevel splits on commas outside parentheses, trimming each part
// and dropping an empty last part.
func splitTopLevel(s string) []string {
	var out []string
	depth := 0
	var cur strings.Builder
	for _, ch := range s {
		switch ch {
		case '(':
			depth++
		case ')':
			depth--
		}
		if ch == ',' && depth == 0 {
			out = append(out, domain.TrimJS(cur.String()))
			cur.Reset()
			continue
		}
		cur.WriteRune(ch)
	}
	if last := domain.TrimJS(cur.String()); last != "" {
		out = append(out, last)
	}
	return out
}

func quoteIdent(id string) string { return `"` + strings.ReplaceAll(id, `"`, `""`) + `"` }

// customerByNfc is the card owner check; the TS ignores its error.
func customerByNfc(ctx context.Context, q database.Querier, uid string) *Obj {
	row, err := QueryObj(ctx, q, `SELECT id, phone FROM pos.pos_customers WHERE nfc_uid = $1`, uid)
	if err != nil {
		return nil
	}
	return row
}

// customerByPhone is the whole row; the TS ignores its error.
func customerByPhone(ctx context.Context, q database.Querier, phone string) *Obj {
	row, err := QueryObj(ctx, q, `SELECT * FROM pos.pos_customers WHERE phone = $1`, phone)
	if err != nil {
		return nil
	}
	return row
}

func updateCustomer(ctx context.Context, q database.Querier, id string, cols domain.Columns) (*Obj, error) {
	rows, err := updateRows(ctx, q, "pos.pos_customers", cols, domain.Columns{{Name: "id", Value: id}}, customerColumns)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

var phoneJunk = regexp.MustCompile(`[^\d+]`)

// normalizeCustomerPhone keeps digits and plus signs.
func normalizeCustomerPhone(v string) string { return domain.TrimJS(phoneJunk.ReplaceAllString(v, "")) }
