package shop

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"math/big"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"nuhabit/backend/internal/modules/shop/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// The wholesale (B2B) portal: partner accounts staff create in the
// dashboard, password sessions in the nh_wholesale cookie, a catalog at
// partner prices and orders that pay by Xendit invoice or later.

// WholesaleAccount is a shop.wholesale_accounts row without its secret.
type WholesaleAccount struct {
	ID           string        `json:"id"`
	ShopID       *string       `json:"shop_id"`
	CompanyName  string        `json:"company_name"`
	ContactName  string        `json:"contact_name"`
	Email        string        `json:"email"`
	Phone        *string       `json:"phone"`
	DiscountPct  float64       `json:"discount_pct"`
	MinOrderIDR  float64       `json:"min_order_idr"`
	PaymentTerms string        `json:"payment_terms"`
	Status       string        `json:"status"`
	LastLoginAt  *httpx.JSTime `json:"last_login_at"`
	CreatedAt    httpx.JSTime  `json:"created_at"`
}

const accountColumns = `id::text, shop_id::text, company_name, contact_name, email, phone,
	discount_pct::float8, min_order_idr::float8, payment_terms, status, last_login_at, created_at`

func scanAccount(row interface{ Scan(dest ...any) error }) (*WholesaleAccount, error) {
	var a WholesaleAccount
	var lastLogin *time.Time
	var created time.Time
	err := row.Scan(&a.ID, &a.ShopID, &a.CompanyName, &a.ContactName, &a.Email, &a.Phone,
		&a.DiscountPct, &a.MinOrderIDR, &a.PaymentTerms, &a.Status, &lastLogin, &created)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	a.LastLoginAt, a.CreatedAt = httpx.NewJSTime(lastLogin), httpx.JSTime(created)
	return &a, nil
}

// ListWholesaleAccounts lists every partner account, newest first.
func (s *Service) ListWholesaleAccounts(ctx context.Context) ([]WholesaleAccount, error) {
	rows, err := s.db.Query(ctx, `SELECT `+accountColumns+` FROM shop.wholesale_accounts ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WholesaleAccount{}
	for rows.Next() {
		a, err := scanAccount(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// WholesaleAccountInput is what staff set on an account.
type WholesaleAccountInput struct {
	ShopID       *string
	CompanyName  string
	ContactName  string
	Email        string
	Phone        *string
	DiscountPct  float64
	MinOrderIDR  float64
	PaymentTerms string
	Status       string
}

// passwordAlphabet leaves out the glyphs that read alike (0/O, 1/l/I).
const passwordAlphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// newPassword is a 12 character one-time password.
func newPassword() (string, error) {
	var b strings.Builder
	for i := 0; i < 12; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(passwordAlphabet))))
		if err != nil {
			return "", err
		}
		b.WriteByte(passwordAlphabet[n.Int64()])
	}
	return b.String(), nil
}

// bcrypt reads at most 72 bytes of a password.
const bcryptMaxBytes = 72

func hashPassword(password string) (string, error) {
	raw := []byte(password)
	if len(raw) > bcryptMaxBytes {
		raw = raw[:bcryptMaxBytes]
	}
	hash, err := bcrypt.GenerateFromPassword(raw, bcrypt.DefaultCost)
	return string(hash), err
}

var errEmailTaken = httpx.Conflict("Email sudah dipakai akun lain")

// CreateWholesaleAccount inserts an account with a fresh one-time password,
// returned once for staff to hand over.
func (s *Service) CreateWholesaleAccount(ctx context.Context, in WholesaleAccountInput) (*WholesaleAccount, string, error) {
	password, err := newPassword()
	if err != nil {
		return nil, "", err
	}
	hash, err := hashPassword(password)
	if err != nil {
		return nil, "", err
	}
	a, err := scanAccount(s.db.QueryRow(ctx, `INSERT INTO shop.wholesale_accounts
		(shop_id, company_name, contact_name, email, password_hash, phone, discount_pct, min_order_idr, payment_terms, status)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING `+accountColumns, in.ShopID, in.CompanyName, in.ContactName, domain.NormalizeEmail(in.Email), hash,
		orNil(in.Phone), in.DiscountPct, in.MinOrderIDR, in.PaymentTerms, in.Status))
	if database.IsUniqueViolation(err) {
		return nil, "", errEmailTaken
	}
	if err != nil {
		return nil, "", err
	}
	return a, password, nil
}

// UpdateWholesaleAccount rewrites the editable fields; resetPassword
// issues a new one-time password (returned once) and ends every session
// of the account.
func (s *Service) UpdateWholesaleAccount(ctx context.Context, id string, in WholesaleAccountInput, resetPassword bool) (*WholesaleAccount, string, error) {
	password := ""
	var hash *string
	if resetPassword {
		p, err := newPassword()
		if err != nil {
			return nil, "", err
		}
		h, err := hashPassword(p)
		if err != nil {
			return nil, "", err
		}
		password, hash = p, &h
	}
	a, err := scanAccount(s.db.QueryRow(ctx, `UPDATE shop.wholesale_accounts SET
		  shop_id = $2::uuid, company_name = $3, contact_name = $4, email = $5, phone = $6,
		  discount_pct = $7, min_order_idr = $8, payment_terms = $9, status = $10,
		  password_hash = COALESCE($11, password_hash), updated_at = now()
		WHERE id = $1::uuid
		RETURNING `+accountColumns, id, in.ShopID, in.CompanyName, in.ContactName, domain.NormalizeEmail(in.Email),
		orNil(in.Phone), in.DiscountPct, in.MinOrderIDR, in.PaymentTerms, in.Status, hash))
	if database.IsUniqueViolation(err) {
		return nil, "", errEmailTaken
	}
	if err != nil {
		return nil, "", err
	}
	if a == nil {
		return nil, "", httpx.NotFound("Akun tidak ditemukan")
	}
	if resetPassword || in.Status != "active" {
		if _, err := s.db.Exec(ctx, `DELETE FROM shop.wholesale_sessions WHERE account_id = $1::uuid`, id); err != nil {
			return nil, "", err
		}
	}
	return a, password, nil
}

// ── Sessions ────────────────────────────────────────────────────────────

var (
	errWholesaleCredentials = httpx.Unauthorized("Email atau kata sandi salah")
	errWholesaleDisabled    = httpx.Forbidden("Akun mitra dinonaktifkan. Hubungi tim NüHabit.")
	errWholesaleLocked      = httpx.TooManyRequests("Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.")
)

// WholesaleLogin checks the password and opens a session. Failed attempts
// count against the email and the IP; past the limit every attempt is
// refused until the window passes.
func (s *Service) WholesaleLogin(ctx context.Context, ip, email, password string) (token string, account *WholesaleAccount, err error) {
	email = domain.NormalizeEmail(email)
	if email == "" || password == "" {
		return "", nil, httpx.BadRequest("Email dan kata sandi wajib diisi")
	}
	emailKey, ipKey := "wholesale-login:"+email, "wholesale-login-ip:"+ip
	now := s.now()
	for key, limit := range map[string]int{emailKey: domain.WholesaleLoginEmailLimit, ipKey: domain.WholesaleLoginIPLimit} {
		n, err := s.limits.SlidingCount(ctx, key, domain.WholesaleLoginWindow, now)
		if err != nil {
			return "", nil, err
		}
		if n >= limit {
			return "", nil, errWholesaleLocked
		}
	}
	var hash string
	err = s.db.QueryRow(ctx, `SELECT password_hash FROM shop.wholesale_accounts WHERE lower(email) = $1`, email).Scan(&hash)
	if err != nil && !database.IsNoRows(err) {
		return "", nil, err
	}
	if err != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		for _, key := range []string{emailKey, ipKey} {
			if _, _, err := s.limits.Sliding(ctx, key, 1<<30, domain.WholesaleLoginWindow, now); err != nil {
				return "", nil, err
			}
		}
		return "", nil, errWholesaleCredentials
	}
	account, err = scanAccount(s.db.QueryRow(ctx, `UPDATE shop.wholesale_accounts SET last_login_at = now(), updated_at = now()
		WHERE lower(email) = $1 RETURNING `+accountColumns, email))
	if err != nil {
		return "", nil, err
	}
	if account.Status != "active" {
		return "", nil, errWholesaleDisabled
	}
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", nil, err
	}
	token = hex.EncodeToString(raw[:])
	_, err = s.db.Exec(ctx, `INSERT INTO shop.wholesale_sessions (token_hash, account_id, expires_at) VALUES ($1, $2::uuid, $3)`,
		auth.HashToken(token), account.ID, now.Add(domain.WholesaleSessionTTL))
	if err != nil {
		return "", nil, err
	}
	return token, account, nil
}

// WholesaleLogout ends the session of a token ("" is a no-op).
func (s *Service) WholesaleLogout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	_, err := s.db.Exec(ctx, `DELETE FROM shop.wholesale_sessions WHERE token_hash = $1`, auth.HashToken(token))
	return err
}

// WholesaleSession resolves a session token to its active account, nil
// when the token is unknown, expired or the account is disabled.
func (s *Service) WholesaleSession(ctx context.Context, token string) (*WholesaleAccount, error) {
	if token == "" {
		return nil, nil
	}
	return scanAccount(s.db.QueryRow(ctx, `WITH touched AS (
			UPDATE shop.wholesale_sessions SET last_seen_at = now()
			WHERE token_hash = $1 AND expires_at > now() RETURNING account_id)
		SELECT `+accountColumns+` FROM shop.wholesale_accounts a
		WHERE a.id = (SELECT account_id FROM touched) AND a.status = 'active'`, auth.HashToken(token)))
}

// wholesaleToken reads the nh_wholesale cookie.
func wholesaleToken(r *http.Request) string {
	if c, err := r.Cookie(domain.WholesaleSessionCookie); err == nil {
		return c.Value
	}
	return ""
}

// ── Catalog ─────────────────────────────────────────────────────────────

// WholesaleSKUView is a variant at partner price.
type WholesaleSKUView struct {
	ID          string  `json:"id"`
	SKU         string  `json:"sku"`
	Name        string  `json:"name"`
	RetailPrice float64 `json:"retailPrice"`
	Price       float64 `json:"price"`
	Stock       float64 `json:"stock"`
	Preorder    bool    `json:"preorder"`
}

// WholesaleProductView is a product at partner price with its minimum
// order quantity.
type WholesaleProductView struct {
	ID            string             `json:"id"`
	Name          string             `json:"name"`
	Description   *string            `json:"description"`
	ImageURL      *string            `json:"imageUrl"`
	Images        []string           `json:"images"`
	Collection    *CatalogCollection `json:"collection"`
	RetailPrice   float64            `json:"retailPrice"`
	Price         float64            `json:"price"`
	MinQty        float64            `json:"minQty"`
	Stock         float64            `json:"stock"`
	Preorder      bool               `json:"preorder"`
	PreorderUntil *string            `json:"preorderUntil"`
	SKUs          []WholesaleSKUView `json:"skus"`
}

// WholesaleCatalog is the web catalog priced for the account.
func (s *Service) WholesaleCatalog(ctx context.Context, acct WholesaleAccount) ([]WholesaleProductView, error) {
	catalog, err := s.BuildCatalog(ctx)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(catalog.Products))
	for i, p := range catalog.Products {
		ids[i] = p.ID
	}
	settings, err := s.productSettings(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]WholesaleProductView, 0, len(catalog.Products))
	for _, p := range catalog.Products {
		ps := settingsOf(settings, p.ID)
		v := WholesaleProductView{
			ID: p.ID, Name: p.Name, Description: p.Description, ImageURL: p.ImageURL, Images: p.Images, Collection: p.Collection,
			RetailPrice: p.Price, Price: domain.WholesaleUnitPrice(p.Price, ps.WholesalePriceIDR, acct.DiscountPct),
			MinQty: ps.WholesaleMinQty, Stock: p.Stock, Preorder: p.Preorder, PreorderUntil: p.PreorderUntil, SKUs: []WholesaleSKUView{},
		}
		for _, sku := range p.SKUs {
			v.SKUs = append(v.SKUs, WholesaleSKUView{ID: sku.ID, SKU: sku.SKU, Name: sku.Name, RetailPrice: sku.Price,
				Price: domain.WholesaleUnitPrice(sku.Price, ps.WholesalePriceIDR, acct.DiscountPct), Stock: sku.Stock, Preorder: sku.Preorder})
		}
		out = append(out, v)
	}
	return out, nil
}

// ── Orders ──────────────────────────────────────────────────────────────

// WholesaleOrderInput is a partner's order.
type WholesaleOrderInput struct {
	Items   []CartItem
	Address string
	Notes   *string
	BaseURL string
}

// WholesaleOrderResult is what the partner gets back.
type WholesaleOrderResult struct {
	ID          string  `json:"id"`
	OrderNumber string  `json:"order_number"`
	Status      string  `json:"status"`
	InvoiceURL  *string `json:"invoice_url"`
	StatusURL   string  `json:"status_url"`
}

// storefrontFor is the account's storefront, else the default one.
func (s *Service) storefrontFor(ctx context.Context, acct WholesaleAccount) (*Storefront, error) {
	if acct.ShopID != nil {
		var sf Storefront
		err := s.db.QueryRow(ctx, `SELECT id::text, slug, name, description FROM shop.storefronts WHERE id = $1::uuid AND is_active`, *acct.ShopID).
			Scan(&sf.ID, &sf.Slug, &sf.Name, &sf.Description)
		if err == nil {
			return &sf, nil
		}
		if !database.IsNoRows(err) {
			return nil, err
		}
	}
	return s.ResolveStorefront(ctx, DefaultStorefrontSlug)
}

// PlaceWholesaleOrder re-prices the lines for the account, checks the
// minimums and writes the order. Invoice terms create the Xendit invoice
// like a retail checkout; pay_later leaves the order unpaid with a due date
// 30 days out and commits its stock at once, since it ships before payment.
func (s *Service) PlaceWholesaleOrder(ctx context.Context, acct WholesaleAccount, in WholesaleOrderInput) (*WholesaleOrderResult, error) {
	if acct.PaymentTerms == "invoice" && !s.ports.Payments.Configured() {
		return nil, &checkoutError{503, "Pembayaran online belum dikonfigurasi"}
	}
	sf, err := s.storefrontFor(ctx, acct)
	if err != nil {
		return nil, err
	}
	if sf == nil {
		return nil, &checkoutError{503, "Toko belum aktif"}
	}
	lines, reason, err := s.resolveLines(ctx, in.Items)
	if err != nil {
		return nil, err
	}
	if reason != "" {
		return nil, &checkoutError{400, reason}
	}
	rules := make([]domain.WholesaleLine, len(lines))
	for i := range lines {
		lines[i].unitPrice = domain.WholesaleUnitPrice(lines[i].unitPrice, lines[i].settings.WholesalePriceIDR, acct.DiscountPct)
		rules[i] = domain.WholesaleLine{Name: lines[i].label(), Quantity: lines[i].quantity, MinQty: lines[i].settings.WholesaleMinQty,
			Subtotal: float64(lines[i].unitPrice * lines[i].quantity)}
	}
	if msg := domain.WholesaleOrderError(rules, acct.MinOrderIDR); msg != "" {
		return nil, &checkoutError{400, msg}
	}
	phone := ""
	if acct.Phone != nil {
		phone = *acct.Phone
	}
	now := s.now()
	terms := acct.PaymentTerms
	d := orderDraft{
		storefront: *sf, lines: lines, customerName: acct.CompanyName, customerPhone: phone, customerEmail: &acct.Email,
		address: in.Address, notes: in.Notes, wholesaleAccountID: &acct.ID, paymentTerms: &terms,
	}
	if d.total() <= 0 {
		return nil, &checkoutError{400, "Total order tidak valid"}
	}
	if terms == "pay_later" {
		due := now.Add(domain.PayLaterDays * 24 * time.Hour)
		d.dueAt, d.reservationStatus = &due, "committed"
	} else {
		expires := now.Add(InvoiceExpiryHours * time.Hour)
		d.invoiceExpiresAt = &expires
	}
	placed, err := s.placeOrder(ctx, d)
	if err != nil {
		return nil, err
	}
	res := &WholesaleOrderResult{ID: placed.id, OrderNumber: placed.number, Status: "pending", StatusURL: in.BaseURL + "/wholesale/orders/" + placed.id}
	if terms == "invoice" {
		url, err := s.issueInvoice(ctx, placed, d.total(), acct.CompanyName, "Order "+placed.number+" — "+sf.Name+" (wholesale)", res.StatusURL)
		if err != nil {
			return nil, err
		}
		res.InvoiceURL = &url
	}
	return res, nil
}

const wholesaleOrderColumns = `o.id, o.order_number, o.status, o.payment_terms, o.due_at, o.subtotal, o.shipping_cost, o.total,
	  o.waybill, o.paid_at, o.created_at,
	  CASE WHEN o.status = 'pending' THEN o.xendit_invoice_url END AS invoice_url,
	  (SELECT COUNT(*) FROM shop.order_items i WHERE i.order_id = o.id) AS item_count`

// ListWholesaleOrders is the partner's order history, newest first.
func (s *Service) ListWholesaleOrders(ctx context.Context, accountID string) ([]*Row, error) {
	return queryRows(ctx, s.db, `SELECT `+wholesaleOrderColumns+` FROM shop.orders o
		WHERE o.wholesale_account_id = $1::uuid ORDER BY o.created_at DESC LIMIT 200`, accountID)
}

// WholesaleOrderDetail is one of the partner's orders with its lines.
func (s *Service) WholesaleOrderDetail(ctx context.Context, accountID, id string) (*Row, error) {
	order, err := queryRow(ctx, s.db, `SELECT `+wholesaleOrderColumns+`, o.shipping_address, o.notes, o.customer_name
		FROM shop.orders o WHERE o.id = $1::uuid AND o.wholesale_account_id = $2::uuid`, id, accountID)
	if err != nil || order == nil {
		return nil, err
	}
	items, err := queryRows(ctx, s.db, `SELECT product_name, sku_name, sku_code, quantity, unit_price, total, is_preorder
		FROM shop.order_items WHERE order_id = $1::uuid ORDER BY product_name`, id)
	if err != nil {
		return nil, err
	}
	return order.Set("items", items), nil
}

// ListWholesaleOrdersAdmin is the back-office list of partner orders: the
// retail list columns plus the account and terms.
func (s *Service) ListWholesaleOrdersAdmin(ctx context.Context, f domain.OrderListFilter) ([]*Row, error) {
	return queryRows(ctx, s.db, `SELECT o.id, o.order_number, o.status, o.customer_name, o.customer_phone,
		  o.shipping_area_label, o.courier_code, o.courier_service,
		  o.subtotal, o.shipping_cost, o.total, o.waybill, o.paid_at,
		  o.created_at, o.customer_id,
		  (SELECT COUNT(*) FROM shop.order_items i WHERE i.order_id = o.id) AS item_count,
		  s.status AS shipment_status, s.provider AS shipment_provider,
		  o.wholesale_account_id, a.company_name, a.contact_name, o.payment_terms, o.due_at
		FROM shop.orders o
		JOIN shop.wholesale_accounts a ON a.id = o.wholesale_account_id
		LEFT JOIN shop.shipments s ON s.order_id = o.id AND s.status NOT IN ('failed','cancelled')
		WHERE ($1 = '' OR o.status = $1)
		  AND ($2 = '' OR o.order_number ILIKE '%' || $2 || '%' OR a.company_name ILIKE '%' || $2 || '%')
		ORDER BY o.created_at DESC
		LIMIT $3::int`, f.Status, f.Search, int(f.Limit))
}

// ── Product settings ────────────────────────────────────────────────────

// WholesaleProductRow is a web product with its shop settings, for staff.
type WholesaleProductRow struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Collection        *string  `json:"collection"`
	Price             float64  `json:"price"`
	Stock             float64  `json:"stock"`
	PreorderUntil     *string  `json:"preorder_until"`
	WholesalePriceIDR *float64 `json:"wholesale_price_idr"`
	WholesaleMinQty   float64  `json:"wholesale_min_qty"`
}

// ListWholesaleProducts lists the web products with their settings.
func (s *Service) ListWholesaleProducts(ctx context.Context) ([]WholesaleProductRow, error) {
	catalog, err := s.BuildCatalog(ctx)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(catalog.Products))
	for i, p := range catalog.Products {
		ids[i] = p.ID
	}
	settings, err := s.productSettings(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]WholesaleProductRow, 0, len(catalog.Products))
	for _, p := range catalog.Products {
		ps := settingsOf(settings, p.ID)
		row := WholesaleProductRow{ID: p.ID, Name: p.Name, Price: p.Price, Stock: p.Stock, PreorderUntil: p.PreorderUntil,
			WholesalePriceIDR: ps.WholesalePriceIDR, WholesaleMinQty: ps.WholesaleMinQty}
		if p.Collection != nil {
			row.Collection = &p.Collection.Name
		}
		out = append(out, row)
	}
	return out, nil
}

// ProductSettingsInput is the staff patch of a product's shop settings.
type ProductSettingsInput struct {
	PreorderUntil     *string
	WholesalePriceIDR *float64
	WholesaleMinQty   int
}

var errUnknownProduct = httpx.NotFound("Produk tidak ditemukan")

// UpdateProductSettings upserts the settings of a web product.
func (s *Service) UpdateProductSettings(ctx context.Context, productID string, in ProductSettingsInput) (*WholesaleProductRow, error) {
	product, err := s.ports.Catalog.WebProduct(ctx, s.db, productID)
	if err != nil {
		return nil, err
	}
	if product == nil {
		return nil, errUnknownProduct
	}
	_, err = s.db.Exec(ctx, `INSERT INTO shop.product_settings (product_id, preorder_until, wholesale_price_idr, wholesale_min_qty)
		VALUES ($1::uuid, $2::date, $3, $4)
		ON CONFLICT (product_id) DO UPDATE SET preorder_until = EXCLUDED.preorder_until,
		  wholesale_price_idr = EXCLUDED.wholesale_price_idr, wholesale_min_qty = EXCLUDED.wholesale_min_qty, updated_at = now()`,
		productID, in.PreorderUntil, in.WholesalePriceIDR, in.WholesaleMinQty)
	if err != nil {
		return nil, err
	}
	rows, err := s.ListWholesaleProducts(ctx)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		if rows[i].ID == productID {
			return &rows[i], nil
		}
	}
	return nil, errUnknownProduct
}
