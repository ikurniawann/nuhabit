package advance

import (
	"context"
	"testing"

	"nuhabit/backend/internal/contracts/salesfunnel"
	"nuhabit/backend/internal/modules/crm/internal/crmtest"
	"nuhabit/backend/internal/platform/outbox"
)

// bus registers the sales-funnel subscribers on the test transaction.
func (e *env) bus() *outbox.Bus {
	e.t.Helper()
	bus := outbox.NewBus(nil, e.deps.Log)
	Subscribe(bus, e.deps, e.ports)
	if err := bus.Register(context.Background(), e.tx); err != nil {
		e.t.Fatal(err)
	}
	return bus
}

func (e *env) dispatch(bus *outbox.Bus) {
	e.t.Helper()
	if _, err := bus.Dispatch(context.Background(), e.tx); err != nil {
		e.t.Fatal(err)
	}
}

// redeliver marks every delivery of topic undelivered, as after a commit
// the dispatcher did not see.
func (e *env) redeliver(bus *outbox.Bus, topic string) {
	e.t.Helper()
	crmtest.MustExec(e.t, e.tx, `UPDATE platform.outbox_deliveries d SET delivered_at = NULL FROM platform.outbox_events ev
		WHERE ev.id = d.event_id AND ev.topic = $1`, topic)
	e.dispatch(bus)
}

func (e *env) publish(topic, key string, payload any) {
	e.t.Helper()
	if err := outbox.Publish(context.Background(), e.tx, topic, key, payload); err != nil {
		e.t.Fatal(err)
	}
}

func TestSalesEventSubscriber(t *testing.T) {
	e := setup(t)
	actor := e.staff("crm.settings")
	lead, _, _ := e.salesFixture(actor.UserID)
	bus := e.bus()
	crmtest.MustExec(t, e.tx, `INSERT INTO crm.crm_scoring_rules (company_id, name, kind, field, operator, value, points)
		VALUES ($1, 'Sumber WA', 'field', 'source', 'eq', '"wa"', 10)`, e.venue.company)
	crmtest.MustExec(t, e.tx, `INSERT INTO crm.crm_workflow_rules (company_id, name, object, trigger_type, run_once_per_record, conditions, actions)
		VALUES ($1, 'Suhu naik', 'lead', 'updated', false, '[{"field":"temperature","op":"changed_to","value":"panas"}]', $2::jsonb)`, e.venue.company,
		`[{"type":"create_task","title":"Telepon {{lead.org_name}}","activity_type":"telepon","priority":"high","assign_to":"creator"}]`)

	e.publish(salesfunnel.TopicCrmEventRaised, "lead:"+lead, salesfunnel.CrmEventRaised{
		EventType: "lead.updated", SubjectType: "lead", SubjectID: lead,
		CompanyID: &e.venue.company, BranchID: &e.venue.branch, ActorUserID: &actor.UserID,
		Payload: map[string]any{"changed_fields": []string{"temperature"}},
		Changes: map[string]any{"temperature": map[string]any{"from": "hangat", "to": "panas"}},
	})
	e.dispatch(bus)
	e.redeliver(bus, salesfunnel.TopicCrmEventRaised)

	if got := crmtest.Scalar[string](t, e.tx, `SELECT string_agg(event_type, ',' ORDER BY created_at, event_type) FROM crm.crm_events WHERE subject_id = $1`, lead); got != "lead.score_changed,lead.updated" && got != "lead.updated,lead.score_changed" {
		t.Fatalf("events = %s", got)
	}
	if got := crmtest.Scalar[string](t, e.tx, `SELECT payload->>'changed_fields' FROM crm.crm_events WHERE subject_id = $1 AND event_type = 'lead.updated'`, lead); got != `["temperature"]` {
		t.Fatalf("payload = %s", got)
	}
	if n := crmtest.Scalar[int](t, e.tx, `SELECT count(*) FROM crm.crm_sales_activities WHERE lead_id = $1 AND title LIKE 'Telepon PT Kopi %' AND created_by = $2`, lead, actor.UserID); n != 1 {
		t.Fatalf("workflow tasks = %d", n)
	}
	if s := crmtest.Scalar[int](t, e.tx, `SELECT score FROM crm.crm_sales_leads WHERE id = $1`, lead); s != 10 {
		t.Fatalf("score = %d", s)
	}
}

// A failing rule rolls back alone: the event, the other rules and the
// scoring still land.
func TestSalesEventSubscriberIsolatesFailingRules(t *testing.T) {
	e := setup(t)
	actor := e.staff("crm.settings")
	lead, _, _ := e.salesFixture(actor.UserID)
	bus := e.bus()
	crmtest.MustExec(t, e.tx, `INSERT INTO crm.crm_workflow_rules (company_id, name, object, trigger_type, actions)
		VALUES ($1, 'Rusak', 'lead', 'created', '[{"type":"wait","hours":1},{"type":"notify_in_app","to":"owner"}]'::jsonb)`, e.venue.company)
	// Queuing the action after the wait fails inside the rule.
	crmtest.MustExec(t, e.tx, `ALTER TABLE crm.crm_scheduled_actions ADD CONSTRAINT test_no_wait CHECK (run_at < '2000-01-01')`)
	crmtest.MustExec(t, e.tx, `INSERT INTO crm.crm_workflow_rules (company_id, name, object, trigger_type, actions)
		VALUES ($1, 'Sehat', 'lead', 'created', '[]'::jsonb)`, e.venue.company)
	e.publish(salesfunnel.TopicCrmEventRaised, "lead:"+lead, salesfunnel.CrmEventRaised{
		EventType: "lead.created", SubjectType: "lead", SubjectID: lead, CompanyID: &e.venue.company, BranchID: &e.venue.branch,
	})
	e.dispatch(bus)
	if got := crmtest.Scalar[string](t, e.tx, `SELECT string_agg(w.name || ':' || r.status, ',') FROM crm.crm_workflow_runs r
		JOIN crm.crm_workflow_rules w ON w.id = r.rule_id WHERE r.subject_id = $1`, lead); got != "Sehat:success" {
		t.Fatalf("runs = %s", got)
	}
	if n := crmtest.Scalar[int](t, e.tx, `SELECT count(*) FROM crm.crm_events WHERE subject_id = $1 AND event_type = 'lead.created'`, lead); n != 1 {
		t.Fatalf("events = %d", n)
	}
}

func TestQuotationPricedSubscriber(t *testing.T) {
	e := setup(t)
	requester := e.staff("crm.settings")
	approver := e.staff("crm.settings")
	_, _, quote := e.salesFixture(requester.UserID)
	crmtest.MustExec(t, e.tx, `UPDATE crm.crm_sales_quotations SET approval_status = 'none' WHERE id = $1`, quote)
	crmtest.MustExec(t, e.tx, `UPDATE crm.crm_approval_rules SET is_active = false`)
	crmtest.MustExec(t, e.tx, `INSERT INTO crm.crm_approval_rules (company_id, name, level, min_discount_percent, approver_user_id)
		VALUES ($1, 'Admin', 1, 10, $2), ($1, 'Owner', 2, 20, $2), ($1, 'Owner besar', 2, 50, $2)`, e.venue.company, approver.UserID)
	bus := e.bus()
	priced := salesfunnel.QuotationPriced{QuotationID: quote, RequestedBy: requester.UserID}

	e.publish(salesfunnel.TopicQuotationPriced, quote, priced)
	e.dispatch(bus)
	e.redeliver(bus, salesfunnel.TopicQuotationPriced)

	reqID := crmtest.Scalar[string](t, e.tx, `SELECT string_agg(id::text, ',') FROM crm.crm_approval_requests WHERE subject_id = $1`, quote)
	if got := crmtest.Scalar[string](t, e.tx, `SELECT status || '|' || current_level || '|' || discount_percent || '|' || amount || '|' || requested_by
		FROM crm.crm_approval_requests WHERE id::text = $1`, reqID); got != "pending|1|25.00|750000.00|"+requester.UserID {
		t.Fatalf("request = %s (%s)", got, reqID)
	}
	if got := crmtest.Scalar[string](t, e.tx, `SELECT string_agg(level::text, ',' ORDER BY level) FROM crm.crm_approval_steps WHERE request_id::text = $1`, reqID); got != "1,2" {
		t.Fatalf("steps = %s", got)
	}
	if got := crmtest.Scalar[string](t, e.tx, `SELECT approval_status || '|' || approval_request_id FROM crm.crm_sales_quotations WHERE id = $1`, quote); got != "pending|"+reqID {
		t.Fatalf("quotation = %s", got)
	}
	if n := crmtest.Scalar[int](t, e.tx, `SELECT count(*) FROM public.notifications WHERE user_id = $1 AND link = $2`,
		approver.UserID, "/dashboard/sales-funnel/approvals?request="+reqID); n != 1 {
		t.Fatalf("approver notifications = %d", n)
	}

	// The discount drops under every bar: the pending request is cancelled.
	crmtest.MustExec(t, e.tx, `UPDATE crm.crm_sales_quotations SET discount_percent = 5 WHERE id = $1`, quote)
	e.publish(salesfunnel.TopicQuotationPriced, quote, priced)
	e.dispatch(bus)
	if got := crmtest.Scalar[string](t, e.tx, `SELECT r.status || '|' || q.approval_status || '|' || (q.approval_request_id IS NULL)::text
		FROM crm.crm_approval_requests r, crm.crm_sales_quotations q WHERE r.id::text = $1 AND q.id = $2`, reqID, quote); got != "cancelled|none|true" {
		t.Fatalf("after discount drop = %s", got)
	}
}
