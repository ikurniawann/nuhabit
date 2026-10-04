package domain

import (
	"math"
	"slices"
	"strings"
)

// FnbStations is FNB_STATIONS: the stations the kitchen display shows.
var FnbStations = []string{"kitchen", "bar", "bakery", "dessert"}

var terminalKitchenStatuses = []string{"served", "cancelled"}

// kitchenStatusByOrderStatus is KITCHEN_STATUS_BY_ORDER_STATUS.
var kitchenStatusByOrderStatus = map[string]string{
	"pending":   "pending",
	"confirmed": "confirmed",
	"preparing": "preparing",
	"ready":     "ready",
	"served":    "served",
	"completed": "served",
	"cancelled": "cancelled",
}

var statusRank = map[string]int{
	"pending":   0,
	"confirmed": 1,
	"preparing": 2,
	"ready":     3,
	"served":    4,
	"completed": 4,
	"cancelled": 5,
}

// KitchenItem is KitchenItemRef: the item fields the status rules read.
// "" stands for a NULL station or kitchen_status.
type KitchenItem struct {
	ID            string
	Station       string
	KitchenStatus string
}

// MapOrderStatusToKitchenStatus maps an order bump to the item kitchen_status
// ("" counts as "pending"; unknown statuses map to "pending"). It never
// returns "".
func MapOrderStatusToKitchenStatus(status string) string {
	if status == "" {
		status = "pending"
	}
	if v, ok := kitchenStatusByOrderStatus[strings.ToLower(status)]; ok {
		return v
	}
	return "pending"
}

// IsFnbStation reports whether station (any case) is a food & beverage station.
func IsFnbStation(station string) bool {
	return slices.Contains(FnbStations, strings.ToLower(station))
}

// IsTerminalKitchenStatus reports served/cancelled (any case).
func IsTerminalKitchenStatus(status string) bool {
	return slices.Contains(terminalKitchenStatuses, strings.ToLower(status))
}

// DeriveStationStatus is deriveStationStatus(items, station): the least
// advanced status among the active F&B items (of station, when not ""), with
// "completed" read as "served"; "served" when no item is active.
func DeriveStationStatus(items []KitchenItem, station string) string {
	wanted := strings.ToLower(station)
	minRank := math.MaxInt
	status := ""
	for _, item := range items {
		itemStation := strings.ToLower(item.Station)
		if !IsFnbStation(itemStation) || (wanted != "" && itemStation != wanted) || IsTerminalKitchenStatus(item.KitchenStatus) {
			continue
		}
		value := strings.ToLower(item.KitchenStatus)
		if value == "" {
			value = "pending"
		}
		rank, ok := statusRank[value]
		if !ok {
			rank = 0
		}
		if rank < minRank {
			minRank = rank
			status = value
			if value == "completed" {
				status = "served"
			}
		}
	}
	if status == "" {
		return "served"
	}
	return status
}

// DeriveOrderKitchenStatus is deriveOrderKitchenStatus(items, paymentStatus):
// the kitchen workflow of the F&B items decides the order status, and payment
// only turns a fully served order into "completed". Note the return order
// (orderStatus first) differs from the TS object { kitchenStatus, orderStatus }.
func DeriveOrderKitchenStatus(items []KitchenItem, paymentStatus string) (orderStatus, kitchenStatus string) {
	var fnb []KitchenItem
	for _, item := range items {
		if IsFnbStation(item.Station) {
			fnb = append(fnb, item)
		}
	}
	paid := strings.ToLower(paymentStatus) == "paid"

	if len(fnb) == 0 {
		if paid {
			return "completed", "served"
		}
		return "pending", "served"
	}
	allTerminal := true
	for _, item := range fnb {
		if !IsTerminalKitchenStatus(item.KitchenStatus) {
			allTerminal = false
			break
		}
	}
	if allTerminal {
		if paid {
			return "completed", "served"
		}
		return "served", "served"
	}
	kitchenStatus = DeriveStationStatus(fnb, "")
	return kitchenStatus, kitchenStatus
}
