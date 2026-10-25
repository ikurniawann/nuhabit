// Package domain holds the rules of gym complaint tickets without I/O: the
// status machine, SLA deadlines in a branch's time zone, escalation timing,
// ticket codes and the copy of member notices and staff alerts.
package domain

import (
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"nuhabit/backend/internal/platform/localtime"
)

// Status is a ticket's place in the resolution flow.
type Status string

const (
	Received   Status = "received"
	InProgress Status = "in_progress"
	Resolved   Status = "resolved"
	Confirmed  Status = "confirmed"
	Reopened   Status = "reopened"
)

// Statuses lists every status in flow order.
var Statuses = []Status{Received, InProgress, Resolved, Confirmed, Reopened}

// StatusLabel is the Indonesian name staff and alerts use.
var StatusLabel = map[Status]string{
	Received:   "Diterima",
	InProgress: "Ditangani",
	Resolved:   "Selesai",
	Confirmed:  "Dikonfirmasi member",
	Reopened:   "Dibuka lagi",
}

// Open reports whether the SLA clock runs: the ticket still waits for staff.
func Open(s Status) bool { return s == Received || s == InProgress || s == Reopened }

// Actor is who moves a ticket.
type Actor int

const (
	Staff Actor = iota
	Member
)

var staffMoves = map[Status][]Status{
	Received:   {InProgress, Resolved},
	InProgress: {Resolved},
	Reopened:   {InProgress, Resolved},
	// Staff confirm or reopen on the member's word (a call, the desk, WhatsApp).
	Resolved: {Confirmed, Reopened},
}

var memberMoves = map[Status][]Status{
	Resolved: {Confirmed, Reopened},
}

// CanMove reports whether actor may move a ticket from one status to another.
// Confirmed is final.
func CanMove(from, to Status, actor Actor) bool {
	moves := staffMoves
	if actor == Member {
		moves = memberMoves
	}
	return slices.Contains(moves[from], to)
}

// NextStatuses lists the moves staff can make from s.
func NextStatuses(s Status) []Status { return slices.Clone(staffMoves[s]) }

// NeedsNote reports whether a move must carry a text: the resolution the
// member reads, or the reason to reopen.
func NeedsNote(to Status) bool { return to == Resolved || to == Reopened }

// Priority is how fast a ticket must be handled.
type Priority string

const (
	Low    Priority = "low"
	Normal Priority = "normal"
	High   Priority = "high"
	Urgent Priority = "urgent"
)

// Priorities lists the priorities from lowest.
var Priorities = []Priority{Low, Normal, High, Urgent}

// PriorityLabel is the Indonesian name.
var PriorityLabel = map[Priority]string{Low: "Rendah", Normal: "Normal", High: "Tinggi", Urgent: "Mendesak"}

// Source is where a ticket came from.
type Source string

const (
	SourceInbox     Source = "wa_inbox"
	SourceDesk      Source = "front_desk"
	SourceMemberApp Source = "member_app"
	SourceStaff     Source = "staff"
)

// Sources lists every source.
var Sources = []Source{SourceInbox, SourceDesk, SourceMemberApp, SourceStaff}

// SourceLabel is the Indonesian name.
var SourceLabel = map[Source]string{
	SourceInbox: "WhatsApp inbox", SourceDesk: "Front desk", SourceMemberApp: "Member app", SourceStaff: "Staf",
}

// ValidPriority and ValidSource check request values.
func ValidPriority(p string) bool { return slices.Contains(Priorities, Priority(p)) }
func ValidSource(s string) bool   { return slices.Contains(Sources, Source(s)) }
func ValidStatus(s string) bool   { return slices.Contains(Statuses, Status(s)) }

// ── SLA ──────────────────────────────────────────────────────────────────────

// Rule is the SLA of one priority. BusinessHours counts only the branch's
// working window; otherwise the clock runs around the clock.
type Rule struct {
	RespondHours  int  `json:"respond_hours"`
	ResolveHours  int  `json:"resolve_hours"`
	BusinessHours bool `json:"business_hours"`
}

// SLA maps each priority to its rule.
type SLA map[Priority]Rule

// MaxSLAHours caps a deadline at two weeks.
const MaxSLAHours = 24 * 14

// DefaultSLA: urgent and high run around the clock, normal and low count
// working hours only.
func DefaultSLA() SLA {
	return SLA{
		Urgent: {RespondHours: 1, ResolveHours: 8},
		High:   {RespondHours: 4, ResolveHours: 24},
		Normal: {RespondHours: 8, ResolveHours: 48, BusinessHours: true},
		Low:    {RespondHours: 24, ResolveHours: 120, BusinessHours: true},
	}
}

// Normalize fills missing priorities from the defaults, clamps hours to
// 1..MaxSLAHours and keeps the resolve deadline at or after the respond one.
func (s SLA) Normalize() SLA {
	out := DefaultSLA()
	for _, p := range Priorities {
		r, ok := s[p]
		if !ok {
			continue
		}
		clamp := func(h, fallback int) int {
			if h <= 0 {
				return fallback
			}
			return min(h, MaxSLAHours)
		}
		r.RespondHours = clamp(r.RespondHours, out[p].RespondHours)
		r.ResolveHours = max(r.RespondHours, clamp(r.ResolveHours, out[p].ResolveHours))
		out[p] = r
	}
	return out
}

// Window is the working day in a branch's local time, minutes after midnight.
type Window struct{ Start, End int }

// DefaultWindow is 08.00 to 21.00.
var DefaultWindow = Window{Start: 8 * 60, End: 21 * 60}

// Valid reports a window inside one day with End after Start.
func (w Window) Valid() bool { return w.Start >= 0 && w.End <= 24*60 && w.End > w.Start }

// Contains reports whether t falls in the window in loc.
func (w Window) Contains(t time.Time, loc *time.Location) bool {
	l := t.In(orJakarta(loc))
	m := l.Hour()*60 + l.Minute()
	return m >= w.Start && m < w.End
}

// AddHours moves start forward by hours. With business set only the window
// of each local day counts: a ticket raised after closing starts its clock
// at the next opening.
func AddHours(start time.Time, hours int, business bool, w Window, loc *time.Location) time.Time {
	remaining := time.Duration(hours) * time.Hour
	if !business || !w.Valid() {
		return start.Add(remaining)
	}
	loc = orJakarta(loc)
	t := start.In(loc)
	for {
		day := localtime.DayStart(t, loc)
		open, close := day.Add(time.Duration(w.Start)*time.Minute), day.Add(time.Duration(w.End)*time.Minute)
		if t.Before(open) {
			t = open
		}
		if !t.Before(close) {
			t = day.AddDate(0, 0, 1).Add(time.Duration(w.Start) * time.Minute)
			continue
		}
		left := close.Sub(t)
		if remaining <= left {
			return t.Add(remaining)
		}
		remaining -= left
		t = day.AddDate(0, 0, 1)
	}
}

// Deadlines are the respond and resolve deadlines of a ticket whose clock
// starts at start.
func Deadlines(start time.Time, p Priority, sla SLA, w Window, loc *time.Location) (respondBy, resolveBy time.Time) {
	r := sla.Normalize()[p]
	return AddHours(start, r.RespondHours, r.BusinessHours, w, loc), AddHours(start, r.ResolveHours, r.BusinessHours, w, loc)
}

func orJakarta(loc *time.Location) *time.Location {
	if loc == nil {
		return localtime.Jakarta
	}
	return loc
}

// ── Escalation ───────────────────────────────────────────────────────────────

// Escalation is the deadline a ticket missed.
type Escalation string

const (
	EscalateRespond Escalation = "respond"
	EscalateResolve Escalation = "resolve"
)

// Clock is the part of a ticket the SLA and escalation rules read.
type Clock struct {
	Status             Status
	RespondBy          time.Time
	ResolveBy          time.Time
	FirstResponseAt    *time.Time
	RespondEscalatedAt *time.Time
	ResolveEscalatedAt *time.Time
}

// Overdue reports whether an open ticket missed a deadline: no first
// response by RespondBy, or not resolved by ResolveBy.
func (c Clock) Overdue(now time.Time) bool {
	if !Open(c.Status) {
		return false
	}
	return now.After(c.ResolveBy) || (c.FirstResponseAt == nil && now.After(c.RespondBy))
}

// Due is the escalation to send now, "" when none: the resolve deadline wins,
// and each deadline escalates once.
func (c Clock) Due(now time.Time) Escalation {
	if !Open(c.Status) {
		return ""
	}
	if c.ResolveEscalatedAt == nil && now.After(c.ResolveBy) {
		return EscalateResolve
	}
	if c.FirstResponseAt == nil && c.RespondEscalatedAt == nil && now.After(c.RespondBy) {
		return EscalateRespond
	}
	return ""
}

// SendableNow reports whether an escalation may go out at now: inside the
// branch's working window, or any time for high and urgent tickets.
func SendableNow(now time.Time, p Priority, w Window, loc *time.Location) bool {
	return p == High || p == Urgent || !w.Valid() || w.Contains(now, loc)
}

// AlertInput is what an escalation message names.
type AlertInput struct {
	Kind     Escalation
	Code     string
	Title    string
	Category string
	Priority Priority
	Reporter string
	Coach    string
	Owner    string
	Deadline time.Time
	Zone     *time.Location
	Link     string
}

// AlertTitle is the staff inbox title and the first WhatsApp line.
func AlertTitle(k Escalation, code string) string {
	if k == EscalateRespond {
		return "Keluhan " + code + " belum ditangani"
	}
	return "Keluhan " + code + " belum selesai"
}

// AlertMessage is the WhatsApp text to the head coach or ops.
func AlertMessage(in AlertInput) string {
	limit := "batas respons"
	if in.Kind == EscalateResolve {
		limit = "batas selesai"
	}
	owner := in.Owner
	if owner == "" {
		owner = "belum ada"
	}
	lines := []string{
		"*" + AlertTitle(in.Kind, in.Code) + "*",
		fmt.Sprintf("Lewat %s %s.", limit, localtime.Format(in.Deadline, in.Zone)),
		"",
		in.Category + " · " + PriorityLabel[in.Priority],
		in.Title,
	}
	if in.Reporter != "" {
		lines = append(lines, "Pelapor: "+in.Reporter)
	}
	if in.Coach != "" {
		lines = append(lines, "Coach: "+in.Coach)
	}
	lines = append(lines, "PIC: "+owner)
	if in.Link != "" {
		lines = append(lines, "", "Tangani di: "+in.Link)
	}
	return strings.Join(lines, "\n")
}

// ── Tickets ──────────────────────────────────────────────────────────────────

// Code is "KEL-2610-0007": year and month in Jakarta, then a sequence that
// restarts every month.
func Code(now time.Time, seq int) string {
	return fmt.Sprintf("%s%04d", CodePrefix(now), seq)
}

// CodePrefix is "KEL-2610-".
func CodePrefix(now time.Time) string { return "KEL-" + now.In(localtime.Jakarta).Format("0601") + "-" }

// Title is the staff title, or the first words of the description, or
// "Keluhan <category>".
func Title(title, description, categoryLabel string) string {
	if t := strings.TrimSpace(title); t != "" {
		return truncate(t, 120)
	}
	if d := strings.Join(strings.Fields(description), " "); d != "" {
		return truncate(d, 80)
	}
	return "Keluhan " + strings.ToLower(categoryLabel)
}

func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:n-1])) + "…"
}

// Inbox conversations carry their own complaint flags (crm inbox): a CS
// category (produk, layanan, pembayaran, lainnya), a priority and an SLA breach.

// CategoryFromInbox maps the CS category: payment stays payment, the rest
// lands in "lainnya" for staff to sort.
func CategoryFromInbox(cs *string) string {
	if cs != nil && *cs == "pembayaran" {
		return "pembayaran"
	}
	return "lainnya"
}

// PriorityFromInbox keeps the conversation's priority, raised to high when
// the inbox reply SLA was already breached.
func PriorityFromInbox(p string, breached bool) Priority {
	pr := Priority(p)
	if !ValidPriority(p) {
		pr = Normal
	}
	if breached && (pr == Low || pr == Normal) {
		return High
	}
	return pr
}

// ── Member app ───────────────────────────────────────────────────────────────

const (
	MemberDailyLimit = 5
	MemberMinLength  = 10
	MemberMaxLength  = 2000
)

// MemberNotice is the member inbox message for a status move or reply.
func MemberNotice(code string, to Status, reply bool) (title, body string) {
	if reply {
		return "Balasan untuk laporan " + code, "Tim NüHabit membalas laporanmu. Buka aplikasi untuk membacanya."
	}
	switch to {
	case InProgress:
		return "Laporan " + code + " sedang ditangani", "Tim kami sedang menindaklanjuti laporanmu."
	case Resolved:
		return "Laporan " + code + " selesai", "Laporanmu sudah ditangani. Konfirmasi selesai atau buka lagi bila masih ada masalah."
	case Reopened:
		return "Laporan " + code + " dibuka lagi", "Kami membuka lagi laporanmu dan akan menindaklanjutinya."
	case Confirmed:
		return "Laporan " + code + " ditutup", "Terima kasih sudah mengonfirmasi. Laporanmu ditutup."
	}
	return "", ""
}
