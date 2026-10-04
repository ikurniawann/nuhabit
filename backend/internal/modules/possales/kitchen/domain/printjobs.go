package domain

import (
	"encoding/json"
	"time"
)

// PrintOrder is the order slice buildKitchenPrintJobs reads. Fill it from the
// pos.pos_orders row the caller just inserted (or settled).
type PrintOrder struct {
	ID          string  // order.id
	OrderNumber string  // order.order_number
	QueueNumber string  // order.queue_number; "" is written as null (`|| null`)
	OrderType   string  // order.order_type
	TableID     *string // order.table_id; nil is written as null
	// RequestedAt is the `new Date()` the TS stamps into payload.requested_at.
	// Pass deps.Now(); the zero value falls back to time.Now().
	RequestedAt time.Time
}

// PrintItem is KitchenPrintItem: one pos.pos_order_items row (inserted, or the
// row about to be inserted when the TS falls back to the input items).
type PrintItem struct {
	ID           *string         // item.id; nil (row not inserted yet) is omitted from the payload
	ProductID    *string         // nil is written as null
	ProductName  *string         // nil is written as null
	ProductSKU   *string         // nil is written as null
	Variants     json.RawMessage // jsonb as stored; nil/null becomes []
	Modifiers    json.RawMessage // jsonb as stored; nil/null becomes []
	Quantity     float64         // Number(quantity); 0 becomes 1 (`|| 1`)
	UnitPrice    float64         // Number(unit_price) || 0
	TotalAmount  float64         // Number(total_amount) || 0
	Station      string          // item.station ("" for null)
	KitchenNotes string          // item.kitchen_notes ("" for null)
}

// PrintJobRow is one row for INSERT INTO pos.pos_print_jobs (order_id,
// station, job_type, status, payload), the columns and values the TS inserts.
type PrintJobRow struct {
	OrderID string
	Station string
	JobType string // "bar_ticket" for the bar, else "kitchen_ticket"
	Status  string // always "pending"
	Payload PrintJobPayload
}

// PrintJobPayload is the payload jsonb, keys in the TS order.
type PrintJobPayload struct {
	OrderID     string             `json:"order_id"`
	OrderNumber string             `json:"order_number"`
	QueueNumber *string            `json:"queue_number"`
	OrderType   string             `json:"order_type"`
	TableID     *string            `json:"table_id"`
	Station     string             `json:"station"`
	RequestedAt string             `json:"requested_at"`
	Items       []PrintPayloadItem `json:"items"`
}

// PrintPayloadItem is one entry of payload.items.
type PrintPayloadItem struct {
	ID          *string         `json:"id,omitempty"`
	ProductID   *string         `json:"product_id"`
	ProductName *string         `json:"product_name"`
	ProductSKU  *string         `json:"product_sku"`
	Variants    json.RawMessage `json:"variants"`
	Modifiers   json.RawMessage `json:"modifiers"`
	Quantity    float64         `json:"quantity"`
	UnitPrice   float64         `json:"unit_price"`
	TotalAmount float64         `json:"total_amount"`
	Notes       string          `json:"notes"`
}

// JobTypeForStation is the job_type default of the TS: bar tickets for the
// bar, kitchen tickets for every other station.
func JobTypeForStation(station string) string {
	if station == "bar" {
		return "bar_ticket"
	}
	return "kitchen_ticket"
}

// BuildKitchenPrintJobs is buildKitchenPrintJobs(order, insertedItems): one
// pending job per station, stations in first-seen item order, merchandise and
// photobooth items skipped. It returns nil when no item reaches a station.
func BuildKitchenPrintJobs(order PrintOrder, items []PrintItem) []PrintJobRow {
	requestedAt := order.RequestedAt
	if requestedAt.IsZero() {
		requestedAt = time.Now()
	}
	var queue *string
	if order.QueueNumber != "" {
		queue = &order.QueueNumber
	}

	var stations []string
	groups := map[string][]PrintItem{}
	for _, item := range items {
		station := NormalizeStation(item.Station, derefOr(item.ProductName), item.KitchenNotes)
		if station == "merchandise" || station == "photobooth" {
			continue
		}
		if _, ok := groups[station]; !ok {
			stations = append(stations, station)
		}
		groups[station] = append(groups[station], item)
	}

	var rows []PrintJobRow
	for _, station := range stations {
		payloadItems := make([]PrintPayloadItem, 0, len(groups[station]))
		for _, item := range groups[station] {
			quantity := item.Quantity
			if quantity == 0 {
				quantity = 1
			}
			payloadItems = append(payloadItems, PrintPayloadItem{
				ID:          item.ID,
				ProductID:   item.ProductID,
				ProductName: item.ProductName,
				ProductSKU:  item.ProductSKU,
				Variants:    jsonOrEmptyArray(item.Variants),
				Modifiers:   jsonOrEmptyArray(item.Modifiers),
				Quantity:    quantity,
				UnitPrice:   item.UnitPrice,
				TotalAmount: item.TotalAmount,
				Notes:       item.KitchenNotes,
			})
		}
		rows = append(rows, PrintJobRow{
			OrderID: order.ID,
			Station: station,
			JobType: JobTypeForStation(station),
			Status:  "pending",
			Payload: PrintJobPayload{
				OrderID:     order.ID,
				OrderNumber: order.OrderNumber,
				QueueNumber: queue,
				OrderType:   order.OrderType,
				TableID:     order.TableID,
				Station:     station,
				RequestedAt: requestedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
				Items:       payloadItems,
			},
		})
	}
	return rows
}

func derefOr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// jsonOrEmptyArray is `value || []` for a jsonb value: a missing value or a
// falsy JSON scalar (null, false, 0, "") becomes []; arrays and objects are
// truthy in JS and kept as they are.
func jsonOrEmptyArray(v json.RawMessage) json.RawMessage {
	if len(v) == 0 || !truthy(v) {
		return json.RawMessage("[]")
	}
	return v
}

// truthy is JS truthiness of a decoded JSON value.
func truthy(v json.RawMessage) bool {
	var x any
	if json.Unmarshal(v, &x) != nil {
		return false
	}
	switch t := x.(type) {
	case nil:
		return false
	case bool:
		return t
	case float64:
		return t != 0
	case string:
		return t != ""
	}
	return true
}
