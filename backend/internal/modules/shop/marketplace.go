package shop

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/shop/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Marketplace accounts, listing links and the sync engine
// (lib/shop/marketplace/{accounts,sync}.ts): stock is pushed from NüHabit
// (minus each account's buffer) and paid Shopee orders are pulled into
// shop.orders, idempotent by order_sn. An order pulled without enough local
// stock is still recorded (it sold on Shopee) with a sync_log error for
// manual reconciliation.

const accountNotFound = "Akun tidak ditemukan"

// requireUUID is requireUuid: a 400 naming the field.
func requireUUID(value, field string) (string, error) {
	if !validate.IsUUID(value) {
		return "", httpx.BadRequest(field + " tidak valid")
	}
	return value, nil
}

// ListAccounts is listMarketplaceAccounts.
func (s *Service) ListAccounts(ctx context.Context) ([]*Row, error) {
	return queryRows(ctx, s.db, `SELECT a.id, a.channel_code, a.shop_id, a.shop_name, a.status,
		  a.stock_buffer, a.last_pull_at, a.token_expires_at,
		  (SELECT COUNT(*) FROM shop.marketplace_links l WHERE l.account_id = a.id) AS link_count
		FROM shop.marketplace_accounts a
		ORDER BY a.created_at`)
}

// UpdateAccount is updateMarketplaceAccount: the stock buffer, or a
// disconnect that drops the access token.
func (s *Service) UpdateAccount(ctx context.Context, id string, stockBuffer *int, status *string) (*Row, error) {
	row, err := queryRow(ctx, s.db, `UPDATE shop.marketplace_accounts
		SET stock_buffer = COALESCE($2, stock_buffer),
		    status = COALESCE($3, status),
		    access_token = CASE WHEN $3 = 'disconnected' THEN NULL ELSE access_token END,
		    updated_at = now()
		WHERE id = $1::uuid
		RETURNING id, status, stock_buffer`, id, stockBuffer, status)
	if err == nil && row == nil {
		return nil, httpx.NotFound(accountNotFound)
	}
	return row, err
}

// account is getMarketplaceAccount.
func (s *Service) account(ctx context.Context, id string) (*marketplaceAccount, error) {
	var a marketplaceAccount
	err := s.db.QueryRow(ctx, `SELECT id::text, channel_code, shop_id, access_token, refresh_token, token_expires_at,
		  status, stock_buffer, last_pull_at
		FROM shop.marketplace_accounts WHERE id = $1::uuid`, id).Scan(&a.ID, &a.ChannelCode, &a.ShopID, &a.AccessToken,
		&a.RefreshToken, &a.TokenExpiresAt, &a.Status, &a.StockBuffer, &a.LastPullAt)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound(accountNotFound)
	}
	return &a, err
}

// logSync writes shop.marketplace_sync_log; a failure is only logged.
func (s *Service) logSync(ctx context.Context, accountID *string, direction, status string, detail map[string]any) {
	raw, _ := json.Marshal(detail)
	if _, err := s.db.Exec(ctx, `INSERT INTO shop.marketplace_sync_log (account_id, direction, status, detail)
		VALUES ($1::uuid, $2, $3, $4::jsonb)`, accountID, direction, status, string(raw)); err != nil {
		s.log.Error("[marketplace] sync log failed", "error", err)
	}
}

// AuthURL is the connect route: the Shopee auth_partner URL.
func (s *Service) AuthURL(origin string) (string, error) {
	sh, _ := s.resolveMarketplace("shopee")
	return sh.authURL(origin + "/api/shop/marketplace/callback")
}

// ConnectShopee is connectShopeeAccount: store the tokens of a new or
// reconnected shop.
func (s *Service) ConnectShopee(ctx context.Context, code, shopID string) error {
	sh, _ := s.resolveMarketplace("shopee")
	bundle, err := sh.exchangeCode(ctx, code, shopID)
	if err != nil {
		return err
	}
	if _, err := s.db.Exec(ctx, `INSERT INTO shop.marketplace_accounts (
		  channel_code, shop_id, access_token, refresh_token, token_expires_at, status
		) VALUES ('shopee', $1, $2, $3, $4, 'connected')
		ON CONFLICT (channel_code, shop_id) DO UPDATE SET
		  access_token = EXCLUDED.access_token,
		  refresh_token = EXCLUDED.refresh_token,
		  token_expires_at = EXCLUDED.token_expires_at,
		  status = 'connected',
		  updated_at = now()`, shopID, bundle.accessToken, bundle.refreshToken, bundle.expiresAt); err != nil {
		return err
	}
	s.logSync(ctx, nil, "auth", "ok", map[string]any{"shop_id": shopID})
	return nil
}

// ensureFreshToken refreshes a token that expires within 10 minutes and
// stores it; a failed refresh marks the account expired.
func (s *Service) ensureFreshToken(ctx context.Context, a *marketplaceAccount) (*marketplaceAccount, error) {
	var expires time.Time
	if a.TokenExpiresAt != nil {
		expires = *a.TokenExpiresAt
	}
	if a.AccessToken != nil && *a.AccessToken != "" && expires.Sub(s.now()) > 10*time.Minute {
		return a, nil
	}
	sh, err := s.resolveMarketplace(a.ChannelCode)
	if err != nil {
		return nil, err
	}
	bundle, err := sh.refreshToken(ctx, a)
	if err == nil {
		_, err = s.db.Exec(ctx, `UPDATE shop.marketplace_accounts
			SET access_token=$2, refresh_token=$3, token_expires_at=$4,
			    status='connected', updated_at=now()
			WHERE id = $1::uuid`, a.ID, bundle.accessToken, bundle.refreshToken, bundle.expiresAt)
	}
	if err != nil {
		if _, uerr := s.db.Exec(ctx, `UPDATE shop.marketplace_accounts SET status='expired', updated_at=now() WHERE id=$1::uuid`, a.ID); uerr != nil {
			s.log.Error("[marketplace] mark expired failed", "account", a.ID, "error", uerr)
		}
		return nil, err
	}
	fresh := *a
	fresh.AccessToken, fresh.RefreshToken, fresh.TokenExpiresAt, fresh.Status = &bundle.accessToken, &bundle.refreshToken, &bundle.expiresAt, "connected"
	return &fresh, nil
}

// Listings is the listings route: the account's Shopee listings.
func (s *Service) Listings(ctx context.Context, accountID string) ([]MarketplaceListing, error) {
	a, err := s.account(ctx, accountID)
	if err != nil {
		return nil, err
	}
	if a, err = s.ensureFreshToken(ctx, a); err != nil {
		return nil, err
	}
	sh, err := s.resolveMarketplace(a.ChannelCode)
	if err != nil {
		return nil, err
	}
	return sh.listListings(ctx, a)
}

// ListLinks is listMarketplaceLinks: the account's links with the product
// and SKU names.
func (s *Service) ListLinks(ctx context.Context, accountID string) ([]*Row, error) {
	links, err := queryRows(ctx, s.db, `SELECT l.* FROM shop.marketplace_links l
		WHERE l.account_id = $1::uuid ORDER BY l.created_at DESC`, accountID)
	if err != nil || len(links) == 0 {
		return links, err
	}
	var productIDs, skuIDs []string
	for _, l := range links {
		productIDs = append(productIDs, l.Str("product_id"))
		if id := l.Str("sku_id"); id != "" {
			skuIDs = append(skuIDs, id)
		}
	}
	products, skus, err := s.ports.Catalog.Labels(ctx, s.db, productIDs, skuIDs)
	if err != nil {
		return nil, err
	}
	out := make([]*Row, 0, len(links))
	for _, l := range links {
		name, ok := products[l.Str("product_id")]
		if !ok {
			continue // the inner join drops links without a product
		}
		l.Set("product_name", name)
		if sku, ok := skus[l.Str("sku_id")]; ok {
			l.Set("sku_name", sku.Name).Set("sku_code", sku.Code)
		} else {
			l.Set("sku_name", nil).Set("sku_code", nil)
		}
		out = append(out, l)
	}
	return out, nil
}

// LinkInput is linkCreateSchema after parsing.
type LinkInput struct {
	AccountID, ProductID, ItemID string
	SkuID, ModelID, ItemName     *string
}

// CreateLink is createMarketplaceLink: merchandise products only, one link
// per listing and per product/SKU.
func (s *Service) CreateLink(ctx context.Context, in LinkInput) (*Row, error) {
	kind, found, err := s.ports.Catalog.ProductKind(ctx, s.db, in.ProductID)
	if err != nil {
		return nil, err
	}
	if !found || kind != "merchandise" {
		return nil, httpx.BadRequest("Mapping hanya untuk produk merchandise")
	}
	// A savepoint keeps a duplicate from aborting a caller's transaction.
	var row *Row
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		var err error
		row, err = queryRow(ctx, tx, `INSERT INTO shop.marketplace_links (
			  account_id, product_id, sku_id, marketplace_item_id,
			  marketplace_model_id, marketplace_item_name
			) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)
			RETURNING *`, in.AccountID, in.ProductID, in.SkuID, in.ItemID, in.ModelID, in.ItemName)
		return err
	})
	if database.IsUniqueViolation(err) {
		return nil, httpx.Conflict("Listing/produk ini sudah dipetakan")
	}
	return row, err
}

// DeleteLink is deleteMarketplaceLink.
func (s *Service) DeleteLink(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM shop.marketplace_links WHERE id = $1::uuid`, id)
	return err
}

type link struct {
	id, productID string
	skuID         *string
	itemID        string
	modelID       *string
}

func (l link) key() string { return linkKey(l.itemID, l.modelID) }

func linkKey(itemID string, modelID *string) string {
	m := ""
	if modelID != nil {
		m = *modelID
	}
	return itemID + "::" + m
}

func (s *Service) accountLinks(ctx context.Context, accountID string) ([]link, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, product_id::text, sku_id::text, marketplace_item_id, marketplace_model_id
		FROM shop.marketplace_links WHERE account_id = $1::uuid`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []link
	for rows.Next() {
		var l link
		if err := rows.Scan(&l.id, &l.productID, &l.skuID, &l.itemID, &l.modelID); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// PushResult is pushAllStock's summary.
type PushResult struct {
	Pushed int `json:"pushed"`
	Failed int `json:"failed"`
}

// pushAllStock pushes every link's stock (local stock minus the buffer).
func (s *Service) pushAllStock(ctx context.Context, in *marketplaceAccount) (PushResult, error) {
	a, err := s.ensureFreshToken(ctx, in)
	if err != nil {
		return PushResult{}, err
	}
	sh, err := s.resolveMarketplace(a.ChannelCode)
	if err != nil {
		return PushResult{}, err
	}
	links, err := s.accountLinks(ctx, a.ID)
	if err != nil {
		return PushResult{}, err
	}
	var res PushResult
	for _, l := range links {
		err := func() error {
			local, err := s.ports.Catalog.LocalStock(ctx, s.db, l.productID, l.skuID)
			if err != nil {
				return err
			}
			stock := math.Max(0, numOr0(local)-float64(a.StockBuffer))
			if err := sh.pushStock(ctx, a, l.itemID, l.modelID, stock); err != nil {
				return err
			}
			_, err = s.db.Exec(ctx, `UPDATE shop.marketplace_links
				SET last_pushed_stock=$2, last_push_at=now(), updated_at=now()
				WHERE id = $1::uuid`, l.id, stock)
			return err
		}()
		if err != nil {
			res.Failed++
			s.log.Error("[marketplace] push stock failed", "link", l.id, "error", err)
			continue
		}
		res.Pushed++
	}
	status := "ok"
	if res.Failed > 0 {
		status = "error"
	}
	s.logSync(ctx, &a.ID, "push_stock", status, map[string]any{"pushed": res.Pushed, "failed": res.Failed, "total": len(links)})
	return res, nil
}

// PullResult is pullMarketplaceOrders' summary.
type PullResult struct {
	Imported    int `json:"imported"`
	Skipped     int `json:"skipped"`
	StockIssues int `json:"stockIssues"`
}

// pullOrders imports the account's paid orders since the last pull (15
// minutes of overlap; 3 days the first time).
func (s *Service) pullOrders(ctx context.Context, in *marketplaceAccount) (PullResult, error) {
	a, err := s.ensureFreshToken(ctx, in)
	if err != nil {
		return PullResult{}, err
	}
	sh, err := s.resolveMarketplace(a.ChannelCode)
	if err != nil {
		return PullResult{}, err
	}
	since := s.now().Add(-3 * 24 * time.Hour)
	if a.LastPullAt != nil {
		since = a.LastPullAt.Add(-15 * time.Minute)
	}
	orders, err := sh.pullOrders(ctx, a, since)
	if err != nil {
		return PullResult{}, err
	}
	linkRows, err := s.accountLinks(ctx, a.ID)
	if err != nil {
		return PullResult{}, err
	}
	links := map[string]link{}
	for _, l := range linkRows {
		links[l.key()] = l
	}

	var res PullResult
	for _, o := range orders {
		if !domain.MarketplaceImportable[o.status] {
			res.Skipped++
			continue
		}
		if err := s.importOrder(ctx, o, links, &res); err != nil {
			return PullResult{}, err
		}
	}
	if _, err := s.db.Exec(ctx, `UPDATE shop.marketplace_accounts SET last_pull_at=now(), updated_at=now()
		WHERE id = $1::uuid`, a.ID); err != nil {
		return PullResult{}, err
	}
	status := "ok"
	if res.StockIssues > 0 {
		status = "error"
	}
	s.logSync(ctx, &a.ID, "pull_orders", status, map[string]any{
		"imported": res.Imported, "skipped": res.Skipped, "stock_issues": res.StockIssues, "fetched": len(orders),
	})
	return res, nil
}

// importOrder records one Shopee order: an existing one only follows the
// status, a new one claims stock and is inserted with its items.
func (s *Service) importOrder(ctx context.Context, o marketplaceOrder, links map[string]link, res *PullResult) error {
	var existingID, existingStatus string
	err := s.db.QueryRow(ctx, `SELECT id::text, status FROM shop.orders WHERE marketplace_order_sn = $1`, o.orderSn).Scan(&existingID, &existingStatus)
	switch {
	case err == nil:
		mapped := domain.MarketplaceStatus[o.status]
		if mapped != "" && existingStatus != "cancelled" && existingStatus != "refund" && existingStatus != "completed" {
			if _, err := s.db.Exec(ctx, `UPDATE shop.orders SET status=$2, updated_at=now()
				WHERE id=$1::uuid AND status <> $2`, existingID, mapped); err != nil {
				return err
			}
		}
		res.Skipped++
		return nil
	case !database.IsNoRows(err):
		return err
	}

	claimed := true
	var missing []string
	for _, it := range o.items {
		l, ok := links[linkKey(it.itemID, it.modelID)]
		if !ok {
			missing = append(missing, it.itemName)
			claimed = false
			continue
		}
		success, _, err := s.ports.Stock.Sell(ctx, s.db, l.productID, l.skuID, it.quantity)
		if err != nil {
			return err
		}
		if success != nil && !*success {
			claimed = false
		}
	}
	if !claimed {
		res.StockIssues++
	}
	notes := []string{"Order Shopee " + o.orderSn + " (" + o.status + ")"}
	if len(missing) > 0 {
		notes = append(notes, "ITEM TANPA MAPPING: "+strings.Join(missing, ", "))
	}
	if !claimed {
		notes = append(notes, "PERHATIAN: stok lokal tidak terpotong penuh — rekonsiliasi manual")
	}
	status := domain.MarketplaceStatus[o.status]
	if status == "" {
		status = "paid"
	}
	name := "Pembeli Shopee"
	for _, n := range []*string{o.recipientName, o.buyerName} {
		if n != nil && *n != "" {
			name = *n
			break
		}
	}
	phone, address := "-", "Alamat dikelola Shopee"
	if o.recipientPh != nil && *o.recipientPh != "" {
		phone = *o.recipientPh
	}
	if o.fullAddress != nil && *o.fullAddress != "" {
		address = *o.fullAddress
	}
	var orderID string
	if err := s.db.QueryRow(ctx, `INSERT INTO shop.orders (
		  source_channel, marketplace_order_sn, status,
		  customer_name, customer_phone, shipping_address,
		  shipping_area_label, subtotal, shipping_cost, total, notes, paid_at
		) VALUES ('shopee', $1, $2, $3, $4, $5, 'Shopee', $6, 0, $6, $7, now())
		RETURNING id::text`, o.orderSn, status, name, phone, address, o.totalAmount, strings.Join(notes, "\n")).Scan(&orderID); err != nil {
		return err
	}
	for _, it := range o.items {
		var productID, skuID *string
		if l, ok := links[linkKey(it.itemID, it.modelID)]; ok {
			productID, skuID = &l.productID, l.skuID
		}
		if _, err := s.db.Exec(ctx, `INSERT INTO shop.order_items (
			  order_id, product_id, sku_id, product_name, quantity, unit_price, total
			) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7)`,
			orderID, productID, skuID, it.itemName, it.quantity, it.price, float64(it.price*it.quantity)); err != nil {
			return err
		}
	}
	res.Imported++
	return nil
}

// SyncResult is the sync route's data.
type SyncResult struct {
	Pull PullResult `json:"pull"`
	Push PushResult `json:"push"`
}

// Sync is the manual (or cron) sync of one account: pull first (orders take
// stock), then push the fresh stock.
func (s *Service) Sync(ctx context.Context, accountID string) (SyncResult, error) {
	a, err := s.account(ctx, accountID)
	if err != nil {
		return SyncResult{}, err
	}
	if a.Status == "disconnected" {
		return SyncResult{}, httpx.BadRequest("Akun terputus — hubungkan ulang")
	}
	pull, err := s.pullOrders(ctx, a)
	if err != nil {
		return SyncResult{}, err
	}
	push, err := s.pushAllStock(ctx, a)
	if err != nil {
		return SyncResult{}, err
	}
	return SyncResult{Pull: pull, Push: push}, nil
}
