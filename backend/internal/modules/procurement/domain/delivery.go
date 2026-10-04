package domain

import (
	"fmt"
	"slices"
	"strings"
)

// Delivery statuses: pending → shipped → in_transit → delivered; anything
// but delivered may be cancelled.
const (
	DeliveryPending   = "pending"
	DeliveryShipped   = "shipped"
	DeliveryInTransit = "in_transit"
	DeliveryDelivered = "delivered"
	DeliveryCancelled = "cancelled"
)

var openDeliveryStatuses = []string{DeliveryPending, DeliveryShipped, DeliveryInTransit}

// IsOpenDeliveryStatus: a delivery still in progress blocks another one.
func IsOpenDeliveryStatus(status string) bool {
	return slices.Contains(openDeliveryStatuses, strings.ToLower(status))
}

// PoDeliveryEligibleStatuses are the PO statuses that accept a delivery.
var PoDeliveryEligibleStatuses = []string{PoApproved, PoSent, PoPartiallyReceived}

// IsPoStatusEligibleForDelivery is isPoStatusEligibleForDelivery.
func IsPoStatusEligibleForDelivery(status string) bool {
	return slices.Contains(PoDeliveryEligibleStatuses, strings.ToLower(status))
}

var deliveryTransitions = map[string][]string{
	DeliveryPending:   {DeliveryShipped, DeliveryInTransit, DeliveryCancelled},
	DeliveryShipped:   {DeliveryInTransit, DeliveryCancelled},
	DeliveryInTransit: {DeliveryDelivered, DeliveryCancelled},
	DeliveryDelivered: {},
	DeliveryCancelled: {},
}

// DeliveryTransitionError is validateDeliveryTransition's message, "" when allowed.
func DeliveryTransitionError(from, to string) string {
	allowed, known := deliveryTransitions[from]
	if known && slices.Contains(allowed, to) {
		return ""
	}
	list := strings.Join(allowed, ", ")
	if list == "" {
		list = "none"
	}
	return fmt.Sprintf("Invalid delivery transition: %s → %s. Allowed: %s", from, to, list)
}
