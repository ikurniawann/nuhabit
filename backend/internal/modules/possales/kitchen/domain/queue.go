package domain

import (
	"slices"
	"strings"
)

// PrintStatuses are the pos_print_jobs.status values.
var PrintStatuses = []string{"pending", "printing", "printed", "failed", "cancelled"}

// QueueStation is the print-jobs route's normalizeStation: a valid station
// (trimmed, case-insensitive) or "kitchen". Unlike NormalizeStation it never
// guesses from product names.
func QueueStation(value string) string {
	if s := strings.ToLower(strings.TrimSpace(value)); IsStation(s) {
		return s
	}
	return "kitchen"
}

// QueueStatus is normalizeStatus: a valid print status, or "" for none.
func QueueStatus(value string) string {
	if s := strings.ToLower(strings.TrimSpace(value)); slices.Contains(PrintStatuses, s) {
		return s
	}
	return ""
}

// patchActions maps PATCH /api/pos/print-jobs/{id} actions to statuses.
var patchActions = map[string]string{
	"mark_printing": "printing",
	"mark_printed":  "printed",
	"mark_failed":   "failed",
	"retry":         "pending",
	"cancel":        "cancelled",
}

// ResolvePatchStatus is resolveStatus(body): a known action wins, else a
// valid status; "" when neither is usable.
func ResolvePatchStatus(action, status string) string {
	if s, ok := patchActions[action]; ok {
		return s
	}
	return QueueStatus(status)
}
