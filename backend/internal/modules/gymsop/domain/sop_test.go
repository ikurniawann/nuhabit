package domain

import (
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/localtime"
)

func TestVersionValidate(t *testing.T) {
	cases := map[string]VersionInput{
		"":                                        {Title: "SOP Cuti", Body: "Isi"},
		"Judul SOP 1 sampai 150 karakter":         {Title: " ", Body: "Isi"},
		"Isi SOP atau lampiran PDF wajib ada":     {Title: "SOP Cuti", Body: "  "},
		"Isi SOP maksimal 50.000 karakter":        {Title: "SOP", Body: strings.Repeat("x", BodyMax+1)},
		"Catatan perubahan maksimal 300 karakter": {Title: "SOP", Body: "x", ChangeNote: strings.Repeat("x", 301)},
	}
	for want, in := range cases {
		if got := in.Validate(); got != want {
			t.Errorf("%+v: got %q, want %q", in.Title, got, want)
		}
	}
	if got := (VersionInput{Title: "SOP PDF", HasAttachment: true}).Validate(); got != "" {
		t.Fatalf("a PDF alone is enough: %q", got)
	}
	if !ValidRemindAfter(0) || !ValidRemindAfter(60) || ValidRemindAfter(61) || ValidRemindAfter(-1) {
		t.Fatal("remind after bounds")
	}
}

func TestJobDue(t *testing.T) {
	published := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	day := 24 * time.Hour
	at := func(d time.Duration) time.Time { return published.Add(d) }
	ptr := func(t time.Time) *time.Time { return &t }
	cases := []struct {
		name  string
		last  *time.Time
		now   time.Time
		after int
		want  bool
	}{
		{"too early", nil, at(3*day - time.Minute), 3, false},
		{"first reminder", nil, at(3 * day), 3, true},
		{"reminded recently", ptr(at(4 * day)), at(6 * day), 3, false},
		{"reminded long ago", ptr(at(3 * day)), at(6 * day), 3, true},
		{"job off", nil, at(30 * day), 0, false},
	}
	for _, c := range cases {
		if got := JobDue(published, c.last, c.now, c.after); got != c.want {
			t.Errorf("%s: got %v", c.name, got)
		}
	}
}

func TestRemindedToday(t *testing.T) {
	now := time.Date(2026, 10, 26, 20, 0, 0, 0, localtime.Jakarta)
	morning := time.Date(2026, 10, 26, 0, 30, 0, 0, localtime.Jakarta)
	yesterday := time.Date(2026, 10, 25, 23, 59, 0, 0, localtime.Jakarta)
	if RemindedToday(nil, now) || !RemindedToday(&morning, now) || RemindedToday(&yesterday, now) {
		t.Fatal("same Jakarta day")
	}
	heading, body := Reminder("Rizky", "SOP Cuti", 2)
	if heading != "SOP perlu dibaca" || body != `Halo Rizky, SOP "SOP Cuti" versi 2 belum Anda konfirmasi. Buka Kelas Saya, baca, lalu tekan Saya sudah membaca dan setuju.` {
		t.Fatalf("reminder %q %q", heading, body)
	}
}
