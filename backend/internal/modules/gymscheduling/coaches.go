package gymscheduling

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/validate"
)

// Coach pages: the coach portal (Kelas Saya), one coach's week with its
// workload, the coach photo upload and the public coach list.

var (
	// myClassesRead opens the coach portal: the caller's own classes.
	myClassesRead = iam.Can(actRead, iam.GymMyClasses)
	// myClassesAttendance checks members in and marks no-shows in the
	// caller's own classes.
	myClassesAttendance = iam.Can(actUpdate, iam.GymMyClasses)
)

// ownOnly reports whether a grant only reaches the caller's own classes.
func ownOnly(g iam.Grant) bool {
	return g.Action == actReadOwn || slices.Equal(g.Prefixes, iam.GymMyClasses)
}

// ── Coach portal ────────────────────────────────────────────────────────────

// myClasses is GET /api/gym/my-classes?from&to: the caller's coach profile
// and the sessions it coaches in the range (default the next 14 days).
// Without a linked coach both are empty.
func (h *handler) myClasses(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	from, to := rangeParams(r.URL.Query(), h.svc.now(), 14)
	out, err := h.svc.MyClasses(r.Context(), user.ID, from, to)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

// MyClasses is the coach linked to userID and its sessions starting in
// [from, to); both are empty without a link.
func (s *Service) MyClasses(ctx context.Context, userID string, from, to time.Time) (*Row, error) {
	coachID, err := s.CoachForUser(ctx, userID)
	if err != nil || coachID == "" {
		return object("coach", nil, "sessions", []any{}), err
	}
	coach, err := s.repo.ActiveCoach(ctx, s.db, coachID)
	if err != nil {
		return nil, err
	}
	sessions, err := s.ListSessions(ctx, SessionFilter{From: &from, To: &to, CoachID: &coachID})
	if err != nil {
		return nil, err
	}
	return object("coach", coach, "sessions", sessions), nil
}

// mySession is GET /api/gym/my-classes/sessions/{id}: one of the caller's
// classes with its roster; any other session is 404.
func (h *handler) mySession(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	ctx := r.Context()
	coachID, err := h.svc.CoachForUser(ctx, user.ID)
	if err != nil {
		return err
	}
	session, err := h.svc.GetSession(ctx, id, nil)
	if err != nil {
		return err
	}
	if session == nil || coachID == "" || session.Str("coach_id") != coachID {
		return httpx.NotFound("Sesi tidak ditemukan")
	}
	roster, err := h.svc.Roster(ctx, id)
	if err != nil {
		return err
	}
	return httpx.OK(w, object("session", session, "roster", roster))
}

// ── One coach's week ────────────────────────────────────────────────────────

// CoachWorkload counts a coach's held sessions (published, full or
// completed) in a week and in a calendar month, with the month's average
// fill (booked seats over capacity, no-shows included).
type CoachWorkload struct {
	WeekSessions  int      `json:"week_sessions"`
	MonthSessions int      `json:"month_sessions"`
	AvgFill       *float64 `json:"avg_fill"`
}

var heldStatuses = []string{string(domain.SessionPublished), string(domain.SessionFull), string(domain.SessionCompleted)}

// coachWorkload computes the figures from the sessions of the month and the
// week ([weekStart, weekEnd)).
func coachWorkload(rows []*Row, weekStart, weekEnd, monthStart, monthEnd time.Time) CoachWorkload {
	var w CoachWorkload
	fillSum := 0.0
	for _, s := range rows {
		if !slices.Contains(heldStatuses, s.Str("status")) {
			continue
		}
		starts := s.Time("starts_at")
		if !starts.Before(weekStart) && starts.Before(weekEnd) {
			w.WeekSessions++
		}
		if starts.Before(monthStart) || !starts.Before(monthEnd) {
			continue
		}
		w.MonthSessions++
		if capacity := s.Int("capacity"); capacity > 0 {
			fillSum += min(1, float64(s.Int("confirmed_count")+s.Int("no_show_count"))/float64(capacity))
		}
	}
	if w.MonthSessions > 0 {
		avg := fillSum / float64(w.MonthSessions)
		w.AvgFill = &avg
	}
	return w
}

// coachSchedule is GET /api/gym/coaches/{id}/schedule?day=YYYY-MM-DD (in
// the coach's branch zone, default today).
func (h *handler) coachSchedule(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	out, err := h.svc.CoachSchedule(r.Context(), id, r.URL.Query().Get("day"))
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

// CoachSchedule is the coach's sessions in the week holding rawDay (Monday
// to Sunday in the coach's branch zone; "" is today) and the workload of
// that week and of the day's month.
func (s *Service) CoachSchedule(ctx context.Context, coachID, rawDay string) (*Row, error) {
	zone, err := s.repo.CoachZone(ctx, s.db, coachID)
	if err != nil {
		return nil, err
	}
	day := s.now()
	if rawDay != "" {
		var valid bool
		if day, valid = localMidnight(rawDay, zone); !valid {
			return nil, httpx.BadRequest("Parameter day harus tanggal (YYYY-MM-DD)")
		}
	}
	week := localtime.WeekStart(day, zone)
	weekEnd := domain.ShiftDays(week, 7)
	local := day.In(zone)
	monthStart := time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, zone)
	monthEnd := monthStart.AddDate(0, 1, 0)
	// The week can start in the previous month or end in the next.
	from, to := monthStart, monthEnd
	if week.Before(from) {
		from = week
	}
	if weekEnd.After(to) {
		to = weekEnd
	}
	rows, err := s.ListSessions(ctx, SessionFilter{From: &from, To: &to, CoachID: &coachID})
	if err != nil {
		return nil, err
	}
	sessions := []*Row{}
	for _, row := range rows {
		if starts := row.Time("starts_at"); !starts.Before(week) && starts.Before(weekEnd) {
			sessions = append(sessions, row)
		}
	}
	return object("week_start", week.Format(time.DateOnly), "month", monthStart.Format("2006-01"), "sessions", sessions,
		"workload", coachWorkload(rows, week, weekEnd, monthStart, monthEnd), "timezone", localtime.Name(zone)), nil
}

// ── Photo ───────────────────────────────────────────────────────────────────

const (
	maxCoachPhotoBytes = 5 << 20
	// Coach photos sit in the public site bucket: the website shows them.
	coachPhotoBucket = "site"
	coachPhotoFolder = "coaches"
)

// uploadCoachPhoto is POST /api/gym/coaches/photo (multipart "file"): it
// stores a JPG, PNG or WebP up to 5 MB and returns its URL for photo_url.
func (h *handler) uploadCoachPhoto(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	form, err := storage.ReadForm(r, storage.MaxRequestBytes)
	if errors.Is(err, storage.ErrBodyTooLarge) {
		return httpx.BadRequest("Foto maksimal 5 MB")
	}
	var file *storage.File
	if err == nil {
		file = form.File("file")
	}
	switch {
	case file == nil || file.Size() == 0:
		return httpx.BadRequest("Pilih file foto dulu")
	case file.Size() > maxCoachPhotoBytes:
		return httpx.BadRequest("Foto maksimal 5 MB")
	}
	mime := storage.SniffImage(file.Data)
	if mime == "" {
		return httpx.BadRequest("File harus gambar JPG, PNG, atau WebP")
	}
	url, err := storage.FromEnv().Upload(coachPhotoBucket, coachPhotoFolder, file.Data, mime, file.Name)
	if err != nil {
		h.log.ErrorContext(r.Context(), "gym: coach photo upload failed", "error", err)
		return httpx.Status(http.StatusInternalServerError, "Gagal mengunggah foto")
	}
	return httpx.OK(w, object("url", url))
}

// photoURLCheck accepts an absolute URL or a file served by /api/files.
func photoURLCheck(s string) (string, string, bool) {
	if strings.HasPrefix(s, "/api/files/") && !strings.Contains(s, "..") {
		return "", "", true
	}
	return validate.URLCheck(s)
}

// ── Public ──────────────────────────────────────────────────────────────────

// PublicCoach is an active coach's name and photo for the website.
type PublicCoach struct {
	Name     string  `json:"name"`
	PhotoURL *string `json:"photo_url"`
}

// publicCoaches is GET /api/public/site/coaches: active coaches, so the site
// can show the photo staff uploaded when its own content has none.
func (h *handler) publicCoaches(w http.ResponseWriter, r *http.Request) error {
	out, err := h.svc.PublicCoaches(r.Context())
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

// PublicCoaches lists the active coaches by name.
func (s *Service) PublicCoaches(ctx context.Context) ([]PublicCoach, error) {
	rows, err := s.repo.MemberCoaches(ctx, s.db)
	if err != nil {
		return nil, err
	}
	out := make([]PublicCoach, len(rows))
	for i, c := range rows {
		out[i] = PublicCoach{Name: c.Str("name"), PhotoURL: c.StrPtr("photo_url")}
	}
	return out, nil
}
