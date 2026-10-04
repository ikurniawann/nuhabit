package posops

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/database"
)

// shiftReportRecipientsKey is SETTING_KEYS.POS_SHIFT_REPORT_WA_RECIPIENTS.
const shiftReportRecipientsKey = "pos_shift_report_wa_recipients"

// ListShifts mirrors GET /api/pos/shifts: the count without paging, then
// one page newest first with each shift's orders embedded.
func (s *Service) ListShifts(ctx context.Context, f shiftFilter, limit, offset float64) ([]*Obj, int, error) {
	count, err := countShifts(ctx, s.db, f)
	if err != nil {
		return nil, 0, err
	}
	if math.IsNaN(limit) || math.IsNaN(offset) {
		// node-postgres sends NaN as the text "NaN".
		return nil, 0, errors.New(`invalid input syntax for type bigint: "NaN"`)
	}
	rows, err := listShifts(ctx, s.db, f, int64(limit), int64(offset))
	if err != nil {
		return nil, 0, err
	}
	if err := s.embedShiftOrders(ctx, rows, true); err != nil {
		return nil, 0, err
	}
	return rows, count, nil
}

// CurrentShift mirrors GET /api/pos/shifts/current: the newest active
// shift of the cashier with its order ids, or nil.
func (s *Service) CurrentShift(ctx context.Context, cashierID string) (*Obj, error) {
	row, err := currentShift(ctx, s.db, cashierID)
	if err != nil || row == nil {
		return nil, err
	}
	return row, s.embedShiftOrders(ctx, []*Obj{row}, false)
}

// embedShiftOrders adds the pos_orders(...) embed the QueryBuilder built.
func (s *Service) embedShiftOrders(ctx context.Context, rows []*Obj, detailed bool) error {
	if len(rows) == 0 {
		return nil
	}
	ids := make([]string, len(rows))
	for i, r := range rows {
		ids[i] = r.Str("id")
	}
	orders, err := s.ports.Sales.ShiftOrders(ctx, s.db, ids, detailed)
	if err != nil {
		return err
	}
	for _, r := range rows {
		list := []*Obj{}
		for _, o := range orders[r.Str("id")] {
			item := NewObj("id", o.ID)
			if p := o.Payment; p != nil {
				item.Set("total_amount", p.TotalAmount).Set("payment_method", p.PaymentMethod).
					Set("amount_paid", p.AmountPaid).Set("ark_coins_used", p.ArkCoinsUsed)
			}
			list = append(list, item)
		}
		r.Set("pos_orders", list)
	}
	return nil
}

// OpenShift mirrors POST /api/pos/shifts.
func (s *Service) OpenShift(ctx context.Context, userID string, body any) (*Obj, error) {
	cashierID := field(body, "cashier_id")
	openingCash := field(body, "opening_cash")
	if domain.IsUndef(openingCash) {
		openingCash = json.Number("0")
	}
	notes := field(body, "notes")
	if domain.IsUndef(notes) {
		notes = ""
	}
	if !domain.Truthy(cashierID) {
		return nil, fail(http.StatusBadRequest, "cashier_id required")
	}

	active, err := activeShiftOf(ctx, s.db, nodeParam(cashierID))
	if err != nil {
		return nil, err
	}
	if active != nil {
		return nil, fail(http.StatusConflict, "Cashier already has an active shift", "active_shift", active)
	}

	number, err := generateShiftNumber(ctx, s.db)
	if err != nil {
		s.log.ErrorContext(ctx, "RPC generate_shift_number error", "error", err)
		return nil, fail(http.StatusInternalServerError, "Failed to generate shift number")
	}
	shiftNumber := "SHF-" + strings.ReplaceAll(s.now().UTC().Format("2006-01-02"), "-", "") + "-001"
	if number != nil && *number != "" {
		shiftNumber = *number
	}
	return insertShift(ctx, s.db, shiftNumber, nodeParam(cashierID), domain.Number(openingCash), nodeParam(notes), userID)
}

// ShiftClosed is the close response: the updated row and its summary.
type ShiftClosed struct {
	Shift   *Obj
	Summary *Obj
}

// CloseShift mirrors PATCH /api/pos/shifts/{id}/close: expected cash is the
// opening cash plus drawer-cash orders plus drawer-cash member bill
// instalments of the shift; the variance is what the cashier counted
// minus that.
func (s *Service) CloseShift(ctx context.Context, userID, shiftID string, body any) (*ShiftClosed, error) {
	closingRaw := field(body, "closing_cash")
	if domain.IsNullish(closingRaw) {
		return nil, fail(http.StatusBadRequest, "closing_cash required")
	}
	closingCash := domain.Number(closingRaw)
	var notes *string
	if raw := field(body, "notes"); domain.Truthy(raw) {
		n := nodeParam(raw).(string)
		notes = &n
	}

	var out *ShiftClosed
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		shift, err := loadShiftForClose(ctx, tx, shiftID)
		if err != nil {
			return fail(http.StatusNotFound, "Shift not found")
		}
		if shift.Status == nil || *shift.Status != "active" {
			return fail(http.StatusBadRequest, "Shift is not active")
		}
		orders, err := s.ports.Sales.ShiftCloseOrders(ctx, tx, shiftID)
		if err != nil {
			return err
		}
		t := domain.SummarizeShiftOrders(orders)
		payments, err := s.ports.MemberBills.ShiftPayments(ctx, tx, shiftID)
		if err != nil {
			return err
		}
		memberBill := domain.SummarizeMemberBillShiftPayments(payments)

		expected := domain.Number(shift.OpeningCash) + t.Cash + memberBill.Cash
		totalSales := t.Cash + t.Qris + t.Debit + t.Credit + t.ArkCoin
		updated, err := closeShift(ctx, tx, shiftID, shiftClose{
			ClosedBy: userID, ClosingCash: closingCash, ExpectedCash: expected,
			Cash: t.Cash, Qris: t.Qris, Debit: t.Debit, Credit: t.Credit, ArkCoin: t.ArkCoin,
			TotalSum: totalSales, TotalOrders: len(orders), Notes: notes,
		})
		if err != nil {
			return err
		}
		out = &ShiftClosed{Shift: updated, Summary: NewObj(
			"total_orders", len(orders),
			"total_sales", totalSales,
			"opening_cash", shift.OpeningCash,
			"expected_cash", expected,
			"closing_cash", closingCash,
			"variance", closingCash-expected,
			"method_breakdown", NewObj("cash", t.Cash, "qris", t.Qris, "debit", t.Debit, "credit", t.Credit,
				"ark_coin", t.ArkCoin, "nfc_tab", t.NfcTab),
			"member_bill_payments", memberBill,
		)}
		return nil
	})
	return out, err
}

// ShiftReportSent is the send-report outcome.
type ShiftReportSent struct {
	Sent, Total int
	Results     []*Obj
}

// SendShiftReport mirrors POST /api/pos/shifts/{id}/send-report: the
// closed shift's numbers go to every recipient in Settings, one by one.
func (s *Service) SendShiftReport(ctx context.Context, userID, shiftID string) (*ShiftReportSent, error) {
	shift, err := loadShiftReport(ctx, s.db, shiftID)
	if err != nil {
		// The TS reads `data` only: any query error is "not found".
		return nil, fail(http.StatusNotFound, "Shift tidak ditemukan")
	}
	if shift.Status == nil || *shift.Status != "closed" {
		return nil, fail(http.StatusBadRequest, "Laporan hanya untuk shift yang sudah ditutup")
	}
	recipients, err := s.shiftReportRecipients(ctx)
	if err != nil {
		return nil, err
	}
	if len(recipients) == 0 {
		return nil, fail(http.StatusBadRequest,
			"Belum ada nomor penerima laporan tutup kasir — isi dulu di Settings → Notifikasi WA")
	}
	outlet, err := s.ports.Directory.FirstCompanyName(ctx, s.db)
	if err != nil {
		return nil, err
	}
	cashier, err := s.ports.Directory.UserFullName(ctx, s.db, shift.CashierID)
	if err != nil {
		return nil, err
	}

	num := func(v *string) float64 {
		if v == nil {
			return 0
		}
		return domain.ToNumber(*v)
	}
	shiftNumber := shiftID
	if shift.ShiftNumber != nil {
		shiftNumber = *shift.ShiftNumber
	}
	closedAt := shift.ClosedAt
	if closedAt == nil {
		now := s.now()
		closedAt = &now
	}
	expected, closing := num(shift.Expected), num(shift.ClosingCash)
	totalOrders := 0.0
	if shift.TotalOrders != nil {
		totalOrders = float64(*shift.TotalOrders)
	}
	message := domain.ShiftReportMessage(domain.ShiftReport{
		OutletName:   orDefault(outlet, "Kasir"),
		ShiftNumber:  shiftNumber,
		CashierName:  orDefault(cashier, "-"),
		OpenedAt:     truncateSeconds(shift.OpenedAt),
		ClosedAt:     truncateSeconds(closedAt),
		TotalOrders:  totalOrders,
		TotalSales:   num(shift.TotalSales),
		OpeningCash:  num(shift.OpeningCash),
		ExpectedCash: expected,
		ClosingCash:  closing,
		Variance:     closing - expected,
	})

	out := &ShiftReportSent{Total: len(recipients), Results: []*Obj{}}
	for _, phone := range recipients {
		d := s.ports.WhatsApp.SendText(ctx, phone, message, userID)
		row := NewObj("phone", phone, "success", d.Delivered)
		if d.Reason != "" {
			row.Set("reason", d.Reason)
		}
		out.Results = append(out.Results, row)
		if d.Delivered {
			out.Sent++
		}
	}
	return out, nil
}

// shiftReportRecipients reads the JSON array of numbers from Settings,
// normalized and de-duplicated; anything unreadable is no recipient.
func (s *Service) shiftReportRecipients(ctx context.Context) ([]string, error) {
	raw, err := s.ports.Directory.Setting(ctx, s.db, shiftReportRecipientsKey)
	if err != nil || raw == nil || *raw == "" {
		return nil, err
	}
	var parsed any
	dec := json.NewDecoder(strings.NewReader(*raw))
	dec.UseNumber()
	if dec.Decode(&parsed) != nil {
		return nil, nil
	}
	list, ok := parsed.([]any)
	if !ok {
		return nil, nil
	}
	seen := map[string]bool{}
	out := []string{}
	for _, v := range list {
		phone := domain.NormalizeWaPhone(domain.String(v))
		if phone == nil || seen[*phone] {
			continue
		}
		seen[*phone] = true
		out = append(out, *phone)
	}
	return out, nil
}

func orDefault(v *string, fallback string) string {
	if v == nil {
		return fallback
	}
	return *v
}

// truncateSeconds mirrors new Date(String(date)): String() drops the
// milliseconds before the message formats the time.
func truncateSeconds(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	v := t.Truncate(time.Second)
	return &v
}
