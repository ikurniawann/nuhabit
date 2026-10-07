package reporting

import (
	"net/http"
	"reflect"
	"slices"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/testutil"
	"nuhabit/backend/internal/platform/xlsx"
)

func TestExportReport(t *testing.T) {
	e := setup(t)
	id := createReport(t, e, &e.admin, "Lead Go / Export", true)
	privID := createReport(t, e, &e.admin, "Lead Privat", false)
	path := "/api/crm/report-builder/" + id + "/export"

	if code, _ := e.call(t, "GET", path, nil, nil); code != 401 {
		t.Fatalf("anon: %d", code)
	}
	if code, _ := e.call(t, "GET", path, nil, &e.other); code != 403 {
		t.Fatalf("no grant: %d", code)
	}
	// Another user's private report is invisible, like the JSON GET.
	if code, body := e.call(t, "GET", "/api/crm/report-builder/"+privID+"/export", nil, &e.plain); code != 404 || body["error"] != "Report tidak ditemukan" {
		t.Fatalf("private: %d %v", code, body)
	}

	rec, _ := testutil.Do(t, e.mux, testutil.AsStaff(testutil.Request("GET", path, nil), e.admin))
	h := rec.Header()
	wantName := "lead-go-export-" + time.Now().UTC().Format("2006-01-02") + ".xlsx"
	if rec.Code != http.StatusOK || h.Get("Content-Type") != xlsx.ContentType || h.Get("Cache-Control") != "no-store" ||
		h.Get("Content-Disposition") != `attachment; filename="`+wantName+`"` {
		t.Fatalf("export: %d %v", rec.Code, h)
	}
	file := rec.Body.Bytes()

	rows, err := xlsx.ParseMatrix(file, xlsx.ReadOptions{PreferSheet: "Data"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(rows[0], []string{"Instansi", "Status", "Temperatur", "Sumber", "Skor", "Penanggung Jawab", "Dibuat"}) || len(rows) != 3 {
		t.Fatalf("Data %v", rows)
	}
	var orgs, scores []string
	for _, r := range rows[1:] {
		orgs, scores = append(orgs, r[0]), append(scores, r[4])
	}
	slices.Sort(orgs)
	slices.Sort(scores)
	if !reflect.DeepEqual(orgs, []string{e.org, e.org + " B"}) || !reflect.DeepEqual(scores, []string{"3", "7"}) {
		t.Fatalf("Data rows %v", rows)
	}

	info, err := xlsx.ParseMatrix(file, xlsx.ReadOptions{PreferSheet: "Info"})
	if err != nil {
		t.Fatal(err)
	}
	want := [][]string{{"Report", "Lead Go / Export"}, {"Deskripsi", "—"}, {"Dataset", "Lead"}, {"Periode", "all_time"}, {"Mode", "Tabel"}, {"Jumlah baris", "2"}}
	if len(info) != 7 || !reflect.DeepEqual(info[:6], want) || info[6][0] != "Dibuat" {
		t.Fatalf("Info %v", info)
	}
}
