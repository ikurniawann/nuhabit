package domain

import (
	"math"
	"slices"
	"strings"
	"time"
)

// TableStatuses are the pos_table_status values the master form accepts.
var TableStatuses = []string{"available", "occupied", "reserved", "maintenance"}

// TablePayload is parsePayload's result for the table master form.
type TablePayload struct {
	TableNumber                      string
	Name, Floor, Area, QrCode, Notes *string
	Capacity                         float64
	IsActive                         bool
	Status                           string
}

// optionalTrimmed is `v != null ? String(v).trim() || null : null`.
func optionalTrimmed(v any) *string {
	if IsNullish(v) {
		return nil
	}
	s := TrimJS(String(v))
	if s == "" {
		return nil
	}
	return &s
}

// ParseTablePayload mirrors parsePayload of the tables routes. newQr is
// called for an empty QR code when autoQr is set. errMsg is the 400 text.
func ParseTablePayload(body any, autoQr bool, newQr func(tableNumber string) string) (p TablePayload, errMsg string) {
	tn := Field(body, "table_number")
	if IsNullish(tn) {
		tn = ""
	}
	p.TableNumber = TrimJS(String(tn))
	p.Name = optionalTrimmed(Field(body, "name"))
	p.Floor = optionalTrimmed(Field(body, "floor"))
	p.Area = optionalTrimmed(Field(body, "area"))
	p.QrCode = optionalTrimmed(Field(body, "qr_code"))
	p.Notes = optionalTrimmed(Field(body, "notes"))
	capacity := ToNumber(Field(body, "capacity"))
	if capacity == 0 {
		capacity = 4
	}
	p.Capacity = math.Max(1, math.Floor(capacity))
	p.IsActive = Field(body, "is_active") != false
	status := Field(body, "status")
	if IsNullish(status) {
		status = "available"
	}
	p.Status = String(status)
	if !slices.Contains(TableStatuses, p.Status) {
		p.Status = "available"
	}
	if p.TableNumber == "" {
		return p, "Table number is required"
	}
	if p.QrCode == nil && autoQr {
		qr := newQr(p.TableNumber)
		p.QrCode = &qr
	}
	return p, ""
}

// TableQrCode mirrors generateTableQrCode with the random 8-character
// suffix supplied: TBL-<NUM>-<SUFFIX>, at most 100 characters.
func TableQrCode(tableNumber, suffix string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(TrimJS(tableNumber)) {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	num := b.String()
	if len(num) > 12 {
		num = num[:12]
	}
	code := "TBL-" + suffix
	if num != "" {
		code = "TBL-" + num + "-" + suffix
	}
	if len(code) > 100 {
		code = code[:100]
	}
	return code
}

// ClampPercent mirrors clampPercent: 0..100 rounded to two decimals.
func ClampPercent(n float64) float64 {
	if !Finite(n) {
		return 0
	}
	return Round(math.Min(100, math.Max(0, n))*100) / 100
}

// ParsePosition mirrors parsePositionPayload.
func ParsePosition(body any) (x, y float64, errMsg string) {
	switch body.(type) {
	case map[string]any, []any:
	default:
		return 0, 0, "Invalid position payload"
	}
	x, y = Number(Field(body, "pos_x")), Number(Field(body, "pos_y"))
	if !Finite(x) || !Finite(y) {
		return 0, 0, "pos_x and pos_y must be numbers"
	}
	return ClampPercent(x), ClampPercent(y), ""
}

/* ── Floor board ─────────────────────────────────────────────────────── */

// TableRow is a pos_tables row as the board reads it.
type TableRow struct {
	ID                             string
	TableNumber, Name, Floor, Area *string
	Capacity                       *int
	Status, QrCode, Notes          *string
	IsActive                       *bool
	PosX, PosY                     *string // numeric text
}

// BoardOrder is an unpaid order sitting on a table.
type BoardOrder struct {
	ID                    string
	OrderNumber, TableID  *string
	Status, PaymentStatus *string
	TotalAmount           *string
	PreSettledAt          *time.Time
	CheckoutID, SoldFrom  *string
	GuestCount            *int
}

// BoardCheckout is an unpaid central checkout on a table.
type BoardCheckout struct {
	ID                                     string
	CheckoutNumber, TableID, PaymentStatus *string
	TotalAmount, Notes                     *string
}

// TableBill is one row of the floor bills rail.
type TableBill struct {
	ID            string
	Kind          string // "checkout" | "order"
	Label         string
	TableID       *string
	PaymentStatus string
	PreSettledAt  *time.Time
	TotalAmount   float64
	OrderID       *string
	CheckoutID    *string
	SoldFrom      string
}

func lowerOr(s *string, fallback string) string {
	if s == nil || *s == "" {
		return fallback
	}
	return strings.ToLower(*s)
}

func orStr(s *string, fallback string) string {
	if s == nil || *s == "" {
		return fallback
	}
	return *s
}

func numText(s *string) float64 {
	if s == nil {
		return 0
	}
	return ToNumber(*s)
}

func isOpenBoardOrder(o BoardOrder) bool {
	switch lowerOr(o.Status, "") {
	case "cancelled", "voided", "merged":
		return false
	}
	return lowerOr(o.PaymentStatus, "unpaid") != "paid"
}

func isCancelledCheckout(c BoardCheckout) bool {
	return strings.HasPrefix(strings.ToLower(TrimJS(orStr(c.Notes, ""))), "cancelled")
}

func sameID(a *string, b string) bool { return a != nil && *a == b }

func first8(s string) string {
	if len(s) > 8 {
		return s[:8]
	}
	return s
}

// ListTableBoardBills mirrors listTableBoardBills: one bill per unpaid
// central checkout (children collapsed) plus each unpaid stall order.
func ListTableBoardBills(tableID string, orders []BoardOrder, checkouts []BoardCheckout) []TableBill {
	cancelled := map[string]bool{}
	for _, c := range checkouts {
		if isCancelledCheckout(c) {
			cancelled[c.ID] = true
		}
	}
	var open []BoardOrder
	for _, o := range orders {
		if tableID != "" && !sameID(o.TableID, tableID) {
			continue
		}
		if o.CheckoutID != nil && *o.CheckoutID != "" && cancelled[*o.CheckoutID] {
			continue
		}
		if isOpenBoardOrder(o) {
			open = append(open, o)
		}
	}
	var openCheckouts []BoardCheckout
	for _, c := range checkouts {
		if tableID != "" && !sameID(c.TableID, tableID) {
			continue
		}
		if !isCancelledCheckout(c) && lowerOr(c.PaymentStatus, "unpaid") != "paid" {
			openCheckouts = append(openCheckouts, c)
		}
	}

	bills := []TableBill{}
	seen := map[string]bool{}
	firstPreSettled := func(match func(BoardOrder) bool) *time.Time {
		for _, o := range open {
			if match(o) && o.PreSettledAt != nil {
				return o.PreSettledAt
			}
		}
		return nil
	}
	for _, c := range openCheckouts {
		var children []BoardOrder
		for _, o := range open {
			if sameID(o.CheckoutID, c.ID) {
				children = append(children, o)
			}
		}
		if len(children) == 0 {
			continue
		}
		seen[c.ID] = true
		total := 0.0
		for _, o := range children {
			total += numText(o.TotalAmount)
		}
		if total == 0 {
			total = numText(c.TotalAmount)
		}
		id, checkoutID := c.ID, c.ID
		orderID := children[0].ID
		bills = append(bills, TableBill{
			ID: id, Kind: "checkout", Label: orStr(c.CheckoutNumber, first8(c.ID)), TableID: c.TableID,
			PaymentStatus: orStr(c.PaymentStatus, "unpaid"),
			PreSettledAt:  firstPreSettled(func(o BoardOrder) bool { return sameID(o.CheckoutID, c.ID) }),
			TotalAmount:   total, OrderID: &orderID, CheckoutID: &checkoutID, SoldFrom: "central",
		})
	}
	for _, o := range open {
		if o.CheckoutID != nil && *o.CheckoutID != "" {
			cid := *o.CheckoutID
			if seen[cid] {
				continue
			}
			seen[cid] = true
			total := 0.0
			for _, s := range open {
				if sameID(s.CheckoutID, cid) {
					total += numText(s.TotalAmount)
				}
			}
			orderID := o.ID
			bills = append(bills, TableBill{
				ID: cid, Kind: "checkout", Label: orStr(o.OrderNumber, first8(cid)), TableID: o.TableID,
				PaymentStatus: orStr(o.PaymentStatus, "unpaid"),
				PreSettledAt:  firstPreSettled(func(s BoardOrder) bool { return sameID(s.CheckoutID, cid) }),
				TotalAmount:   total, OrderID: &orderID, CheckoutID: &cid, SoldFrom: "central",
			})
			continue
		}
		soldFrom := "stall"
		if o.SoldFrom != nil && *o.SoldFrom == "central" {
			soldFrom = "central"
		}
		orderID := o.ID
		bills = append(bills, TableBill{
			ID: o.ID, Kind: "order", Label: orStr(o.OrderNumber, first8(o.ID)), TableID: o.TableID,
			PaymentStatus: orStr(o.PaymentStatus, "unpaid"), PreSettledAt: o.PreSettledAt,
			TotalAmount: numText(o.TotalAmount), OrderID: &orderID, SoldFrom: soldFrom,
		})
	}
	return bills
}

// ResolveTableBoardStatus mirrors resolveTableBoardStatus: billing when an
// unpaid bill is pre-settled, occupied when any is unpaid, else the master
// status when reserved or maintenance, else available.
func ResolveTableBoardStatus(tableStatus *string, bills []TableBill) string {
	unpaid := 0
	for _, b := range bills {
		if strings.ToLower(orStr(&b.PaymentStatus, "unpaid")) == "paid" {
			continue
		}
		if b.PreSettledAt != nil {
			return "billing"
		}
		unpaid++
	}
	if unpaid > 0 {
		return "occupied"
	}
	raw := lowerOr(tableStatus, "available")
	if raw == "reserved" || raw == "maintenance" {
		return raw
	}
	return "available"
}

// TableMaster is normalizeTable of the master routes.
type TableMaster struct {
	ID          string   `json:"id"`
	TableNumber string   `json:"table_number"`
	Name        string   `json:"name"`
	Label       string   `json:"label"`
	Floor       *string  `json:"floor"`
	Area        *string  `json:"area"`
	Capacity    float64  `json:"capacity"`
	Status      string   `json:"status"`
	QrCode      *string  `json:"qr_code"`
	Notes       *string  `json:"notes"`
	IsActive    bool     `json:"is_active"`
	PosX        *float64 `json:"pos_x"`
	PosY        *float64 `json:"pos_y"`
}

// BoardOrderView is toOrderPayload.
type BoardOrderView struct {
	ID            string   `json:"id"`
	OrderNumber   *string  `json:"order_number"`
	Status        *string  `json:"status"`
	PaymentStatus *string  `json:"payment_status"`
	TotalAmount   float64  `json:"total_amount"`
	PreSettledAt  *string  `json:"pre_settled_at"`
	CheckoutID    *string  `json:"checkout_id"`
	SoldFrom      *string  `json:"sold_from"`
	GuestCount    *float64 `json:"guest_count"`
}

// BoardCheckoutView is one open_checkouts entry.
type BoardCheckoutView struct {
	ID             string  `json:"id"`
	CheckoutNumber string  `json:"checkout_number"`
	PaymentStatus  string  `json:"payment_status"`
	TotalAmount    float64 `json:"total_amount"`
}

// TableBoard is normalizeTable of the board (GET and POST).
type TableBoard struct {
	TableMaster
	ActiveOrder   *BoardOrderView     `json:"active_order"`
	ActiveOrders  []BoardOrderView    `json:"active_orders"`
	OpenCheckouts []BoardCheckoutView `json:"open_checkouts"`
	BillCount     int                 `json:"bill_count"`
	GuestCount    float64             `json:"guest_count"`
}

func numPtr(s *string) *float64 {
	if s == nil {
		return nil
	}
	f := Number(*s)
	return &f
}

func nonEmpty(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}

// NormalizeTableMaster mirrors normalizeTable of tables/[id].
func NormalizeTableMaster(t TableRow) TableMaster {
	tableNumber := TrimJS(orStr(t.TableNumber, ""))
	if tableNumber == "" {
		tableNumber = TrimJS(orStr(t.QrCode, ""))
	}
	if tableNumber == "" {
		tableNumber = TrimJS(orStr(t.Name, ""))
	}
	if tableNumber == "" {
		tableNumber = "Meja"
	}
	capacity := 4.0
	if t.Capacity != nil && *t.Capacity != 0 {
		capacity = float64(*t.Capacity)
	}
	return TableMaster{
		ID: t.ID, TableNumber: tableNumber, Name: orStr(t.Name, tableNumber), Label: orStr(t.Name, tableNumber),
		Floor: nonEmpty(t.Floor), Area: nonEmpty(t.Area), Capacity: capacity, Status: orStr(t.Status, "available"),
		QrCode: nonEmpty(t.QrCode), Notes: nonEmpty(t.Notes), IsActive: t.IsActive == nil || *t.IsActive,
		PosX: numPtr(t.PosX), PosY: numPtr(t.PosY),
	}
}

// NormalizeTableBoard mirrors normalizeTable of the board route: orders
// and checkouts are the ones on this table.
func NormalizeTableBoard(t TableRow, orders []BoardOrder, checkouts []BoardCheckout) TableBoard {
	board := TableBoard{TableMaster: NormalizeTableMaster(t), ActiveOrders: []BoardOrderView{}, OpenCheckouts: []BoardCheckoutView{}}
	for _, o := range orders {
		v := BoardOrderView{
			ID: o.ID, OrderNumber: o.OrderNumber, Status: o.Status, PaymentStatus: o.PaymentStatus,
			TotalAmount: numText(o.TotalAmount), CheckoutID: o.CheckoutID, SoldFrom: o.SoldFrom,
		}
		if o.PreSettledAt != nil {
			at := jsDate(*o.PreSettledAt)
			v.PreSettledAt = &at
		}
		if o.GuestCount != nil {
			g := float64(*o.GuestCount)
			v.GuestCount = &g
			board.GuestCount += g
		}
		board.ActiveOrders = append(board.ActiveOrders, v)
	}
	if len(board.ActiveOrders) > 0 {
		board.ActiveOrder = &board.ActiveOrders[0]
	}
	bills := ListTableBoardBills(t.ID, orders, checkouts)
	board.Status = ResolveTableBoardStatus(t.Status, bills)
	for _, b := range bills {
		if b.Kind == "checkout" {
			board.OpenCheckouts = append(board.OpenCheckouts, BoardCheckoutView{
				ID: b.ID, CheckoutNumber: b.Label, PaymentStatus: b.PaymentStatus, TotalAmount: b.TotalAmount,
			})
		}
	}
	board.BillCount = len(bills)
	return board
}

// jsDate renders a time as JSON.stringify(Date) does.
func jsDate(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }
