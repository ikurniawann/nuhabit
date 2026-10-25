package importer

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/httpx"
)

var testSpec = Spec{
	Entity: "test", FileName: "t.csv",
	Columns: []Column{
		{Key: "nama", Label: "Nama", Required: true},
		{Key: "kapasitas", Label: "Kapasitas"},
		{Key: "harga", Label: "Harga"},
		{Key: "hari", Label: "Hari"},
		{Key: "jam_mulai", Label: "Jam mulai"},
		{Key: "aktif", Label: "Aktif"},
		{Key: "mulai", Label: "Berlaku mulai"},
	},
	Sample: []([]string){{"Engine", "16", "150000", "Senin", "06:30", "ya", "2026-11-01"}},
}

func upload(t *testing.T, name, content, dryRun string) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = fw.Write([]byte(content))
	if dryRun != "" {
		_ = mw.WriteField("dry_run", dryRun)
	}
	_ = mw.Close()
	r := httptest.NewRequest("POST", "/import", &buf)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	return r
}

func TestReadMatchesHeadersByKeyOrLabel(t *testing.T) {
	csv := "\ufeffNama,KAPASITAS,Jam Mulai\nEngine,16,06:30\n,,\nStrength,,\n"
	up, err := Read(upload(t, "a.csv", csv, "1"), testSpec)
	if err != nil {
		t.Fatal(err)
	}
	if !up.DryRun || len(up.Rows) != 2 {
		t.Fatalf("dry run %v, rows %d", up.DryRun, len(up.Rows))
	}
	if up.Rows[0].Number != 2 || up.Rows[0].Get("nama") != "Engine" || up.Rows[0].Get("kapasitas") != "16" || up.Rows[0].Get("jam_mulai") != "06:30" {
		t.Fatalf("row 2: %+v", up.Rows[0])
	}
	if up.Rows[1].Number != 4 || up.Rows[1].Get("nama") != "Strength" || up.Rows[1].Get("kapasitas") != "" {
		t.Fatalf("row 4: %+v", up.Rows[1])
	}
}

func TestReadRejectsMissingRequiredColumn(t *testing.T) {
	_, err := Read(upload(t, "a.csv", "kapasitas\n16\n", ""), testSpec)
	var apiErr *httpx.Error
	if err == nil || !strings.Contains(err.Error(), "nama") {
		t.Fatalf("want missing column error, got %v", err)
	}
	if !errorsAs(err, &apiErr) || apiErr.Status != 400 {
		t.Fatalf("want 400, got %v", err)
	}
	if _, err := Read(upload(t, "a.csv", "nama\n", ""), testSpec); err == nil {
		t.Fatal("header only must fail")
	}
}

func errorsAs(err error, target **httpx.Error) bool {
	e, ok := err.(*httpx.Error)
	if ok {
		*target = e
	}
	return ok
}

func TestFieldsCollectEveryProblem(t *testing.T) {
	row := Row{Number: 3, Data: map[string]string{"nama": "", "kapasitas": "abc", "harga": "x", "hari": "Senen", "jam_mulai": "25:00", "aktif": "mungkin", "mulai": "31/02"}}
	f := testSpec.Fields(row)
	f.Text("nama", 80)
	f.Int("kapasitas", 1, 200)
	f.Money("harga")
	f.Weekday("hari")
	f.Clock("jam_mulai")
	f.Bool("aktif", true)
	f.Date("mulai")
	err := f.Err()
	if err == nil {
		t.Fatal("want rejection")
	}
	msg := err.Error()
	for _, want := range []string{"Nama wajib diisi", "Kapasitas harus angka bulat antara 1 dan 200", "Harga harus nominal rupiah",
		"Hari harus hari", "Jam mulai harus jam HH:MM", "Aktif harus ya atau tidak", "Berlaku mulai harus tanggal"} {
		if !strings.Contains(msg, want) {
			t.Errorf("message lacks %q: %s", want, msg)
		}
	}
	if strings.Count(msg, ";") != 6 {
		t.Errorf("want 7 problems joined by ';', got %s", msg)
	}
}

func TestFieldsReadTypedValues(t *testing.T) {
	row := Row{Number: 2, Data: map[string]string{"nama": " Engine ", "kapasitas": "16.0", "harga": "Rp 1.500.000", "hari": "sabtu",
		"jam_mulai": "6.30", "aktif": "tidak", "mulai": "17/10/2026"}}
	f := testSpec.Fields(row)
	if v := f.Text("nama", 80); v != "Engine" {
		t.Errorf("text %q", v)
	}
	if v, ok := f.Int("kapasitas", 1, 200); !ok || v != 16 {
		t.Errorf("int %d %v", v, ok)
	}
	if v, ok := f.Money("harga"); !ok || v != 1500000 {
		t.Errorf("money %v %v", v, ok)
	}
	if v, ok := f.Weekday("hari"); !ok || v != 6 {
		t.Errorf("weekday %d %v", v, ok)
	}
	if v, ok := f.Clock("jam_mulai"); !ok || v != "06:30" {
		t.Errorf("clock %q %v", v, ok)
	}
	if f.Bool("aktif", true) {
		t.Error("bool tidak must be false")
	}
	if v, ok := f.Date("mulai"); !ok || v != "2026-10-17" {
		t.Errorf("date %q %v", v, ok)
	}
	if err := f.Err(); err != nil {
		t.Fatal(err)
	}
	// An optional blank column is not an error and reports ok=false.
	blank := testSpec.Fields(Row{Data: map[string]string{"nama": "x"}})
	if _, ok := blank.Int("kapasitas", 1, 200); ok || blank.Err() != nil {
		t.Errorf("blank optional: ok %v err %v", ok, blank.Err())
	}
}

func TestParsers(t *testing.T) {
	money := map[string]float64{"1500000": 1500000, "1.500.000": 1500000, "1,500,000": 1500000, "1.500.000,50": 1500000.5,
		"1,500,000.25": 1500000.25, "Rp1.250.000": 1250000, "12.5": 12.5, "0": 0}
	for in, want := range money {
		if got, ok := ParseMoney(in); !ok || got != want {
			t.Errorf("ParseMoney(%q) = %v %v, want %v", in, got, ok, want)
		}
	}
	if _, ok := ParseMoney("abc"); ok {
		t.Error("ParseMoney(abc) must fail")
	}
	dates := map[string]string{"2026-10-17": "2026-10-17", "17/10/2026": "2026-10-17", "17-10-2026": "2026-10-17",
		"2026-10-17T00:00:00.000Z": "2026-10-17", "7/1/2026": "2026-01-07"}
	for in, want := range dates {
		if got, ok := ParseDate(in); !ok || got != want {
			t.Errorf("ParseDate(%q) = %q %v", in, got, ok)
		}
	}
	for _, bad := range []string{"2026-13-01", "32/01/2026", "kemarin", ""} {
		if _, ok := ParseDate(bad); ok {
			t.Errorf("ParseDate(%q) must fail", bad)
		}
	}
	clocks := map[string]string{"06:30": "06:30", "6:30": "06:30", "06.30": "06:30", "06:30:00": "06:30",
		"1899-12-30T06:30:00.000Z": "06:30", "0.2708333333": "06:30", "18:45": "18:45"}
	for in, want := range clocks {
		if got, ok := ParseClock(in); !ok || got != want {
			t.Errorf("ParseClock(%q) = %q %v", in, got, ok)
		}
	}
	for _, bad := range []string{"24:00", "6:5", "pagi", "1.5"} {
		if _, ok := ParseClock(bad); ok {
			t.Errorf("ParseClock(%q) must fail", bad)
		}
	}
	days := map[string]int{"1": 1, "7": 7, "Senin": 1, "jumat": 5, "Jum'at": 5, "Minggu": 7, "Sun": 7, "Wednesday": 3}
	for in, want := range days {
		if got, ok := ParseWeekday(in); !ok || got != want {
			t.Errorf("ParseWeekday(%q) = %d %v", in, got, ok)
		}
	}
	if _, ok := ParseWeekday("8"); ok {
		t.Error("ParseWeekday(8) must fail")
	}
	if got := SplitList(" Station; Engine |Race Sim;; "); len(got) != 3 || got[2] != "Race Sim" {
		t.Errorf("SplitList = %v", got)
	}
	pairs, ok := ParsePairs("DAGO=1200000; SNP = 1300000")
	if !ok || len(pairs) != 2 || pairs[1].Key != "SNP" || pairs[1].Value != "1300000" {
		t.Errorf("ParsePairs = %v %v", pairs, ok)
	}
	if _, ok := ParsePairs("DAGO"); ok {
		t.Error("ParsePairs without = must fail")
	}
}

func TestWriteTemplate(t *testing.T) {
	rec := httptest.NewRecorder()
	if err := WriteTemplate(rec, testSpec); err != nil {
		t.Fatal(err)
	}
	body := rec.Body.String()
	if !strings.HasPrefix(body, "\ufeffnama,kapasitas,harga,hari,jam_mulai,aktif,mulai\n") {
		t.Fatalf("header: %q", body)
	}
	if !strings.Contains(body, "Engine,16,150000,Senin,06:30,ya,2026-11-01") {
		t.Fatalf("sample: %q", body)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/csv") {
		t.Fatalf("content type %q", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, "t.csv") {
		t.Fatalf("disposition %q", cd)
	}
}
