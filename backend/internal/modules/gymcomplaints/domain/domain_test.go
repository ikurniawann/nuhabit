package domain

import (
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/localtime"
)

func at(s string, loc *time.Location) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04", s, loc)
	if err != nil {
		panic(err)
	}
	return t
}

var (
	wib  = localtime.Zone("Asia/Jakarta")
	wita = localtime.Zone("Asia/Makassar")
	wit  = localtime.Zone("Asia/Jayapura")
)

func TestStatusMachine(t *testing.T) {
	cases := []struct {
		from, to Status
		actor    Actor
		ok       bool
	}{
		{Received, InProgress, Staff, true},
		{Received, Resolved, Staff, true},
		{Received, Confirmed, Staff, false},
		{InProgress, Resolved, Staff, true},
		{InProgress, Received, Staff, false},
		{Resolved, Confirmed, Staff, true},
		{Resolved, Reopened, Staff, true},
		{Resolved, InProgress, Staff, false},
		{Reopened, InProgress, Staff, true},
		{Reopened, Resolved, Staff, true},
		{Confirmed, Reopened, Staff, false},
		{Confirmed, InProgress, Staff, false},
		{Resolved, Confirmed, Member, true},
		{Resolved, Reopened, Member, true},
		{Received, Resolved, Member, false},
		{InProgress, Resolved, Member, false},
		{Confirmed, Reopened, Member, false},
	}
	for _, c := range cases {
		if got := CanMove(c.from, c.to, c.actor); got != c.ok {
			t.Errorf("%s -> %s by %d = %v, want %v", c.from, c.to, c.actor, got, c.ok)
		}
	}
	if !NeedsNote(Resolved) || !NeedsNote(Reopened) || NeedsNote(InProgress) || NeedsNote(Confirmed) {
		t.Error("NeedsNote: resolution and reopen reason only")
	}
	if Open(Resolved) || Open(Confirmed) || !Open(Reopened) || !Open(Received) {
		t.Error("Open: received, in_progress and reopened run the SLA clock")
	}
	if got := NextStatuses(Received); len(got) != 2 {
		t.Errorf("NextStatuses(received) = %v", got)
	}
}

func TestSLANormalize(t *testing.T) {
	s := SLA{Urgent: {RespondHours: 5, ResolveHours: 2}, Low: {RespondHours: 0, ResolveHours: 9999, BusinessHours: false}}.Normalize()
	if s[Urgent].RespondHours != 5 || s[Urgent].ResolveHours != 5 {
		t.Errorf("resolve must not precede respond: %+v", s[Urgent])
	}
	if s[Low].RespondHours != 24 || s[Low].ResolveHours != MaxSLAHours || s[Low].BusinessHours {
		t.Errorf("low = %+v", s[Low])
	}
	if s[Normal] != DefaultSLA()[Normal] || s[High] != DefaultSLA()[High] {
		t.Error("missing priorities take the defaults")
	}
}

func TestDeadlinesAroundTheClock(t *testing.T) {
	start := at("2026-10-26 22:30", wib)
	respond, resolve := Deadlines(start, Urgent, DefaultSLA(), DefaultWindow, wib)
	if !respond.Equal(start.Add(time.Hour)) || !resolve.Equal(start.Add(8*time.Hour)) {
		t.Fatalf("urgent = %s / %s", respond, resolve)
	}
}

func TestDeadlinesInBranchWorkingHours(t *testing.T) {
	sla := DefaultSLA() // normal: 8 working hours to respond, 48 to resolve
	cases := []struct {
		name          string
		start         time.Time
		loc           *time.Location
		respond, done time.Time
	}{
		{
			// 10.00 + 8h stays inside the day.
			name: "jakarta morning", start: at("2026-10-26 10:00", wib), loc: wib,
			respond: at("2026-10-26 18:00", wib),
			// 48h of 13h days: 11h left on day one, 13+13 on the next two, 11h on day four.
			done: at("2026-10-29 19:00", wib),
		},
		{
			// Raised after closing: the clock starts at 08.00 next day.
			name: "jakarta night", start: at("2026-10-26 22:15", wib), loc: wib,
			respond: at("2026-10-27 16:00", wib), done: at("2026-10-30 17:00", wib),
		},
		{
			// 21.30 WIB is 22.30 WITA: the Makassar branch is closed too.
			name: "makassar after hours", start: at("2026-10-26 21:30", wib), loc: wita,
			respond: at("2026-10-27 16:00", wita), done: at("2026-10-30 17:00", wita),
		},
		{
			// 06.30 WIB is 08.30 WIT: Jayapura is already open.
			name: "jayapura early", start: at("2026-10-26 06:30", wib), loc: wit,
			respond: at("2026-10-26 16:30", wit), done: at("2026-10-29 17:30", wit),
		},
		{
			// 20.00 WIB: one working hour left in Jakarta, seven next morning.
			name: "jakarta near closing", start: at("2026-10-26 20:00", wib), loc: wib,
			respond: at("2026-10-27 15:00", wib), done: at("2026-10-30 16:00", wib),
		},
	}
	for _, c := range cases {
		respond, done := Deadlines(c.start, Normal, sla, DefaultWindow, c.loc)
		if !respond.Equal(c.respond) || !done.Equal(c.done) {
			t.Errorf("%s: got %s / %s, want %s / %s", c.name, respond.In(c.loc), done.In(c.loc), c.respond, c.done)
		}
	}
	// The same instant in a later zone opens later in absolute time.
	jkt, _ := Deadlines(at("2026-10-26 07:30", wib), Normal, sla, DefaultWindow, wib)
	jyp, _ := Deadlines(at("2026-10-26 07:30", wib), Normal, sla, DefaultWindow, wit)
	if !jkt.Equal(at("2026-10-26 16:00", wib)) || !jyp.Equal(at("2026-10-26 17:30", wit)) {
		t.Errorf("zones: %s / %s", jkt, jyp.In(wit))
	}
}

func TestEscalationDue(t *testing.T) {
	now := at("2026-10-27 12:00", wib)
	past, future := now.Add(-time.Minute), now.Add(time.Hour)
	stamp := now.Add(-time.Hour)
	cases := []struct {
		name string
		c    Clock
		want Escalation
	}{
		{"respond missed", Clock{Status: Received, RespondBy: past, ResolveBy: future}, EscalateRespond},
		{"responded", Clock{Status: InProgress, RespondBy: past, ResolveBy: future, FirstResponseAt: &stamp}, ""},
		{"respond sent", Clock{Status: Received, RespondBy: past, ResolveBy: future, RespondEscalatedAt: &stamp}, ""},
		{"resolve wins", Clock{Status: Received, RespondBy: past, ResolveBy: past}, EscalateResolve},
		{"resolve sent", Clock{Status: InProgress, RespondBy: past, ResolveBy: past, FirstResponseAt: &stamp, ResolveEscalatedAt: &stamp}, ""},
		{"reopened late", Clock{Status: Reopened, RespondBy: past, ResolveBy: past, FirstResponseAt: &stamp}, EscalateResolve},
		{"resolved", Clock{Status: Resolved, RespondBy: past, ResolveBy: past}, ""},
		{"on time", Clock{Status: Received, RespondBy: future, ResolveBy: future}, ""},
	}
	for _, c := range cases {
		if got := c.c.Due(now); got != c.want {
			t.Errorf("%s: Due = %q, want %q", c.name, got, c.want)
		}
	}
	if !(Clock{Status: Received, RespondBy: past, ResolveBy: future}).Overdue(now) {
		t.Error("missed respond deadline is overdue")
	}
	if (Clock{Status: Resolved, RespondBy: past, ResolveBy: past}).Overdue(now) {
		t.Error("a resolved ticket is never overdue")
	}
}

func TestSendableNow(t *testing.T) {
	night := at("2026-10-26 22:00", wib) // 23.00 WITA, 00.00 WIT
	if SendableNow(night, Normal, DefaultWindow, wib) {
		t.Error("normal tickets wait for the morning")
	}
	if !SendableNow(night, Urgent, DefaultWindow, wib) || !SendableNow(night, High, DefaultWindow, wita) {
		t.Error("urgent and high go out at night")
	}
	// 07.30 WIB is 09.30 WIT: open in Jayapura, closed in Jakarta.
	early := at("2026-10-26 07:30", wib)
	if SendableNow(early, Low, DefaultWindow, wib) || !SendableNow(early, Low, DefaultWindow, wit) {
		t.Error("the window follows the branch zone")
	}
}

func TestCodeTitleAndInboxFlags(t *testing.T) {
	// 31 Oct 2026 20.00 UTC is 1 Nov in Jakarta.
	if got := Code(time.Date(2026, 10, 31, 20, 0, 0, 0, time.UTC), 7); got != "KEL-2611-0007" {
		t.Errorf("Code = %s", got)
	}
	if got := Title("  Lantai licin  ", "x", "Fasilitas"); got != "Lantai licin" {
		t.Errorf("Title = %q", got)
	}
	long := strings.Repeat("kata ", 30)
	if got := Title("", long, "Kelas"); len([]rune(got)) != 80 || !strings.HasSuffix(got, "…") {
		t.Errorf("Title from description = %q", got)
	}
	if got := Title("", " ", "Booking / aplikasi"); got != "Keluhan booking / aplikasi" {
		t.Errorf("Title fallback = %q", got)
	}
	pay, svc := "pembayaran", "layanan"
	if CategoryFromInbox(&pay) != "pembayaran" || CategoryFromInbox(&svc) != "lainnya" || CategoryFromInbox(nil) != "lainnya" {
		t.Error("CategoryFromInbox")
	}
	if PriorityFromInbox("normal", true) != High || PriorityFromInbox("urgent", true) != Urgent ||
		PriorityFromInbox("low", false) != Low || PriorityFromInbox("bogus", false) != Normal {
		t.Error("PriorityFromInbox")
	}
}

func TestAlertMessage(t *testing.T) {
	msg := AlertMessage(AlertInput{Kind: EscalateResolve, Code: "KEL-2610-0001", Title: "AC mati", Category: "Fasilitas",
		Priority: High, Coach: "Raka", Deadline: at("2026-10-27 18:00", wita), Zone: wita, Link: "https://x/t/1"})
	for _, want := range []string{"*Keluhan KEL-2610-0001 belum selesai*", "Lewat batas selesai Sel, 27 Okt, 18.00 WITA.", "Fasilitas · Tinggi", "Coach: Raka", "PIC: belum ada", "Tangani di: https://x/t/1"} {
		if !strings.Contains(msg, want) {
			t.Errorf("message lacks %q:\n%s", want, msg)
		}
	}
	if strings.Contains(msg, "Pelapor") {
		t.Error("empty reporter line")
	}
}
