package gymscheduling

import (
	"context"
	"net/http"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// Public timetable: GET /api/public/site/sessions?branch=<slug>&week=<Monday>.
// No session is required; the auth gate lists /api/public/site as public.

// PublicTimetable is the response: the branch, the Monday the week starts
// on (WIB, YYYY-MM-DD) and its open sessions.
type PublicTimetable struct {
	Branch    PublicBranch    `json:"branch"`
	WeekStart string          `json:"week_start"`
	Sessions  []PublicSession `json:"sessions"`
}

// publicWeeksAhead caps how far the public timetable looks ahead.
const publicWeeksAhead = 8

// mondayOf is the Monday 00:00 WIB of the week holding t.
func mondayOf(t time.Time) time.Time {
	t = t.In(domain.WIB)
	back := (int(t.Weekday()) + 6) % 7
	return time.Date(t.Year(), t.Month(), t.Day()-back, 0, 0, 0, 0, domain.WIB)
}

func (h *handler) publicSessions(w http.ResponseWriter, r *http.Request) error {
	query := r.URL.Query()
	slug := strings.TrimSpace(query.Get("branch"))
	if slug == "" {
		return httpx.BadRequest("Parameter branch wajib diisi")
	}
	week := mondayOf(h.svc.now())
	if raw := query.Get("week"); raw != "" {
		day, valid := wibMidnight(raw)
		if !valid || day.Weekday() != time.Monday {
			return httpx.BadRequest("Parameter week harus tanggal Senin (YYYY-MM-DD)")
		}
		week = day
	}
	out, err := h.svc.PublicTimetable(r.Context(), slug, week)
	if err != nil {
		return err
	}
	if out == nil {
		return httpx.NotFound("Cabang tidak ditemukan")
	}
	return ok(w, out)
}

// PublicTimetable lists the branch's published sessions for the week
// starting on week (a Monday), clamped to the current week and the next
// publicWeeksAhead. nil when the branch is unknown.
func (s *Service) PublicTimetable(ctx context.Context, slug string, week time.Time) (*PublicTimetable, error) {
	branch, err := s.repo.PublicBranch(ctx, s.db, slug)
	if err != nil || branch == nil {
		return nil, err
	}
	now := s.now()
	first := mondayOf(now)
	last := domain.ShiftDays(first, 7*publicWeeksAhead)
	if week.Before(first) {
		week = first
	}
	if week.After(last) {
		week = last
	}
	sessions, err := s.repo.PublicWeekSessions(ctx, s.db, branch.ID, week, domain.ShiftDays(week, 7))
	if err != nil {
		return nil, err
	}
	for i := range sessions {
		sessions[i].WaitlistOpen = sessions[i].SeatsLeft == 0 && now.Before(sessions[i].bookingClosesAt)
	}
	return &PublicTimetable{Branch: *branch, WeekStart: week.Format("2006-01-02"), Sessions: sessions}, nil
}
