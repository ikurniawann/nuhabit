package mail

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestResendRequestShapeAndErrors(t *testing.T) {
	var got map[string]any
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer re_test" {
			t.Error("missing API key")
		}
		got = map[string]any{}
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(status)
		if status == http.StatusOK {
			_, _ = io.WriteString(w, `{"id":"re-1"}`)
			return
		}
		_, _ = io.WriteString(w, `{"statusCode":`+strconv.Itoa(status)+`,"name":"validation_error","message":"The gmail.com domain is not verified."}`)
	}))
	defer srv.Close()
	r := &Resend{APIKey: "re_test", URL: srv.URL, Client: srv.Client()}
	id, err := r.Send(context.Background(), Message{To: "a@example.com", From: "noreply@nuhabit.id", FromName: "NüHabit", Subject: "Hi", HTML: "<p>x</p>",
		Attachments: []Attachment{{Filename: "a.pdf", Content: []byte("x")}}})
	if err != nil || id != "re-1" {
		t.Fatalf("id=%q err=%v", id, err)
	}
	if got["from"] != "NüHabit <noreply@nuhabit.id>" || got["to"].([]any)[0] != "a@example.com" || got["attachments"].([]any)[0].(map[string]any)["filename"] != "a.pdf" {
		t.Errorf("payload = %v", got)
	}
	status = http.StatusForbidden
	_, err = r.Send(context.Background(), Message{To: "a@example.com", From: "x", Subject: "s", HTML: "h"})
	if err == nil || IsTransient(err) || !strings.Contains(err.Error(), "domain is not verified") {
		t.Fatalf("403 must be permanent with Resend's message: %v", err)
	}
	status = http.StatusTooManyRequests
	if _, err := r.Send(context.Background(), Message{To: "a@example.com", From: "x", Subject: "s", HTML: "h"}); !IsTransient(err) {
		t.Fatalf("429 must be transient: %v", err)
	}
}
