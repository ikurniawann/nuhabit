package tableorder

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	contracts "nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/modules/possales/tableorder/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/members"
	"nuhabit/backend/internal/platform/outbox"
)

// tableOrderTag is TABLE_ORDER_TAG.
const tableOrderTag = "Self-service table order"

var uuidRe = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// isUUID is isUuid in lib/table-order/server.ts.
func isUUID(s string) bool { return uuidRe.MatchString(s) }

// errMessage is `error.message` as node-postgres and the TS libs set it.
func errMessage(err error) string {
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		return pg.Message
	}
	return err.Error()
}

type service struct {
	db  database.DB
	p   Ports
	now func() time.Time
	log *slog.Logger
}

/* ── venue and menu ──────────────────────────────────────────────────── */

// venue is VenueContext.
type venue struct {
	CompanyID, BranchID string
	BrandName           string
	ProfileName         string
	Charges             []domain.Charge
	QrisAvailable       bool
	ArkRate             float64
}

// loadVenue is loadVenueContext: only the billing profile may fail it.
func (s *service) loadVenue(ctx context.Context) (venue, error) {
	v := venue{}
	v.CompanyID, v.BranchID = s.p.Directory.Venue(ctx, s.db)
	brand, err := s.p.Settings.BrandName(ctx, s.db, v.CompanyID)
	if err != nil {
		brand = "NüHabit"
	}
	v.BrandName = brand
	name, charges, err := s.p.Catalog.BillingProfile(ctx, s.db, v.BranchID)
	if err != nil {
		return v, err
	}
	v.ProfileName = name
	v.Charges = []domain.Charge{}
	for _, c := range charges {
		if c.IsEnabled && !c.IsOptional {
			v.Charges = append(v.Charges, c)
		}
	}
	_, err = s.p.Settings.XenditConfig(ctx, s.db)
	v.QrisAvailable = err == nil
	if v.ArkRate, err = s.p.Catalog.ArkRate(ctx, s.db); err != nil {
		v.ArkRate = 1000
	}
	return v, nil
}

func (s *service) menu(ctx context.Context, search string) ([]domain.Product, CatalogMeta, error) {
	rows, err := s.p.Catalog.SellableProducts(ctx, s.db, search)
	if err != nil {
		return nil, CatalogMeta{}, err
	}
	products := make([]domain.Product, len(rows))
	for i, r := range rows {
		products[i] = domain.NormalizeProduct(r)
	}
	meta, err := s.p.Catalog.Meta(ctx, s.db)
	return products, meta, err
}

// tableLabel is tableLabel(table, fallbackCode).
func tableLabel(t *Table, code string) string {
	if t != nil {
		for _, v := range []*string{t.Name, t.TableNumber, t.QRCode} {
			if v != nil && *v != "" {
				return *v
			}
		}
	}
	return strings.ToUpper(code)
}

// activeTable is the table when it is registered and not deactivated.
func activeTable(t *Table) *Table {
	if t == nil || (t.IsActive != nil && !*t.IsActive) {
		return nil
	}
	return t
}

/* ── POST /orders ────────────────────────────────────────────────────── */

type orderLineInput struct {
	ProductID   string
	VariantID   string
	ModifierIDs []string
	Quantity    int
}

type createInput struct {
	TableCode     string
	OrderType     string
	PaymentMethod string
	Items         []orderLineInput
	CustomerNote  string
	GuestName     string
	GuestPhone    string
	CustomerID    string // from the member session, never the body
	ActionURL     func(orderID string) string
}

// line is one priced order line.
type line struct {
	product   domain.Product
	variant   string
	modifiers []domain.SelectedModifier
	quantity  int
	unitPrice float64
}

// qrisPayload is OrderQrisPayload.
type qrisPayload struct {
	QRID        string  `json:"qr_id"`
	ReferenceID string  `json:"reference_id"`
	QRString    string  `json:"qr_string"`
	Amount      float64 `json:"amount"`
	ExpiresAt   *string `json:"expires_at"`
}

type createdItem struct {
	ProductName string  `json:"product_name"`
	VariantName *string `json:"variant_name"`
	Quantity    int     `json:"quantity"`
	UnitPrice   float64 `json:"unit_price"`
	TotalAmount float64 `json:"total_amount"`
	Station     string  `json:"station"`
}

// createdOrder is the 201 data of POST /api/table-order/orders.
type createdOrder struct {
	ID                  string                 `json:"id"`
	OrderNumber         string                 `json:"order_number"`
	QueueNumber         *string                `json:"queue_number"`
	Status              string                 `json:"status"`
	PaymentStatus       string                 `json:"payment_status"`
	PaymentFlow         string                 `json:"payment_flow"`
	OrderType           string                 `json:"order_type"`
	TableCode           string                 `json:"table_code"`
	TableResolved       bool                   `json:"table_resolved"`
	Subtotal            float64                `json:"subtotal"`
	DiscountAmount      float64                `json:"discount_amount"`
	TaxAmount           float64                `json:"tax_amount"`
	ServiceChargeAmount float64                `json:"service_charge_amount"`
	OtherChargesAmount  float64                `json:"other_charges_amount"`
	TotalAmount         float64                `json:"total_amount"`
	Breakdown           []domain.BreakdownLine `json:"breakdown"`
	TotalXP             int                    `json:"total_xp"`
	Items               []createdItem          `json:"items"`
	Qris                *qrisPayload           `json:"qris"`
	QrisError           *string                `json:"qris_error"`
	CrmXP               any                    `json:"crm_xp"`
}

// errArkDisabled is rejectIfArkCoinDisabled's 409 (its body has a code).
var errArkDisabled = errors.New("ARK_COIN_DISABLED")

// isGatewayConfigError is isGatewayConfigError.
var gatewayConfigError = regexp.MustCompile(`(?i)not configured|inactive|secret key is missing`)

func truncateUTF16(s string, n int) string {
	units := utf16.Encode([]rune(s))
	if len(units) <= n {
		return s
	}
	return string(utf16.Decode(units[:n]))
}

// createOrder is POST /api/table-order/orders after the rate limit and the
// body schema. Rejections are *httpx.Error, answered as {success:false}
// (or errArkDisabled); anything else is a 500 with its message.
func (s *service) createOrder(ctx context.Context, in createInput) (*createdOrder, error) {
	if in.PaymentMethod == "ark_coin" && !s.p.Loyalty.ArkCoinEnabled(ctx, s.db) {
		return nil, errArkDisabled
	}
	customerID := in.CustomerID
	if in.PaymentMethod == "ark_coin" && customerID == "" {
		return nil, httpx.Status(401, "Masuk sebagai member dulu untuk membayar dengan ARK Coin")
	}
	var guest *domain.Guest
	if customerID == "" {
		g, msg := domain.ValidateGuest(in.GuestName, in.GuestPhone)
		if msg != "" {
			return nil, httpx.Status(400, msg)
		}
		guest = &g
	}

	lines, err := s.priceLines(ctx, in.Items)
	if err != nil {
		return nil, err
	}

	productIDs := make([]string, len(lines))
	for i, l := range lines {
		productIDs[i] = l.product.ID
	}
	allowed, msg, err := s.p.Loyalty.CheckProductPrivileges(ctx, s.db, productIDs, customerID)
	if err != nil {
		return nil, err
	}
	if !allowed {
		if msg == "" {
			msg = "Produk khusus member"
		}
		return nil, httpx.Status(403, msg)
	}

	v, err := s.loadVenue(ctx)
	if err != nil {
		return nil, err
	}
	subtotal := 0.0
	for _, l := range lines {
		subtotal += l.unitPrice * float64(l.quantity)
	}
	if subtotal <= 0 {
		return nil, httpx.Status(400, "Total pesanan tidak valid")
	}
	discountPct := 0.0
	if customerID != "" {
		discountPct = s.p.CRM.MemberDiscountPercent(ctx, s.db, customerID)
	}
	discount := domain.MemberDiscountAmount(subtotal, discountPct)
	bill := domain.CalculateBill(subtotal-discount, v.Charges)
	total := bill.Total

	// QRIS: the gateway must be ready before the order exists.
	var xendit *XenditConfig
	switch in.PaymentMethod {
	case "qris":
		if xendit, err = s.p.Settings.XenditConfig(ctx, s.db); err != nil {
			if gatewayConfigError.MatchString(err.Error()) {
				return nil, httpx.Status(503, "QRIS belum tersedia di venue ini — pilih Bayar di Kasir")
			}
			return nil, err
		}
	case "static_qris":
		sq, err := s.p.Settings.StaticQris(ctx, s.db)
		if err != nil {
			return nil, err
		}
		if !sq.Available {
			return nil, httpx.Status(503, "Static QRIS belum tersedia di venue ini — pilih Bayar di Kasir")
		}
	}

	table, err := s.p.Catalog.TableByCode(ctx, s.db, in.TableCode)
	if err != nil {
		table = nil
	}
	table = activeTable(table)
	tableCode := strings.ToUpper(in.TableCode)
	selfPaid := in.PaymentMethod == "ark_coin"
	tag := tableOrderTag + " " + tableCode

	out := &createdOrder{
		Status: "pending", PaymentStatus: "unpaid", PaymentFlow: in.PaymentMethod, OrderType: in.OrderType,
		TableCode: tableCode, TableResolved: table != nil, Subtotal: subtotal, DiscountAmount: discount,
		TaxAmount: bill.TaxAmount, ServiceChargeAmount: bill.ServiceChargeAmount, OtherChargesAmount: bill.OtherChargesAmount,
		TotalAmount: total, Breakdown: bill.Breakdown, Items: []createdItem{},
		CrmXP: ports.XPAward{Status: "skipped", Reason: "payment_unpaid"},
	}
	if selfPaid {
		out.Status, out.PaymentStatus = "confirmed", "paid"
	}

	notes := []string{tag}
	if guest != nil {
		notes = append(notes, fmt.Sprintf("Atas nama: %s · WA %s", guest.Name, guest.Phone))
	}
	if in.CustomerNote != "" {
		notes = append(notes, "Catatan: "+in.CustomerNote)
	}
	items := make([]orderItem, len(lines))
	xp := make([]ports.XPItem, len(lines))
	for i, l := range lines {
		lineTotal := l.unitPrice * float64(l.quantity)
		variants := []map[string]string{}
		if l.variant != "" {
			variants = append(variants, map[string]string{"name": l.variant})
		}
		type kdsModifier struct {
			Name  string  `json:"name"`
			Group string  `json:"group"`
			Price float64 `json:"price"`
		}
		mods := make([]kdsModifier, len(l.modifiers))
		for j, m := range l.modifiers {
			mods[j] = kdsModifier{m.Name, m.GroupName, m.PriceAdjustment}
		}
		items[i] = orderItem{
			ProductID: l.product.ID, ProductName: l.product.Name, ProductSKU: truncateUTF16(l.product.SKU, 50),
			Variants: variants, Modifiers: mods, Quantity: l.quantity, UnitPrice: l.unitPrice, Total: lineTotal,
			KitchenNotes: tag, Station: l.product.Station, XPEarned: int(l.product.XP) * l.quantity,
		}
		qty, unit, sub := float64(l.quantity), l.unitPrice, lineTotal
		xp[i] = ports.XPItem{ProductID: l.product.ID, Quantity: &qty, UnitPrice: &unit, Subtotal: &sub, TotalAmount: &sub}
		out.TotalXP += items[i].XPEarned
		// variant_name repeats the first line of the same product (TS find by product_id).
		var variantName *string
		for _, first := range lines {
			if first.product.ID == l.product.ID {
				variantName = nullable(first.variant)
				break
			}
		}
		out.Items = append(out.Items, createdItem{l.product.Name, variantName, l.quantity, l.unitPrice, lineTotal, l.product.Station})
	}

	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		if selfPaid {
			// Atomic with the order: a failed insert must not lose the coins.
			notes := tag
			_, err := s.p.Wallet.Move(ctx, tx, ports.ArkMove{CustomerID: customerID, Amount: -total, Type: "payment", Notes: &notes})
			switch {
			case errors.Is(err, ports.ErrArkInsufficient):
				return httpx.Status(400, "Saldo ARK Coin tidak cukup")
			case err != nil:
				s.log.ErrorContext(ctx, "[table-order] ark coin debit", "error", err)
				return httpx.Status(400, "Gagal memproses ARK Coin")
			}
		}
		number, err := generateOrderNumber(ctx, tx)
		if err != nil {
			return err
		}
		out.OrderNumber = number
		out.QueueNumber = allocateQueueNumber(ctx, tx, v.CompanyID, v.BranchID)
		row := newOrder{
			OrderNumber: number, QueueNumber: out.QueueNumber, OrderType: in.OrderType, Status: out.Status,
			PaymentStatus: out.PaymentStatus, CustomerID: nullable(customerID), Subtotal: subtotal, Discount: discount,
			Tax: bill.TaxAmount, Service: bill.ServiceChargeAmount, Other: bill.OtherChargesAmount, Breakdown: bill.Breakdown,
			Total: total, Notes: strings.Join(notes, " · "),
			SpecialRequests: fmt.Sprintf("%s; payment=%s", tag, in.PaymentMethod),
			OrderedAt:       s.now(), CompanyID: nullable(v.CompanyID), BranchID: nullable(v.BranchID),
		}
		if table != nil {
			row.TableID = &table.ID
		}
		if guest != nil {
			row.ContactName, row.ContactPhone = &guest.Name, &guest.Phone
		}
		if selfPaid {
			method := "ark_coin"
			row.PaymentMethod, row.AmountPaid, row.ArkCoinsUsed = &method, total, total
		}
		if out.ID, err = insertOrder(ctx, tx, row); err != nil {
			return err
		}
		if err := insertItems(ctx, tx, out.ID, items); err != nil {
			return err
		}
		insertHistory(ctx, tx, out.ID, out.Status, fmt.Sprintf("Created from table self-service (%s)", in.PaymentMethod))
		if !selfPaid {
			return nil
		}
		// Paid with ARK Coin: XP is in the response (crm_xp), so it is
		// awarded here through the port; the journal, member stats and CRM's
		// idempotent re-award travel on the outbox.
		award, err := s.p.Loyalty.AwardOrderXP(ctx, tx, ports.OrderXP{
			OrderID: out.ID, CustomerID: customerID, TotalAmount: total, Items: xp,
			OutletID: nullable(v.BranchID), PaymentMethod: "ark_coin",
		})
		if err != nil {
			return err
		}
		out.CrmXP = award
		if err := outbox.Publish(ctx, tx, contracts.TopicCustomerOrderRecorded, out.ID,
			contracts.CustomerOrderRecorded{CustomerID: customerID, OrderID: out.ID, Amount: total}); err != nil {
			return err
		}
		if err := publishJournal(ctx, tx, out.ID, fallbackCashierID, "ark_coin"); err != nil {
			return err
		}
		return publishSaleCompleted(ctx, tx, out.ID, customerID, total, "ark_coin", v.BranchID, fallbackCashierID, xp)
	})
	if err != nil {
		return nil, err
	}

	if xendit != nil {
		qr, err := s.ensureOrderQris(ctx, qrisOrder{ID: out.ID, OrderNumber: out.OrderNumber, Total: total}, xendit)
		if err != nil {
			// The order stays an open bill; the guest pays at the cashier.
			msg := errMessage(err)
			out.QrisError, out.PaymentFlow = &msg, "cashier"
			s.log.ErrorContext(ctx, "[table-order] qris create failed order="+out.ID+":", "error", msg)
			setSpecialRequests(ctx, s.db, out.ID, tag+"; payment=cashier (qris gagal)")
		} else {
			out.Qris = qr
		}
	}

	s.alert(ctx, in, out, v.BrandName, lines, guest, table)
	return out, nil
}

// priceLines validates the items against the catalog and prices them:
// prices, XP and stations come from the catalog, never from the client.
func (s *service) priceLines(ctx context.Context, items []orderLineInput) ([]line, error) {
	ids := make([]string, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.ProductID)
	}
	catalog, err := s.p.Catalog.ProductsByIDs(ctx, s.db, uniqueUUIDs(ids))
	if err != nil {
		return nil, err
	}
	byID := map[string]CatalogProduct{}
	for _, c := range catalog {
		byID[c.Row.ID] = c
	}
	lines := make([]line, 0, len(items))
	for _, it := range items {
		c, found := byID[it.ProductID]
		if !found || !c.Sellable {
			return nil, httpx.Status(409, "Ada menu yang sudah tidak tersedia — muat ulang daftar menu")
		}
		product := domain.NormalizeProduct(c.Row)
		variant := domain.ResolveVariant(product, it.VariantID)
		if len(product.Variants) > 0 && variant == nil {
			return nil, httpx.Status(409, fmt.Sprintf("Varian %s tidak dikenal — pilih ulang", product.Name))
		}
		mods, msg := domain.ResolveModifiers(product, it.ModifierIDs)
		if msg != "" {
			return nil, httpx.Status(409, msg)
		}
		l := line{product: product, modifiers: mods, quantity: it.Quantity, unitPrice: domain.UnitPrice(product, variant, mods)}
		if variant != nil {
			l.variant = variant.Name
		}
		lines = append(lines, l)
	}
	return lines, nil
}

func uniqueUUIDs(ids []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, id := range ids {
		if isUUID(id) && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// alert is the fireOrderAlert call: the guest's name, or the member's.
func (s *service) alert(ctx context.Context, in createInput, out *createdOrder, brand string, lines []line, guest *domain.Guest, table *Table) {
	a := domain.OrderAlert{
		BrandName: brand, SourceLabel: "Self-order QR", TableLabel: tableLabel(table, out.TableCode), OrderType: in.OrderType,
		OrderNumber: out.OrderNumber, PaymentLabel: domain.PaymentMethodText(out.PaymentFlow),
		Paid: out.PaymentStatus == "paid", IsMember: in.CustomerID != "", CustomerNote: in.CustomerNote,
		Total: out.TotalAmount, ActionURL: in.ActionURL(out.ID),
	}
	if out.QueueNumber != nil {
		a.QueueNumber = *out.QueueNumber
	}
	if guest != nil {
		a.GuestName, a.GuestPhone = guest.Name, guest.Phone
	} else if m, err := members.Get(ctx, s.db, in.CustomerID); err == nil && m != nil {
		if m.Name != nil {
			a.GuestName = *m.Name
		}
		a.GuestPhone = m.Phone
	}
	for _, l := range lines {
		names := make([]string, len(l.modifiers))
		for i, m := range l.modifiers {
			names[i] = m.Name
		}
		a.Items = append(a.Items, domain.AlertItem{Name: l.product.Name, Quantity: l.quantity, Variant: l.variant, Modifiers: names})
	}
	s.p.Alerts.OrderAlert(a)
}

/* ── QRIS ────────────────────────────────────────────────────────────── */

// qrisOrder is OrderQrisRow.
type qrisOrder struct {
	ID, OrderNumber         string
	Total                   float64
	XenditQRID, XenditExtID string
}

// ensureOrderQris is ensureOrderQris (lib/table-order/qris.ts): reuse the
// order's QR (by id, else by reference) or create one bound to
// pos-ord-<id>, so the existing Xendit webhook settles it.
func (s *service) ensureOrderQris(ctx context.Context, o qrisOrder, cfg *XenditConfig) (*qrisPayload, error) {
	amount := domain.JSRound(o.Total)
	if amount <= 0 {
		return nil, errors.New("Nominal QRIS tidak valid")
	}
	reference := "pos-ord-" + o.ID
	if o.XenditQRID != "" || o.XenditExtID != "" {
		var remote QR
		var err error
		if o.XenditQRID != "" {
			remote, err = s.p.Xendit.QRCode(ctx, cfg.SecretKey, o.XenditQRID)
		} else {
			remote, err = s.p.Xendit.QRCodeByReference(ctx, cfg.SecretKey, o.XenditExtID)
		}
		if err == nil {
			p := &qrisPayload{
				QRID:        domain.JSString(remote["id"]),
				ReferenceID: domain.JSOr(remote["reference_id"]),
				QRString:    domain.JSOr(remote["qr_string"]),
				Amount:      domain.QRAmount(remote["amount"], amount),
				ExpiresAt:   expiresAt(remote["expires_at"]),
			}
			if p.ReferenceID == "" {
				p.ReferenceID = reference
			}
			if p.QRString != "" {
				if o.XenditQRID == "" {
					_ = setXenditIDs(ctx, s.db, o.ID, &p.QRID, nil)
				}
				return p, nil
			}
		} else {
			s.log.WarnContext(ctx, "[table-order] qris reuse miss, membuat baru: order="+o.ID, "error", errMessage(err))
		}
	}

	if err := setXenditIDs(ctx, s.db, o.ID, nil, &reference); err != nil {
		return nil, err
	}
	description := "Self-order " + o.OrderNumber
	if o.OrderNumber == "" {
		description = "Self-order " + o.ID
	}
	qr, err := s.p.Xendit.CreateDynamicQR(ctx, cfg.SecretKey, reference, amount, cfg.CallbackURL, description)
	if err != nil {
		return nil, err
	}
	if err := setXenditIDs(ctx, s.db, o.ID, &qr.ID, &qr.ReferenceID); err != nil {
		return nil, err
	}
	return &qrisPayload{QRID: qr.ID, ReferenceID: qr.ReferenceID, QRString: qr.QRString, Amount: qr.Amount, ExpiresAt: qr.ExpiresAt}, nil
}

// checkAndSettle is checkAndSettleOrderQris: ask Xendit, settle when paid.
func (s *service) checkAndSettle(ctx context.Context, orderID, qrID string, cfg *XenditConfig) (bool, string, error) {
	remote, err := s.p.Xendit.QRCode(ctx, cfg.SecretKey, qrID)
	if err != nil {
		return false, "", err
	}
	paid := domain.IsXenditQRPaid(remote)
	status := domain.JSOr(remote["status"])
	if status == "" {
		status = domain.JSOr(remote["payment_status"])
	}
	if status == "" {
		status = "ACTIVE"
	}
	if !paid {
		// The payments endpoint is optional: the QR detail is enough.
		if payments, err := s.p.Xendit.QRPayments(ctx, cfg.SecretKey, qrID); err == nil &&
			domain.IsXenditQRPaid(map[string]any{"payments": payments}) {
			paid, status = true, "SUCCEEDED"
		}
	}
	if paid {
		if err := s.settle(ctx, orderID); err != nil {
			return false, "", err
		}
	}
	return paid, status, nil
}

// settle is settleOrderQrisPayment for a standalone order: idempotent, it
// marks the order paid by QRIS, allocates a missing queue number and
// publishes the journal, member stats and XP events. Child orders of a
// checkout are left to the checkout.
func (s *service) settle(ctx context.Context, orderID string) error {
	return database.WithTx(ctx, s.db, func(tx pgx.Tx) error { return settleOrderQris(ctx, tx, orderID) })
}

// settleOrderQris is settle on the caller's transaction (the status poll
// and the Xendit webhook subscriber).
func settleOrderQris(ctx context.Context, tx pgx.Tx, orderID string) error {
	o, err := lockSettleRow(ctx, tx, orderID)
	if err != nil || o == nil || o.PaymentStatus == "paid" || o.CheckoutID != nil {
		return err
	}
	if err := markPaidByQris(ctx, tx, orderID, o.Total); err != nil {
		return err
	}
	if o.QueueNumber == nil || strings.TrimSpace(*o.QueueNumber) == "" {
		if q := allocateQueueNumber(ctx, tx, deref(o.CompanyID), deref(o.BranchID)); q != nil {
			setQueueNumber(ctx, tx, orderID, *q)
		}
	}
	// The webhook has no cashier session: the journal's actor is the
	// order's cashier_id, and no journal is posted without one (TS).
	if o.CashierID != "" {
		if err := publishJournal(ctx, tx, orderID, o.CashierID, "qris"); err != nil {
			return err
		}
	}
	if o.CustomerID == nil {
		return nil
	}
	if err := outbox.Publish(ctx, tx, contracts.TopicCustomerOrderRecorded, orderID,
		contracts.CustomerOrderRecorded{CustomerID: *o.CustomerID, OrderID: orderID, Amount: o.Total}); err != nil {
		return err
	}
	items, err := xpItems(ctx, tx, orderID)
	if err != nil {
		return err
	}
	return publishSaleCompleted(ctx, tx, orderID, *o.CustomerID, o.Total, "qris", deref(o.BranchID), o.CashierID, items)
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

/* ── GET /orders/{id} ────────────────────────────────────────────────── */

type statusQris struct {
	QRID      string  `json:"qr_id"`
	QRString  string  `json:"qr_string"`
	Amount    float64 `json:"amount"`
	ExpiresAt *string `json:"expires_at"`
}

type statusItem struct {
	ID            string   `json:"id"`
	ProductName   string   `json:"product_name"`
	VariantName   *string  `json:"variant_name"`
	ModifierNames []string `json:"modifier_names"`
	Quantity      float64  `json:"quantity"`
	UnitPrice     float64  `json:"unit_price"`
	TotalAmount   float64  `json:"total_amount"`
	Station       *string  `json:"station"`
	KitchenStatus *string  `json:"kitchen_status"`
}

// orderStatus is the data of GET /api/table-order/orders/[id].
type orderStatus struct {
	ID                     string        `json:"id"`
	OrderNumber            string        `json:"order_number"`
	QueueNumber            *string       `json:"queue_number"`
	Status                 string        `json:"status"`
	PaymentStatus          string        `json:"payment_status"`
	PaymentMethod          *string       `json:"payment_method"`
	PaymentFlow            string        `json:"payment_flow"`
	OrderType              *string       `json:"order_type"`
	Subtotal               float64       `json:"subtotal"`
	DiscountAmount         float64       `json:"discount_amount"`
	TaxAmount              float64       `json:"tax_amount"`
	ServiceChargeAmount    float64       `json:"service_charge_amount"`
	OtherChargesAmount     float64       `json:"other_charges_amount"`
	TotalAmount            float64       `json:"total_amount"`
	Breakdown              rawJSON       `json:"breakdown"`
	OrderedAt              *httpx.JSTime `json:"ordered_at"`
	TotalXP                int           `json:"total_xp"`
	Items                  []statusItem  `json:"items"`
	PaymentProofUploadedAt *httpx.JSTime `json:"payment_proof_uploaded_at"`
	Qris                   *statusQris   `json:"qris"`
	QrisStatus             *string       `json:"qris_status"`
	QrisCheckError         *string       `json:"qris_check_error"`
}

// rawJSON is a jsonb value passed through as node-postgres + JSON.stringify
// would (compacted by encoding/json).
type rawJSON []byte

func (r rawJSON) MarshalJSON() ([]byte, error) { return r, nil }

// arrayOr is `Array.isArray(v) ? v : []` for a jsonb column.
func arrayOr(raw []byte) rawJSON {
	trimmed := strings.TrimSpace(string(raw))
	if strings.HasPrefix(trimmed, "[") {
		return rawJSON(trimmed)
	}
	return rawJSON("[]")
}

// variantName is variantName(raw): the first variant's string name.
func variantName(raw []byte) *string {
	var list []map[string]any
	if json.Unmarshal(raw, &list) != nil || len(list) == 0 {
		return nil
	}
	if name, ok := list[0]["name"].(string); ok {
		return &name
	}
	return nil
}

// modifierNames is the modifiers' names, empty ones dropped.
func modifierNames(raw []byte) []string {
	names := []string{}
	var list []any
	if json.Unmarshal(raw, &list) != nil {
		return names
	}
	for _, item := range list {
		m, _ := item.(map[string]any)
		if name := domain.JSString(m["name"]); name != "" {
			names = append(names, name)
		}
	}
	return names
}

// orderStatus is GET /api/table-order/orders/[id] after the id check and
// the rate limit (nil, nil = 404).
func (s *service) orderStatus(ctx context.Context, orderID string, wantQr bool) (*orderStatus, error) {
	o, err := loadOrder(ctx, s.db, orderID)
	if err != nil || o == nil {
		return nil, err
	}
	out := &orderStatus{}
	if o.PaymentStatus == "unpaid" && domain.PaymentFlowFrom(o.SpecialRequests, o.PaymentMethod) == "qris" && deref(o.XenditQRID) != "" {
		paid, status, qr, err := s.pollQris(ctx, o, wantQr)
		if status != "" {
			out.QrisStatus = &status
		}
		out.Qris = qr
		if err == nil && paid {
			var reloaded *orderRow
			if reloaded, err = loadOrder(ctx, s.db, orderID); reloaded != nil {
				o = reloaded
			}
		}
		if err != nil {
			msg := errMessage(err)
			out.QrisCheckError = &msg
			s.log.WarnContext(ctx, "[table-order] qris check order="+orderID+":", "error", msg)
		}
	}

	items, err := loadItems(ctx, s.db, orderID)
	if err != nil {
		return nil, err
	}
	out.ID, out.OrderNumber, out.QueueNumber = o.ID, o.OrderNumber, o.QueueNumber
	out.Status, out.PaymentStatus, out.PaymentMethod = o.Status, o.PaymentStatus, o.PaymentMethod
	out.PaymentFlow, out.OrderType = domain.PaymentFlowFrom(o.SpecialRequests, o.PaymentMethod), o.OrderType
	out.Subtotal, out.DiscountAmount, out.TaxAmount = o.Subtotal, o.Discount, o.Tax
	out.ServiceChargeAmount, out.OtherChargesAmount, out.TotalAmount = o.Service, o.Other, o.Total
	out.Breakdown = arrayOr(o.Breakdown)
	out.OrderedAt, out.PaymentProofUploadedAt = httpx.NewJSTime(o.OrderedAt), httpx.NewJSTime(o.ProofUploadedAt)
	out.Items = make([]statusItem, len(items))
	for i, it := range items {
		out.TotalXP += it.XPEarned
		quantity := it.Quantity
		if math.IsNaN(quantity) {
			quantity = 0
		}
		out.Items[i] = statusItem{
			ID: it.ID, ProductName: it.ProductName, VariantName: variantName(it.Variants),
			ModifierNames: modifierNames(it.Modifiers), Quantity: quantity, UnitPrice: it.UnitPrice,
			TotalAmount: it.Total, Station: it.Station, KitchenStatus: it.KitchenStatus,
		}
	}
	return out, nil
}

// pollQris checks an unpaid QRIS order with Xendit (a webhook fallback) and
// settles it when paid; an unpaid order gets its QR again when wanted. The
// status is set once Xendit answered, even when a later step failed.
func (s *service) pollQris(ctx context.Context, o *orderRow, wantQr bool) (bool, string, *statusQris, error) {
	cfg, err := s.p.Settings.XenditConfig(ctx, s.db)
	if err != nil {
		return false, "", nil, err
	}
	paid, status, err := s.checkAndSettle(ctx, o.ID, *o.XenditQRID, cfg)
	if err != nil || paid || !wantQr {
		return paid, status, nil, err
	}
	p, err := s.ensureOrderQris(ctx, qrisOrder{ID: o.ID, OrderNumber: o.OrderNumber, Total: o.Total,
		XenditQRID: deref(o.XenditQRID), XenditExtID: deref(o.XenditExtID)}, cfg)
	if err != nil {
		return false, status, nil, err
	}
	return false, status, &statusQris{QRID: p.QRID, QRString: p.QRString, Amount: p.Amount, ExpiresAt: p.ExpiresAt}, nil
}

// publishJournal asks accounting for the sale's journal (pos.sale.settled).
func publishJournal(ctx context.Context, q database.Querier, orderID, userID, method string) error {
	return outbox.Publish(ctx, q, contracts.TopicSaleSettled, orderID,
		contracts.SaleSettled{OrderID: orderID, UserID: userID, PaymentMethod: &method})
}

// publishSaleCompleted hands the paid order to CRM for XP. Stats travel on
// pos.customer_order.recorded, so StatsAmount stays empty here.
func publishSaleCompleted(ctx context.Context, q database.Querier, orderID, customerID string, total float64, method, branchID, userID string, items []ports.XPItem) error {
	ev := contracts.SaleCompleted{OrderID: orderID, CustomerID: &customerID, TotalAmount: total, PaymentMethod: method, Items: []contracts.SaleItem{}}
	if branchID != "" {
		ev.BranchID = &branchID
	}
	if userID != "" {
		ev.UserID = &userID
	}
	for _, it := range items {
		qty := 1.0
		if it.Quantity != nil && *it.Quantity != 0 {
			qty = *it.Quantity
		}
		ev.Items = append(ev.Items, contracts.SaleItem{ProductID: it.ProductID, Quantity: qty, UnitPrice: it.UnitPrice, TotalAmount: it.TotalAmount})
	}
	return outbox.Publish(ctx, q, contracts.TopicSaleCompleted, orderID, ev)
}
