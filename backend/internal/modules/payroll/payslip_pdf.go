package payroll

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/pdfgen"
	"nuhabit/backend/internal/platform/ratelimit"
)

// The payroll routes that produce files: the payslip PDF (formerly in
// NEXT_ONLY_ROUTES) and the KPI snapshot, whose collectors read five
// contexts through the KPI port.
func (h *handler) fileRoutes() []module.Route {
	limiter := ratelimit.New(h.svc.db)
	return []module.Route{
		route("GET /api/hris/payslips/{id}/pdf", func(w http.ResponseWriter, r *http.Request) error {
			return h.payslipPDF(w, r, limiter)
		}),
		route("POST /api/hris/kpi/snapshot", h.kpiSnapshot),
	}
}

// GET /api/hris/payslips/{id}/pdf: generated from the payroll_details
// snapshot, so a download next year shows the same numbers. Employees only
// get their own slip; HR gets any. 30 per minute per account.
func (h *handler) payslipPDF(w http.ResponseWriter, r *http.Request, limiter *ratelimit.Limiter) error {
	a, err := h.requireActor(r)
	if err != nil {
		return err
	}
	id, err := requireUUID(r.PathValue("id"), "ID slip tidak valid")
	if err != nil {
		return err
	}
	win, err := limiter.Fixed(r.Context(), "payslip_pdf_"+a.UserID, 30, time.Minute, h.svc.now())
	if err != nil {
		return err
	}
	if !win.Allowed {
		return httpx.TooManyRequests("Terlalu banyak permintaan, coba lagi sebentar lagi")
	}
	slip, err := h.svc.payslipDocument(r.Context(), id)
	if err != nil {
		return err
	}
	if slip == nil {
		return httpx.NotFound("Slip gaji tidak ditemukan")
	}
	if !a.IsHR && (a.EmployeeID == nil || *a.EmployeeID != slip.employee.ID) {
		return httpx.Forbidden("Insufficient permissions")
	}
	pdf, err := buildPayslipPDF(slip)
	if err != nil {
		return err
	}
	hd := w.Header()
	hd.Set("Content-Type", "application/pdf")
	hd.Set("Content-Length", strconv.Itoa(len(pdf)))
	hd.Set("Content-Disposition", `attachment; filename="`+
		domain.PayslipFileName(slip.employee.FullName, slip.month, slip.year)+`"`)
	hd.Set("Cache-Control", "no-store, private") // salary data: never in a shared cache
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(pdf)
	return nil
}

// payslipAmountColumns are the payroll_details amounts the slip prints.
var payslipAmountColumns = []string{
	"base_salary", "fixed_allowance", "variable_allowance", "transport_allowance", "meal_allowance",
	"housing_allowance", "overtime_pay", "thr", "bonus", "other_earning", "gross_salary",
	"bpjs_tk_jht_deduction", "bpjs_tk_jp_deduction", "bpjs_kes_deduction", "tapera_deduction",
	"pph21_deduction", "unpaid_leave_deduction", "late_deduction", "loan_deduction", "other_deduction",
	"total_deductions", "net_salary", "working_days", "present_days", "overtime_hours",
}

// payslipDoc is PayslipDocumentData.
type payslipDoc struct {
	company     map[string]*string
	employee    EmployeeBrief
	month, year int
	paidAt      *time.Time
	amounts     map[string]float64
	loans       []domain.LoanInstallmentDetail
}

// payslipDocument is loadPayslipPdfRow + payslipAmounts + the company
// settings (a settings error leaves them empty); nil when the slip or its
// employee is missing.
func (s *service) payslipDocument(ctx context.Context, id string) (*payslipDoc, error) {
	cols := make([]string, len(payslipAmountColumns))
	for i, c := range payslipAmountColumns {
		cols[i] = "pd." + c + "::text"
	}
	var employeeID, loans string
	doc := &payslipDoc{amounts: map[string]float64{}}
	raw := make([]*string, len(cols))
	dest := []any{&employeeID, &doc.month, &doc.year, &doc.paidAt, &loans}
	for i := range raw {
		dest = append(dest, &raw[i])
	}
	err := s.db.QueryRow(ctx, `SELECT pd.employee_id::text, r.period_month, r.period_year, r.paid_at,
		pd.loan_details::text, `+strings.Join(cols, ", ")+`
		FROM hris.payroll_details pd JOIN hris.payroll_runs r ON r.id = pd.payroll_run_id
		WHERE pd.id = $1`, id).Scan(dest...)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	for i, c := range payslipAmountColumns {
		var v any
		if raw[i] != nil {
			v = *raw[i]
		}
		doc.amounts[c] = domain.OrZero(v)
	}
	if json.Unmarshal([]byte(loans), &doc.loans) != nil {
		doc.loans = nil
	}
	briefs, err := s.ports.Employees.Briefs(ctx, s.db, []string{employeeID})
	if err != nil {
		return nil, err
	}
	emp, ok := briefs[employeeID]
	if !ok {
		return nil, nil
	}
	doc.employee = emp
	doc.company, err = s.ports.Settings.GetMany(ctx, s.db, []string{"company_legal_name", "company_address", "company_city"})
	if err != nil {
		doc.company = map[string]*string{}
	}
	return doc, nil
}

/* ── PDF ─────────────────────────────────────────────────────────────── */

const (
	slipText     = "#111827"
	slipMuted    = "#6b7280"
	slipLine     = "#d1d5db"
	slipNegative = "#b91c1c"
)

func jsNum(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

func dashIfEmpty(s *string) string {
	if s == nil || *s == "" {
		return "—"
	}
	return *s
}

// buildPayslipPDF is buildPayslipPdf (A4, 48pt margins). Text written
// without a position starts at the x of the previous text, as in pdfkit.
func buildPayslipPDF(p *payslipDoc) ([]byte, error) {
	d := pdfgen.New(pdfgen.Options{Size: "A4", Margin: 48})
	left, right := d.Left(), d.Right()
	half := (right - left) / 2
	flow := func(s string, align pdfgen.Align) { d.Text(s, d.X, d.Y, pdfgen.TextOpts{Align: align}) }
	hLine := func() { d.Line(left, d.Y, right, d.Y, slipLine, 0.7) }
	a := p.amounts

	// Letterhead.
	d.Font(pdfgen.HelveticaBold, 13).Color(slipText)
	title := "SLIP GAJI"
	if v := p.company["company_legal_name"]; v != nil && strings.TrimSpace(*v) != "" {
		title = strings.TrimSpace(*v)
	}
	flow(title, pdfgen.AlignCenter)
	var place []string
	for _, k := range []string{"company_address", "company_city"} {
		if v := p.company[k]; v != nil && *v != "" {
			place = append(place, *v)
		}
	}
	if len(place) > 0 {
		d.Font(pdfgen.Helvetica, 8.5).Color(slipMuted)
		flow(strings.Join(place, ", "), pdfgen.AlignCenter)
	}
	d.MoveDown(0.5)
	d.Font(pdfgen.HelveticaBold, 11).Color(slipText)
	flow("SLIP GAJI — "+strings.ToUpper(domain.MonthOrNumber(p.month)+" "+strconv.Itoa(p.year)), pdfgen.AlignCenter)
	d.MoveDown(0.5)
	hLine()
	d.MoveDown(0.6)

	// Employee.
	info := func(label, value string, x, y float64) {
		d.Font(pdfgen.Helvetica, 8.5).Color(slipMuted)
		d.Text(label, x, y, pdfgen.TextOpts{Width: half - 10})
		if value == "" {
			value = "—"
		}
		d.Font(pdfgen.HelveticaBold, 9.5).Color(slipText)
		d.Text(value, x, y+11, pdfgen.TextOpts{Width: half - 10})
	}
	top := d.Y
	info("Nama Karyawan", p.employee.FullName, left, top)
	info("NIP", dashIfEmpty(p.employee.NIP), left+half, top)
	info("Jabatan", dashIfEmpty(p.employee.Position), left, top+30)
	info("Departemen", dashIfEmpty(p.employee.Department), left+half, top+30)
	d.Y = top + 62
	info("Kehadiran", jsNum(a["present_days"])+" dari "+jsNum(a["working_days"])+" hari kerja", left, d.Y)
	overtime := "—"
	if a["overtime_hours"] != 0 {
		overtime = jsNum(a["overtime_hours"]) + " jam"
	}
	info("Jam Lembur", overtime, left+half, d.Y)
	d.Y += 32

	type rowOpts struct {
		bold, negative bool
		share          *string
	}
	row := func(label string, amount float64, o rowOpts) {
		y := d.Y
		font, color := pdfgen.Helvetica, slipText
		if o.bold {
			font = pdfgen.HelveticaBold
		}
		if o.negative {
			color = slipNegative
		}
		d.Font(font, 9.5).Color(color)
		d.Text(label, left, y, pdfgen.TextOpts{Width: right - left - 180})
		if o.share != nil {
			d.Font(pdfgen.Helvetica, 8.5).Color(slipMuted)
			d.Text(*o.share, right-180, y+0.8, pdfgen.TextOpts{Width: 56, Align: pdfgen.AlignRight})
			d.Font(font, 9.5).Color(color)
		}
		sign := ""
		if o.negative {
			sign = "-"
		}
		d.Text(sign+pdfgen.RupiahSpaced(amount), right-120, y, pdfgen.TextOpts{Width: 120, Align: pdfgen.AlignRight})
		d.Y = y + 14
	}
	section := func(title string) {
		d.MoveDown(0.4)
		d.Font(pdfgen.HelveticaBold, 10).Color(slipText)
		flow(strings.ToUpper(title), pdfgen.AlignLeft)
		d.MoveDown(0.15)
		hLine()
		d.MoveDown(0.3)
	}

	section("Penghasilan")
	row("Gaji Pokok", a["base_salary"], rowOpts{})
	for _, e := range []struct{ label, key string }{
		{"Tunjangan Tetap", "fixed_allowance"}, {"Tunjangan Variabel", "variable_allowance"},
		{"Tunjangan Transport", "transport_allowance"}, {"Tunjangan Makan", "meal_allowance"},
		{"Tunjangan Perumahan", "housing_allowance"}, {"Lembur", "overtime_pay"}, {"THR", "thr"},
		{"Bonus", "bonus"}, {"Penghasilan Lain", "other_earning"},
	} {
		if a[e.key] != 0 {
			row(e.label, a[e.key], rowOpts{})
		}
	}
	hLine()
	d.MoveDown(0.25)
	row("Total Penghasilan Bruto", a["gross_salary"], rowOpts{bold: true})

	section("Potongan")
	y := d.Y
	d.Font(pdfgen.Helvetica, 7.5).Color(slipMuted)
	d.Text("% dari bruto", right-180, y, pdfgen.TextOpts{Width: 56, Align: pdfgen.AlignRight})
	d.Y = y + 11
	deduct := func(label string, amount float64) {
		row(label, amount, rowOpts{negative: true, share: domain.ShareOfGross(amount, a["gross_salary"])})
	}
	for _, e := range []struct{ label, key string }{
		{"BPJS TK (JHT)", "bpjs_tk_jht_deduction"}, {"BPJS TK (JP)", "bpjs_tk_jp_deduction"},
		{"BPJS Kesehatan", "bpjs_kes_deduction"}, {"Tapera", "tapera_deduction"}, {"PPh 21", "pph21_deduction"},
		{"Cuti Tanpa Bayaran", "unpaid_leave_deduction"}, {"Potongan Keterlambatan", "late_deduction"},
	} {
		if a[e.key] != 0 {
			deduct(e.label, a[e.key])
		}
	}
	// One line per loan when the run stored the split; older runs show the total.
	if len(p.loans) > 0 {
		for _, l := range p.loans {
			deduct(domain.LoanInstallmentLabel(l), l.Amount)
		}
	} else if a["loan_deduction"] != 0 {
		deduct("Cicilan Pinjaman", a["loan_deduction"])
	}
	if a["other_deduction"] != 0 {
		deduct("Potongan Lain", a["other_deduction"])
	}
	hLine()
	d.MoveDown(0.25)
	row("Total Potongan", a["total_deductions"], rowOpts{bold: true, negative: true,
		share: domain.ShareOfGross(a["total_deductions"], a["gross_salary"])})

	// Take-home pay.
	d.MoveDown(0.5)
	box := d.Y
	d.RoundedRect(left, box, right-left, 34, 5, "#f3f4f6", slipLine)
	d.Font(pdfgen.HelveticaBold, 11).Color(slipText)
	d.Text("GAJI BERSIH (TAKE HOME PAY)", left+12, box+11, pdfgen.TextOpts{Width: right - left - 140})
	d.Font(pdfgen.HelveticaBold, 13)
	d.Text(pdfgen.RupiahSpaced(a["net_salary"]), right-140, box+9, pdfgen.TextOpts{Width: 128, Align: pdfgen.AlignRight})
	d.Y = box + 46

	d.Font(pdfgen.Helvetica, 7.5).Color(slipMuted)
	paid := "Status pembayaran belum final."
	if p.paidAt != nil {
		t := p.paidAt.In(jakarta)
		paid = "Dibayarkan pada " + strconv.Itoa(t.Day()) + " " + domain.MonthNamesID[t.Month()-1] + " " + strconv.Itoa(t.Year()) + "."
	}
	flow(paid+" Dokumen ini dibuat otomatis oleh sistem dan sah tanpa tanda tangan basah. "+
		"Bila ada nominal yang tidak sesuai, hubungi HRD.", pdfgen.AlignLeft)
	return d.Bytes()
}
