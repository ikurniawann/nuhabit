package domain

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func ptr[T any](v T) *T { return &v }

func TestValidateType(t *testing.T) {
	medical := Medical
	bogus := Category("other")
	cases := []struct {
		in     TypeInput
		create bool
		want   string
	}{
		{TypeInput{Label: ptr("Cedera bahu"), Category: &medical}, true, ""},
		{TypeInput{Label: ptr("Cedera bahu")}, true, "Nama dan kategori penanda wajib diisi"},
		{TypeInput{Label: ptr("  ")}, false, "Nama penanda 1 sampai 40 karakter"},
		{TypeInput{Category: &bogus}, false, "Kategori harus umum atau medis"},
		{TypeInput{Color: ptr("purple")}, false, "Warna penanda tidak dikenal"},
		{TypeInput{Icon: ptr("skull")}, false, "Ikon penanda tidak dikenal"},
		{TypeInput{DefaultExpiryDays: ptr(ptr(0))}, false, "Masa berlaku bawaan 1 sampai 3650 hari"},
		{TypeInput{DefaultExpiryDays: ptr[*int](nil)}, false, ""},
		{TypeInput{SortOrder: ptr(-1)}, false, "Urutan 0 sampai 10000"},
	}
	for i, c := range cases {
		if got := ValidateType(c.in, c.create); got != c.want {
			t.Errorf("case %d: got %q, want %q", i, got, c.want)
		}
	}
}

func TestTypeCode(t *testing.T) {
	for label, want := range map[string]string{
		"Cedera Bahu":             "cedera_bahu",
		"  VIP!! Member  ":        "vip_member",
		"Ünïcode":                 "n_code",
		"!!!":                     "flag",
		strings.Repeat("ab ", 20): "ab_ab_ab_ab_ab_ab_ab_ab_ab_ab_ab",
	} {
		if got := TypeCode(label); got != want {
			t.Errorf("TypeCode(%q) = %q, want %q", label, got, want)
		}
	}
}

func TestFlagExpiry(t *testing.T) {
	today := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	if DefaultExpiry(today, nil) != nil {
		t.Fatal("no default means no expiry")
	}
	if got := DefaultExpiry(today, ptr(30)); !got.Equal(today.AddDate(0, 0, 30)) {
		t.Fatalf("default expiry %v", got)
	}
	if !ValidExpiry(today, today) || ValidExpiry(today.AddDate(0, 0, -1), today) || ValidExpiry(today.AddDate(11, 0, 0), today) {
		t.Fatal("expiry bounds")
	}
	if ReviewKeepsFlag(ReviewCleared) || !ReviewKeepsFlag(ReviewRestricted) || !ReviewKeepsFlag(ReviewDoctorNote) {
		t.Fatal("review keeps flag")
	}
}

func TestParqAnswers(t *testing.T) {
	raw := map[string]any{}
	for _, q := range ParqQuestions {
		raw[q.Code] = false
	}
	if len(ParqQuestions) != 7 {
		t.Fatalf("PAR-Q+ has 7 general questions, got %d", len(ParqQuestions))
	}
	a, ok := ParseParqAnswers(raw)
	if !ok || a.HasYes() {
		t.Fatal("all no parses and has no yes")
	}
	raw["extra"] = true
	if a, ok = ParseParqAnswers(raw); !ok || len(a) != 7 {
		t.Fatal("unknown keys are dropped")
	}
	raw["chest_pain"] = "yes"
	if _, ok := ParseParqAnswers(raw); ok {
		t.Fatal("non-boolean answer must fail")
	}
	delete(raw, "chest_pain")
	if _, ok := ParseParqAnswers(raw); ok {
		t.Fatal("missing answer must fail")
	}

	a = ParqAnswers{"bone_joint": true, "heart_condition": true}
	if !a.HasYes() {
		t.Fatal("has yes")
	}
	if got := a.ReviewNote("  lutut\n kiri "); got != "PAR-Q ya: kondisi jantung atau tekanan darah tinggi; masalah tulang, sendi atau jaringan lunak. Keterangan member: lutut kiri" {
		t.Fatalf("note %q", got)
	}
	long := a.ReviewNote(strings.Repeat("x", 600))
	if utf8.RuneCountInString(long) != NoteMax || !strings.HasSuffix(long, "…") {
		t.Fatalf("long note is cut to %d: %d", NoteMax, utf8.RuneCountInString(long))
	}
}

func TestParqDue(t *testing.T) {
	submitted := time.Date(2025, 10, 26, 9, 0, 0, 0, time.UTC)
	expires := ParqExpiry(submitted)
	if !expires.Equal(time.Date(2026, 10, 26, 9, 0, 0, 0, time.UTC)) {
		t.Fatalf("expiry %v", expires)
	}
	if !ParqDue("", nil, submitted) {
		t.Fatal("never filled is due")
	}
	if ParqDue(ParqVersion, &expires, expires.Add(-time.Second)) {
		t.Fatal("current before expiry")
	}
	if !ParqDue(ParqVersion, &expires, expires) {
		t.Fatal("due at expiry")
	}
	if !ParqDue("parq-old", &expires, submitted) {
		t.Fatal("older version is due")
	}
}

func TestNotes(t *testing.T) {
	now := time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)
	if !CanWriteNote(now.Add(-time.Hour), now) || CanWriteNote(now.Add(time.Minute), now) ||
		!CanWriteNote(now.AddDate(0, 0, -7), now) || CanWriteNote(now.AddDate(0, 0, -7).Add(-time.Second), now) {
		t.Fatal("write window")
	}
	if ValidSessionNote("") || !ValidSessionNote("ok") || ValidSessionNote(strings.Repeat("x", 501)) {
		t.Fatal("note length")
	}
	day := func(d int) time.Time { return now.AddDate(0, 0, -d) }
	notes := []NoteRef{
		{false, day(5)}, {true, day(40)}, {false, day(1)}, {false, day(3)}, {true, day(2)}, {false, day(10)},
	}
	got := RosterNotes(notes, 3)
	want := []int{4, 1, 2, 3, 0}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}
