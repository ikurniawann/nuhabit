// Package domain holds the recruitment rules: candidate statuses and
// sources, portal link validity, psikotes scoring, offer responses, job
// opening normalization, promotion contract drafts, the rate-limit windows
// and the WebRTC signaling store. Pure Go, no database or HTTP.
package domain

import (
	"regexp"
	"slices"
	"strings"
)

// CandidateStatuses are the keys of CANDIDATE_STATUS_LABELS
// (lib/recruitment/status.ts), in declaration order. "archived" is the
// talent pool archive.
var CandidateStatuses = []string{
	"applied", "screening", "psikotes", "interview", "offer", "hired", "talent_pool", "rejected", "archived",
}

var statusLabels = map[string]string{
	"applied":     "Applied",
	"screening":   "Screening",
	"psikotes":    "Psikotes",
	"interview":   "Interview",
	"offer":       "Offer",
	"hired":       "Hired",
	"talent_pool": "Talent Pool",
	"rejected":    "Tolak",
	"archived":    "Diarsipkan",
}

// StatusLabel returns the UI label of a candidate status.
func StatusLabel(status string) (string, bool) {
	label, ok := statusLabels[status]
	return label, ok
}

// CreatableStatuses are the statuses a new candidate may start in.
var CreatableStatuses = []string{"applied", "screening"}

// CandidateSources are the keys of CANDIDATE_SOURCE_LABELS.
var CandidateSources = []string{
	"portal", "internal", "referral", "jobstreet", "instagram", "jobfair", "walk_in", "internal_referral", "headhunter", "other",
}

// Availabilities are CANDIDATE_AVAILABILITIES.
var Availabilities = []string{"immediate", "1_week", "2_weeks", "1_month"}

// Recommendations are the screening and psikotes summary verdicts.
var Recommendations = []string{"lolos", "hold", "tidak_lolos"}

var recommendationLabels = map[string]string{"lolos": "Lolos", "hold": "Hold", "tidak_lolos": "Tidak Lolos"}

// RecommendationSuffix is the activity suffix " (rekomendasi: Lolos)", or ""
// without a recommendation.
func RecommendationSuffix(rec *string) string {
	if rec == nil || *rec == "" {
		return ""
	}
	return " (rekomendasi: " + recommendationLabels[*rec] + ")"
}

// waTemplateLabels is WA_TEMPLATE_LABELS of the activities route.
var waTemplateLabels = map[string]string{
	"undangan_screening": "Undangan Screening",
	"lolos_psikotes":     "Lolos → Lanjut Psikotes",
	"undangan_psikotes":  "Undangan Psikotes Online",
	"undangan_interview": "Undangan Interview AI",
	"lolos_interview":    "Lolos → Lanjut Interview",
	"lolos_offer":        "Lolos → Lanjut Offer",
	"offer_terkirim":     "Penawaran Kerja Terkirim",
	"penolakan":          "Penolakan Halus",
}

// WATemplateLabel returns the label of a WhatsApp template key.
func WATemplateLabel(key string) (string, bool) {
	label, ok := waTemplateLabels[key]
	return label, ok
}

// CanSeePortalToken reports whether a staff role receives portal session
// tokens (TOKEN_ROLES): roles that share links with candidates.
func CanSeePortalToken(role string) bool {
	return slices.Contains([]string{"super_admin", "admin", "hrd"}, role)
}

var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// IsUUID is isUuid from candidate-query.ts (any version, case-insensitive).
func IsUUID(s string) bool { return uuidPattern.MatchString(s) }

// LikePattern escapes LIKE wildcards so a search matches literally.
func LikePattern(search string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(search) + "%"
}
