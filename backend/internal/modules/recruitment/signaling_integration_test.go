package recruitment

import (
	"strings"
	"testing"
)

// HR and the candidate reach different replicas: the offer, the pending
// list and the answer must travel through the database.
func TestSignalingAcrossReplicas(t *testing.T) {
	hr := newHarness(t)
	candidate := hr.replica()
	id := hr.candidate("psikotes")
	token := strings.Repeat("cd", 32)
	sessionID := hr.scalar(`INSERT INTO recruitment.psikotes_sessions (candidate_id, token, status, invited_at, expires_at)
		VALUES ($1, $2, 'in_progress', now(), now() + interval '1 day') RETURNING id::text`, id, token)
	base := "/api/recruitment/live-monitoring/psikotes/" + sessionID + "/webrtc"
	portal := "/api/psikotes/session/" + token + "/webrtc"

	for _, offer := range []string{"viewer-0001", "viewer-0002", "viewer-0003", "viewer-0004"} {
		expect(t, hr.as(hr.hr, "POST", base, map[string]any{"offer_id": offer, "sdp": "v=0 " + offer}), 201, "")
	}
	// Three offers per session; the oldest is dropped.
	c := candidate.anon("GET", portal, nil)
	want := `{"data":{"offers":[{"offer_id":"viewer-0002","sdp":"v=0 viewer-0002"},{"offer_id":"viewer-0003","sdp":"v=0 viewer-0003"},{"offer_id":"viewer-0004","sdp":"v=0 viewer-0004"}]}}`
	if c.raw != want {
		t.Fatalf("pending on the candidate's replica:\n got %s\nwant %s", c.raw, want)
	}
	if c = candidate.anon("POST", portal, map[string]any{"offer_id": "viewer-0001", "sdp": "late"}); c.raw != `{"data":{"ok":false}}` {
		t.Fatalf("answer to a dropped offer: %s", c.raw)
	}
	if c = candidate.anon("POST", portal, map[string]any{"offer_id": "viewer-0003", "sdp": "answer-3"}); c.raw != `{"data":{"ok":true}}` {
		t.Fatalf("answer: %s", c.raw)
	}
	if c = hr.as(hr.hr, "GET", base+"?offer_id=viewer-0003", nil); c.raw != `{"data":{"sdp":"answer-3"}}` {
		t.Fatalf("answer read on the HR replica: %s", c.raw)
	}
	if c = hr.as(hr.hr, "GET", base+"?offer_id=viewer-0004", nil); c.raw != `{"data":{"sdp":null}}` {
		t.Fatalf("unanswered offer: %s", c.raw)
	}
	if c = candidate.anon("GET", portal, nil); !strings.Contains(c.raw, "viewer-0004") || strings.Contains(c.raw, "viewer-0003") {
		t.Fatalf("answered offers leave the pending list: %s", c.raw)
	}
	// Offers expire after two minutes.
	hr.exec(`UPDATE recruitment.live_signals SET created_at = created_at - interval '2 minutes' WHERE session_id = $1`, sessionID)
	if c = candidate.anon("GET", portal, nil); c.raw != `{"data":{"offers":[]}}` {
		t.Fatalf("expired offers: %s", c.raw)
	}
	if c = hr.as(hr.hr, "GET", base+"?offer_id=viewer-0003", nil); c.raw != `{"data":{"sdp":null}}` {
		t.Fatalf("expired answer: %s", c.raw)
	}
}
