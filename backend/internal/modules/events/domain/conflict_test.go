package domain

import (
	"strings"
	"testing"
	"time"

	eventsc "nuhabit/backend/internal/contracts/events"
	"nuhabit/backend/internal/platform/localtime"
)

func at(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

func ptr(s string) *string { return &s }

var (
	branchA = ptr("branch-a")
	branchB = ptr("branch-b")
	coach1  = ptr("coach-1")
)

func subject(area, coach *string) eventsc.Subject {
	return eventsc.Subject{Source: eventsc.SourceCRM, Title: "Race Day", BranchID: branchA, Area: area, CoachID: coach,
		StartsAt: at("2026-11-02T03:00:00Z"), EndsAt: at("2026-11-02T05:00:00Z")}
}

func class(id string, branch, area, coach *string, start, end string) Entry {
	return Entry{Kind: eventsc.KindClass, ID: id, Title: "HYROX Fundamentals", BranchID: branch, Area: area, CoachID: coach,
		CoachName: ptr("Dimas"), StartsAt: at(start), EndsAt: at(end)}
}

func TestDetectRoomClashBlocks(t *testing.T) {
	s := subject(ptr(" Studio 2 "), nil)
	r := Detect(s, []Entry{class("c1", branchA, ptr("studio 2"), coach1, "2026-11-02T04:00:00Z", "2026-11-02T05:00:00Z")})
	if len(r.Blocking) != 1 || r.Blocking[0].Reason != ReasonRoom || len(r.Warnings) != 0 {
		t.Fatalf("want one room clash, got %+v", r)
	}
	if msg := r.Blocking[0].Message; !strings.HasPrefix(msg, "Area studio 2 sudah dipakai kelas HYROX Fundamentals pada ") ||
		!strings.Contains(msg, "11.00–12.00") {
		t.Fatalf("message %q", msg)
	}
}

func TestDetectSameAreaOtherBranchIsNoClash(t *testing.T) {
	s := subject(ptr("Studio 2"), nil)
	r := Detect(s, []Entry{class("c1", branchB, ptr("Studio 2"), nil, "2026-11-02T04:00:00Z", "2026-11-02T05:00:00Z")})
	if len(r.Blocking) != 0 || len(r.Warnings) != 0 {
		t.Fatalf("another branch's room is free, got %+v", r)
	}
}

func TestDetectCoachClashBlocksEvenAcrossBranches(t *testing.T) {
	s := subject(nil, coach1)
	r := Detect(s, []Entry{class("c1", branchB, ptr("Floor"), coach1, "2026-11-02T04:30:00Z", "2026-11-02T06:00:00Z")})
	if len(r.Blocking) != 1 || r.Blocking[0].Reason != ReasonCoach {
		t.Fatalf("want a coach clash, got %+v", r)
	}
	if msg := r.Blocking[0].Message; !strings.HasPrefix(msg, "Coach Dimas sudah mengisi kelas HYROX Fundamentals pada ") {
		t.Fatalf("message %q", msg)
	}
}

func TestDetectBranchWideClassIsWarning(t *testing.T) {
	s := subject(ptr("Studio 1"), nil)
	others := []Entry{
		class("c1", branchA, ptr("Studio 2"), coach1, "2026-11-02T04:00:00Z", "2026-11-02T05:00:00Z"),
		{Kind: eventsc.KindPT, ID: "p1", Title: "PT", BranchID: branchA, CoachID: ptr("coach-9"),
			StartsAt: at("2026-11-02T04:00:00Z"), EndsAt: at("2026-11-02T05:00:00Z")},
		{Kind: eventsc.KindSiteEvent, ID: "s1", Title: "Open House", BranchID: branchA, Area: ptr("Lobby"),
			StartsAt: at("2026-11-02T04:00:00Z"), EndsAt: at("2026-11-02T05:00:00Z")},
	}
	r := Detect(s, others)
	if len(r.Blocking) != 0 {
		t.Fatalf("another room never blocks, got %+v", r.Blocking)
	}
	if len(r.Warnings) != 1 || r.Warnings[0].ID != "c1" || r.Warnings[0].Reason != ReasonBranch {
		t.Fatalf("only the class warns, got %+v", r.Warnings)
	}
	if !strings.HasPrefix(r.Warnings[0].Message, "Waktunya beririsan dengan kelas HYROX Fundamentals di cabang yang sama") {
		t.Fatalf("message %q", r.Warnings[0].Message)
	}
}

func TestDetectBackToBackAndSelfAreIgnored(t *testing.T) {
	s := subject(ptr("Studio 2"), coach1)
	s.ID = "me"
	others := []Entry{
		class("c1", branchA, ptr("Studio 2"), coach1, "2026-11-02T05:00:00Z", "2026-11-02T06:00:00Z"),
		class("c2", branchA, ptr("Studio 2"), coach1, "2026-11-02T01:00:00Z", "2026-11-02T03:00:00Z"),
		{Kind: eventsc.KindCRMEvent, ID: "me", Title: "Race Day", BranchID: branchA, Area: ptr("Studio 2"), CoachID: coach1,
			StartsAt: at("2026-11-02T03:00:00Z"), EndsAt: at("2026-11-02T05:00:00Z")},
	}
	if r := Detect(s, others); len(r.Blocking) != 0 || len(r.Warnings) != 0 {
		t.Fatalf("back-to-back slots and the subject itself never clash, got %+v", r)
	}
}

func TestDetectMessageUsesTheOtherEntryZone(t *testing.T) {
	s := subject(ptr("Arena"), nil)
	o := class("c1", branchA, ptr("Arena"), nil, "2026-11-02T04:00:00Z", "2026-11-02T05:00:00Z")
	o.Zone = localtime.Zone("Asia/Makassar")
	r := Detect(s, []Entry{o})
	if len(r.Blocking) != 1 || !strings.Contains(r.Blocking[0].Message, "12.00–13.00 WITA") {
		t.Fatalf("want the WITA wall clock, got %+v", r.Blocking)
	}
}

func TestDetectCoachClashOutranksRoomClash(t *testing.T) {
	s := subject(ptr("Arena"), coach1)
	o := class("c1", branchA, ptr("Arena"), coach1, "2026-11-02T04:00:00Z", "2026-11-02T05:00:00Z")
	r := Detect(s, []Entry{o})
	if len(r.Blocking) != 1 || r.Blocking[0].Reason != ReasonCoach {
		t.Fatalf("one entry yields one clash, the coach one, got %+v", r.Blocking)
	}
}
