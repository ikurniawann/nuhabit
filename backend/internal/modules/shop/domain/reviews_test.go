package domain

import "testing"

func TestReviewerName(t *testing.T) {
	for in, want := range map[string]string{"Budi Santoso": "Budi S.", "Budi": "Budi", "  ": "Member", " Émile Zola Jr": "Émile Z."} {
		if got := ReviewerName(in); got != want {
			t.Errorf("ReviewerName(%q) = %q, want %q", in, got, want)
		}
	}
}
