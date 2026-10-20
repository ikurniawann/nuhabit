// Package gym is the event contract of the gym contexts (scheduling and
// credits).
package gym

// TopicMemberNotified is a gym notification that the publisher already
// stored in the member inbox (crm.member_notifications, same transaction).
// The CRM subscriber delivers it outside the app: web push to the member's
// devices, and WhatsApp or email where the member has not opted out.
const TopicMemberNotified = "gym.member.notified"

// MemberNotified is the inbox row's content.
type MemberNotified struct {
	CustomerID string `json:"customer_id"`
	Type       string `json:"type"`
	Title      string `json:"title"`
	Body       string `json:"body"`
}
