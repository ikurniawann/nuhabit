package domain

import (
	"errors"
	"fmt"
	"math"
	"testing"
)

func ptr[T any](v T) *T { return &v }

func TestRound2AndFormat(t *testing.T) {
	cases := []struct {
		in   float64
		want float64
	}{
		{1.005, 1}, // 1.005*100 = 100.49999999999999 in IEEE
		{2.675, 2.68},
		{-2.5 / 100, -0.02}, // Math.round(-2.5) = -2
		{-0.001, 0},         // -0 normalised
		{1234.565, 1234.57},
	}
	for _, c := range cases {
		if got := Round2(c.in); got != c.want {
			t.Errorf("Round2(%v) = %v, want %v", c.in, got, c.want)
		}
	}
	a, b := 0.1, 0.2
	if got := FormatNumber(a + b); got != "0.30000000000000004" {
		t.Errorf("0.1+0.2 = %q", got)
	}
	fmts := map[float64]string{0: "0", 1500: "1500", 1e21: "1e+21", 1e-7: "1e-7", 0.000001: "0.000001", -12.5: "-12.5"}
	for in, want := range fmts {
		if got := FormatNumber(in); got != want {
			t.Errorf("FormatNumber(%v) = %q, want %q", in, got, want)
		}
	}
}

func TestParseNumber(t *testing.T) {
	cases := map[string]float64{"": 0, " 20 ": 20, "1e2": 100, "0x10": 16, "12.5": 12.5, ".5": 0.5, "Infinity": math.Inf(1)}
	for in, want := range cases {
		if got := ParseNumber(in); got != want {
			t.Errorf("ParseNumber(%q) = %v, want %v", in, got, want)
		}
	}
	for _, in := range []string{"abc", "1_000", "12px", "0x", "nan"} {
		if got := ParseNumber(in); !math.IsNaN(got) {
			t.Errorf("ParseNumber(%q) = %v, want NaN", in, got)
		}
	}
	if !math.IsNaN(PageNumber(math.NaN(), 1, 100)) || PageNumber(500, 1, 100) != 100 || PageNumber(-3, 0, 0) != 0 {
		t.Fatal("PageNumber")
	}
}

func TestAccountCodes(t *testing.T) {
	cases := []struct {
		raw, code, display string
		level              int
	}{
		{"1 1 01 001", "1101001", "1 1 01 001", 4},
		{"1101001", "1101001", "1 1 01 001", 4},
		{"1-1-01-000", "1101000", "1 1 01 000", 3},
		{"  2.1.00.000 ", "2100000", "2 1 00 000", 2},
		{"3000000", "3000000", "3 0 00 000", 1},
		{"11010", "", "11010", 0},
		{"abc", "", "abc", 0},
	}
	for _, c := range cases {
		if got := NormalizeAccountCode(c.raw); got != c.code {
			t.Errorf("NormalizeAccountCode(%q) = %q, want %q", c.raw, got, c.code)
		}
		if got := FormatAccountCodeDisplay(c.raw); got != c.display {
			t.Errorf("FormatAccountCodeDisplay(%q) = %q, want %q", c.raw, got, c.display)
		}
		if got := InferAccountLevel(c.raw); got != c.level {
			t.Errorf("InferAccountLevel(%q) = %d, want %d", c.raw, got, c.level)
		}
	}
}

// fiscal-periods.test.ts
func TestOpenSequenceViolation(t *testing.T) {
	if got := OpenSequenceViolation([]PeriodInput{{PeriodNo: 1, Status: "CLOSED"}, {PeriodNo: 2, Status: "OPEN"}}); got != "" {
		t.Fatalf("closed then open: %q", got)
	}
	got := OpenSequenceViolation([]PeriodInput{{PeriodNo: 2, Status: "OPEN"}, {PeriodNo: 1, Name: "Januari 2026", Status: "OPEN"}})
	want := "Tidak bisa OPEN period 2: period 1 (Januari 2026) belum CLOSED. Tutup period sebelumnya terlebih dahulu."
	if got != want {
		t.Fatalf("got %q", got)
	}
}

func TestValidateFiscalYear(t *testing.T) {
	jan := PeriodInput{PeriodNo: 1, Name: "Jan", StartDate: "2026-01-01", EndDate: "2026-01-31", Status: "OPEN"}
	feb := PeriodInput{PeriodNo: 2, Name: "Feb", StartDate: "2026-02-01", EndDate: "2026-02-28", Status: "CLOSED"}
	cases := []struct {
		start, end string
		periods    []PeriodInput
		want       string
	}{
		{"2026-01-01", "2026-12-31", []PeriodInput{jan, feb}, ""},
		{"2026-12-31", "2026-01-01", []PeriodInput{jan}, "end_date harus >= start_date"},
		{"2026-01-01", "2026-12-31", []PeriodInput{jan, jan}, "period_no 1 duplikat"},
		{"2026-02-01", "2026-12-31", []PeriodInput{jan}, "Period 1 harus berada dalam rentang fiscal year"},
		{"2026-01-01", "2026-12-31", []PeriodInput{{PeriodNo: 3, StartDate: "2026-03-31", EndDate: "2026-03-01", Status: "OPEN"}}, "Period 3: end_date < start_date"},
		{"2026-01-01", "2026-12-31", []PeriodInput{jan, {PeriodNo: 2, Name: "Feb", StartDate: "2026-02-01", EndDate: "2026-02-28", Status: "OPEN"}},
			"Tidak bisa OPEN period 2: period 1 (Jan) belum CLOSED. Tutup period sebelumnya terlebih dahulu."},
	}
	for i, c := range cases {
		if got := ValidateFiscalYear(c.start, c.end, c.periods); got != c.want {
			t.Errorf("case %d: got %q, want %q", i, got, c.want)
		}
	}
	if b := CloseBlockers("Jan", "CLOSED", false, 2); len(b) != 3 || b[2] != "Masih ada 2 jurnal DRAFT. Posting atau hapus dulu sebelum closing." {
		t.Fatalf("blockers %v", b)
	}
}

func line(side string, amount float64) Line { return Line{AccountID: "a", Side: side, Amount: amount} }

func TestValidateBalanced(t *testing.T) {
	cases := []struct {
		name  string
		lines []Line
		want  string
	}{
		{"balanced", []Line{line(Debit, 100.10), line(Credit, 50.05), line(Credit, 50.05)}, ""},
		{"one line", []Line{line(Debit, 1)}, "Minimal 2 baris jurnal (debit dan credit)"},
		{"no credit", []Line{line(Debit, 1), line(Debit, 1)}, "Harus ada minimal satu baris Debit dan satu baris Credit"},
		{"zero", []Line{line(Debit, 0), line(Credit, 0)}, "Amount harus lebih dari 0"},
		{"bad side", []Line{line("X", 1), line(Credit, 1)}, "entry_side harus DEBIT atau CREDIT"},
		{"no account", []Line{{Side: Debit, Amount: 1}, line(Credit, 1)}, "Setiap baris harus punya akun COA"},
		{"unbalanced", []Line{line(Debit, 1500), line(Credit, 1499.5)}, "Jurnal tidak balance: Debit 1500 ≠ Credit 1499.5"},
	}
	for _, c := range cases {
		err := ValidateBalanced(c.lines)
		got := ""
		if err != nil {
			got = err.Error()
		}
		if got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestJournalStateMachine(t *testing.T) {
	mut := []struct {
		typ, status string
		recon       bool
		want        string
	}{
		{EntryManual, StatusDraft, false, ""},
		{EntryOpening, StatusDraft, false, "Beginning balance (OPENING) dikelola lewat menu Beginning Balance"},
		{EntryAuto, StatusDraft, false, "Journal entry AUTO dari modul operasional tidak bisa diubah dari sini"},
		{EntryManual, StatusPosted, false, "Journal entry POSTED tidak bisa diubah/dihapus"},
		{EntryManual, StatusDraft, true, "Journal entry dengan flag recon tidak bisa diubah/dihapus"},
	}
	for _, c := range mut {
		err := AssertMutable(c.typ, c.status, c.recon)
		got := ""
		if err != nil {
			got = err.Error()
		}
		if got != c.want {
			t.Errorf("AssertMutable(%s,%s,%v) = %q", c.typ, c.status, c.recon, got)
		}
	}
	post := []struct {
		status string
		lines  int
		d, c   float64
		want   string
	}{
		{StatusDraft, 2, 10, 10, ""},
		{StatusPosted, 2, 10, 10, "Journal entry sudah POSTED"},
		{StatusDraft, 1, 10, 10, "Minimal 2 baris jurnal sebelum post"},
		{StatusDraft, 2, 10, 9, "Jurnal tidak balance"},
	}
	for _, c := range post {
		err := AssertPostable(c.status, c.lines, c.d, c.c)
		got := ""
		if err != nil {
			got = err.Error()
		}
		if got != c.want {
			t.Errorf("AssertPostable(%v) = %q", c, got)
		}
	}
	if !CanEdit(StatusDraft, false, EntryManual) || CanEdit(StatusDraft, false, EntryAuto) || CanEdit(StatusPosted, false, EntryManual) {
		t.Fatal("CanEdit")
	}
	if NormalizeEntryType("weird") != EntryManual || NormalizeEntryType(EntryAuto) != EntryAuto {
		t.Fatal("NormalizeEntryType")
	}
}

func TestCheckPostableAccounts(t *testing.T) {
	co := "c1"
	other := "c2"
	ok := AccountCheck{ID: "a", IsPostable: true, CompanyID: &co}
	cases := []struct {
		want int
		rows []AccountCheck
		co   *string
		msg  string
	}{
		{1, []AccountCheck{ok}, &co, ""},
		{2, []AccountCheck{ok}, &co, "Satu atau lebih akun COA tidak ditemukan"},
		{1, []AccountCheck{{ID: "a", IsPostable: true, CompanyID: &co, Deleted: true}}, &co, "Akun COA sudah dihapus"},
		{1, []AccountCheck{{ID: "a", CompanyID: &co}}, &co, "header"},
		{1, []AccountCheck{{ID: "a", IsPostable: true, CompanyID: &other}}, &co, "Akun COA harus dalam company yang sama"},
		{1, []AccountCheck{ok}, nil, "Akun COA harus dalam company yang sama"},
	}
	for i, c := range cases {
		err := CheckPostableAccounts(c.want, c.rows, c.co, "header")
		got := ""
		if err != nil {
			got = err.Error()
		}
		if got != c.msg {
			t.Errorf("case %d: %q", i, got)
		}
	}
	var rej *Rejection
	if err := CheckPostableAccounts(2, nil, &co, ""); !errors.As(err, &rej) || rej.Status != 404 {
		t.Fatal("missing account must be 404")
	}
}

func TestNextSequenceNo(t *testing.T) {
	if got := NextSequenceNo("JE-202610-", ""); got != "JE-202610-0001" {
		t.Fatal(got)
	}
	if got := NextSequenceNo("JE-202610-", "JE-202610-0041"); got != "JE-202610-0042" {
		t.Fatal(got)
	}
	if got := NextSequenceNo("OB-2026-", "OB-2026-x"); got != "OB-2026-0001" {
		t.Fatal(got)
	}
}

// journal-mapping-posting.test.ts
func TestMappingPosting(t *testing.T) {
	if AmountFromSource("TOTAL", Amounts{"TOTAL": 1200, "SUBTOTAL": 1000}) != 1200 || AmountFromSource("PAID", Amounts{"PAID": 500}) != 500 {
		t.Fatal("reads by source")
	}
	if AmountFromSource("TAX", Amounts{"TOTAL": 10}) != 0 || AmountFromSource("TOTAL", Amounts{"TOTAL": -5}) != 0 {
		t.Fatal("non-positive is 0")
	}
	if !HasRequiredAccounts([]MappingLine{{AccountID: ptr("a"), IsRequired: true}, {IsRequired: false}}) ||
		HasRequiredAccounts([]MappingLine{{IsRequired: true}, {AccountID: ptr("b"), IsRequired: true}}) {
		t.Fatal("required accounts")
	}
	base := []MappingLine{
		{Side: Debit, AccountID: ptr("inv"), AmountSource: "TOTAL", SortOrder: 10, IsRequired: true, LineRole: "INVENTORY"},
		{Side: Credit, AccountID: ptr("grni"), AmountSource: "TOTAL", SortOrder: 20, IsRequired: true, LineRole: "GRNI"},
	}
	lines, reason := BuildFromMapping(base, Amounts{"TOTAL": 1500}, nil)
	if reason != "" || len(lines) != 2 || lines[0].Amount != 1500 || lines[1].Amount != 1500 || *lines[1].SortOrder != 20 {
		t.Fatalf("balanced: %v %q", lines, reason)
	}
	if _, reason := BuildFromMapping(base, Amounts{"SUBTOTAL": 10}, nil); reason != "Amount source TOTAL untuk role INVENTORY bernilai 0" {
		t.Fatal(reason)
	}
	missing := []MappingLine{{Side: Debit, AmountSource: "TOTAL", IsRequired: true, LineRole: "INVENTORY"}, base[1]}
	if _, reason := BuildFromMapping(missing, Amounts{"TOTAL": 100}, nil); reason != "Journal mapping belum lengkap (akun COA wajib belum diisi)" {
		t.Fatal(reason)
	}
	discount := []MappingLine{
		{Side: Debit, AccountID: ptr("cash"), AmountSource: "TOTAL", SortOrder: 10, IsRequired: true, LineRole: "CASH"},
		{Side: Debit, AmountSource: "DISCOUNT", SortOrder: 15, LineRole: "DISCOUNT"},
		{Side: Credit, AccountID: ptr("rev"), AmountSource: "SUBTOTAL", SortOrder: 20, IsRequired: true, LineRole: "REVENUE"},
	}
	if _, reason := BuildFromMapping(discount, Amounts{"TOTAL": 36000, "DISCOUNT": 4000, "SUBTOTAL": 40000}, nil); reason != "Akun COA untuk role DISCOUNT belum diisi (nilai DISCOUNT=4000)" {
		t.Fatal(reason)
	}
	if got := Summarize(PostResult{Status: PostPosted}, PostResult{Status: PostPosted}, PostResult{Status: PostSkipped, Reason: AlreadyExists}, PostResult{Status: PostDraft}); got != "jurnal posted; jurnal draft: mapping belum lengkap" {
		t.Fatal(got)
	}
	if got := Summarize(PostResult{Status: PostSkipped, Reason: AlreadyExists}); got != "" {
		t.Fatal(got)
	}
}

// ap-status.test.ts
func TestReceivableStatus(t *testing.T) {
	if InvoiceOutstanding(1000, 250) != 750 || InvoiceOutstanding(100, 100) != 0 || InvoiceOutstanding(50, 80) != 0 {
		t.Fatal("outstanding")
	}
	today := "2026-08-12"
	cases := []struct {
		total, alloc float64
		due          string
		want         string
	}{
		{1000, 1000, "2026-01-01", "paid"},
		{1000, 400, "2026-12-01", "partial"},
		{1000, 0, "2026-01-01", "overdue"},
		{1000, 100, "2026-01-01", "overdue"},
		{1000, 0, "2026-12-01", "unpaid"},
		{1000, 0, "Thu Jan 01", "unpaid"}, // the TS date-string bug never reports overdue
	}
	for _, c := range cases {
		if got := PaymentStatus(c.total, c.alloc, &c.due, today); got != c.want {
			t.Errorf("%v: %s", c, got)
		}
	}
	if BucketAging(0, ptr("2026-01-01"), today) != "" {
		t.Fatal("no outstanding")
	}
	buckets := map[string]string{"2026-08-20": "current", "2026-08-12": "current", "2026-07-20": "1_30", "2026-06-20": "31_60", "2026-05-20": "61_90", "2026-01-01": "90_plus", "Sun Aug 09": "current"}
	for due, want := range buckets {
		if got := BucketAging(100, ptr(due), today); got != want {
			t.Errorf("BucketAging(%s) = %s, want %s", due, got, want)
		}
	}
	if DaysPastDue(ptr("2026-08-01"), today) != 11 || DaysPastDue(ptr("2026-08-20"), today) != -8 {
		t.Fatal("daysPastDue")
	}
}

func TestApPaymentVoid(t *testing.T) {
	cases := []struct {
		found          bool
		status, reason string
		want           int
	}{
		{false, "", "alasan panjang", 404},
		{true, StatusPosted, " abc ", 400},
		{true, StatusVoid, "salah input", 409},
		{true, StatusDraft, "salah input", 409},
		{true, StatusPosted, "salah input", 0},
	}
	for _, c := range cases {
		r := EvaluateApPaymentVoid(c.found, c.status, c.reason)
		got := 0
		if r != nil {
			got = r.Status
		}
		if got != c.want {
			t.Errorf("%v: %d", c, got)
		}
	}
}

// finance/invoices.test.ts
func TestInvoicePaymentSummary(t *testing.T) {
	cases := []struct {
		amount, paid float64
		status       string
		out          float64
	}{
		{1000, 1000, "lunas", 0},
		{1000, 250.555, "sebagian", 749.45},
		{1000, 0, "belum", 1000},
		{0, 0, "belum", 0},
		{100, 150, "lunas", 0},
	}
	for _, c := range cases {
		s, o := InvoicePaymentSummary(c.amount, c.paid)
		if s != c.status || o != c.out {
			t.Errorf("%v: %s %v", c, s, o)
		}
	}
}

func TestOperationalAmounts(t *testing.T) {
	total := 36000.0
	got := PosAmounts(PosAmountsInput{Subtotal: 40000, Discount: 4000, Total: &total, Cogs: 12000.004})
	want := Amounts{"SUBTOTAL": 40000, "DISCOUNT": 4000, "TAX": 0, "SERVICE_CHARGE": 0, "TOTAL": 36000, "PAID": 36000, "COGS": 12000}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %v, want %v", k, got[k], v)
		}
	}
	derived := PosAmounts(PosAmountsInput{Subtotal: 100, Tax: 11, ServiceCharge: 5, OtherCharges: 1})
	if derived["TOTAL"] != 117 || derived["SERVICE_CHARGE"] != 6 {
		t.Fatalf("derived %v", derived)
	}
	split := SplitAmounts(SplitInput{Subtotal: 50, Total: 60, OrderTotal: 120, OrderCogs: 40, OrderServiceCharge: 10})
	if split["COGS"] != 20 || split["SERVICE_CHARGE"] != 5 || split["TOTAL"] != 60 {
		t.Fatalf("split %v", split)
	}
	events := map[string]string{"cash": "POS_SALE_CASH", " QRIS ": "POS_SALE_QRIS", "credit_card": "POS_SALE_CREDIT", "nfc_tab": SkipNFCTab, "member_bill": "POS_SALE_MEMBER_BILL", "voucher": ""}
	for in, want := range events {
		if got := SaleEventForMethod(in); got != want {
			t.Errorf("SaleEventForMethod(%q) = %q", in, got)
		}
	}
	if MemberDepositEvent("debit") != "POS_MEMBER_DEPOSIT_CARD" || MemberDepositEvent("transfer") != "" {
		t.Fatal("MemberDepositEvent")
	}
	grn := GrnAmounts([]GrnLine{{QtyQcPosted: 2, QtyReceived: 3, UnitPrice: 1000}, {QtyReceived: 1, UnitPrice: 500}, {UnitPrice: 9}}, 11)
	if grn["SUBTOTAL"] != 2500 || grn["TAX"] != 275 || grn["TOTAL"] != 2775 {
		t.Fatalf("grn %v", grn)
	}
	valued, sum := ValueVariances([]VarianceLine{{QtyDiff: -2, UnitCost: 1.5}, {QtyDiff: 3, UnitCost: 1}, {QtyDiff: -1, UnitCost: 0}}, true)
	if len(valued) != 1 || sum != 3 {
		t.Fatalf("variances %v %v", valued, sum)
	}
}

func TestReportBalances(t *testing.T) {
	if Balance(100, 40, Debit, false) != 60 || Balance(100, 40, Credit, false) != -60 || Balance(100, 40, Debit, true) != -60 {
		t.Fatal("Balance")
	}
	if SignedDelta(Debit, 10, Debit, false) != 10 || SignedDelta(Credit, 10, Debit, false) != -10 || SignedDelta(Credit, 10, Credit, true) != -10 {
		t.Fatal("SignedDelta")
	}
	if d, c := TrialBalanceColumns(10, 30); d != 0 || c != 20 {
		t.Fatal("TB")
	}
	if side, amt, ok := OpeningLine(5, 5); ok || side != "" || amt != 0 {
		t.Fatal("OpeningLine zero")
	}
	if side, amt, _ := OpeningLine(5, 15); side != Credit || amt != 10 {
		t.Fatal("OpeningLine credit")
	}
}

func TestLandedCostAmounts(t *testing.T) {
	for _, c := range []struct {
		capitalized, expensed float64
		post, reverse         Amounts
	}{
		{9000, 3000, Amounts{"SUBTOTAL": 9000, "COGS": 3000, "TOTAL": 12000}, nil},
		{-9000, -1000.005, nil, Amounts{"SUBTOTAL": 9000, "COGS": 1000.01, "TOTAL": 10000.01}},
		{-9000, 1000, Amounts{"COGS": 1000, "TOTAL": 1000}, Amounts{"SUBTOTAL": 9000, "TOTAL": 9000}},
		{0, 0, nil, nil},
	} {
		post, reverse := LandedCostAmounts(c.capitalized, c.expensed)
		if fmt.Sprint(post) != fmt.Sprint(c.post) || fmt.Sprint(reverse) != fmt.Sprint(c.reverse) {
			t.Errorf("LandedCostAmounts(%v, %v) = %v %v, want %v %v", c.capitalized, c.expensed, post, reverse, c.post, c.reverse)
		}
	}
}
