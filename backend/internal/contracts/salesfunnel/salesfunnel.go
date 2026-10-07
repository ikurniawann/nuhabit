// Package salesfunnel holds the events the sales-funnel module publishes.
package salesfunnel

// TopicCrmEventRaised: a lead, deal, task or quotation changed. CRM records
// it in crm.crm_events, runs the matching workflow rules and rescores the
// affected lead (emitting lead.score_changed when the score moved), as
// lib/crm/events.ts emitCrmEvent did inline after the write.
const TopicCrmEventRaised = "salesfunnel.crm_event.raised"

// CrmEventRaised is the payload of TopicCrmEventRaised (CrmEventInput).
// Payload and Changes are JSON objects; Changes maps a field to
// {"from": old, "to": new} ("from" absent when the field was not read).
type CrmEventRaised struct {
	EventType   string         `json:"event_type"`
	SubjectType string         `json:"subject_type"`
	SubjectID   string         `json:"subject_id"`
	CompanyID   *string        `json:"company_id"`
	BranchID    *string        `json:"branch_id"`
	ActorUserID *string        `json:"actor_user_id"`
	Payload     map[string]any `json:"payload"`
	Changes     map[string]any `json:"changes,omitempty"`
}

// TopicQuotationPriced: a quotation was created, revised or its items and
// discount changed. CRM re-syncs its discount approval
// (lib/crm/approvals-server.ts syncQuotationApproval: approval request,
// steps, quotation approval_status/approval_request_id, approver
// notifications). Published before the TopicCrmEventRaised of the same
// change, in the TS order.
const TopicQuotationPriced = "salesfunnel.quotation.priced"

// QuotationPriced is the payload of TopicQuotationPriced.
type QuotationPriced struct {
	QuotationID string `json:"quotation_id"`
	RequestedBy string `json:"requested_by"`
}

// LeadSources are the values crm_sales_leads_source_check accepts. CRM's
// public forms and the sales-funnel module both validate against them.
var LeadSources = []string{"wa", "instagram", "referral", "google", "pameran", "canvassing", "website", "lainnya"}
