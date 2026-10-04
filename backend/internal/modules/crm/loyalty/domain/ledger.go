package domain

import (
	"math"
	"regexp"
	"strconv"
	"strings"
)

// LedgerRow is the part of a crm_xp_ledger row the description helper reads.
type LedgerRow struct {
	Description    *string
	ReferenceTable *string
	ReferenceID    *string
	Amount         any // metadata.amount (number, numeric string or nil)
}

var uuidRe = regexp.MustCompile(`(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// LedgerOrderIDs mirrors ledgerOrderIds: unique order ids of order rows.
func LedgerOrderIDs(rows []LedgerRow) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, r := range rows {
		if deref(r.ReferenceTable) == "pos_orders" && deref(r.ReferenceID) != "" && !seen[*r.ReferenceID] {
			seen[*r.ReferenceID] = true
			out = append(out, *r.ReferenceID)
		}
	}
	return out
}

// HumanizeLedgerDescription mirrors humanizeLedgerDescription: old rows
// carried internal UUIDs; show the cashier order number or the top-up amount.
func HumanizeLedgerDescription(r LedgerRow, orderNumbers map[string]string) string {
	desc := deref(r.Description)
	uuid := uuidRe.FindString(desc)
	if uuid == "" {
		return desc
	}
	prefix := strings.SplitN(desc, " untuk ", 2)[0]
	if prefix == "" {
		// desc.replace(UUID_RE, "") replaces the first match only.
		prefix = strings.TrimSpace(strings.Replace(desc, uuid, "", 1))
	}
	if deref(r.ReferenceTable) == "pos_orders" && deref(r.ReferenceID) != "" {
		ref := *r.ReferenceID
		if num, ok := orderNumbers[ref]; ok {
			return prefix + " — order #" + num
		}
		if len(ref) > 8 {
			ref = ref[:8]
		}
		return prefix + " — order " + ref
	}
	if amount, ok := jsNumber(r.Amount); ok && amount > 0 {
		return prefix + " — " + formatRupiah(amount)
	}
	return strings.Replace(desc, uuid, uuid[:8], 1)
}

// jsNumber is Number(v) restricted to finite results.
func jsNumber(v any) (float64, bool) {
	var f float64
	switch x := v.(type) {
	case float64:
		f = x
	case string:
		s := strings.TrimSpace(x)
		if s == "" {
			f = 0
		} else {
			p, err := strconv.ParseFloat(s, 64)
			if err != nil {
				return 0, false
			}
			f = p
		}
	case bool:
		if x {
			f = 1
		}
	default:
		return 0, false
	}
	return f, !math.IsNaN(f) && !math.IsInf(f, 0)
}

// formatRupiah mirrors lib/format formatRupiah ("Rp50.000").
func formatRupiah(v float64) string {
	n := int64(math.Floor(v + 0.5))
	sign := ""
	if n < 0 {
		sign, n = "-", -n
	}
	s := strconv.FormatInt(n, 10)
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	return sign + "Rp" + b.String()
}
