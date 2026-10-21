package gymscheduling

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strconv"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Open gym hours: one window per weekday per branch, in the branch zone. The rules
// openGymEnabled and openGymCreditCost decide whether the gate uses them.

// OpenHoursView is one weekday's window as the dashboard edits it.
type OpenHoursView struct {
	Weekday  int    `json:"weekday"`
	OpensAt  string `json:"opens_at"`
	ClosesAt string `json:"closes_at"`
}

func clock(min int) string { return fmt.Sprintf("%02d:%02d", min/60, min%60) }

var clockPattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

func clockMinutes(s string) int {
	h, _ := strconv.Atoi(s[:2])
	m, _ := strconv.Atoi(s[3:])
	return h*60 + m
}

func (s *Service) OpenGymHours(ctx context.Context, branchID string) ([]OpenHoursView, error) {
	hours, err := s.repo.OpenGymHours(ctx, s.db, branchID)
	if err != nil {
		return nil, err
	}
	out := make([]OpenHoursView, len(hours))
	for i, h := range hours {
		out[i] = OpenHoursView{Weekday: h.Weekday, OpensAt: clock(h.Opens), ClosesAt: clock(h.Closes)}
	}
	return out, nil
}

func (s *Service) SaveOpenGymHours(ctx context.Context, branchID string, hours []domain.OpenHours, by string) error {
	return s.inTx(ctx, func(q Q) error { return s.repo.ReplaceOpenGymHours(ctx, q, branchID, hours, by) })
}

func (h *handler) openGymHours(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	branchID, err := validate.UUID(r.URL.Query().Get("branch_id"))
	if err != nil {
		return err
	}
	hours, err := h.svc.OpenGymHours(r.Context(), branchID)
	if err != nil {
		return err
	}
	return httpx.OK(w, object("branch_id", branchID, "hours", hours))
}

// saveOpenGymHours is PUT {branch_id, hours: [{weekday, opens_at, closes_at}]}:
// the full week, one window per weekday; an empty list opens the gym all day.
func (h *handler) saveOpenGymHours(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	f := form(r)
	branchID := f.UUID("branch_id", validate.Rule{})
	clockOpts := validate.StrOpts{Check: func(s string) (string, string, bool) {
		return "invalid_format", "Jam harus berformat HH:MM", clockPattern.MatchString(s)
	}}
	var hours []domain.OpenHours
	seen := map[int]bool{}
	f.List("hours", validate.Rule{}, 7, func(sub *validate.Form, i int, v any) {
		item := sub.Item(i, v)
		weekday := item.Int("weekday", validate.Rule{}, between(1, 7))
		opens := item.Str("opens_at", validate.Rule{}, clockOpts)
		closes := item.Str("closes_at", validate.Rule{}, clockOpts)
		if weekday == nil || opens == nil || closes == nil {
			return
		}
		window := domain.OpenHours{Weekday: *weekday, Opens: clockMinutes(*opens), Closes: clockMinutes(*closes)}
		switch {
		case window.Closes <= window.Opens:
			item.Fail("closes_at", "custom", "Jam tutup harus setelah jam buka")
		case seen[window.Weekday]:
			item.Fail("weekday", "custom", "Satu hari hanya punya satu jam open gym")
		}
		seen[window.Weekday] = true
		hours = append(hours, window)
	})
	if err := invalid(f); err != nil {
		return err
	}
	if err := h.svc.SaveOpenGymHours(r.Context(), *branchID, hours, user.ID); err != nil {
		return err
	}
	out, err := h.svc.OpenGymHours(r.Context(), *branchID)
	if err != nil {
		return err
	}
	return httpx.OK(w, object("branch_id", *branchID, "hours", out))
}
