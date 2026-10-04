package shop

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/shop/domain"
)

// The Shopee Open Platform v2 adapter (lib/shop/marketplace/shopee.ts).
// Partner credentials come from SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY and
// SHOPEE_API_BASE (production by default). Signatures:
//   - public API (auth/token): HMAC-SHA256(key, partner_id+path+timestamp)
//   - shop API: HMAC-SHA256(key, partner_id+path+timestamp+access_token+shop_id)

const shopeeDefaultBase = "https://partner.shopeemobile.com"

// marketplaceAccount is MarketplaceAccountRow.
type marketplaceAccount struct {
	ID             string
	ChannelCode    string
	ShopID         string
	AccessToken    *string
	RefreshToken   *string
	TokenExpiresAt *time.Time
	Status         string
	StockBuffer    int
	LastPullAt     *time.Time
}

// tokenBundle is TokenBundle.
type tokenBundle struct {
	accessToken, refreshToken string
	expiresAt                 time.Time
}

// MarketplaceListing is MarketplaceListing.
type MarketplaceListing struct {
	ItemID   string             `json:"itemId"`
	ItemName string             `json:"itemName"`
	Models   []MarketplaceModel `json:"models"`
}

// MarketplaceModel is one variation of a listing.
type MarketplaceModel struct {
	ModelID   string  `json:"modelId"`
	ModelName string  `json:"modelName"`
	ModelSku  *string `json:"modelSku"`
}

type marketplaceOrderItem struct {
	itemID   string
	modelID  *string
	itemName string
	quantity float64
	price    float64
}

type marketplaceOrder struct {
	orderSn                               string
	status                                string
	buyerName, recipientName, recipientPh *string
	fullAddress                           *string
	totalAmount                           float64
	items                                 []marketplaceOrderItem
}

type shopee struct{ s *Service }

// resolveMarketplace is resolveMarketplaceAdapter: Shopee only.
func (s *Service) resolveMarketplace(channel string) (shopee, error) {
	if channel == "shopee" {
		return shopee{s}, nil
	}
	return shopee{}, providerError("Channel marketplace tidak dikenal: "+channel, 400)
}

func (sh shopee) env(name string) (string, error) {
	if v := sh.s.ports.Getenv(name); v != "" {
		return v, nil
	}
	return "", providerError(name+" belum dikonfigurasi di environment server", 503)
}

func (sh shopee) base() string {
	if v := sh.s.ports.Getenv("SHOPEE_API_BASE"); v != "" {
		return v
	}
	return shopeeDefaultBase
}

func (sh shopee) sign(path string, timestamp int64, accessToken, shopID string) (string, error) {
	partnerID, err := sh.env("SHOPEE_PARTNER_ID")
	if err != nil {
		return "", err
	}
	key, err := sh.env("SHOPEE_PARTNER_KEY")
	if err != nil {
		return "", err
	}
	base := partnerID + path + strconv.FormatInt(timestamp, 10)
	if accessToken != "" && shopID != "" {
		base += accessToken + shopID
	}
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(base))
	return hex.EncodeToString(mac.Sum(nil)), nil
}

type shopeeCall struct {
	method  string
	query   [][2]string
	body    any
	account *marketplaceAccount
}

// fetch is shopeeFetch: signed query, 20 s timeout, an `error` field or a
// non-2xx status is a MarketplaceError.
func (sh shopee) fetch(ctx context.Context, path string, c shopeeCall) (map[string]any, error) {
	timestamp := sh.s.now().Unix()
	partnerID, err := sh.env("SHOPEE_PARTNER_ID")
	if err != nil {
		return nil, err
	}
	params := [][2]string{{"partner_id", partnerID}, {"timestamp", strconv.FormatInt(timestamp, 10)}}
	if c.account != nil {
		if c.account.AccessToken == nil || *c.account.AccessToken == "" {
			return nil, providerError("Toko belum terhubung (token kosong)", 401)
		}
		sig, err := sh.sign(path, timestamp, *c.account.AccessToken, c.account.ShopID)
		if err != nil {
			return nil, err
		}
		params = append(params, [2]string{"access_token", *c.account.AccessToken}, [2]string{"shop_id", c.account.ShopID}, [2]string{"sign", sig})
	} else {
		sig, err := sh.sign(path, timestamp, "", "")
		if err != nil {
			return nil, err
		}
		params = append(params, [2]string{"sign", sig})
	}
	params = append(params, c.query...)
	var body io.Reader
	if c.body != nil {
		raw, _ := json.Marshal(c.body)
		body = bytes.NewReader(raw)
	}
	method := c.method
	if method == "" {
		method = http.MethodGet
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	status, data, err := sh.s.fetchJSON(ctx, method, sh.base()+path+"?"+encodeParams(params), body,
		map[string]string{"content-type": "application/json"})
	if err != nil {
		return nil, err
	}
	if !ok2xx(status) || domain.JSTruthy(data["error"]) {
		reason := firstText(data["error"])
		if reason == "" {
			reason = "HTTP " + strconv.Itoa(status)
		}
		return nil, providerError(strings.TrimSpace("Shopee " + path + ": " + reason + " " + text(data["message"])))
	}
	return data, nil
}

// encodeParams is URLSearchParams#toString with insertion order kept.
func encodeParams(params [][2]string) string {
	parts := make([]string, len(params))
	for i, p := range params {
		parts[i] = url.QueryEscape(p[0]) + "=" + url.QueryEscape(p[1])
	}
	return strings.Join(parts, "&")
}

// authURL is buildAuthUrl.
func (sh shopee) authURL(redirect string) (string, error) {
	const path = "/api/v2/shop/auth_partner"
	timestamp := sh.s.now().Unix()
	partnerID, err := sh.env("SHOPEE_PARTNER_ID")
	if err != nil {
		return "", err
	}
	sig, err := sh.sign(path, timestamp, "", "")
	if err != nil {
		return "", err
	}
	return sh.base() + path + "?" + encodeParams([][2]string{
		{"partner_id", partnerID}, {"timestamp", strconv.FormatInt(timestamp, 10)}, {"sign", sig}, {"redirect", redirect},
	}), nil
}

func (sh shopee) tokenBundle(data map[string]any, failMsg string, failStatus int) (tokenBundle, error) {
	access, refresh := text(data["access_token"]), text(data["refresh_token"])
	if access == "" || refresh == "" {
		return tokenBundle{}, providerError(failMsg, failStatus)
	}
	expireIn := toNumber(data["expire_in"])
	if expireIn == 0 {
		expireIn = 14400
	}
	return tokenBundle{access, refresh, sh.s.now().Add(time.Duration(expireIn * float64(time.Second)))}, nil
}

// exchangeCode trades the redirect code for the shop's tokens.
func (sh shopee) exchangeCode(ctx context.Context, code, shopID string) (tokenBundle, error) {
	partnerID, err := sh.env("SHOPEE_PARTNER_ID")
	if err != nil {
		return tokenBundle{}, err
	}
	data, err := sh.fetch(ctx, "/api/v2/auth/token/get", shopeeCall{method: http.MethodPost, body: map[string]any{
		"code": code, "shop_id": domain.JSNumber(shopID), "partner_id": domain.JSNumber(partnerID),
	}})
	if err != nil {
		return tokenBundle{}, err
	}
	return sh.tokenBundle(data, "Shopee tidak mengembalikan token — coba otorisasi ulang", 502)
}

func (sh shopee) refreshToken(ctx context.Context, a *marketplaceAccount) (tokenBundle, error) {
	if a.RefreshToken == nil || *a.RefreshToken == "" {
		return tokenBundle{}, providerError("Refresh token kosong — hubungkan ulang toko", 401)
	}
	partnerID, err := sh.env("SHOPEE_PARTNER_ID")
	if err != nil {
		return tokenBundle{}, err
	}
	data, err := sh.fetch(ctx, "/api/v2/auth/access_token/get", shopeeCall{method: http.MethodPost, body: map[string]any{
		"refresh_token": *a.RefreshToken, "shop_id": domain.JSNumber(a.ShopID), "partner_id": domain.JSNumber(partnerID),
	}})
	if err != nil {
		return tokenBundle{}, err
	}
	return sh.tokenBundle(data, "Refresh token Shopee gagal — hubungkan ulang toko", 401)
}

// listListings is listListings: at most 5 pages of 50 items.
func (sh shopee) listListings(ctx context.Context, a *marketplaceAccount) ([]MarketplaceListing, error) {
	out := []MarketplaceListing{}
	offset := 0.0
	for page := 0; page < 5; page++ {
		lst, err := sh.fetch(ctx, "/api/v2/product/get_item_list", shopeeCall{account: a, query: [][2]string{
			{"offset", domain.JSString(offset)}, {"page_size", "50"}, {"item_status", "NORMAL"},
		}})
		if err != nil {
			return nil, err
		}
		resp := lst["response"]
		items := list(field(resp, "item"))
		if len(items) == 0 {
			break
		}
		ids := make([]string, len(items))
		for i, it := range items {
			ids[i] = domain.JSString(field(it, "item_id"))
		}
		info, err := sh.fetch(ctx, "/api/v2/product/get_item_base_info", shopeeCall{account: a, query: [][2]string{{"item_id_list", strings.Join(ids, ",")}}})
		if err != nil {
			return nil, err
		}
		for _, it := range list(field(info["response"], "item_list")) {
			itemID := domain.JSString(field(it, "item_id"))
			listing := MarketplaceListing{ItemID: itemID, ItemName: firstText(field(it, "item_name")), Models: []MarketplaceModel{}}
			if listing.ItemName == "" {
				listing.ItemName = itemID
			}
			if domain.JSTruthy(field(it, "has_model")) {
				models, err := sh.fetch(ctx, "/api/v2/product/get_model_list", shopeeCall{account: a, query: [][2]string{{"item_id", itemID}}})
				if err != nil {
					return nil, err
				}
				for _, m := range list(field(models["response"], "model")) {
					id := domain.JSString(field(m, "model_id"))
					name := firstText(field(m, "model_name"))
					if name == "" {
						name = id
					}
					var sku *string
					if v := text(field(m, "model_sku")); v != "" {
						sku = &v
					}
					listing.Models = append(listing.Models, MarketplaceModel{ModelID: id, ModelName: name, ModelSku: sku})
				}
			}
			out = append(out, listing)
		}
		if !domain.JSTruthy(field(resp, "has_next_page")) {
			break
		}
		if next := toNumber(field(resp, "next_offset")); next != 0 {
			offset = next
		} else {
			offset += 50
		}
	}
	return out, nil
}

// pushStock sets one listing's stock (model 0 = an item without variations).
func (sh shopee) pushStock(ctx context.Context, a *marketplaceAccount, itemID string, modelID *string, stock float64) error {
	model := 0.0
	if modelID != nil && *modelID != "" {
		model = domain.JSNumber(*modelID)
	}
	_, err := sh.fetch(ctx, "/api/v2/product/update_stock", shopeeCall{account: a, method: http.MethodPost, body: map[string]any{
		"item_id": domain.JSNumber(itemID),
		"stock_list": []map[string]any{{
			"model_id": model, "seller_stock": []map[string]any{{"stock": math.Max(0, math.Floor(stock))}},
		}},
	}})
	return err
}

// pullOrders lists the orders updated since `since` with their details.
func (sh shopee) pullOrders(ctx context.Context, a *marketplaceAccount, since time.Time) ([]marketplaceOrder, error) {
	lst, err := sh.fetch(ctx, "/api/v2/order/get_order_list", shopeeCall{account: a, query: [][2]string{
		{"time_range_field", "update_time"},
		{"time_from", strconv.FormatInt(int64(math.Floor(float64(since.UnixMilli())/1000)), 10)},
		{"time_to", strconv.FormatInt(sh.s.now().Unix(), 10)},
		{"page_size", "50"},
	}})
	if err != nil {
		return nil, err
	}
	var sns []string
	for _, o := range list(field(lst["response"], "order_list")) {
		sns = append(sns, domain.JSString(field(o, "order_sn")))
	}
	if len(sns) == 0 {
		return nil, nil
	}
	detail, err := sh.fetch(ctx, "/api/v2/order/get_order_detail", shopeeCall{account: a, query: [][2]string{
		{"order_sn_list", strings.Join(sns, ",")},
		{"response_optional_fields", "item_list,recipient_address,total_amount,buyer_username"},
	}})
	if err != nil {
		return nil, err
	}
	var out []marketplaceOrder
	for _, o := range list(field(detail["response"], "order_list")) {
		addr := field(o, "recipient_address")
		mo := marketplaceOrder{
			orderSn: domain.JSString(field(o, "order_sn")), status: text(field(o, "order_status")),
			buyerName: optText(field(o, "buyer_username")), recipientName: optText(field(addr, "name")),
			recipientPh: optText(field(addr, "phone")), fullAddress: optText(field(addr, "full_address")),
			totalAmount: toNumber(field(o, "total_amount")),
		}
		for _, it := range list(field(o, "item_list")) {
			itemID := domain.JSString(field(it, "item_id"))
			name := firstText(field(it, "item_name"))
			if name == "" {
				name = itemID
			}
			qty := toNumber(field(it, "model_quantity_purchased"))
			if qty == 0 {
				qty = 1
			}
			var model *string
			if domain.JSTruthy(field(it, "model_id")) {
				v := domain.JSString(field(it, "model_id"))
				model = &v
			}
			mo.items = append(mo.items, marketplaceOrderItem{itemID: itemID, modelID: model, itemName: name,
				quantity: qty, price: toNumber(field(it, "model_discounted_price"))})
		}
		out = append(out, mo)
	}
	return out, nil
}
