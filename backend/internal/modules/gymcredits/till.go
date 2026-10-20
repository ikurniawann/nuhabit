package gymcredits

import (
	"context"
	"encoding/json"
	"net/http"

	"nuhabit/backend/internal/platform/database"
)

// Front desk money goes through the POS till: a sale or refund paid in
// cash, card, transfer or QRIS joins the staff member's open POS shift, so
// the shift close-out counts it. Cash needs a shift because the drawer
// holds it; the other methods join one when it is open. The shift close
// journals nothing (the POS journals per order), and gym purchases are no
// POS orders, so their GYM_SALE_* / GYM_REFUND_* journals stay the only ones.

// CodeShiftRequired marks the 409 of a cash sale or refund without an open
// shift; the desk offers to open one.
const CodeShiftRequired = "SHIFT_REQUIRED"

const msgShiftRequired = "Buka shift kasir di cabang ini dulu untuk menerima atau mengembalikan uang tunai"

// tillMethods are the payment methods counted in a POS shift.
var tillMethods = map[string]bool{"cash": true, "card": true, "transfer": true, "qris": true}

// Till reads POS cashier shifts and receipt settings (pos-ops).
type Till interface {
	// ActiveShift is the open shift userID runs that serves branchID: one
	// opened for that branch or for no branch. nil when none.
	ActiveShift(ctx context.Context, q database.Querier, userID string, branchID *string) (*ShiftRef, error)
	// ReceiptLines are the receipt header and footer of the branch (the
	// global setting when the branch has none).
	ReceiptLines(ctx context.Context, q database.Querier, branchID *string) (header, footer []string, err error)
}

// ShiftRef is an open POS shift.
type ShiftRef struct {
	ID     string
	Number string
}

// tillShift is the shift a payment of method joins: nil for methods outside
// the till or when no shift is open, and a 409 for cash without one.
func (s *Service) tillShift(ctx context.Context, q database.Querier, method, userID string, branchID *string) (*string, error) {
	if !tillMethods[method] {
		return nil, nil
	}
	shift, err := s.ports.Till.ActiveShift(ctx, q, userID, branchID)
	if err != nil {
		return nil, err
	}
	if shift == nil {
		if method == "cash" {
			return nil, &Error{Status: http.StatusConflict, Message: msgShiftRequired, Code: CodeShiftRequired}
		}
		return nil, nil
	}
	return &shift.ID, nil
}

// SQLTill reads pos.pos_shifts and pos.pos_receipt_settings.
type SQLTill struct{}

var _ Till = SQLTill{}

// ActiveShift matches cashier_id (shifts opened from the gym desk) or
// opened_by (the POS cashier opens under a placeholder cashier).
func (SQLTill) ActiveShift(ctx context.Context, q database.Querier, userID string, branchID *string) (*ShiftRef, error) {
	var s ShiftRef
	err := q.QueryRow(ctx, `SELECT id::text, shift_number FROM pos.pos_shifts
		WHERE status = 'active' AND (cashier_id::text = $1 OR opened_by = $1)
		  AND (branch_id IS NULL OR $2::uuid IS NULL OR branch_id = $2::uuid)
		ORDER BY opened_at DESC LIMIT 1`, userID, branchID).Scan(&s.ID, &s.Number)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &s, err
}

// ReceiptLines takes the branch row, else the global one (no branch, no
// stall), like the server-side resolve of the POS receipt.
func (SQLTill) ReceiptLines(ctx context.Context, q database.Querier, branchID *string) ([]string, []string, error) {
	var header, footer []byte
	err := q.QueryRow(ctx, `SELECT header_lines::text, footer_lines::text FROM pos.pos_receipt_settings
		WHERE is_active = true AND warehouse_id IS NULL AND (branch_id IS NULL OR branch_id = $1::uuid)
		ORDER BY branch_id NULLS LAST LIMIT 1`, branchID).Scan(&header, &footer)
	if database.IsNoRows(err) || database.IsUndefinedTable(err) {
		return []string{}, []string{}, nil
	}
	if err != nil {
		return nil, nil, err
	}
	h, f := []string{}, []string{}
	_ = json.Unmarshal(header, &h)
	_ = json.Unmarshal(footer, &f)
	return h, f, nil
}

/* ── Receipt ─────────────────────────────────────────────────────────── */

// ReceiptView is the printable receipt of a paid or refunded purchase.
type ReceiptView struct {
	ReceiptNumber string   `json:"receipt_number"`
	PurchaseID    string   `json:"purchase_id"`
	PackageName   string   `json:"package_name"`
	Kind          string   `json:"kind"`
	Credits       int      `json:"credits"`
	ValidityDays  int      `json:"validity_days"`
	PriceIdr      float64  `json:"price_idr"`
	DiscountIdr   float64  `json:"discount_idr"`
	TotalIdr      float64  `json:"total_idr"`
	PaymentMethod *string  `json:"payment_method"`
	Status        string   `json:"status"`
	PaidAt        *JSTime  `json:"paid_at"`
	RefundedAt    *JSTime  `json:"refunded_at"`
	RefundedIdr   *float64 `json:"refunded_idr"`
	MemberName    *string  `json:"member_name"`
	MemberPhone   *string  `json:"member_phone"`
	BranchName    *string  `json:"branch_name"`
	CashierName   *string  `json:"cashier_name"`
	ShiftNumber   *string  `json:"shift_number"`
	Header        []string `json:"header_lines"`
	Footer        []string `json:"footer_lines"`
}

// Receipt is the receipt of a paid or refunded purchase; a pending or
// failed one has none (404).
func (s *Service) Receipt(ctx context.Context, purchaseID string) (*ReceiptView, error) {
	p, err := s.repo.Purchase(ctx, s.db, purchaseID, false)
	if err != nil {
		return nil, err
	}
	if p == nil || p.ReceiptNumber == nil {
		return nil, fail(http.StatusNotFound, "Struk pembelian tidak ditemukan")
	}
	view := &ReceiptView{
		ReceiptNumber: *p.ReceiptNumber, PurchaseID: p.ID, PackageName: p.PackageName, Kind: p.Kind,
		Credits: p.Credits, ValidityDays: p.ValidityDays, PriceIdr: p.PriceIdr, DiscountIdr: p.DiscountIdr,
		TotalIdr: p.TotalIdr, PaymentMethod: p.PaymentMethod, Status: p.Status, PaidAt: p.PaidAt,
		RefundedAt: p.RefundedAt, RefundedIdr: p.RefundedIdr, ShiftNumber: p.ShiftNumber,
	}
	if member, err := s.ports.Members.Profile(ctx, s.db, p.CustomerID); err != nil {
		return nil, err
	} else if member != nil {
		view.MemberName, view.MemberPhone = member.Name, &member.Phone
	}
	if p.BranchID != nil {
		names, err := s.ports.Directory.BranchNames(ctx, s.db, []string{*p.BranchID})
		if err != nil {
			return nil, err
		}
		if name, ok := names[*p.BranchID]; ok {
			view.BranchName = &name
		}
	}
	if p.CreatedBy != nil {
		names, err := s.ports.Directory.StaffNames(ctx, s.db, []string{*p.CreatedBy})
		if err != nil {
			return nil, err
		}
		view.CashierName = names[*p.CreatedBy]
	}
	if view.Header, view.Footer, err = s.ports.Till.ReceiptLines(ctx, s.db, p.BranchID); err != nil {
		return nil, err
	}
	return view, nil
}
