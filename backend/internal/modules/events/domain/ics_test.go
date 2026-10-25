package domain

import (
	"strings"
	"testing"

	eventsc "nuhabit/backend/internal/contracts/events"
)

func TestRenderICS(t *testing.T) {
	long := strings.Repeat("Panjang sekali judulnya, ", 5) + "selesai; koma, titik"
	entries := []ICSEntry{
		{Entry: Entry{Kind: eventsc.KindCRMEvent, ID: "e1", Title: long, Area: ptr("Arena"),
			StartsAt: at("2026-11-02T03:00:00Z"), EndsAt: at("2026-11-02T05:00:00Z")},
			BranchName: ptr("Dago"), Status: "published", UpdatedAt: at("2026-10-01T00:00:00Z")},
		{Entry: Entry{Kind: eventsc.KindClass, ID: "c1", Title: "HYROX", CoachName: ptr("Dimas"),
			StartsAt: at("2026-11-03T03:00:00Z"), EndsAt: at("2026-11-03T04:00:00Z")},
			Status: "draft", UpdatedAt: at("2026-10-01T00:00:00Z")},
	}
	out := RenderICS("NüHabit · Dago", entries, at("2026-10-26T00:00:00Z"))
	for _, want := range []string{
		"BEGIN:VCALENDAR\r\n", "X-WR-CALNAME:NüHabit · Dago\r\n",
		"UID:crm_event-e1@nuhabit\r\n", "DTSTART:20261102T030000Z\r\n", "DTEND:20261102T050000Z\r\n",
		"LOCATION:Dago · Arena\r\n", "STATUS:CONFIRMED\r\n",
		"UID:class-c1@nuhabit\r\n", "SUMMARY:Kelas HYROX\r\n", "DESCRIPTION:Coach: Dimas\\nStatus: draft\r\n", "STATUS:TENTATIVE\r\n",
		"END:VCALENDAR\r\n",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in\n%s", want, out)
		}
	}
	if unfolded := strings.ReplaceAll(out, "\r\n ", ""); !strings.Contains(unfolded, `selesai\; koma\, titik`) {
		t.Errorf("reserved characters must be escaped:\n%s", out)
	}
	for _, line := range strings.Split(out, "\r\n") {
		if len(line) > 75 {
			t.Errorf("line over 75 octets: %q", line)
		}
	}
	if !strings.Contains(out, "\r\n ") {
		t.Errorf("the long summary should fold onto a continuation line")
	}
}

func TestFoldKeepsUTF8Sequences(t *testing.T) {
	s := "SUMMARY:" + strings.Repeat("é", 60)
	for _, line := range strings.Split(fold(s), "\r\n") {
		if len(line) > 75 || !strings.ContainsRune(line, 'é') && !strings.HasPrefix(line, "SUMMARY") {
			t.Fatalf("bad fold %q", line)
		}
		if strings.HasPrefix(line, " ") && !strings.HasPrefix(line, " é") {
			t.Fatalf("continuation split a multi-byte rune: %q", line)
		}
	}
}
