package domain

import (
	"encoding/json"
	"unicode"

	"golang.org/x/text/unicode/norm"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Messages shared by the central-cashier and stall guards
// (lib/pos/central-cashier.ts, checkout/types.ts, pos-sell-stall.ts).
const (
	MsgMixedSplitUnsupported        = "Split bill belum didukung untuk checkout multi-stall"
	MsgMixedNfcGiftUnsupported      = "Pembayaran NFC Tab / Gift Card belum didukung untuk checkout multi-stall"
	MsgMixedArkUnsupported          = "Pembayaran ARK Coin belum didukung untuk tagihan checkout — gunakan tunai, kartu, atau QRIS"
	MsgMixedPromoUnsupported        = "Promo belum didukung untuk checkout multi-stall"
	MsgMixedLineDiscountUnsupported = "Diskon per item belum didukung untuk checkout multi-stall — pakai diskon transaksi"
	MsgMixedStallForbidden          = "Keranjang campur stall hanya untuk kasir pusat"
	MsgMissingProductStall          = "Ada produk tanpa stall — tidak bisa dimasukkan ke keranjang"
	MsgMultiStallRequired           = "Checkout multi-stall membutuhkan item dari minimal 2 stall"
	MsgStallOutsideAssignment       = "Stall aktif di luar penempatan Anda"
	MsgContinueOpenBill             = "Lanjutkan open bill di meja ini"
	MsgCheckoutQrisMissing          = "QRIS belum dibuat untuk checkout ini"
	MsgCheckoutQrisUnpaid           = "QRIS belum lunas"
	MsgCheckoutCancelHasChildren    = "Checkout dengan pesanan tidak bisa dibatalkan"
	MsgCheckoutCancelPaid           = "Checkout sudah lunas"
	CheckoutCancelledNote           = "cancelled"
	CentralCashierMenu              = "pos.cashier.central"
)

// ActiveStallMode is the stall switcher cookie state.
type ActiveStallMode string

const (
	StallUnset ActiveStallMode = "unset"
	StallAll   ActiveStallMode = "all"
	StallOne   ActiveStallMode = "stall"
)

// CanSellMixedStall: central menu + can_central_checkout + "Semua Stall".
func CanSellMixedStall(hasCentralMenu, canCentralCheckout bool, mode ActiveStallMode) bool {
	return hasCentralMenu && canCentralCheckout && mode == StallAll
}

// UniqueStallIDs keeps the first occurrence of every non-empty id.
func UniqueStallIDs(ids []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

// ShouldCreateCheckout: two or more stalls.
func ShouldCreateCheckout(stallIDs []string) bool { return len(UniqueStallIDs(stallIDs)) >= 2 }

// ResolveSingleStallSellFromAllMode: one stall in the cart while the central
// cashier sells in "all" mode → sell as that stall ("" otherwise).
func ResolveSingleStallSellFromAllMode(itemWarehouses []string, canSellMixed bool) string {
	ids := UniqueStallIDs(itemWarehouses)
	if len(ids) == 1 && canSellMixed {
		return ids[0]
	}
	return ""
}

// AssertAllModeSellStallAssigned returns "" when allowed, else the message.
func AssertAllModeSellStallAssigned(warehouseID string, allowed []string) string {
	for _, id := range allowed {
		if id == warehouseID {
			return ""
		}
	}
	return MsgStallOutsideAssignment
}

// AllocateAmount splits total pro rata weights (floored), remainder to the
// largest weight (first on ties).
func AllocateAmount(total float64, weights []float64) []float64 {
	out := make([]float64, len(weights))
	sum := 0.0
	for _, w := range weights {
		sum += w
	}
	if sum <= 0 || total == 0 {
		return out
	}
	allocated := 0.0
	for i, w := range weights {
		out[i] = math.Floor(total * w / sum)
		allocated += out[i]
	}
	remainder := total - allocated
	largest, maxW := -1, math.Inf(-1)
	for i, w := range weights {
		if w > maxW {
			largest, maxW = i, w
		}
	}
	if remainder != 0 && largest >= 0 {
		out[largest] += remainder
	}
	return out
}

// StallCharges is one stall slice with its share of the checkout charges.
type StallCharges struct {
	WarehouseID   string
	Subtotal      float64
	Discount      float64
	Tax           float64
	ServiceCharge float64
	OtherCharges  float64
	Total         float64
}

// AllocateCheckoutCharges splits discount, tax, service and other charges
// pro rata the stall subtotals.
func AllocateCheckoutCharges(slices []StallCharges, discount, tax, service, other float64) []StallCharges {
	weights := make([]float64, len(slices))
	for i, s := range slices {
		weights[i] = s.Subtotal
	}
	d := AllocateAmount(discount, weights)
	t := AllocateAmount(tax, weights)
	sv := AllocateAmount(service, weights)
	o := AllocateAmount(other, weights)
	out := make([]StallCharges, len(slices))
	for i, s := range slices {
		s.Discount, s.Tax, s.ServiceCharge, s.OtherCharges = d[i], t[i], sv[i], o[i]
		s.Total = s.Subtotal - s.Discount + s.Tax + s.ServiceCharge + s.OtherCharges
		out[i] = s
	}
	return out
}

/* ── single-stall selling (pos-sell-stall.ts, stall-assignment.ts) ───── */

// SellStallResult is resolvePosSellStall's result: WarehouseID set, or Message.
type SellStallResult struct {
	WarehouseID string
	Reason      string
	Message     string
}

// OK reports a resolved stall.
func (r SellStallResult) OK() bool { return r.WarehouseID != "" }

const (
	msgPickOneStall = "Pilih satu stall aktif sebelum membuat transaksi POS"
	msgNoStall      = "Tidak ada stall penempatan. Hubungi admin untuk assign stall"
)

// ResolvePosSellStall picks the single stall a cashier may sell from.
func ResolvePosSellStall(mode ActiveStallMode, activeStallID string, assigned []string, defaultWarehouseID string) SellStallResult {
	ids := UniqueStallIDs(assigned)
	if mode == StallOne && activeStallID != "" {
		return SellStallResult{WarehouseID: activeStallID}
	}
	if mode == StallAll {
		return SellStallResult{Reason: "all_stalls", Message: msgPickOneStall}
	}
	if defaultWarehouseID != "" {
		return SellStallResult{WarehouseID: defaultWarehouseID}
	}
	switch len(ids) {
	case 1:
		return SellStallResult{WarehouseID: ids[0]}
	case 0:
		return SellStallResult{Reason: "no_stall", Message: msgNoStall}
	}
	return SellStallResult{Reason: "multiple_unselected", Message: msgPickOneStall}
}

// IsSellStallAllowed is stall-assignment.ts isSellStallAllowed.
func IsSellStallAllowed(warehouseID string, assigned []string, canSwitchStall, isUnscoped bool, defaultWarehouseID string) bool {
	if isUnscoped || canSwitchStall {
		return true
	}
	for _, id := range assigned {
		if id == warehouseID {
			return true
		}
	}
	return defaultWarehouseID != "" && warehouseID == defaultWarehouseID
}

// ComputeStallAllAccess is stall-assignment.ts computeStallAllAccess.
func ComputeStallAllAccess(role string, canSwitchStall, assignedMainStorage bool) bool {
	return role == "super_admin" || canSwitchStall || assignedMainStorage
}

// AssertProductWarehousesMatchStall returns "" when every product sits in stallID.
func AssertProductWarehousesMatchStall(productWarehouses []string, stallID string) string {
	for _, wid := range productWarehouses {
		if wid == "" {
			return "Ada produk tanpa stall — tidak bisa digabung ke transaksi stall ini"
		}
		if wid != stallID {
			return "Keranjang berisi produk dari stall lain. Ganti stall atau kosongkan keranjang"
		}
	}
	return ""
}

// Warehouse is a stall option (configuration.warehouses).
type Warehouse struct {
	ID        string
	Name      string
	Code      string
	IsDefault bool
}

var stallCodePattern = regexp.MustCompile(`^STALL-0*(\d+)$`)

func stallNumber(code string) (int, bool) {
	m := stallCodePattern.FindStringSubmatch(strings.ToUpper(strings.TrimSpace(code)))
	if m == nil {
		return 0, false
	}
	n, err := strconv.Atoi(m[1])
	return n, err == nil
}

// SortWarehouses: default first, STALL-n numerically last, MAIN early, then
// code/name with numeric collation (sort-warehouses.ts).
func SortWarehouses(ws []Warehouse) []Warehouse {
	out := append([]Warehouse(nil), ws...)
	sort.SliceStable(out, func(i, j int) bool { return compareWarehouses(out[i], out[j]) < 0 })
	return out
}

func compareWarehouses(a, b Warehouse) int {
	if a.IsDefault != b.IsDefault {
		if a.IsDefault {
			return -1
		}
		return 1
	}
	an, aok := stallNumber(a.Code)
	bn, bok := stallNumber(b.Code)
	switch {
	case aok && bok:
		return an - bn
	case aok:
		return 1
	case bok:
		return -1
	}
	if strings.EqualFold(a.Code, "MAIN") {
		return -1
	}
	if strings.EqualFold(b.Code, "MAIN") {
		return 1
	}
	if c := naturalCompare(a.Code, b.Code); c != 0 {
		return c
	}
	return naturalCompare(a.Name, b.Name)
}

// naturalCompare approximates localeCompare(…, {numeric:true, sensitivity:"base"}).
func naturalCompare(a, b string) int {
	a, b = foldBase(a), foldBase(b)
	for a != "" && b != "" {
		da, db := leadingDigits(a), leadingDigits(b)
		if da != "" && db != "" {
			na, _ := strconv.Atoi(da)
			nb, _ := strconv.Atoi(db)
			if na != nb {
				if na < nb {
					return -1
				}
				return 1
			}
			a, b = a[len(da):], b[len(db):]
			continue
		}
		if a[0] != b[0] {
			if a[0] < b[0] {
				return -1
			}
			return 1
		}
		a, b = a[1:], b[1:]
	}
	switch {
	case a == "" && b == "":
		return 0
	case a == "":
		return -1
	}
	return 1
}

func leadingDigits(s string) string {
	i := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	return s[:i]
}

/* ── table sale target (table-sale-target.ts) ─────────────────────────── */

// SaleKind is TableSaleKind.
type SaleKind string

const (
	SaleStall         SaleKind = "stall"
	SaleCentralMixed  SaleKind = "central_mixed"
	SaleCentralSingle SaleKind = "central_single"
)

// SaleTarget actions.
const (
	TargetCreateOrder    = "create_order"
	TargetCreateCheckout = "create_checkout"
	TargetAppendCheckout = "append_checkout"
)

// ResolveTableSaleTarget decides where a table sale lands.
func ResolveTableSaleTarget(kind SaleKind, unpaidCentralCheckoutID string) string {
	if kind == SaleStall {
		return TargetCreateOrder
	}
	if unpaidCentralCheckoutID != "" {
		return TargetAppendCheckout
	}
	if kind == SaleCentralMixed {
		return TargetCreateCheckout
	}
	return TargetCreateOrder
}

// ShouldReuseUnpaidOpenBillCheckout: default true unless false/"false"/0/"0".
func ShouldReuseUnpaidOpenBillCheckout(raw any) bool {
	// raw === false || raw === "false" || raw === 0 || raw === "0"
	switch x := raw.(type) {
	case bool:
		return x
	case string:
		return x != "false" && x != "0"
	case json.Number, float64, int:
		return Number(x) != 0
	}
	return true
}

// ResolveUnpaidCheckoutForOpenBill prefers the explicit id, then the table's
// unpaid checkout when reuse is on.
func ResolveUnpaidCheckoutForOpenBill(reuse bool, explicit, tableUnpaid string) string {
	if e := Trim(explicit); e != "" {
		return e
	}
	if !reuse {
		return ""
	}
	return Trim(tableUnpaid)
}

// ResolveOpenBillOfferDiscount keeps the offer amount the cashier saw.
func ResolveOpenBillOfferDiscount(client any, server float64) float64 {
	if IsNullish(client) || client == "" {
		return math.Max(0, Or0(server))
	}
	n := Number(client)
	if !Finite(n) {
		return math.Max(0, Or0(server))
	}
	return math.Max(0, n)
}

// BillFamily is the central/stall family of a bill.
type BillFamily struct {
	CheckoutID string
	SoldFrom   string
}

// IsCentralBill: part of a checkout or sold by the central cashier.
func IsCentralBill(b BillFamily) bool { return b.CheckoutID != "" || b.SoldFrom == "central" }

// CanAppendTransferItems: never mix stall and central bills.
func CanAppendTransferItems(source, target BillFamily) bool {
	return IsCentralBill(source) == IsCentralBill(target)
}

// AppendChild is one planned child of a checkout append: OrderID set means
// append to that child, empty means create a new child.
type AppendChild struct {
	OrderID     string
	WarehouseID string
}

// PlanCheckoutAppend maps incoming stalls to existing central children.
func PlanCheckoutAppend(incoming []string, existing []AppendChild) []AppendChild {
	byWarehouse := map[string]string{}
	for _, c := range existing {
		byWarehouse[c.WarehouseID] = c.OrderID // later rows win, like new Map(...)
	}
	out := make([]AppendChild, len(incoming))
	for i, w := range incoming {
		out[i] = AppendChild{OrderID: byWarehouse[w], WarehouseID: w}
	}
	return out
}

// foldBase lower-cases and strips diacritics, approximating the "base"
// sensitivity of localeCompare ("Éclair" sorts with "eclair").
func foldBase(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(strings.ToLower(s)) {
		if !unicode.Is(unicode.Mn, r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}
