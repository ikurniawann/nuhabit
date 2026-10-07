package domain

import (
	"encoding/json"
	"math"
	"regexp"
	"strings"
	"time"
)

// Ports lib/crm/google-reviews.ts (the pure Google review rules).

// ReviewResource is a Google Business Profile review resource.
type ReviewResource struct {
	Name     *string `json:"name"`
	ReviewID *string `json:"reviewId"`
	Reviewer *struct {
		DisplayName     *string `json:"displayName"`
		ProfilePhotoURL *string `json:"profilePhotoUrl"`
		IsAnonymous     bool    `json:"isAnonymous"`
	} `json:"reviewer"`
	StarRating  any     `json:"starRating"`
	Comment     *string `json:"comment"`
	CreateTime  *string `json:"createTime"`
	UpdateTime  *string `json:"updateTime"`
	ReviewReply *struct {
		Comment    *string `json:"comment"`
		UpdateTime *string `json:"updateTime"`
	} `json:"reviewReply"`
}

// Review is a normalized review ready to store.
type Review struct {
	ReviewID         string
	ReviewName       string
	LocationID       *string
	ReviewerName     string
	ReviewerPhotoURL *string
	StarRating       int
	Comment          *string
	CreatedAt        time.Time
	UpdatedAt        *time.Time
	ReplyComment     *string
	ReplyUpdatedAt   *time.Time
}

var starRatings = map[string]float64{"ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5}

// ParseStarRating mirrors parseStarRating: Google's word enum, a number,
// or a numeric string, 1..5 (rounded); 0 when invalid.
func ParseStarRating(v any) int {
	var f float64
	switch x := v.(type) {
	case float64:
		f = x
	case json.Number:
		n, err := x.Float64()
		if err != nil {
			return 0
		}
		f = n
	case string:
		if m, ok := starRatings[strings.ToUpper(x)]; ok {
			f = m
		} else if n, ok := jsNumber(x); ok {
			f = n
		}
	default:
		return 0
	}
	if f < 1 || f > 5 {
		return 0
	}
	return int(math.Floor(f + 0.5))
}

// ExtractReviewID is the segment after the last "/reviews/" (stable across
// Google accounts), or the trimmed name.
func ExtractReviewID(name string) string {
	parts := strings.Split(name, "/reviews/")
	if id := JSTrim(parts[len(parts)-1]); id != "" {
		return id
	}
	return JSTrim(name)
}

var locationSegment = regexp.MustCompile(`locations/([^/]+)`)

// ExtractLocationID is the segment after "locations/", or nil.
func ExtractLocationID(name string) *string {
	m := locationSegment.FindStringSubmatch(name)
	if m == nil {
		return nil
	}
	return &m[1]
}

// ParseLocationIDs mirrors parseLocationIds: the google_bp_location_id
// setting holds one or more locations separated by commas, semicolons or
// spaces; each becomes "locations/{id}", duplicates dropped.
func ParseLocationIDs(raw string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == ';' || isJSSpace(r) }) {
		cleaned := strings.Trim(JSTrim(part), "/")
		if cleaned == "" {
			continue
		}
		if !strings.HasPrefix(cleaned, "locations/") {
			cleaned = "locations/" + cleaned
		}
		if cleaned == "locations/" || seen[cleaned] {
			continue
		}
		seen[cleaned] = true
		out = append(out, cleaned)
	}
	return out
}

// ReplyApprovalMaxRating is the highest rating whose replies need approval.
const ReplyApprovalMaxRating = 2

// NeedsReplyApproval: a non-approver's reply to a review rated <= max goes
// to the approval queue; approvers always send directly.
func NeedsReplyApproval(starRating int, canApprove bool, max int) bool {
	return !canApprove && starRating <= max
}

func trimmedOrNil(s *string) *string {
	if s == nil {
		return nil
	}
	t := JSTrim(*s)
	if t == "" {
		return nil
	}
	return &t
}

// parseGoogleTime is new Date(value) for Google's RFC 3339 timestamps.
func parseGoogleTime(s *string) *time.Time {
	if s == nil || *s == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339Nano, *s)
	if err != nil {
		return nil
	}
	return &t
}

// NormalizeReview mirrors normalizeReview: nil when the review has no
// name, no valid rating or no creation time. Anonymous reviewers are kept
// under a placeholder name.
func NormalizeReview(r ReviewResource) *Review {
	name := trimmedOrNil(r.Name)
	if name == nil {
		name = trimmedOrNil(r.ReviewID)
	}
	if name == nil {
		return nil
	}
	rating := ParseStarRating(r.StarRating)
	if rating == 0 {
		return nil
	}
	created := parseGoogleTime(r.CreateTime)
	if created == nil {
		return nil
	}
	out := &Review{
		ReviewID:     ExtractReviewID(*name),
		ReviewName:   *name,
		LocationID:   ExtractLocationID(*name),
		ReviewerName: "Pengguna Google",
		StarRating:   rating,
		Comment:      trimmedOrNil(r.Comment),
		CreatedAt:    *created,
		UpdatedAt:    parseGoogleTime(r.UpdateTime),
	}
	if rv := r.Reviewer; rv != nil {
		if n := trimmedOrNil(rv.DisplayName); n != nil && !rv.IsAnonymous {
			out.ReviewerName = *n
		}
		out.ReviewerPhotoURL = trimmedOrNil(rv.ProfilePhotoURL)
	}
	if rp := r.ReviewReply; rp != nil {
		out.ReplyComment = trimmedOrNil(rp.Comment)
		out.ReplyUpdatedAt = parseGoogleTime(rp.UpdateTime)
	}
	return out
}

// ReviewSLA is the reply SLA of one review.
type ReviewSLA struct {
	WaitingSeconds int64
	Breached       bool
}

// EvaluateReviewSLA mirrors evaluateReviewSla: waiting time runs from
// Google's publish time until the reply (or now); only unreplied reviews
// breach.
func EvaluateReviewSLA(created time.Time, slaMinutes float64, repliedAt *time.Time, now time.Time) ReviewSLA {
	until := now
	if repliedAt != nil {
		until = *repliedAt
	}
	waiting := max(0, int64(math.Floor(float64(until.Sub(created).Milliseconds())/1000)))
	limit := math.Max(0, slaMinutes) * 60
	return ReviewSLA{WaitingSeconds: waiting, Breached: repliedAt == nil && float64(waiting) > limit}
}
