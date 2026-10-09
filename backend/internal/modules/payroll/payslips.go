package payroll

import (
	"context"
	"fmt"
	"html"
	"net/http"
	"net/mail"
	"strings"

	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// Payslips and PDF delivery.

// payslipRunEmbed is `payroll_run:payroll_runs ( … )`; the NULL employee
// column holds the employee embed's place before it.
const payslipRunEmbed = `NULL AS employee,
	(SELECT row_to_json(e) FROM (SELECT id, run_name, period_month, period_year, status, paid_at
	   FROM hris.payroll_runs WHERE id = d.payroll_run_id) e) AS payroll_run`

func (s *service) listPayslips(ctx context.Context, a *actor, employeeParam, runID *string, year, month *int) ([]*obj, error) {
	scope := domain.ResolvePayslipScope(a.Role, a.EmployeeID, employeeParam)
	if scope.Skip {
		return []*obj{}, nil
	}
	where, args := []string{}, []any{}
	if scope.EmployeeID != "" {
		args = append(args, scope.EmployeeID)
		where = append(where, "d.employee_id = $"+itoa(len(args)))
	}
	if runID != nil {
		args = append(args, *runID)
		where = append(where, "d.payroll_run_id = $"+itoa(len(args)))
	}
	// The period lives on the run (payroll_details has no period columns).
	for _, period := range []struct {
		col string
		v   *int
	}{{"period_year", year}, {"period_month", month}} {
		if period.v != nil && *period.v != 0 {
			args = append(args, *period.v)
			where = append(where, "d.payroll_run_id IN (SELECT id FROM hris.payroll_runs WHERE "+period.col+" = $"+itoa(len(args))+")")
		}
	}
	sql := `SELECT d.*, ` + payslipRunEmbed + ` FROM hris.payroll_details d`
	if len(where) > 0 {
		sql += " WHERE " + strings.Join(where, " AND ")
	}
	rows, err := queryObjs(ctx, s.db, sql+` ORDER BY d.created_at DESC LIMIT 60`, args...)
	if err != nil {
		return nil, opaque(err)
	}
	if err := s.stitch(ctx, s.db, rows, embed{"employee", "employee_id", payslipEmp}); err != nil {
		return nil, err
	}
	if !scope.MeView {
		return rows, nil
	}
	// The personal view only lists slips of paid runs.
	paid := []*obj{}
	for _, r := range rows {
		if run, ok := r.Get("payroll_run").(*obj); ok && run.Get("status") == "paid" {
			paid = append(paid, r)
		}
	}
	return paid, nil
}

type notifyData struct {
	Email       string `json:"email"`
	PayslipSent bool   `json:"payslip_sent"`
}

func (s *service) notifyPayslip(ctx context.Context, detailID string) (*messageData, error) {
	var runStatus string
	var month *int
	var year int
	err := s.db.QueryRow(ctx, `SELECT r.status, r.period_month, r.period_year
		  FROM hris.payroll_details d JOIN hris.payroll_runs r ON r.id = d.payroll_run_id
		 WHERE d.id = $1`, detailID).Scan(&runStatus, &month, &year)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Slip tidak ditemukan")
	}
	if err != nil {
		return nil, err
	}
	if runStatus != "paid" {
		return nil, httpx.BadRequest("Notifikasi hanya untuk run yang sudah dibayar")
	}
	if s.ports.PayslipMailer == nil || strings.TrimSpace(s.ports.PayslipFrom) == "" {
		return nil, httpx.Status(http.StatusServiceUnavailable, "Pengiriman email slip gaji belum dikonfigurasi")
	}
	doc, err := s.payslipDocument(ctx, detailID)
	if err != nil {
		return nil, err
	}
	if doc == nil {
		return nil, httpx.NotFound("Data karyawan untuk slip tidak ditemukan")
	}
	if !doc.employee.IsActive || doc.employee.Email == nil || strings.TrimSpace(*doc.employee.Email) == "" {
		return nil, httpx.BadRequest("Email karyawan aktif belum tersedia")
	}
	to := strings.TrimSpace(*doc.employee.Email)
	parsed, err := mail.ParseAddress(to)
	if err != nil || parsed.Address != to {
		return nil, httpx.BadRequest("Email karyawan tidak valid")
	}
	pdf, err := buildPayslipPDF(doc)
	if err != nil {
		return nil, err
	}
	period := domain.PeriodLabelID(month, year)
	name := html.EscapeString(doc.employee.FullName)
	message := fmt.Sprintf("<p>Halo %s,</p><p>Slip gaji periode %s terlampir dalam email ini.</p><p>Salam,<br>NüHabit</p>", name, html.EscapeString(period))
	resendID, err := s.ports.PayslipMailer.SendPayslip(ctx, to, s.ports.PayslipFrom, "Slip Gaji NüHabit — "+period, message,
		domain.PayslipFileName(doc.employee.FullName, doc.month, doc.year), pdf)
	if err != nil {
		s.log.ErrorContext(ctx, "payslip: email send failed", "id", detailID, "error", err)
		return nil, httpx.Status(http.StatusBadGateway, "Email slip gaji gagal dikirim; coba lagi")
	}
	if _, err := s.db.Exec(ctx, `UPDATE hris.payroll_details SET payslip_sent = true, payslip_sent_at = $2,
		payslip_emailed_at = $2, payslip_email_recipient = $3, payslip_resend_id = $4 WHERE id = $1`,
		detailID, s.clock(), to, resendID); err != nil {
		s.log.ErrorContext(ctx, "payslip: mark sent failed", "id", detailID, "error", err)
		return nil, err
	}
	return &messageData{Data: notifyData{to, true}, Message: "Email slip gaji diterima Resend"}, nil
}

// GET /api/hris/payslips?employee_id&payroll_run_id&year&month
func (h *handler) listPayslips(w http.ResponseWriter, r *http.Request) error {
	a, err := h.requireActor(r)
	if err != nil {
		return err
	}
	q := queryForm(r)
	employee := q.Str("employee_id", optional, validate.StrOpts{})
	runID := q.Str("payroll_run_id", optional, validate.StrOpts{})
	year := coerceInt(q, "year", numRule{Rule: optional})
	month := coerceInt(q, "month", numRule{Rule: optional})
	if err := issuesErr(q, ""); err != nil {
		return err
	}
	rows, err := h.svc.listPayslips(r.Context(), a, employee, runID, year, month)
	if err != nil {
		return err
	}
	return writeJSON(w, dataBody{rows})
}

// POST /api/hris/payslips/notify { payroll_detail_id }
func (h *handler) notifyPayslip(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.auth.RequireMenuPrefix(r, iam.HrisCompensation...); err != nil {
		return err
	}
	f, err := readJSON(r, "")
	if err != nil {
		return err
	}
	id := f.UUID("payroll_detail_id", validate.Rule{})
	if err := issuesErr(f, ""); err != nil {
		return err
	}
	out, err := h.svc.notifyPayslip(r.Context(), *id)
	if err != nil {
		return err
	}
	return writeJSON(w, out)
}
