package domain

import (
	"reflect"
	"testing"

	"nuhabit/backend/internal/platform/xlsx"
)

func coaRow(code string, edit func(*CoaRow)) CoaRow {
	r := CoaRow{Code: code, Name: "Akun " + code, AccountTypeCode: "ASSET", Level: 1, SourceRow: 1}
	if edit != nil {
		edit(&r)
	}
	return r
}

// coa-import.test.ts
func TestBuildCoaImportPreview(t *testing.T) {
	types := map[string]string{"ASSET": "type-asset"}
	existing := map[string]ExistingAccount{"1100": {"a", "Akun 1100"}, "1200": {"b", "Nama lama"}}
	preview := BuildCoaImportPreview([]CoaRow{
		coaRow("1000", nil),
		coaRow("1100", nil),
		coaRow("1200", nil),
		coaRow("1300", func(r *CoaRow) { r.AccountTypeCode = "EXPENSE" }),
		coaRow("1400", func(r *CoaRow) { r.ParentCode = ptr("9999") }),
		coaRow("1500", func(r *CoaRow) { r.ParentCode = ptr("1000") }),
	}, types, existing)
	got := [][3]string{}
	for _, p := range preview {
		got = append(got, [3]string{p.Code, p.Action, p.Message})
	}
	want := [][3]string{
		{"1000", "create", ""},
		{"1100", "skip", "Tidak berubah"},
		{"1200", "update", ""},
		{"1300", "error", "Account type EXPENSE tidak ditemukan"},
		{"1400", "error", "Parent 9999 tidak ditemukan"},
		{"1500", "create", ""},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("preview = %v\nwant %v", got, want)
	}

	one := BuildCoaImportPreview([]CoaRow{coaRow("1000", nil)}, types, nil)
	if s := SummarizeCoaImport(one, []CoaIssue{{Row: 3, Message: "Kode kosong"}}); s != (CoaImportSummary{Create: 1, Error: 1}) {
		t.Fatalf("summary = %+v", s)
	}
}

func book(t *testing.T, sheets ...xlsx.SheetSpec) []byte {
	t.Helper()
	b, err := xlsx.Build(sheets...)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestParseCoaStandardSheet(t *testing.T) {
	data := book(t,
		xlsx.SheetSpec{Name: "Other", Rows: [][]any{{"ignored"}}},
		xlsx.SheetSpec{Name: "coa", Rows: [][]any{
			{"Kode Akun", "Nama", "Tipe", "Kas Bank", "Cash Flow", "Deskripsi", "Parent"},
			{"1 0 00 000", "CURRENT ASSETS", "", "", "", "", ""},
			{"1101000", "CASH & BANK", "", "", "", "", ""},
			{"1101001", "Kas Kecil", "", "", "", "Petty", ""},
			{"1-1-01-002", "Bank BCA", "asset", "tidak", "investing", "", "1101000"},
			{"1101001", "Duplikat", "", "", "", "", ""},
			{"", "", "", "", "", "", ""},
			{"abc", "Rusak", "", "", "", "", ""},
			{"1101003", "", "", "", "", "", ""},
			{"1101004", "Salah CF", "", "", "bogus", "", ""},
			{"1702001", "ACCUMULATED DEPRECIATION", "", "", "", "", ""},
		}},
	)
	rows, issues, err := ParseCoaSpreadsheet(data)
	if err != nil {
		t.Fatal(err)
	}
	wantIssues := []CoaIssue{
		{Row: 6, Code: "1101001", Message: "Kode duplikat (baris 4)"},
		{Row: 8, Message: "Kode tidak valid: abc"},
		{Row: 9, Code: "1101003", Message: "Nama wajib diisi"},
		{Row: 10, Code: "1101004", Message: "cash_flow_category tidak valid: BOGUS"},
	}
	if !reflect.DeepEqual(issues, wantIssues) {
		t.Fatalf("issues = %+v", issues)
	}
	if len(rows) != 5 {
		t.Fatalf("rows = %+v", rows)
	}
	petty, bca, accum := rows[2], rows[3], rows[4]
	if petty.Level != 4 || *petty.ParentCode != "1101000" || !petty.IsCashBank || *petty.CashFlowCategory != "OPERATING" || *petty.Description != "Petty" {
		t.Fatalf("petty = %+v", petty)
	}
	if bca.Code != "1101002" || bca.AccountTypeCode != "ASSET" || bca.IsCashBank || *bca.CashFlowCategory != "INVESTING" || bca.SourceRow != 5 {
		t.Fatalf("bca = %+v", bca)
	}
	// 1700000 and 1702000 are absent: the nearest kept ancestor is the class header.
	if *accum.ParentCode != "1000000" || !accum.IsContra || *accum.CashFlowCategory != "NON_CASH" {
		t.Fatalf("accumulated = %+v", accum)
	}
	if rows[0].ParentCode != nil || rows[0].CashFlowCategory != nil || rows[0].Level != 1 {
		t.Fatalf("header = %+v", rows[0])
	}
}

func TestParseCoaSuluSheet(t *testing.T) {
	data := book(t, xlsx.SheetSpec{Name: "Sheet1", Rows: [][]any{
		{"8 0 00 000", "OTHER INCOME/EXPENSES"},
		{"8 2 00 000", "", "NON OPERATING INCOME"},
		{"8 3 01 001", "", "", "Rounding Gain"},
		{"8 3 01 001", "", "", "Rounding Loss"},
		{"8 3 01 001", "", "", "Rounding Loss again"},
		{"8 1 01 001", ""},
		{"x"},
	}})
	rows, issues, err := ParseCoaSpreadsheet(data)
	if err != nil {
		t.Fatal(err)
	}
	wantIssues := []CoaIssue{
		{Row: 5, Code: "8301001", Message: "Kode duplikat (sudah di baris 4)"},
		{Row: 6, Code: "8101001", Message: "Nama kosong — baris dilewati"},
		{Row: 7, Message: "Kode tidak valid: x"},
	}
	if !reflect.DeepEqual(issues, wantIssues) {
		t.Fatalf("issues = %+v", issues)
	}
	codes := []string{}
	for _, r := range rows {
		codes = append(codes, r.Code+":"+r.AccountTypeCode)
	}
	if want := []string{"8000000:OTHER_EXPENSE", "8200000:OTHER_INCOME", "8201003:OTHER_INCOME", "8301001:OTHER_EXPENSE"}; !reflect.DeepEqual(codes, want) {
		t.Fatalf("codes = %v", codes)
	}
	if *rows[2].ParentCode != "8200000" || *rows[3].ParentCode != "8000000" {
		t.Fatalf("parents = %v %v", *rows[2].ParentCode, *rows[3].ParentCode)
	}
}

func TestParseCoaEdgeSheets(t *testing.T) {
	cases := []struct {
		rows [][]any
		want []CoaIssue
	}{
		{[][]any{{"code", "name"}}, []CoaIssue{{Row: 1, Message: "File kosong / tanpa data"}}},
		{[][]any{{"kode", "keterangan"}, {"1000000", "x"}}, []CoaIssue{{Row: 1, Message: "Header wajib: code, name"}}},
	}
	for _, c := range cases {
		rows, issues, err := ParseCoaSpreadsheet(book(t, xlsx.SheetSpec{Name: "COA", Rows: c.rows}))
		if err != nil || len(rows) != 0 || !reflect.DeepEqual(issues, c.want) {
			t.Fatalf("%v: rows %v issues %v err %v", c.rows, rows, issues, err)
		}
	}
	if _, _, err := ParseCoaSpreadsheet([]byte("not a workbook")); err == nil {
		t.Fatal("garbage parsed")
	}
}

func TestCoaHeuristics(t *testing.T) {
	cashBank := []struct {
		name, code string
		level      int
		want       bool
	}{
		{"Kas", "1101000", 3, false},
		{"Anything", "1102005", 4, true},
		{"BANK LOAN", "2101001", 4, false},
		{"Petty Cash", "1199001", 4, true},
		{"Giro Mandiri", "1199002", 4, true},
		{"AR Bank", "1199003", 4, false},
		{"Bankruptcy reserve", "1199004", 4, false},
	}
	for _, c := range cashBank {
		if got := InferIsCashBank(c.name, c.code, c.level); got != c.want {
			t.Errorf("InferIsCashBank(%q, %q) = %v", c.name, c.code, got)
		}
	}
	cf := map[[2]string]string{
		{"2201001", "Bank loan"}:           "FINANCING",
		{"3101001", "Modal"}:               "FINANCING",
		{"6101001", "Gaji"}:                "OPERATING",
		{"8101001", "Biaya lain"}:          "NON_CASH",
		{"6101002", "Biaya DE amortisasi"}: "NON_CASH",
		{"7101001", "Lain"}:                "",
	}
	for k, want := range cf {
		got := ""
		if p := InferCashFlowCategory(k[0], k[1], 4); p != nil {
			got = *p
		}
		if got != want {
			t.Errorf("InferCashFlowCategory(%v) = %q, want %q", k, got, want)
		}
	}
	if p := InferCashFlowCategory("1700000", "Depreciation", 2); p == nil || *p != "NON_CASH" {
		t.Error("depreciation header has a category")
	}
}
