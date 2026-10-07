package domain

import (
	"math"
	"sort"
	"strings"
	"unicode/utf16"

	"nuhabit/backend/internal/platform/jsmath"
)

// ReviewReplyMax is REVIEW_REPLY_MAX.
const ReviewReplyMax = 1000

// CleanReviewText mirrors cleanReviewText: trimmed, empty becomes nil, cut
// at max UTF-16 units.
func CleanReviewText(text string, max int) *string {
	value := strings.TrimSpace(text)
	if value == "" {
		return nil
	}
	if units := utf16.Encode([]rune(value)); len(units) > max {
		value = string(utf16.Decode(units[:max]))
	}
	return &value
}

// RatingCount is one (outlet, rating) count row.
type RatingCount struct {
	BranchID   *string
	BranchName *string
	Rating     float64
	N          float64
}

// OutletSummary is one outlet's review count and average.
type OutletSummary struct {
	BranchID *string `json:"branch_id"`
	Name     string  `json:"name"`
	Count    int     `json:"count"`
	Average  float64 `json:"average"`
}

// ReviewSummary is the rating summary of the admin page.
type ReviewSummary struct {
	Count        int             `json:"count"`
	Average      *float64        `json:"average"`
	Distribution [5]int          `json:"distribution"` // index 0 = one star
	Outlets      []OutletSummary `json:"outlets"`
}

func round1(n float64) float64 { return jsmath.RoundTo(n, 1) }

// SummarizeReviews mirrors summarizeReviews: average, star distribution and
// per-outlet figures, outlets by count then name.
func SummarizeReviews(rows []RatingCount) ReviewSummary {
	type acc struct {
		branchID *string
		name     string
		count    int
		total    int
	}
	var order []string
	outlets := map[string]*acc{}
	s := ReviewSummary{Outlets: []OutletSummary{}}
	total := 0
	for _, row := range rows {
		rating := int(math.Floor(row.Rating + 0.5))
		n := int(row.N)
		if rating < 1 || rating > 5 || n <= 0 {
			continue
		}
		s.Distribution[rating-1] += n
		s.Count += n
		total += rating * n
		key := ""
		if row.BranchID != nil {
			key = *row.BranchID
		}
		o, ok := outlets[key]
		if !ok {
			name := "Tanpa outlet"
			if row.BranchName != nil {
				name = *row.BranchName
			}
			o = &acc{branchID: row.BranchID, name: name}
			outlets[key] = o
			order = append(order, key)
		}
		o.count += n
		o.total += rating * n
	}
	if s.Count > 0 {
		avg := round1(float64(total) / float64(s.Count))
		s.Average = &avg
	}
	for _, key := range order {
		o := outlets[key]
		s.Outlets = append(s.Outlets, OutletSummary{o.branchID, o.name, o.count, round1(float64(o.total) / float64(o.count))})
	}
	sort.SliceStable(s.Outlets, func(i, j int) bool {
		a, b := s.Outlets[i], s.Outlets[j]
		if a.Count != b.Count {
			return a.Count > b.Count
		}
		return localeLess(a.Name, b.Name)
	})
	return s
}

// localeLess approximates localeCompare(a, b, "id") < 0: case-insensitive,
// lowercase first on a tie, as ICU orders.
func localeLess(a, b string) bool {
	la, lb := strings.ToLower(a), strings.ToLower(b)
	if la != lb {
		return la < lb
	}
	return a > b
}
