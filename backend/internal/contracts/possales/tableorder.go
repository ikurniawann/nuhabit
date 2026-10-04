package possales

// TopicCustomerOrderRecorded is a paid order of a member:
// syncPosCustomerOrderStats (lib/crm/loyalty-tier-sync.ts) adds Amount to
// pos_customers.total_spent, one visit_count, and stamps last_visit. Published
// by table self-order (ARK Coin orders, and QRIS orders settled by the status
// poll).
const TopicCustomerOrderRecorded = "pos.customer_order.recorded"

// CustomerOrderRecorded is the payload of TopicCustomerOrderRecorded.
type CustomerOrderRecorded struct {
	CustomerID string  `json:"customer_id"`
	OrderID    string  `json:"order_id"`
	Amount     float64 `json:"amount"`
}
