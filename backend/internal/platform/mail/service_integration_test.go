package mail

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/testutil"
)

// fakeProvider answers each send from a queue of errors (nil = accepted).
type fakeProvider struct {
	errs  []error
	sent  []Message
	calls int
}

func (f *fakeProvider) Name() string { return "fake" }

func (f *fakeProvider) Send(_ context.Context, m Message) (string, error) {
	f.calls++
	var err error
	if len(f.errs) > 0 {
		err, f.errs = f.errs[0], f.errs[1:]
	}
	if err != nil {
		return "", err
	}
	f.sent = append(f.sent, m)
	return "msg-" + m.To, nil
}

type harness struct {
	svc  *Service
	prov *fakeProvider
	now  time.Time
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	tx := testutil.Tx(t)
	h := &harness{prov: &fakeProvider{}, now: time.Date(2026, 10, 27, 8, 0, 0, 0, time.UTC)}
	h.svc = New(tx, func(k string) string {
		return map[string]string{"RESEND_API_KEY": "re_1", "FROM_EMAIL": "noreply@nuhabit.id", "MAIL_FROM_NAME": "NüHabit"}[k]
	}, slog.New(slog.NewTextHandler(io.Discard, nil)), func() time.Time { return h.now })
	h.svc.Providers = func(Config) (Provider, error) { return h.prov, nil }
	if _, err := tx.Exec(context.Background(), `DELETE FROM configuration.app_settings WHERE key = ANY($1)`, SettingKeys()); err != nil {
		t.Fatal(err)
	}
	return h
}

func (h *harness) entry(t *testing.T, id string) Entry {
	t.Helper()
	e, err := h.svc.Get(context.Background(), id)
	if err != nil || e == nil {
		t.Fatalf("Get(%s) = %v, %v", id, e, err)
	}
	return *e
}

func TestSendLogsAndFillsSender(t *testing.T) {
	h := newHarness(t)
	res := h.svc.Send(context.Background(), Message{Kind: "test", To: " staff@example.com ", Subject: "Uji", HTML: "<p>uji</p>"})
	if !res.Sent() || res.MessageID != "msg-staff@example.com" || res.Err != nil {
		t.Fatalf("result = %+v", res)
	}
	if got := h.prov.sent[0]; got.From != "noreply@nuhabit.id" || got.FromName != "NüHabit" || got.To != "staff@example.com" {
		t.Errorf("sender not filled from env: %+v", got)
	}
	e := h.entry(t, res.ID)
	if e.Status != StatusSent || e.Attempts != 1 || e.Kind != "test" || e.MessageID == nil || *e.MessageID != res.MessageID || e.SentAt == nil || e.Provider != "fake" {
		t.Errorf("entry = %+v", e)
	}
	if res := h.svc.Send(context.Background(), Message{To: "no-at-sign", Subject: "x", HTML: "y"}); res.Err == nil || res.ID != "" {
		t.Errorf("invalid recipient must fail before logging: %+v", res)
	}
}

func TestTransientFailuresRetryWithBackoff(t *testing.T) {
	h := newHarness(t)
	h.prov.errs = []error{Transient(errors.New("Graph 503: ServiceUnavailable")), Transient(errors.New("Graph 429: TooManyRequests")), nil}
	res := h.svc.Send(context.Background(), Message{Kind: "payslip", To: "emp@example.com", Subject: "Slip", HTML: "<p>s</p>",
		Attachments: []Attachment{{Filename: "slip.pdf", ContentType: "application/pdf", Content: []byte("%PDF")}}})
	if res.Status != StatusQueued || res.Err == nil || res.Err.Error() != "Graph 503: ServiceUnavailable" {
		t.Fatalf("first attempt: %+v", res)
	}
	e := h.entry(t, res.ID)
	if e.Attempts != 1 || e.NextAttemptAt == nil || !e.NextAttemptAt.Equal(h.now.Add(time.Minute)) || e.Error == nil || *e.Error != "Graph 503: ServiceUnavailable" {
		t.Fatalf("after first failure: %+v next=%v", e, e.NextAttemptAt)
	}

	// Not due yet.
	if err := h.svc.RetryDue(context.Background(), h.now.Add(30*time.Second)); err != nil || h.prov.calls != 1 {
		t.Fatalf("early retry ran: calls=%d err=%v", h.prov.calls, err)
	}
	h.now = h.now.Add(time.Minute)
	if err := h.svc.RetryDue(context.Background(), h.now); err != nil {
		t.Fatal(err)
	}
	e = h.entry(t, res.ID)
	if e.Status != StatusQueued || e.Attempts != 2 || !e.NextAttemptAt.Equal(h.now.Add(5*time.Minute)) {
		t.Fatalf("after second failure: %+v next=%v", e, e.NextAttemptAt)
	}
	h.now = h.now.Add(5 * time.Minute)
	if err := h.svc.RetryDue(context.Background(), h.now); err != nil {
		t.Fatal(err)
	}
	e = h.entry(t, res.ID)
	if e.Status != StatusSent || e.Attempts != 3 || e.Error != nil || e.NextAttemptAt != nil {
		t.Fatalf("third attempt should send: %+v", e)
	}
	if sent := h.prov.sent[0]; len(sent.Attachments) != 1 || string(sent.Attachments[0].Content) != "%PDF" || sent.Subject != "Slip" {
		t.Errorf("retried message lost its body: %+v", sent)
	}
}

func TestFailsAfterMaxAttemptsAndOnPermanentErrors(t *testing.T) {
	h := newHarness(t)
	h.prov.errs = []error{Transient(errors.New("t1")), Transient(errors.New("t2")), Transient(errors.New("t3"))}
	res := h.svc.Send(context.Background(), Message{To: "a@example.com", Subject: "s", HTML: "h"})
	for i := 0; i < 2; i++ {
		h.now = h.now.Add(10 * time.Minute)
		if err := h.svc.RetryDue(context.Background(), h.now); err != nil {
			t.Fatal(err)
		}
	}
	if e := h.entry(t, res.ID); e.Status != StatusFailed || e.Attempts != 3 || *e.Error != "t3" || e.NextAttemptAt != nil {
		t.Fatalf("after three transient failures: %+v", e)
	}

	h.prov.errs = []error{errors.New("Resend 403: domain not verified")}
	res = h.svc.Send(context.Background(), Message{To: "b@example.com", Subject: "s", HTML: "h"})
	if res.Status != StatusFailed || h.entry(t, res.ID).NextAttemptAt != nil {
		t.Fatalf("permanent error must not queue: %+v", res)
	}

	h.prov.errs = []error{Transient(errors.New("timeout"))}
	res = h.svc.Send(context.Background(), Message{Kind: "otp", To: "c@example.com", Subject: "Kode", HTML: "h", NoRetry: true})
	if res.Status != StatusFailed {
		t.Fatalf("NoRetry must fail on the first transient error: %+v", res)
	}
	if _, err := h.svc.Resend(context.Background(), res.ID); !errors.Is(err, ErrNotResendable) {
		t.Fatalf("OTP resend must be refused: %v", err)
	}
}

func TestResendAndList(t *testing.T) {
	h := newHarness(t)
	h.prov.errs = []error{errors.New("SMTP 550: mailbox unavailable")}
	failed := h.svc.Send(context.Background(), Message{Kind: "gym", To: "member@example.com", Subject: "Kelas", HTML: "h"})
	h.svc.Send(context.Background(), Message{Kind: "test", To: "staff@example.com", Subject: "Uji", HTML: "h"})

	list, sum, err := h.svc.List(context.Background(), Filter{Status: StatusFailed})
	if err != nil || len(list) != 1 || list[0].ID != failed.ID || sum.Failed != 1 || sum.Sent != 1 {
		t.Fatalf("list failed = %v %+v %v", list, sum, err)
	}
	if list, _, err := h.svc.List(context.Background(), Filter{Search: "kel"}); err != nil || len(list) != 1 || list[0].Subject != "Kelas" {
		t.Fatalf("search = %v %v", list, err)
	}

	res, err := h.svc.Resend(context.Background(), failed.ID)
	if err != nil || !res.Sent() || res.ID != failed.ID {
		t.Fatalf("resend = %+v %v", res, err)
	}
	if e := h.entry(t, failed.ID); e.Status != StatusSent || e.Attempts != 2 || e.Error != nil {
		t.Fatalf("resent entry = %+v", e)
	}
	if res, err := h.svc.Resend(context.Background(), "00000000-0000-4000-8000-000000000000"); err != nil || res.ID != "" {
		t.Fatalf("missing row: %+v %v", res, err)
	}
}
