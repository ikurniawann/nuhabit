// Package posops is the event contract of the pos-ops context (shifts,
// tables, catalog, POS customers and settings). pos-ops owns this file:
// add fields, never repurpose them.
package posops

// TopicCustomerEnrolled fires when the cashier's customer dialog asks to
// enroll the customer as a CRM member (POST /api/pos/customers with
// enroll_member). The CRM subscriber upserts crm_member_profiles on
// customer_id as the TS route did inline: tier by TierCode, falling back to
// the 'regular' tier (skip when neither exists), lifetime_xp and
// loyalty_score = LifetimeXp, status 'active',
// metadata {source: "pos_customer_modal", enrolled_by}, last_activity_at =
// EnrolledAt. Failures were swallowed in the TS, so the customer save never
// depends on it.
const TopicCustomerEnrolled = "pos.customer.enrolled"

// CustomerEnrolled is the TopicCustomerEnrolled payload.
type CustomerEnrolled struct {
	CustomerID string  `json:"customer_id"`
	TierCode   string  `json:"tier_code"`
	LifetimeXp float64 `json:"lifetime_xp"`
	EnrolledBy string  `json:"enrolled_by"`
	EnrolledAt string  `json:"enrolled_at"` // ISO 8601
}
