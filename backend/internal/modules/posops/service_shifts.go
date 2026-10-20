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
	return insertShift(ctx, s.db, shiftNumber, nodeParam(cashierID), nodeParam(field(body, "branch_id")),
		domain.Number(openingCash), nodeParam(notes), userID)
}

// ShiftClosed is the close response: the updated row and its summary.
type ShiftClosed struct {
	Shift   *Obj
	Summary *Obj
}

// shiftTotals is what a shift took: POS orders, member bill instalments and
// gym package sales. Gym card sales count as debit and transfers as credit,
// like a custom catalog method of a POS order.
type shiftTotals struct {
	Orders     int
	POS        domain.ShiftOrderTotals
	MemberBill domain.MemberBillShiftTotals
	Gym        domain.GymShiftTotals
}

func (s *Service) loadShiftTotals(ctx context.Context, q database.Querier, shiftID string) (*shiftTotals, error) {
	orders, err := s.ports.Sales.ShiftCloseOrders(ctx, q, shiftID)
	if err != nil {
		return nil, err
	}
	bills, err := s.ports.MemberBills.ShiftPayments(ctx, q, shiftID)
	if err != nil {
		return nil, err
	}
	gym, err := s.ports.GymSales.ShiftPayments(ctx, q, shiftID)
	if err != nil {
		return nil, err
	}
	return &shiftTotals{
		Orders: len(orders), POS: domain.SummarizeShiftOrders(orders),
		MemberBill: domain.SummarizeMemberBillShiftPayments(bills), Gym: domain.SummarizeGymShiftPayments(gym),
	}, nil
}

func (t *shiftTotals) cash() float64   { return t.POS.Cash + t.Gym.Cash }
func (t *shiftTotals) qris() float64   { return t.POS.Qris + t.Gym.Qris }
func (t *shiftTotals) debit() float64  { return t.POS.Debit + t.Gym.Card }
func (t *shiftTotals) credit() float64 { return t.POS.Credit + t.Gym.Transfer }
func (t *shiftTotals) orderCount() int { return t.Orders + t.Gym.Count }
func (t *shiftTotals) sales() float64 {
	return t.cash() + t.qris() + t.debit() + t.credit() + t.POS.ArkCoin
}
func (t *shiftTotals) drawerIn() float64 { return t.cash() + t.MemberBill.Cash - t.Gym.CashRefunds }

// summary is the close summary without the counted cash.
func (t *shiftTotals) summary(openingCash string) *Obj {
	return NewObj(
		"total_orders", t.orderCount(),
		"total_sales", t.sales(),
		"total_refunds", t.Gym.Refunds,
		"opening_cash", openingCash,
		"expected_cash", domain.Number(openingCash)+t.drawerIn(),
		"method_breakdown", NewObj("cash", t.cash(), "qris", t.qris(), "debit", t.debit(), "credit", t.credit(),
			"ark_coin", t.POS.ArkCoin, "nfc_tab", t.POS.NfcTab),
		"member_bill_payments", t.MemberBill,
		"gym_sales", t.Gym,
	)
}

// CloseShift mirrors PATCH /api/pos/shifts/{id}/close: expected cash is the
// opening cash plus drawer-cash orders, member bill instalments and gym
// sales of the shift, minus gym cash refunds; the variance is what the
// cashier counted minus that.
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
		t, err := s.loadShiftTotals(ctx, tx, shiftID)
		if err != nil {
			return err
		}
		expected := domain.Number(shift.OpeningCash) + t.drawerIn()
		updated, err := closeShift(ctx, tx, shiftID, shiftClose{
			ClosedBy: userID, ClosingCash: closingCash, ExpectedCash: expected,
			Cash: t.cash(), Qris: t.qris(), Debit: t.debit(), Credit: t.credit(), ArkCoin: t.POS.ArkCoin,
			TotalSum: t.sales(), TotalOrders: t.orderCount(), Refunds: t.Gym.Refunds, Notes: notes,
		})
		if err != nil {
			return err
		}
		out = &ShiftClosed{Shift: updated, Summary: t.summary(shift.OpeningCash).
			Set("closing_cash", closingCash).Set("variance", closingCash-expected)}
		return nil
	})
	return out, err
}

/* ── The caller's own shift (gym front desk) ─────────────────────────── */

// MyShift is the caller's open shift serving branchID with the totals so
// far, or nil.
func (s *Service) MyShift(ctx context.Context, userID string, branchID *string) (*Obj, error) {
	shift, err := myActiveShift(ctx, s.db, userID, branchID)
	if err != nil || shift == nil {
		return nil, err
	}
	t, err := s.loadShiftTotals(ctx, s.db, shift.Str("id"))
	if err != nil {
		return nil, err
	}
	return shift.Set("summary", t.summary(shift.Str("opening_cash"))), nil
}

// OpenMyShift opens a shift with the caller as cashier at branchID.
func (s *Service) OpenMyShift(ctx context.Context, userID string, branchID *string, body any) (*Obj, error) {
	open, err := myActiveShift(ctx, s.db, userID, nil)
	if err != nil {
		return nil, err
	}
	if open != nil {
		return nil, fail(http.StatusConflict, "Anda masih punya shift kasir yang terbuka", "active_shift", open)
	}
	in := map[string]any{"cashier_id": userID, "opening_cash": field(body, "opening_cash"), "notes": field(body, "notes")}
	if branchID != nil {
		in["branch_id"] = *branchID
	}
	return s.OpenShift(ctx, userID, in)
}

// CloseMyShift closes the caller's open shift serving branchID.
func (s *Service) CloseMyShift(ctx context.Context, userID string, branchID *string, body any) (*ShiftClosed, error) {
	shift, err := myActiveShift(ctx, s.db, userID, branchID)
	if err != nil {
		return nil, err
	}
	if shift == nil {
		return nil, fail(http.StatusNotFound, "Tidak ada shift kasir yang terbuka")
	}
	return s.CloseShift(ctx, userID, shift.Str("id"), body)
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
