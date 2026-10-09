package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPayslipMailerAttachesPDF(t *testing.T) {
	pdf := []byte("%PDF-test")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("missing API key")
		}
		var body struct {
			To          []string `json:"to"`
			Attachments []struct {
				Filename string `json:"filename"`
				Content  string `json:"content"`
			} `json:"attachments"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if len(body.To) != 1 || body.To[0] != "employee@example.com" || len(body.Attachments) != 1 || body.Attachments[0].Filename != "slip.pdf" {
			t.Fatalf("unexpected email payload: %+v", body)
		}
		attachment, err := base64.StdEncoding.DecodeString(body.Attachments[0].Content)
		if err != nil || string(attachment) != string(pdf) {
			t.Fatal("PDF attachment mismatch")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"resend-test-id"}`))
	}))
	defer server.Close()
	mailer := &resendPayslipMailer{apiKey: "test-key", client: server.Client(), url: server.URL}
	if id, err := mailer.SendPayslip(context.Background(), "employee@example.com", "Payroll <payroll@example.com>", "Slip", "<p>Slip</p>", "slip.pdf", pdf); err != nil || id != "resend-test-id" {
		t.Fatal(err)
	}
}

func TestPayslipMailerRejectsFailedProvider(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()
	mailer := &resendPayslipMailer{apiKey: "test-key", client: server.Client(), url: server.URL}
	if _, err := mailer.SendPayslip(context.Background(), "employee@example.com", "Payroll <payroll@example.com>", "Slip", "<p>Slip</p>", "slip.pdf", []byte("%PDF")); err == nil {
		t.Fatal("provider failure must not be treated as sent")
	}
}

func TestPayslipMailerRequiresResendID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()
	mailer := &resendPayslipMailer{apiKey: "test-key", client: server.Client(), url: server.URL}
	if _, err := mailer.SendPayslip(context.Background(), "employee@example.com", "Payroll <payroll@example.com>", "Slip", "<p>Slip</p>", "slip.pdf", []byte("%PDF")); err == nil {
		t.Fatal("missing Resend id must not be treated as accepted")
	}
}
