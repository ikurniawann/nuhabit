package domain

import (
	"testing"
	"time"
)

func TestLateness(t *testing.T) {
	shift := ShiftTimes{StartTime: "08:00:00", EndTime: "17:00:00", LateToleranceMinutes: 10}
	at := func(s string) time.Time { v, _ := time.Parse(time.RFC3339, s); return v }
	for _, c := range []struct {
		clock string
		late  bool
		mins  int
	}{
		{"2026-10-05T01:10:00Z", false, 0},  // 08:10 WIB, inside the tolerance
		{"2026-10-05T01:10:01Z", true, 11},  // counted from 08:00, rounded up
		{"2026-10-05T03:00:00Z", true, 120}, // 10:00 WIB
		{"2026-10-04T23:30:00Z", false, 0},  // early
	} {
		if late, mins := Lateness(at(c.clock), "2026-10-05", shift); late != c.late || mins != c.mins {
			t.Errorf("%s: %v %d, want %v %d", c.clock, late, mins, c.late, c.mins)
		}
	}
}

func TestReportLabels(t *testing.T) {
	for in, want := range map[[2]string]string{
		{"2026-08-01", "2026-08-31"}: "1–31 Agustus 2026",
		{"2026-08-25", "2026-09-05"}: "25 Agustus – 5 September 2026",
		{"2026-12-30", "2027-01-02"}: "30 Desember 2026 – 2 Januari 2027",
		{"2026-13-01", "2026-12-01"}: "2026-13-01 s.d. 2026-12-01",
	} {
		if got := PeriodLabel(in[0], in[1]); got != want {
			t.Errorf("PeriodLabel%v = %q, want %q", in, got, want)
		}
	}
	str := func(s string) *string { return &s }
	if StatusLabel(str("present")) != "Hadir" || StatusLabel(str("late")) != "Terlambat" ||
		StatusLabel(str("custom")) != "custom" || StatusLabel(nil) != "—" {
		t.Error("StatusLabel")
	}
	ts := time.Date(2026, 8, 27, 17, 30, 0, 0, time.UTC)
	if ClockWIB(&ts, "—") != "00.30" || ClockWIB(nil, "—") != "—" || DateTimeWIB(&ts, "-") != "28 Agu 2026, 00.30" {
		t.Errorf("WIB formats %q %q", ClockWIB(&ts, "—"), DateTimeWIB(&ts, "-"))
	}
	if TanggalShort("2026-08-27") != "Kam, 27 Agu 2026" || TanggalShort("nope") != "nope" {
		t.Error("TanggalShort")
	}
}

func TestSortReportRows(t *testing.T) {
	rows := []ReportRow{{EmployeeName: "budi", Date: "2026-08-28"}, {EmployeeName: "Ani", Date: "2026-08-27"},
		{EmployeeName: "budi", Date: "2026-08-27"}, {EmployeeName: "Ánis", Date: "2026-08-01"}}
	SortReportRows(rows)
	got := ""
	for _, r := range rows {
		got += r.EmployeeName + " " + r.Date + "|"
	}
	if got != "Ani 2026-08-27|Ánis 2026-08-01|budi 2026-08-27|budi 2026-08-28|" {
		t.Fatal(got)
	}
}

func TestDocumentNames(t *testing.T) {
	if got := ContractFileName("0001/PKWT/VII/2026", "Budi Santoso"); got != "kontrak-0001-pkwt-vii-2026-budi-santoso.pdf" {
		t.Error(got)
	}
	if got := ContractFileName("", "Zoë Ñúñez"); got != "kontrak-zoe-nunez.pdf" {
		t.Error(got)
	}
	if got := ContractFileName("///", "日本"); got != "kontrak-karyawan.pdf" {
		t.Error(got)
	}
	if got := SignedDocumentName("0001/PKWT/VII-2026.a 😀é"); got != "ttd-0001_PKWT_VII-2026.a____" {
		t.Error(got)
	}
	if got, ok := LongDateID("2026-08-01"); !ok || got != "1 Agustus 2026" {
		t.Error(got)
	}
}
