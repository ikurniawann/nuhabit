package domain

import (
	"reflect"
	"testing"
	"time"
)

func TestReportSheets(t *testing.T) {
	jkt, _ := time.LoadLocation("Asia/Jakarta")
	cols := []Column{
		{Key: "title", Label: "Judul Deal", Type: "text"},
		{Key: "value", Label: "Nilai Deal", Type: "currency"},
		{Key: "pax", Label: "Estimasi Pax", Type: "number"},
		{Key: "is_won", Label: "Menang", Type: "boolean"},
		{Key: "created_at", Label: "Dibuat", Type: "datetime"},
	}
	rows := []Row{
		{"title": "Deal A", "value": "5000000.00", "pax": int64(40), "is_won": true, "created_at": time.Date(2026, 10, 4, 7, 30, 0, 0, time.UTC)},
		// NULLs are empty cells; a non-numeric number is Number(v) || 0.
		{"title": nil, "value": nil, "pax": "abc", "is_won": false, "created_at": nil},
	}
	def := deal(func(d *Definition) {
		d.DatePreset = "custom"
		d.DateFrom = OptStr{Set: true, Val: ptr("2026-09-01")}
		d.Limit = 2
	})
	generated := time.Date(2026, 10, 5, 3, 4, 0, 0, time.UTC)
	sheets := ReportSheets(ExportReport{Name: "Deal Q3", Columns: cols, Rows: rows, Truncated: true}, def, generated, jkt)

	wantData := [][]any{
		{"Judul Deal", "Nilai Deal", "Estimasi Pax", "Menang", "Dibuat"},
		{"Deal A", 5_000_000.0, 40.0, "Ya", "4 Okt 2026, 14.30"},
		{"", "", 0.0, "Tidak", ""},
	}
	wantInfo := [][]any{
		{"Report", "Deal Q3"},
		{"Deskripsi", "—"},
		{"Dataset", "Deal"},
		{"Periode", "2026-09-01 s/d ?"},
		{"Mode", "Tabel"},
		{"Jumlah baris", 2},
		{"Dibuat", "5 Okt 2026, 10.04"},
		{"Catatan", "Dipotong pada batas 2 baris"},
	}
	if sheets[0].Name != "Data" || !reflect.DeepEqual(sheets[0].Rows, wantData) {
		t.Fatalf("Data %v", sheets[0].Rows)
	}
	if sheets[1].Name != "Info" || !reflect.DeepEqual(sheets[1].Rows, wantInfo) {
		t.Fatalf("Info %v", sheets[1].Rows)
	}

	// A preset prints its key, an empty description stays empty, grouped
	// results are "Agregasi" and an untruncated run has no note.
	desc := ""
	sheets = ReportSheets(ExportReport{Name: "x", Description: &desc, Columns: cols, Grouped: true}, deal(nil), generated, jkt)
	info := sheets[1].Rows
	if len(sheets[0].Rows) != 1 || len(info) != 7 || info[1][1] != "" || info[3][1] != "all_time" || info[4][1] != "Agregasi" || info[5][1] != 0 {
		t.Fatalf("defaults %v", info)
	}
}

func TestReportFileName(t *testing.T) {
	// 01:00 WIB on the 6th is still the 5th in UTC, as toISOString gives.
	at := time.Date(2026, 10, 6, 1, 0, 0, 0, time.FixedZone("WIB", 7*3600))
	for name, want := range map[string]string{
		"Laporan Penjualan Q3 / 2026!!": "laporan-penjualan-q3-2026-2026-10-05.xlsx",
		"":                              "report-2026-10-05.xlsx",
		"¡¡¡":                           "report-2026-10-05.xlsx",
		"--Lead Panas--":                "lead-panas-2026-10-05.xlsx",
		"Sebuah nama report yang sangat panjang sekali ya !": "sebuah-nama-report-yang-sangat-panjang-s-2026-10-05.xlsx",
		"Sebuah nama report yang sangat panjang  -x":         "sebuah-nama-report-yang-sangat-panjang-x-2026-10-05.xlsx",
	} {
		if got := ReportFileName(name, at); got != want {
			t.Errorf("%q: %q, want %q", name, got, want)
		}
	}
}
