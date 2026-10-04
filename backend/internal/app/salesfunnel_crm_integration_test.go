package app

import (
	"context"
	"fmt"
	"math/rand/v2"
	"testing"

	"nuhabit/backend/internal/modules/crm/advance"
	"nuhabit/backend/internal/modules/salesfunnel"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/testutil"
	"nuhabit/backend/internal/platform/whatsapp"
)

type noWhatsApp struct{}

func (noWhatsApp) LoadGateway(context.Context, database.Querier) *whatsapp.Gateway { return nil }

// A Go-served sales-funnel write reaches CRM through the outbox: after
// dispatch the lead-created workflow rule has run and the discounted
// quotation waits on an approval request, as the TS routes did inline.
func TestSalesFunnelWritesReachCRM(t *testing.T) {
	d := testutil.Deps(t, nil)
	ctx := context.Background()
	var company, branch string
	if err := testutil.DB(t).QueryRow(ctx, `SELECT company_id::text, id::text FROM configuration.branches ORDER BY created_at LIMIT 1`).
		Scan(&company, &branch); err != nil {
		t.Skipf("no branch fixture: %v", err)
	}
	seller := testutil.CreateStaff(t, testutil.StaffOptions{Role: "admin", CompanyID: &company,
		Menus: map[string][]string{"sales-funnel": {"read", "create", "update", "delete"}}})
	tx := testutil.Tx(t)
	mux := testutil.Mux(salesfunnel.NewOn(d, tx, SalesFunnelPorts(d)))
	ports := crmAdvancePorts(d)
	ports.WhatsApp = noWhatsApp{}
	bus := outbox.NewBus(nil, d.Log)
	advance.Subscribe(bus, d, ports)
	if err := bus.Register(ctx, tx); err != nil {
		t.Fatal(err)
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	scalar := func(sql string, args ...any) string {
		t.Helper()
		var v string
		if err := tx.QueryRow(ctx, sql, args...).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return v
	}
	post := func(path string, body any) map[string]any {
		t.Helper()
		res, out := testutil.Do(t, mux, testutil.AsStaff(testutil.Request("POST", path, body), seller))
		if res.Code != 201 {
			t.Fatalf("POST %s = %d %s", path, res.Code, res.Body)
		}
		return out["data"].(map[string]any)
	}
	dispatch := func() {
		t.Helper()
		if _, err := bus.Dispatch(ctx, tx); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO crm.crm_workflow_rules (company_id, name, object, trigger_type, actions)
		VALUES ($1, 'Sambut lead', 'lead', 'created', $2::jsonb)`, company,
		`[{"type":"create_task","title":"Sambut {{lead.org_name}}","activity_type":"telepon","priority":"high","assign_to":"creator"}]`)
	exec(`UPDATE crm.crm_approval_rules SET is_active = false`)
	exec(`INSERT INTO crm.crm_approval_rules (company_id, name, level, min_discount_percent, approver_user_id)
		VALUES ($1, 'Admin', 1, 10, $2)`, company, seller.UserID)

	org := "PT Outbox " + testutil.RandomHex(3)
	lead := post("/api/sales-funnel/leads", map[string]any{"org_name": org, "pic_name": "Budi",
		"pic_phone": fmt.Sprintf("0812%08d", rand.IntN(100_000_000))})["id"].(string)
	taskCount := `SELECT count(*)::text FROM crm.crm_sales_activities WHERE lead_id = $1 AND title = $2 AND created_by = $3`
	if n := scalar(taskCount, lead, "Sambut "+org, seller.UserID); n != "0" {
		t.Fatal("the workflow runs after dispatch, not in the request")
	}
	dispatch()
	if n := scalar(taskCount, lead, "Sambut "+org, seller.UserID); n != "1" {
		t.Fatalf("workflow tasks = %s", n)
	}
	if got := scalar(`SELECT event_type FROM crm.crm_events WHERE subject_id = $1 ORDER BY created_at LIMIT 1`, lead); got != "lead.created" {
		t.Fatalf("event = %s", got)
	}

	deal := post("/api/sales-funnel/deals", map[string]any{"lead_id": lead, "title": "Gathering"})["id"].(string)
	quote := post("/api/sales-funnel/deals/"+deal+"/quotations", map[string]any{"discount_percent": 25,
		"items": []any{map[string]any{"description": "Sewa venue", "qty": 1, "unit_price": 1000000}},
		"terms": []any{map[string]any{"label": "Lunas", "percent": 100}}})["id"].(string)
	if got := scalar(`SELECT approval_status FROM crm.crm_sales_quotations WHERE id = $1`, quote); got != "none" {
		t.Fatalf("approval before dispatch = %s", got)
	}
	dispatch()
	if got := scalar(`SELECT q.approval_status || '|' || r.status || '|' || r.discount_percent || '|' || r.requested_by
		FROM crm.crm_sales_quotations q JOIN crm.crm_approval_requests r ON r.id = q.approval_request_id WHERE q.id = $1`, quote); got != "pending|pending|25.00|"+seller.UserID {
		t.Fatalf("approval = %s", got)
	}
}
