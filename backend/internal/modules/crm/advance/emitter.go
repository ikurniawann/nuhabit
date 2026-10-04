package advance

import (
	"context"
	"errors"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// Emitter exposes the CRM event engine (emitCrmEvent) and notifyUsers to
// sibling CRM areas, such as the public web-to-lead forms.
type Emitter struct{ h *handler }

// NewEmitter builds the engine on db (the pool, or a test transaction);
// nil ports fall back to the stopgap adapters like Routes.
func NewEmitter(db database.DB, d module.Deps, p Ports) Emitter {
	return Emitter{h: newHandler(db, d, p)}
}

// Event is CrmEventInput.
type Event struct {
	EventType, SubjectType, SubjectID string
	CompanyID, BranchID               *string
	Payload                           map[string]any
	ActorUserID                       *string
}

// Emit is emitCrmEvent: best effort, failures are logged.
func (e Emitter) Emit(ctx context.Context, ev Event) {
	e.h.emitCrmEvent(ctx, crmEvent{
		EventType: ev.EventType, SubjectType: ev.SubjectType, SubjectID: ev.SubjectID,
		CompanyID: ev.CompanyID, BranchID: ev.BranchID, Payload: ev.Payload, ActorUserID: ev.ActorUserID,
	})
}

// NotifyUsers is notifyUsers: one in-app alert per distinct user.
func (e Emitter) NotifyUsers(ctx context.Context, userIDs []string, title, message string, link *string, metadata map[string]any) (int, error) {
	return e.h.notifyUsers(ctx, e.h.db, userIDs, title, message, link, metadata)
}

// EmployeePhone is the newest HRIS phone of a user, nil when none.
func (e Emitter) EmployeePhone(ctx context.Context, userID string) (*string, error) {
	return e.h.ports.Employees.Phone(ctx, e.h.db, userID)
}

// WhatsApp sends a text through the self-hosted gateway; sent is false when
// the gateway is not configured.
func (e Emitter) WhatsApp(ctx context.Context, target, message string) (sent bool, err error) {
	gateway := e.h.ports.WhatsApp.LoadGateway(ctx, e.h.db)
	if gateway == nil {
		return false, nil
	}
	if res := gateway.SendText(ctx, target, message); !res.Success {
		return true, errors.New(res.Reason)
	}
	return true, nil
}
