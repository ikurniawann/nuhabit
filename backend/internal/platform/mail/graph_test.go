package mail

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// graphStub is a login and Graph endpoint pair recording what the client sent.
type graphStub struct {
	t          *testing.T
	tokens     atomic.Int32
	sends      atomic.Int32
	tokenForm  map[string]string
	lastPath   string
	lastBody   map[string]any
	lastHeader http.Header
	// sendStatus is answered to sendMail; the body is a Graph error.
	sendStatus  atomic.Int32
	tokenStatus atomic.Int32
}

func newGraphStub(t *testing.T) (*graphStub, *Graph) {
	t.Helper()
	s := &graphStub{t: t}
	s.sendStatus.Store(http.StatusAccepted)
	s.tokenStatus.Store(http.StatusOK)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /login/{tenant}/oauth2/v2.0/token", func(w http.ResponseWriter, r *http.Request) {
		s.tokens.Add(1)
		if err := r.ParseForm(); err != nil {
			t.Error(err)
		}
		s.tokenForm = map[string]string{"tenant": r.PathValue("tenant")}
		for k := range r.PostForm {
			s.tokenForm[k] = r.PostForm.Get(k)
		}
		if st := int(s.tokenStatus.Load()); st != http.StatusOK {
			w.WriteHeader(st)
			_, _ = io.WriteString(w, `{"error":"invalid_client","error_description":"AADSTS7000215: Invalid client secret provided.\r\nTrace ID: x"}`)
			return
		}
		_, _ = io.WriteString(w, `{"token_type":"Bearer","expires_in":3599,"access_token":"tok-`+time.Now().Format("150405.000000")+`"}`)
	})
	mux.HandleFunc("POST /graph/", func(w http.ResponseWriter, r *http.Request) {
		s.sends.Add(1)
		s.lastPath = r.URL.Path
		s.lastHeader = r.Header.Clone()
		s.lastBody = map[string]any{}
		_ = json.NewDecoder(r.Body).Decode(&s.lastBody)
		st := int(s.sendStatus.Load())
		w.WriteHeader(st)
		if st/100 != 2 {
			_, _ = io.WriteString(w, `{"error":{"code":"ErrorSendAsDenied","message":"The user account which was used to submit this request does not have the right to send mail on behalf of the specified sending account."}}`)
		}
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	g := &Graph{TenantID: "tenant-id", ClientID: "client-id", ClientSecret: "secret", Mailbox: "ops@nuhabit.onmicrosoft.com",
		BaseURL: srv.URL + "/graph", LoginURL: srv.URL + "/login", Client: srv.Client()}
	return s, g
}

func TestGraphTokenFlowAndRequestShape(t *testing.T) {
	stub, g := newGraphStub(t)
	id, err := g.Send(context.Background(), Message{To: "member@example.com", From: "ops@nuhabit.onmicrosoft.com", FromName: "NüHabit",
		Subject: "Slip gaji", HTML: "<p>Halo</p>", Attachments: []Attachment{{Filename: "slip.pdf", ContentType: "application/pdf", Content: []byte("%PDF")}}})
	if err != nil || id == "" {
		t.Fatalf("Send: id=%q err=%v", id, err)
	}
	want := map[string]string{"tenant": "tenant-id", "client_id": "client-id", "client_secret": "secret",
		"scope": "https://graph.microsoft.com/.default", "grant_type": "client_credentials"}
	for k, v := range want {
		if stub.tokenForm[k] != v {
			t.Errorf("token form %s = %q, want %q", k, stub.tokenForm[k], v)
		}
	}
	if stub.lastPath != "/graph/users/ops@nuhabit.onmicrosoft.com/sendMail" {
		t.Errorf("path = %s", stub.lastPath)
	}
	if !strings.HasPrefix(stub.lastHeader.Get("Authorization"), "Bearer tok-") || stub.lastHeader.Get("client-request-id") != id {
		t.Errorf("headers = %v (id %s)", stub.lastHeader, id)
	}
	msg := stub.lastBody["message"].(map[string]any)
	body := msg["body"].(map[string]any)
	to := msg["toRecipients"].([]any)[0].(map[string]any)["emailAddress"].(map[string]any)
	from := msg["from"].(map[string]any)["emailAddress"].(map[string]any)
	att := msg["attachments"].([]any)[0].(map[string]any)
	if msg["subject"] != "Slip gaji" || body["contentType"] != "HTML" || body["content"] != "<p>Halo</p>" ||
		to["address"] != "member@example.com" || from["address"] != "ops@nuhabit.onmicrosoft.com" || from["name"] != "NüHabit" ||
		att["@odata.type"] != "#microsoft.graph.fileAttachment" || att["name"] != "slip.pdf" || att["contentType"] != "application/pdf" ||
		att["contentBytes"] != base64.StdEncoding.EncodeToString([]byte("%PDF")) || stub.lastBody["saveToSentItems"] != true {
		t.Errorf("sendMail body = %v", stub.lastBody)
	}

	// The token is cached: a second send does not hit the login endpoint.
	if _, err := g.Send(context.Background(), Message{To: "b@example.com", From: "x", Subject: "s", HTML: "h"}); err != nil {
		t.Fatal(err)
	}
	if stub.tokens.Load() != 1 || stub.sends.Load() != 2 {
		t.Errorf("tokens=%d sends=%d, want 1 and 2", stub.tokens.Load(), stub.sends.Load())
	}

	// An expired token is refreshed before the next send.
	g.Now = func() time.Time { return time.Now().Add(2 * time.Hour) }
	if _, err := g.Send(context.Background(), Message{To: "c@example.com", From: "x", Subject: "s", HTML: "h"}); err != nil {
		t.Fatal(err)
	}
	if stub.tokens.Load() != 2 {
		t.Errorf("expired token must be refreshed, tokens=%d", stub.tokens.Load())
	}
}

func TestGraphRetriesOnceAfter401(t *testing.T) {
	stub, g := newGraphStub(t)
	stub.sendStatus.Store(http.StatusUnauthorized)
	_, err := g.Send(context.Background(), Message{To: "a@example.com", From: "x", Subject: "s", HTML: "h"})
	if err == nil || IsTransient(err) || !strings.Contains(err.Error(), "Graph 401") {
		t.Fatalf("err = %v", err)
	}
	if stub.tokens.Load() != 2 || stub.sends.Load() != 2 {
		t.Errorf("401 must refresh the token once: tokens=%d sends=%d", stub.tokens.Load(), stub.sends.Load())
	}
}

func TestGraphErrorClassification(t *testing.T) {
	stub, g := newGraphStub(t)
	stub.sendStatus.Store(http.StatusForbidden)
	_, err := g.Send(context.Background(), Message{To: "a@example.com", From: "x", Subject: "s", HTML: "h"})
	if err == nil || IsTransient(err) || !strings.Contains(err.Error(), "ErrorSendAsDenied") {
		t.Fatalf("403 must be permanent with the Graph message: %v", err)
	}
	stub.sendStatus.Store(http.StatusTooManyRequests)
	if _, err := g.Send(context.Background(), Message{To: "a@example.com", From: "x", Subject: "s", HTML: "h"}); !IsTransient(err) {
		t.Fatalf("429 must be transient: %v", err)
	}
	stub.tokenStatus.Store(http.StatusUnauthorized)
	g.invalidate()
	_, err = g.Send(context.Background(), Message{To: "a@example.com", From: "x", Subject: "s", HTML: "h"})
	if err == nil || IsTransient(err) || !strings.Contains(err.Error(), "AADSTS7000215") || strings.Contains(err.Error(), "Trace ID") {
		t.Fatalf("token error must carry the AADSTS message without trace ids: %v", err)
	}
}
