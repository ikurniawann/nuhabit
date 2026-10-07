package domain

import (
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"
)

// GRN statuses: pending → received / partially_received / rejected.
const (
	GrnPending           = "pending"
	GrnPartiallyReceived = "partially_received"
	GrnReceived          = "received"
	GrnRejected          = "rejected"
)

var grnTransitions = map[string][]string{
	GrnPending:           {GrnReceived, GrnPartiallyReceived, GrnRejected},
	GrnPartiallyReceived: {GrnReceived, GrnPending},
	GrnReceived:          {},
	GrnRejected:          {},
}

// GrnTransitionError is validateGrnTransition's message, "" when allowed.
func GrnTransitionError(from, to string) string {
	if slices.Contains(grnTransitions[from], to) {
		return ""
	}
	return fmt.Sprintf("Invalid GRN transition: %s → %s", from, to)
}

// GrnQtyEpsilon is GRN_QTY_EPSILON.
const GrnQtyEpsilon = 0.000001

// ReceiveLine is one GRN line as the receive rules read it.
type ReceiveLine struct {
	PurchaseOrderItemID, RawMaterialID, ProductID, SupplyItemID string
	PosSkuID                                                    *string
	QtyDiterima, QtyDitolak                                     float64
}

// LineKey is grnLineKey: the PO item, else the item id.
func (l ReceiveLine) LineKey() string {
	for _, k := range []string{l.PurchaseOrderItemID, l.RawMaterialID, l.ProductID, l.SupplyItemID} {
		if k != "" {
			return k
		}
	}
	return ""
}

// PoItemForReceive is a purchase_order_items row read for receiving.
type PoItemForReceive struct {
	ID, RawMaterialID, ProductID, SupplyItemID string
	PosSkuID                                   *string
	QtyOrdered, QtyReceived, HargaSatuan       float64
	Label                                      string // raw material or product name, "" when unknown
}

// RemainingPoQty is max(0, ordered − received).
func RemainingPoQty(p PoItemForReceive) float64 { return math.Max(0, p.QtyOrdered-p.QtyReceived) }

func (p PoItemForReceive) label() string {
	if p.Label != "" {
		return p.Label
	}
	return "item ini"
}

// ReceiveError is a 400 the receive rules raise.
type ReceiveError struct{ Message string }

func (e *ReceiveError) Error() string { return e.Message }

func receiveErr(format string, args ...any) error {
	return &ReceiveError{Message: fmt.Sprintf(format, args...)}
}

func exceedsRemaining(p PoItemForReceive, remaining, processed float64, scope string) error {
	return receiveErr("Qty %s melebihi sisa PO. Maksimal %s%s, tetapi diinput %s (diterima + ditolak).",
		p.label(), FormatNumberID(remaining, 4), scope, FormatNumberID(processed, 4))
}

// FindPoItemForLine is findPoItemForLine.
func FindPoItemForLine(l ReceiveLine, items []PoItemForReceive) (PoItemForReceive, error) {
	var match *PoItemForReceive
	switch {
	case l.PurchaseOrderItemID != "":
		for i := range items {
			if items[i].ID == l.PurchaseOrderItemID {
				match = &items[i]
				break
			}
		}
	case l.ProductID != "":
		var matches []*PoItemForReceive
		for i := range items {
			if items[i].ProductID == l.ProductID {
				matches = append(matches, &items[i])
			}
		}
		if len(matches) > 1 {
			return PoItemForReceive{}, receiveErr("Item PO ber-varian harus dirujuk lewat purchase_order_item_id")
		}
		if len(matches) == 1 {
			match = matches[0]
		}
	case l.SupplyItemID != "":
		for i := range items {
			if items[i].SupplyItemID == l.SupplyItemID {
				match = &items[i]
				break
			}
		}
	default:
		for i := range items {
			if items[i].RawMaterialID == l.RawMaterialID {
				match = &items[i]
				break
			}
		}
	}
	if match == nil {
		return PoItemForReceive{}, receiveErr("Item PO tidak ditemukan untuk validasi penerimaan")
	}
	return *match, nil
}

// ValidateReceiveLines checks every line against its PO line's remaining
// quantity (received + rejected) and returns the SKU each line inherits.
func ValidateReceiveLines(lines []ReceiveLine, items []PoItemForReceive) ([]*string, error) {
	processed := map[string]float64{}
	for _, l := range lines {
		processed[l.LineKey()] += l.QtyDiterima + l.QtyDitolak
	}
	out := make([]*string, len(lines))
	for i, l := range lines {
		p, err := FindPoItemForLine(l, items)
		if err != nil {
			return nil, err
		}
		remaining := RemainingPoQty(p)
		if got := processed[l.LineKey()]; got > remaining+GrnQtyEpsilon {
			return nil, exceedsRemaining(p, remaining, got, "")
		}
		if l.ProductID == "" {
			continue
		}
		if l.PosSkuID != nil && !eqPtr(l.PosSkuID, p.PosSkuID) {
			return nil, receiveErr("SKU tidak sesuai item PO")
		}
		out[i] = p.PosSkuID
	}
	return out, nil
}

// ExistingGrnQty is a stored GRN line's quantities.
type ExistingGrnQty struct{ QtyDiterima, QtyDitolak float64 }

// ValidateAdditionalReceive is validateAdditionalReceive (GRN Continue):
// only the increase over the stored line is checked against the remainder.
func ValidateAdditionalReceive(lines []ReceiveLine, items []PoItemForReceive, existing map[string]ExistingGrnQty) error {
	for _, l := range lines {
		var match *PoItemForReceive
		for i := range items {
			if (l.PurchaseOrderItemID != "" && items[i].ID == l.PurchaseOrderItemID) ||
				(l.PurchaseOrderItemID == "" && items[i].RawMaterialID == l.RawMaterialID) {
				match = &items[i]
				break
			}
		}
		if match == nil {
			return receiveErr("Item PO tidak ditemukan untuk validasi penerimaan")
		}
		prev := existing[l.LineKey()]
		delta := math.Max(0, l.QtyDiterima-prev.QtyDiterima) + math.Max(0, l.QtyDitolak-prev.QtyDitolak)
		remaining := RemainingPoQty(*match)
		if delta > remaining+GrnQtyEpsilon {
			return exceedsRemaining(*match, remaining, delta, " untuk penerimaan tambahan")
		}
	}
	return nil
}

// GrnTotals is calculateGrnTotals.
func GrnTotals(lines []ReceiveLine) (diterima, ditolak float64) {
	for _, l := range lines {
		diterima += l.QtyDiterima
		ditolak += l.QtyDitolak
	}
	return
}

// StatusFromLines is statusFromLines: all rejected → rejected; anything
// received → pending (awaiting QC); "" otherwise.
func StatusFromLines(lines []ReceiveLine) string {
	diterima, ditolak := GrnTotals(lines)
	allZero := true
	for _, l := range lines {
		if l.QtyDiterima != 0 {
			allZero = false
		}
	}
	switch {
	case allZero && ditolak > 0:
		return GrnRejected
	case diterima > 0:
		return GrnPending
	}
	return ""
}

// InitialGrnStatus is resolveInitialGrnStatus.
func InitialGrnStatus(moduleType string, diterima, ditolak float64) string {
	if diterima == 0 && ditolak > 0 {
		return GrnRejected
	}
	if moduleType == "general" {
		return GrnReceived
	}
	return GrnPending
}

// GrnCreatedMessage is grnCreatedMessage.
func GrnCreatedMessage(number, status, moduleType string, accountingNote *string) string {
	var base string
	switch {
	case status == GrnRejected:
		base = "GRN " + number + " berhasil dibuat — semua item ditolak"
	case moduleType == "general":
		base = "GRN " + number + " berhasil dibuat"
	default:
		base = "GRN " + number + " berhasil dibuat — QC selesai dan stok sudah diperbarui"
	}
	if accountingNote != nil && *accountingNote != "" {
		return base + " (" + *accountingNote + ")"
	}
	return base
}

// NormalizeQc is normalizeQcOnItem: accepted defaults to received, rejected
// to the rest.
func NormalizeQc(received float64, accepted, rejected *float64) (float64, float64) {
	a := received
	if accepted != nil {
		a = *accepted
	}
	r := math.Max(0, received-a)
	if rejected != nil {
		r = *rejected
	}
	return a, r
}

// QcOverallStatus is resolveOverallQcStatus.
func QcOverallStatus(accepted, rejected []float64) string {
	var a, r float64
	for i := range accepted {
		a += accepted[i]
		r += rejected[i]
	}
	switch {
	case a <= 0 && r > 0:
		return "rejected"
	case r > 0:
		return "partial"
	}
	return "approved"
}

// QcItemStatus is resolveItemStatus.
func QcItemStatus(accepted, rejected float64) string {
	switch {
	case accepted <= 0 && rejected > 0:
		return "rejected"
	case rejected > 0:
		return "partially_rejected"
	}
	return "accepted"
}

// GrnItemReceivedQty is resolveGrnItemReceivedQty: QC-posted quantity once
// inventory is posted, 0 while the GRN awaits QC, else the door quantity.
func GrnItemReceivedQty(qtyDiterima, qtyQcPosted float64, grnStatus string, inventoryPosted bool) float64 {
	if inventoryPosted {
		return qtyQcPosted
	}
	if strings.ToLower(grnStatus) == GrnPending {
		return 0
	}
	return qtyDiterima
}

// PoStatusFromReceipts is the status updatePOStatusAfterGrn writes.
func PoStatusFromReceipts(ordered, received float64) string {
	switch {
	case received == 0:
		return PoSent
	case received >= ordered:
		return PoReceived
	}
	return PoPartiallyReceived
}

// GrnStatusAfterQc is computeGrnStatusAfterQc once PO received quantities
// are rebuilt: nothing accepted → rejected.
func GrnStatusAfterQc(totalAccepted, ordered, received float64, hasLines bool) string {
	switch {
	case totalAccepted <= 0:
		return GrnRejected
	case !hasLines:
		return GrnPartiallyReceived
	case ordered > 0 && received >= ordered:
		return GrnReceived
	}
	return GrnPartiallyReceived
}

// DeliveryStatusAfterGrn is updateDeliveryStatusAfterGrn's target ("" = no change).
func DeliveryStatusAfterGrn(grnStatus string) string {
	switch grnStatus {
	case GrnReceived, GrnPartiallyReceived:
		return DeliveryDelivered
	case GrnRejected:
		return DeliveryCancelled
	}
	return ""
}

// DefaultExpiryDate is defaultExpiryDate: received date + shelf life days.
func DefaultExpiryDate(receivedOn string, shelfLifeDays *float64) *string {
	if shelfLifeDays == nil || *shelfLifeDays <= 0 || math.IsNaN(*shelfLifeDays) {
		return nil
	}
	t, err := time.Parse("2006-01-02", receivedOn[:min(10, len(receivedOn))])
	if err != nil {
		return nil
	}
	s := t.AddDate(0, 0, int(math.Floor(*shelfLifeDays))).Format("2006-01-02")
	return &s
}

// RoundQty rounds to 3 decimals (roundQty).
func RoundQty(v float64) float64 { return JSRound(v*1000) / 1000 }

// PackToBase is packToBase.
func PackToBase(packQty, factor float64) float64 {
	if !(factor > 0) || math.IsInf(factor, 0) {
		factor = 1
	}
	return RoundQty(packQty * factor)
}

// PackPriceToBase is packPriceToBase.
func PackPriceToBase(packPrice, factor float64) float64 {
	if !(factor > 0) || math.IsInf(factor, 0) {
		return packPrice
	}
	return JSRound(packPrice/factor*100) / 100
}

// FormatNumberID is formatNumber(value, maxFrac) in id-ID: "." groups
// thousands, "," separates up to maxFrac decimals (trailing zeros dropped).
func FormatNumberID(v float64, maxFrac int) string {
	neg := v < 0
	s := strconv.FormatFloat(math.Abs(v), 'f', maxFrac, 64)
	intPart, frac, _ := strings.Cut(s, ".")
	frac = strings.TrimRight(frac, "0")
	var b strings.Builder
	for i, c := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	out := b.String()
	if frac != "" {
		out += "," + frac
	}
	if neg && out != "0" {
		out = "-" + out
	}
	return out
}

func eqPtr(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
