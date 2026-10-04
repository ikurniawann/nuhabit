package salesfunnel

import (
	"context"

	contract "nuhabit/backend/internal/contracts/salesfunnel"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/outbox"
)

// crmEvent is CrmEventInput.
type crmEvent struct {
	eventType, subjectType, subjectID string
	companyID, branchID               string
	actorID                           string
	payload                           map[string]any
	changes                           map[string]any
}

// emit publishes the CRM event emitCrmEvent ran inline (rule 3: crm_events,
// workflow rules and lead scoring belong to CRM and nothing in the response
// reads them).
func emit(ctx context.Context, q database.Querier, e crmEvent) error {
	payload := e.payload
	if payload == nil {
		payload = map[string]any{}
	}
	return outbox.Publish(ctx, q, contract.TopicCrmEventRaised, e.subjectType+":"+e.subjectID, contract.CrmEventRaised{
		EventType: e.eventType, SubjectType: e.subjectType, SubjectID: e.subjectID,
		CompanyID: &e.companyID, BranchID: &e.branchID, ActorUserID: &e.actorID,
		Payload: payload, Changes: e.changes,
	})
}

// requestApproval publishes syncQuotationApproval for CRM.
func requestApproval(ctx context.Context, q database.Querier, quotationID, userID string) error {
	return outbox.Publish(ctx, q, contract.TopicQuotationPriced, quotationID,
		contract.QuotationPriced{QuotationID: quotationID, RequestedBy: userID})
}
