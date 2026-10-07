package audit_test

import (
	"context"
	"net/http/httptest"
	"testing"

	"nuhabit/backend/internal/platform/audit"
	"nuhabit/backend/internal/platform/testutil"
)

func TestWrite(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	label, reason, blank := "PO-<1>", "  salah input  ", "  "
	entityID := "go-audit-test"
	r := httptest.NewRequest("POST", "/x", nil)
	r.Header.Set("X-Forwarded-For", " 10.0.0.1 , 10.0.0.2")
	r.Header.Set("User-Agent", "go-test")

	e := audit.Entry{
		ActorName: &blank, Action: "po.cancel", Entity: "purchase_order", EntityID: &entityID, EntityLabel: &label,
		Before: map[string]any{"status": "<draft>"}, Reason: &reason,
	}.WithRequest(r)
	if err := audit.Write(ctx, tx, e); err != nil {
		t.Fatal(err)
	}
	var actor, after, ip *string
	var name, before, gotReason, ua string
	err := tx.QueryRow(ctx, `SELECT actor_id::text, actor_name, before::text, after::text, reason, ip, user_agent
		FROM audit.audit_log WHERE entity_id = $1`, entityID).Scan(&actor, &name, &before, &after, &gotReason, &ip, &ua)
	if err != nil {
		t.Fatal(err)
	}
	if actor != nil || name != "  " || before != `{"status": "<draft>"}` || after != nil || gotReason != "salah input" ||
		ip == nil || *ip != "10.0.0.1" || ua != "go-test" {
		t.Fatalf("row = %v %q %s %v %q %v %q", actor, name, before, after, gotReason, ip, ua)
	}

	// A blank reason is NULL; x-real-ip is the fallback.
	r = httptest.NewRequest("POST", "/x", nil)
	r.Header.Set("X-Real-Ip", "10.9.9.9")
	e = audit.Entry{Action: "po.approve", Entity: "purchase_order", EntityID: &entityID, Reason: &blank}.WithRequest(r)
	if e.IP == nil || *e.IP != "10.9.9.9" || e.UserAgent != nil {
		t.Fatalf("meta = %v %v", e.IP, e.UserAgent)
	}
	if err := audit.Write(ctx, tx, e); err != nil {
		t.Fatal(err)
	}
	var nullReason bool
	if err := tx.QueryRow(ctx, `SELECT reason IS NULL FROM audit.audit_log WHERE entity_id = $1 AND action = 'po.approve'`, entityID).Scan(&nullReason); err != nil || !nullReason {
		t.Fatalf("blank reason stored: %v", err)
	}
}
