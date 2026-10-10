package domain

import "strings"

// ReviewerName is how a review signs its author: the first name and the
// initial of the next one ("Budi Santoso" is "Budi S.").
func ReviewerName(customerName string) string {
	parts := strings.Fields(customerName)
	switch len(parts) {
	case 0:
		return "Member"
	case 1:
		return parts[0]
	}
	return parts[0] + " " + string([]rune(parts[1])[:1]) + "."
}
