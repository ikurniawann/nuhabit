package gymcredits

import (
	"errors"
	"testing"
)

func TestPickTransferReceiver(t *testing.T) {
	hits := []MemberSummary{
		{ID: "intl", Phone: "+62 812-3456-7890"},
		{ID: "local", Phone: "081298765432"},
		{ID: "bare", Phone: "6281311112222"},
		{ID: "twin-a", Phone: "085500001111"},
		{ID: "twin-b", Phone: "+6285500001111"},
		{ID: "tail-only", Phone: "081355551234"},
		{ID: "empty", Phone: ""},
	}
	for _, c := range []struct {
		name, phone, want string
		status            int
	}{
		{"08 spelling finds the +62 member", "0812 3456 7890", "intl", 0},
		{"+62 spelling finds the 08 member", "+62-812-9876-5432", "local", 0},
		{"62 spelling finds the +62 member", "6281234567890", "intl", 0},
		{"dashes and spaces are ignored", "62 813-1111-2222", "bare", 0},
		{"an exact match wins over tails", "085500001111", "twin-a", 0},
		{"a unique nine digit tail is accepted", "+1 813 5555 1234", "tail-only", 0},
		{"the same tail on two members is ambiguous", "+1 855 0000 1111", "", 409},
		{"no member with the number", "081200000000", "", 404},
		{"too short to be a number", "0812", "", 400},
	} {
		t.Run(c.name, func(t *testing.T) {
			got, err := pickTransferReceiver(hits, c.phone)
			if c.status == 0 {
				if err != nil || got != c.want {
					t.Fatalf("got %q, %v; want %q", got, err, c.want)
				}
				return
			}
			var e *Error
			if !errors.As(err, &e) || e.Status != c.status {
				t.Fatalf("got %q, %v; want status %d", got, err, c.status)
			}
		})
	}
}
