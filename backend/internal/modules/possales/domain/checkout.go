package domain

import (
	"math"
	"strings"
)

// CheckoutError is MixedCheckoutError: a rule failure with its HTTP status.
type CheckoutError struct {
	Status  int
	Message string
}

func (e *CheckoutError) Error() string { return e.Message }

// Reject builds a 400 CheckoutError.
func Reject(msg string) *CheckoutError { return &CheckoutError{Status: 400, Message: msg} }

// MixedGuard is guardMixedCheckoutCart's result ("" Message = ok).
type MixedGuard struct {
	Message        string
	CreateCheckout bool
	StallIDs       []string
}

// GuardMixedCheckoutCart validates the stalls of a cart.
func GuardMixedCheckoutCart(productIDs []string, warehouseByProduct map[string]string, canSellMixed, hasSplits bool, promoCode string) MixedGuard {
	ws := make([]string, 0, len(productIDs))
	for _, id := range productIDs {
		w := warehouseByProduct[id]
		if w == "" {
			return MixedGuard{Message: MsgMissingProductStall}
		}
		ws = append(ws, w)
	}
	ids := UniqueStallIDs(ws)
	mixed := ShouldCreateCheckout(ids)
	switch {
	case mixed && !canSellMixed:
		return MixedGuard{Message: MsgMixedStallForbidden}
	case mixed && hasSplits:
		return MixedGuard{Message: MsgMixedSplitUnsupported}
	case mixed && Trim(promoCode) != "":
		return MixedGuard{Message: MsgMixedPromoUnsupported}
	}
	return MixedGuard{CreateCheckout: mixed, StallIDs: ids}
}

// BuiltLine is a cart item with its computed pricing (checkout/rules.ts).
type BuiltLine struct {
	Item         Obj
	WarehouseID  string
	Qty          float64
	UnitPrice    float64
	LineSubtotal float64
	LineDiscount float64
	LineTotal    float64
}

// ProductID is String(item.product_id || "").
func (l BuiltLine) ProductID() string { return l.Item.Str("product_id") }

// BuildLines prices cart items for a mixed checkout.
func BuildLines(items []Obj, warehouseByProduct map[string]string) []BuiltLine {
	out := make([]BuiltLine, len(items))
	for i, it := range items {
		qty := ToNumber(it.Get("quantity"), 1)
		if qty == 0 {
			qty = 1
		}
		unit := ToNumber(it.Get("unit_price"), 0) + ToNumber(it.Get("variant_price_adjustment"), 0) + ToNumber(it.Get("modifier_price_adjustment"), 0)
		sub := unit * qty
		disc := math.Max(0, ToNumber(it.Get("discount_amount"), 0))
		out[i] = BuiltLine{
			Item:         it,
			WarehouseID:  warehouseByProduct[it.Str("product_id")],
			Qty:          qty,
			UnitPrice:    unit,
			LineSubtotal: sub,
			LineDiscount: disc,
			LineTotal:    math.Max(0, sub-disc),
		}
	}
	return out
}

// Snapshot fields are stored as cart_snapshot jsonb; Item carries the line
// object as the TS spread wrote it.
func (l BuiltLine) Snapshot() map[string]any {
	m := map[string]any{}
	for k, v := range l.Item {
		m[k] = v
	}
	m["warehouseId"] = l.WarehouseID
	m["qty"] = l.Qty
	m["unitPrice"] = l.UnitPrice
	m["lineSubtotal"] = l.LineSubtotal
	m["lineDiscount"] = l.LineDiscount
	m["lineTotal"] = l.LineTotal
	m["warehouse_id"] = l.WarehouseID
	return m
}

// StallSlice is one stall's share of a cart.
type StallSlice struct {
	WarehouseID string
	Subtotal    float64
	Lines       []BuiltLine
}

// SliceLinesByStall groups lines by stall in first-appearance order.
func SliceLinesByStall(lines []BuiltLine) []StallSlice {
	idx := map[string]int{}
	var out []StallSlice
	for _, l := range lines {
		if l.WarehouseID == "" {
			continue
		}
		i, ok := idx[l.WarehouseID]
		if !ok {
			i = len(out)
			idx[l.WarehouseID] = i
			out = append(out, StallSlice{WarehouseID: l.WarehouseID})
		}
		out[i].Lines = append(out[i].Lines, l)
		out[i].Subtotal += l.LineSubtotal
	}
	return out
}

// AllocateSliceCharges splits checkout charges over stall slices.
func AllocateSliceCharges(slices []StallSlice, discount, tax, service, other float64) []StallCharges {
	in := make([]StallCharges, len(slices))
	for i, s := range slices {
		in[i] = StallCharges{WarehouseID: s.WarehouseID, Subtotal: s.Subtotal}
	}
	return AllocateCheckoutCharges(in, discount, tax, service, other)
}

// ShouldInsertCheckoutChildren: not for unpaid or under-paid QRIS.
func ShouldInsertCheckoutChildren(paymentMethod, paymentStatus string, amountPaid, total float64) bool {
	if strings.ToLower(paymentStatus) == "unpaid" {
		return false
	}
	return !(paymentMethod == "qris" && amountPaid < total)
}

// ChildOrderStatus: paid pay-now children complete, open bills stay pending.
func ChildOrderStatus(paymentStatus string, isOpenBill bool) string {
	if strings.ToLower(paymentStatus) == "paid" && !isOpenBill {
		return "completed"
	}
	return "pending"
}

// SoldFrom is resolveOrderSoldFrom.
func SoldFrom(isCentralCashier bool) string {
	if isCentralCashier {
		return "central"
	}
	return "stall"
}

// QrisAction is resolveCheckoutQrisAction.
func QrisAction(xenditQRID, xenditExternalID string) string {
	switch {
	case xenditQRID != "":
		return "reuse_qr_id"
	case xenditExternalID != "":
		return "lookup_external_id"
	}
	return "create"
}

// RejectUnsupportedMixedTender rejects NFC Tab and gift card ("" = ok).
func RejectUnsupportedMixedTender(method string) string {
	if method == "nfc_tab" || method == "gift_card" {
		return MsgMixedNfcGiftUnsupported
	}
	return ""
}

// BillTender is resolveCheckoutBillTender's success value.
type BillTender struct {
	PaymentMethod string
	AmountPaid    float64
	ChangeAmount  float64
}

var checkoutBillMethods = map[string]bool{"cash": true, "qris": true, "credit": true, "debit": true, "credit_card": true}

// ResolveCheckoutBillTender validates the tender that pays a checkout bill.
func ResolveCheckoutBillTender(paymentMethod string, amountPaid *float64, total float64) (BillTender, string) {
	raw := Trim(paymentMethod)
	if raw == "" {
		return BillTender{}, "Metode pembayaran wajib"
	}
	if msg := RejectUnsupportedMixedTender(raw); msg != "" {
		return BillTender{}, msg
	}
	if raw == "ark_coin" {
		return BillTender{}, MsgMixedArkUnsupported
	}
	method := raw
	if raw == "credit_card" {
		method = "credit"
	}
	if !checkoutBillMethods[raw] && !checkoutBillMethods[method] {
		return BillTender{}, "Metode pembayaran tidak didukung untuk tagihan checkout"
	}
	if amountPaid == nil || !Finite(*amountPaid) {
		return BillTender{}, "Nominal pembayaran wajib"
	}
	if *amountPaid < total {
		return BillTender{}, "Nominal tunai kurang dari total tagihan"
	}
	return BillTender{PaymentMethod: method, AmountPaid: *amountPaid, ChangeAmount: math.Max(0, *amountPaid-total)}, ""
}

// AssertCheckoutQrisReady returns "" when the stored QRIS is paid.
func AssertCheckoutQrisReady(xenditQRID, xenditExternalID string, paid bool) string {
	if xenditQRID == "" && xenditExternalID == "" {
		return MsgCheckoutQrisMissing
	}
	if !paid {
		return MsgCheckoutQrisUnpaid
	}
	return ""
}

// IsCancelledCheckout: notes start with "cancelled".
func IsCancelledCheckout(notes string) bool {
	return strings.HasPrefix(strings.ToLower(Trim(notes)), CheckoutCancelledNote)
}

// CanCancelChildlessCheckout returns "" when the unpaid checkout may be cancelled.
func CanCancelChildlessCheckout(paymentStatus string, childCount int, notes string) string {
	if IsCancelledCheckout(notes) {
		return ""
	}
	if paymentStatus == "" {
		paymentStatus = "unpaid"
	}
	if strings.ToLower(paymentStatus) == "paid" {
		return MsgCheckoutCancelPaid
	}
	if childCount > 0 {
		return MsgCheckoutCancelHasChildren
	}
	return ""
}

// CompleteTender is resolveCompleteCheckoutTender.
func CompleteTender(method string, amountPaid *float64, storedMethod string, total float64) (string, float64) {
	// String(tender.paymentMethod || stored || "").trim(): a blank but
	// non-empty tender method does not fall back to the stored one.
	m := method
	if m == "" {
		m = storedMethod
	}
	m = Trim(m)
	if amountPaid != nil && Finite(*amountPaid) {
		return m, *amountPaid
	}
	return m, total
}

// MixedSaleInput is the part of CreateMixedCheckoutInput the plan reads.
type MixedSaleInput struct {
	Items                    []Obj
	WarehouseByProduct       map[string]string
	OrderType                string
	CustomerID               string
	CashierID                string
	ServerID                 string
	TableID                  string
	GuestCount               any
	DiscountAmount           any
	DiscountReason           string
	PromoCode                string
	TaxAmount                any
	ServiceChargeAmount      any
	OtherChargesAmount       any
	ChargesBreakdown         any
	PaymentMethod            string
	PaymentStatus            string
	AmountPaid               any
	ArkCoinsUsed             any
	Notes                    string
	SpecialRequests          string
	SessionUserID            string
	ForceInsertChildren      bool
	ReuseUnpaidTableCheckout bool
	ExistingCheckoutID       string
}

// MixedSalePlan is planMixedSale's result.
type MixedSalePlan struct {
	Lines                  []BuiltLine
	CanCreateFreshCheckout bool
	DiscountAmount         float64
	TaxAmount              float64
	ServiceChargeAmount    float64
	OtherChargesAmount     float64
	ServerSubtotal         float64
	ServerTotal            float64
	PaymentMethod          string
	AmountPaid             float64
	ArkUsed                float64
	ChangeAmount           float64
	RequestedUnpaid        bool
	InsertChildren         bool
	PaymentStatus          string
	IsPaidSale             bool
	Snapshot               map[string]any
}

// PlanMixedSale validates the cart and tender and computes the server
// totals, failing in the same order as the TS.
func PlanMixedSale(in MixedSaleInput) (MixedSalePlan, error) {
	lines := BuildLines(in.Items, in.WarehouseByProduct)
	ws := make([]string, len(lines))
	for i, l := range lines {
		if l.WarehouseID == "" {
			return MixedSalePlan{}, Reject(MsgMissingProductStall)
		}
		ws[i] = l.WarehouseID
	}
	canFresh := ShouldCreateCheckout(ws)
	if !canFresh && !in.ReuseUnpaidTableCheckout && in.TableID == "" && in.ExistingCheckoutID == "" {
		return MixedSalePlan{}, Reject(MsgMultiStallRequired)
	}
	slices := SliceLinesByStall(lines)
	p := MixedSalePlan{
		Lines:                  lines,
		CanCreateFreshCheckout: canFresh,
		DiscountAmount:         ToNumber(in.DiscountAmount, 0),
		TaxAmount:              ToNumber(in.TaxAmount, 0),
		ServiceChargeAmount:    ToNumber(in.ServiceChargeAmount, 0),
		OtherChargesAmount:     ToNumber(in.OtherChargesAmount, 0),
	}
	if Trim(in.PromoCode) != "" {
		return MixedSalePlan{}, Reject(MsgMixedPromoUnsupported)
	}
	for _, l := range lines {
		if l.LineDiscount > 0 {
			return MixedSalePlan{}, Reject(MsgMixedLineDiscountUnsupported)
		}
	}
	allocated := AllocateSliceCharges(slices, p.DiscountAmount, p.TaxAmount, p.ServiceChargeAmount, p.OtherChargesAmount)
	for _, s := range slices {
		p.ServerSubtotal += s.Subtotal
	}
	for _, a := range allocated {
		p.ServerTotal += a.Total
	}
	p.PaymentMethod = in.PaymentMethod
	if p.PaymentMethod == "" {
		p.PaymentMethod = "cash"
	}
	if msg := RejectUnsupportedMixedTender(p.PaymentMethod); msg != "" {
		return MixedSalePlan{}, Reject(msg)
	}
	p.AmountPaid = ToNumber(in.AmountPaid, 0)
	p.ArkUsed = ToNumber(in.ArkCoinsUsed, 0)
	p.RequestedUnpaid = strings.ToLower(in.PaymentStatus) == "unpaid"
	p.InsertChildren = in.ForceInsertChildren || ShouldInsertCheckoutChildren(p.PaymentMethod, in.PaymentStatus, p.AmountPaid+p.ArkUsed, p.ServerTotal)
	switch {
	case p.RequestedUnpaid:
		p.PaymentStatus = "unpaid"
	case p.InsertChildren:
		p.PaymentStatus = "paid"
	default:
		p.PaymentStatus = "unpaid"
	}
	p.IsPaidSale = p.PaymentStatus == "paid"
	if p.IsPaidSale && p.AmountPaid+p.ArkUsed < p.ServerTotal {
		return MixedSalePlan{}, Reject("Payment insufficient")
	}
	if p.PaymentMethod == "ark_coin" {
		if in.CustomerID == "" {
			return MixedSalePlan{}, Reject("Pembayaran ARK Coin membutuhkan customer")
		}
		if p.ArkUsed < p.ServerTotal {
			return MixedSalePlan{}, Reject("Pembayaran ARK Coin harus menutup seluruh total order")
		}
	}
	p.ChangeAmount = math.Max(0, p.AmountPaid+p.ArkUsed-p.ServerTotal)
	p.Snapshot = SnapshotFromInput(in, lines)
	return p, nil
}

// SnapshotFromInput is snapshotFromInput: the cart stored on the checkout.
func SnapshotFromInput(in MixedSaleInput, lines []BuiltLine) map[string]any {
	items := make([]any, len(lines))
	byProduct := map[string]any{}
	for i, l := range lines {
		items[i] = l.Snapshot()
		if l.Item.Truthy("product_id") {
			byProduct[l.ProductID()] = l.WarehouseID
		}
	}
	orderType := in.OrderType
	if orderType == "" {
		orderType = "dine_in"
	}
	charges, ok := in.ChargesBreakdown.([]any)
	if !ok {
		charges = []any{}
	}
	return map[string]any{
		"items":              items,
		"warehouseByProduct": byProduct,
		"orderType":          orderType,
		"guestCount":         NormalizeGuestCount(in.GuestCount),
		"notes":              nullIfEmpty(in.Notes),
		"specialRequests":    nullIfEmpty(in.SpecialRequests),
		"chargesBreakdown":   charges,
		"cashierId":          in.CashierID,
		"serverId":           nullIfEmpty(in.ServerID),
		"sessionUserId":      in.SessionUserID,
		"discountReason":     nullIfEmpty(in.DiscountReason),
	}
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// SnapshotItems returns the items of a stored cart_snapshot.
func SnapshotItems(snapshot map[string]any) []Obj {
	raw, _ := snapshot["items"].([]any)
	out := make([]Obj, 0, len(raw))
	for _, r := range raw {
		if m, ok := r.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

// NormalizeGuestCount: blank or odd input is one guest, capped at 500.
func NormalizeGuestCount(raw any) int {
	if IsNullish(raw) {
		return 1
	}
	if s, ok := raw.(string); ok && Trim(s) == "" {
		return 1
	}
	n := Number(raw)
	if s, ok := raw.(string); ok {
		n = Number(Trim(s))
	}
	if !Finite(n) {
		return 1
	}
	b := math.Floor(n)
	if b < 1 {
		return 1
	}
	return int(math.Min(b, 500))
}
