package master

import (
	"net/url"
	"testing"
)

func TestParseAuditParams(t *testing.T) {
	q, _ := url.ParseQuery("entity=all&action=update&action=&page= 2 &limit=0x10&search=")
	p, err := parseAuditParams(q)
	if err != nil || p.entity != "" || p.action != "update" || p.page != 2 || p.limit != 16 {
		t.Fatalf("params = %+v %v", p, err)
	}
	if p, _ := parseAuditParams(url.Values{}); p.page != 1 || p.limit != 30 {
		t.Fatalf("defaults = %+v", p)
	}
	for _, raw := range []string{"limit=101", "page=0", "page=x", "actor_id=1", "date_to=2026/01/01", "entity=" + string(make([]byte, 61))} {
		q, _ := url.ParseQuery(raw)
		if _, err := parseAuditParams(q); err == nil {
			t.Errorf("%q accepted", raw)
		}
	}
}
