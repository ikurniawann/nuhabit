package sales

import (
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// Routes lists the sale routes. GET /api/pos/orders/{id}/payment-proof
// stays in TS (it reads Next's local private storage).
func (h *Handler) Routes() []module.Route {
	r := func(pattern string, fn httpx.HandlerFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(fn)}
	}
	return []module.Route{
		r("GET /api/pos/orders", h.listOrders),
		r("POST /api/pos/orders", h.createOrder),
		r("POST /api/pos/orders/open-bill", h.openBill),
		r("GET /api/pos/orders/{id}", h.getOrder),
		r("PATCH /api/pos/orders/{id}", h.patchOrder),
		r("POST /api/pos/orders/{id}/accept", h.acceptOrder),
		r("POST /api/pos/orders/{id}/merge", h.mergeOrders),
		r("POST /api/pos/orders/{id}/pre-settle", h.preSettle),
		r("PATCH /api/pos/orders/{id}/status", h.updateKitchenStatus),
		r("POST /api/pos/orders/{id}/transfer-items", h.transferItems),
		r("PATCH /api/pos/orders/{id}/table", h.moveTable),
		r("POST /api/pos/orders/{id}/void", h.voidOrder),
		r("POST /api/pos/orders/{id}/send-wa", h.sendReceiptWa),
		r("GET /api/pos/orders/{id}/splits", h.listSplits),
		r("POST /api/pos/orders/{id}/splits", h.createSplits),
		r("PATCH /api/pos/orders/{id}/splits/{splitId}", h.cancelSplit),
		r("POST /api/pos/orders/{id}/splits/{splitId}/pay", h.paySplit),

		r("POST /api/pos/checkouts", h.createCheckout),
		r("GET /api/pos/checkouts/{id}", h.getCheckout),
		r("POST /api/pos/checkouts/{id}/cancel", h.cancelCheckout),
		r("POST /api/pos/checkouts/{id}/complete", h.completeCheckout),

		r("POST /api/pos/qris", h.createQris),
		r("GET /api/pos/qris/{id}/status", h.qrisStatus),

		r("GET /api/pos/supervisors", h.listSupervisors),
		r("POST /api/pos/supervisors", h.updateSupervisor),
	}
}
