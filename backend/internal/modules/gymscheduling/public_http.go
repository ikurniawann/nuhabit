package gymscheduling

import (
	"context"
	"net/http"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/localtime"
)

// Public timetable: GET /api/public/site/sessions?branch=<slug>&week=<Monday>.
// No session is required; the auth gate lists /api/public/site as public.

// PublicTimetable is the response: the branch, the Monday the week starts
// on (YYYY-MM-DD in the branch zone) and its open sessions.
type PublicTimetable struct {
	Branch    PublicBranch    `json:"branch"`
	WeekStart string          `json:"week_start"`
	Sessions  []PublicSession `json:"sessions"`
}

// publicWeeksAhead caps how far the public timetable looks ahead.
const publicWeeksAhead = 8

var errNotMonday = httpx.BadRequest("Parameter week harus tanggal Senin (YYYY-MM-DD)")

func (h *handler) publicSessions(w http.ResponseWriter, r *http.Request) error {
	query := r.URL.Query()
	slug := strings.TrimSpace(query.Get("branch"))
	if slug == "" {
		return httpx.BadRequest("Parameter branch wajib diisi")
	}
	out, err := h.svc.PublicTimetable(r.Context(), slug, query.Get("week"))
	if err != nil {
		return err
	}
	if out == nil {
		return httpx.NotFound("Cabang tidak ditemukan")
	}
	return httpx.OK(w, out)
}

// PublicTimetable lists the branch's published sessions for the week
// starting on week (a Monday, YYYY-MM-DD in the branch zone; "" is this
// week), clamped to the current week and the next publicWeeksAhead. nil
// when the branch is unknown.
func (s *Service) PublicTimetable(ctx context.Context, slug, rawWeek string) (*PublicTimetable, error) {
	branch, err := s.repo.PublicBranch(ctx, s.db, slug)
	if err != nil || branch == nil {
		return nil, err
	}
	zone := localtime.Zone(branch.Timezone)
	now := s.now()
	first := localtime.WeekStart(now, zone)
	week := first
	if rawWeek != "" {
		day, valid := localMidnight(rawWeek, zone)
		if !valid || day.Weekday() != time.Monday {
			return nil, errNotMonday
		}
		week = day
	}
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
