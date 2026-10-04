package app

import (
	"nuhabit/backend/internal/modules/shop"
	"nuhabit/backend/internal/platform/module"
)

// shop: the online shop storefront, orders, shipping and the Shopee
// marketplace sync (/api/shop/**, /api/public/shop/**).
func init() {
	Register(shop.Name, func(d module.Deps) module.Module {
		return shop.New(d, ShopPorts(d))
	})
}
