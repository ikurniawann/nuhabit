package domain

import (
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
)

// businessEntityTypes is BUSINESS_ENTITY_TYPES (lib/settings/business-entity.ts).
var businessEntityTypes = []string{"holding", "company", "branch", "warehouse"}

// BusinessTables maps an entity type to its configuration table.
var BusinessTables = map[string]string{
	"holding": "holdings", "company": "companies", "branch": "branches", "warehouse": "warehouses",
}

// IsBusinessEntityType reports whether s is one of businessEntityTypes.
func IsBusinessEntityType(s string) bool { return slices.Contains(businessEntityTypes, s) }

// ParentRequired is the createBusinessEntity message for a missing parent
// of each child type.
var ParentRequired = map[string]string{
	"company": "Holding wajib dipilih", "branch": "Company wajib dipilih", "warehouse": "Branch wajib dipilih",
}

var nonCode = regexp.MustCompile(`[^A-Z0-9]+`)

// SlugCode is slugCode: an upper-case dash code from a name, 30 characters
// at most.
func SlugCode(name string) string {
	s := nonCode.ReplaceAllString(strings.ToUpper(TrimJS(name)), "-")
	s = strings.TrimPrefix(s, "-")
	s = strings.TrimSuffix(s, "-")
	if len(s) > 30 {
		s = s[:30]
	}
	return s
}

// NextWarehouse is nextWarehouseCode's name and code for the branch's
// (count+1)th stall.
func NextWarehouse(count int) (name, code string) {
	n := count + 1
	return fmt.Sprintf("Stall %d", n), fmt.Sprintf("STALL-%02d", n)
}

/* ── Warehouse order (lib/configuration/sort-warehouses.ts) ───────────── */

// Warehouse is the sort key of a warehouse row.
type Warehouse struct {
	IsDefault  bool
	Code, Name string
}

var stallCode = regexp.MustCompile(`^STALL-0*(\d+)$`)

func stallNumber(code string) (float64, bool) {
	m := stallCode.FindStringSubmatch(strings.ToUpper(TrimJS(code)))
	if m == nil {
		return 0, false
	}
	n, err := strconv.ParseFloat(m[1], 64)
	return n, err == nil
}

// CompareWarehouses is compareWarehouses: the default warehouse first, MAIN
// next, other codes in natural order, STALL-n codes last by number.
func CompareWarehouses(a, b Warehouse) int {
	if a.IsDefault != b.IsDefault {
		if a.IsDefault {
			return -1
		}
		return 1
	}
	an, aStall := stallNumber(a.Code)
	bn, bStall := stallNumber(b.Code)
	switch {
	case aStall && bStall:
		return cmpFloat(an, bn)
	case aStall:
		return 1
	case bStall:
		return -1
	}
	if strings.ToUpper(a.Code) == "MAIN" {
		return -1
	}
	if strings.ToUpper(b.Code) == "MAIN" {
		return 1
	}
	if c := naturalCompare(a.Code, b.Code); c != 0 {
		return c
	}
	return naturalCompare(a.Name, b.Name)
}

// SortWarehouses sorts rows stably by CompareWarehouses on key(row).
func SortWarehouses[T any](rows []T, key func(T) Warehouse) {
	sort.SliceStable(rows, func(i, j int) bool { return CompareWarehouses(key(rows[i]), key(rows[j])) < 0 })
}

func cmpFloat(a, b float64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

// naturalCompare approximates localeCompare(a, b, undefined, {numeric: true,
// sensitivity: "base"}): case-insensitive, digit runs compared as numbers.
func naturalCompare(a, b string) int {
	a, b = strings.ToLower(a), strings.ToLower(b)
	for a != "" && b != "" {
		ad, bd := digitRun(a), digitRun(b)
		if ad > 0 && bd > 0 {
			an, _ := strconv.ParseFloat(a[:ad], 64)
			bn, _ := strconv.ParseFloat(b[:bd], 64)
			if c := cmpFloat(an, bn); c != 0 {
				return c
			}
			a, b = a[ad:], b[bd:]
			continue
		}
		if a[0] != b[0] {
			return cmpFloat(float64(a[0]), float64(b[0]))
		}
		a, b = a[1:], b[1:]
	}
	return cmpFloat(float64(len(a)), float64(len(b)))
}

func digitRun(s string) int {
	i := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	return i
}
