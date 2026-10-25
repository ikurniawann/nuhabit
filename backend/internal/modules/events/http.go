package events

import (
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	eventsc "nuhabit/backend/internal/contracts/events"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

type handler struct {
	svc   *Service
	guard auth.Granter
}

// Grants. Anyone who sees the calendar or manages events on either side
// reads; writing the checklist, the links and the feeds takes a write
// grant on the CRM or site events menu.
var (
	view   = iam.Can("read", iam.EventsCalendar, iam.CrmEngagement, iam.SiteEvents)
	manage = []iam.Grant{iam.Can("update", iam.CrmEngagement, iam.SiteEvents), iam.Can("create", iam.CrmEngagement, iam.SiteEvents)}
)

// Routes lists the staff (/api/events/**) routes and the public ICS feed.
func (h *handler) Routes() []module.Route {
	staff := func(pattern string, fn auth.StaffFunc, grants ...iam.Grant) module.Route {
		return module.Route{Pattern: pattern, Handler: auth.Staff(h.guard, fn, grants...)}
	}
	return []module.Route{
		staff("GET /api/events/calendar", h.calendar, view),
		staff("GET /api/events/options", h.options, view),
		staff("GET /api/events/export.csv", h.exportCSV, view),
		staff("GET /api/events/overrides", h.overrides, view),
		staff("GET /api/events/link/candidates", h.linkCandidates, view),
		staff("POST /api/events/link", h.link, manage...),
		staff("POST /api/events/link/publish", h.publishToSite, manage...),
		staff("DELETE /api/events/link/{crmEventId}", h.unlink, manage...),
		staff("GET /api/events/tasks", h.tasks, view),
		staff("POST /api/events/tasks", h.addTask, manage...),
		staff("PATCH /api/events/tasks/{id}", h.patchTask, manage...),
		staff("DELETE /api/events/tasks/{id}", h.removeTask, manage...),
		staff("GET /api/events/feeds", h.feeds, view),
		staff("POST /api/events/feeds", h.createFeed, view),
		staff("DELETE /api/events/feeds/{id}", h.revokeFeed, view),
		{Pattern: "GET " + FeedPath, Handler: httpx.Handle(h.feedICS)},
	}
}

func queryTime(r *http.Request, key string) (time.Time, bool) {
	return validate.ParseJSDate(r.URL.Query().Get(key))
}

func queryUUID(r *http.Request, key string) (*string, error) {
	v := strings.TrimSpace(r.URL.Query().Get(key))
	if v == "" {
		return nil, nil
	}
	if !validate.IsUUID(v) {
		return nil, httpx.BadRequest(key + " tidak valid")
	}
	return &v, nil
}

func sourceParam(v string) (eventsc.Source, error) {
	switch eventsc.Source(v) {
	case eventsc.SourceCRM, eventsc.SourceSite:
		return eventsc.Source(v), nil
	}
	return "", httpx.BadRequest("source harus crm atau site")
}

// eventRef reads the ?source=&event_id= pair.
func eventRef(r *http.Request) (eventsc.Source, string, error) {
	src, err := sourceParam(r.URL.Query().Get("source"))
	if err != nil {
		return "", "", err
	}
	id := r.URL.Query().Get("event_id")
	if !validate.IsUUID(id) {
		return "", "", httpx.BadRequest("event_id tidak valid")
	}
	return src, id, nil
}

/* ── calendar ────────────────────────────────────────────────────────── */

var kinds = []string{string(eventsc.KindCRMEvent), string(eventsc.KindSiteEvent), string(eventsc.KindClass), string(eventsc.KindPT)}

func (h *handler) calendar(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	from, okFrom := queryTime(r, "from")
	to, okTo := queryTime(r, "to")
	if !okFrom || !okTo || !to.After(from) || to.Sub(from) > 62*24*time.Hour {
		return httpx.BadRequest("Rentang from/to tidak valid (maksimal 62 hari)")
	}
	branchID, err := queryUUID(r, "branch_id")
	if err != nil {
		return err
	}
	f := CalendarFilter{From: from, To: to, BranchID: branchID}
	if area := strings.TrimSpace(r.URL.Query().Get("area")); area != "" {
		f.Area = &area
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("kinds")); raw != "" {
		for _, k := range strings.Split(raw, ",") {
			if !slices.Contains(kinds, k) {
				return httpx.BadRequest("Jenis " + k + " tidak dikenal")
			}
			f.Kinds = append(f.Kinds, k)
		}
	}
	list, err := h.svc.Calendar(r.Context(), f)
	if err != nil {
		return err
	}
	return httpx.OK(w, list)
}

func (h *handler) options(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	o, err := h.svc.Options(r.Context())
	if err != nil {
		return err
	}
	return httpx.OK(w, o)
}

func (h *handler) exportCSV(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	branchID, err := queryUUID(r, "branch_id")
	if err != nil {
		return err
	}
	month := r.URL.Query().Get("month")
	body, err := h.svc.MonthCSV(r.Context(), month, branchID)
	if errors.Is(err, ErrBadMonth) {
		return httpx.BadRequest(err.Error())
	}
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="kalender-event-`+month+`.csv"`)
	_, err = w.Write(body)
	return err
}

func (h *handler) overrides(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	src, id, err := eventRef(r)
	if err != nil {
		return err
	}
	list, err := h.svc.repo.Overrides(r.Context(), h.svc.db, src, id)
	if err != nil {
		return err
	}
	return httpx.OK(w, list)
}

/* ── links ───────────────────────────────────────────────────────────── */

func (h *handler) linkCandidates(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	src, err := sourceParam(r.URL.Query().Get("source"))
	if err != nil {
		return err
	}
	list, err := h.svc.Candidates(r.Context(), src)
	if err != nil {
		return err
	}
	return httpx.OK(w, list)
}

func notLinkable(err error) error {
	if errors.Is(err, ErrNotLinkable) {
		return httpx.Conflict("Event tidak bisa ditautkan: salah satu sudah tertaut, dibatalkan, atau tidak ada")
	}
	return err
}

func (h *handler) link(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	f := validate.New(validate.ReadBody(r))
	crmID := f.UUID("crm_event_id", validate.Rule{})
	siteID := f.UUID("site_event_id", validate.Rule{})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	if err := h.svc.Link(r.Context(), *crmID, *siteID); err != nil {
		return notLinkable(err)
	}
	return httpx.OK(w, map[string]string{"crm_event_id": *crmID, "site_event_id": *siteID})
}

func (h *handler) publishToSite(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	f := validate.New(validate.ReadBody(r))
	crmID := f.UUID("crm_event_id", validate.Rule{})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	siteID, err := h.svc.PublishToSite(r.Context(), *crmID, user.ID)
	if err != nil {
		return notLinkable(err)
	}
	return httpx.Data(w, http.StatusCreated, map[string]string{"crm_event_id": *crmID, "site_event_id": siteID})
}

func (h *handler) unlink(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	crmID, err := validate.PathUUID(r, "crmEventId")
	if err != nil {
		return err
	}
	ok, err := h.svc.Unlink(r.Context(), crmID)
	if err != nil {
		return err
	}
	if !ok {
		return httpx.NotFound("Event ini tidak tertaut")
	}
	return httpx.OK(w, map[string]string{"crm_event_id": crmID})
}

/* ── tasks ───────────────────────────────────────────────────────────── */

func taskNotFound(err error) error {
	if errors.Is(err, ErrEventNotFound) {
		return httpx.NotFound("Event tidak ditemukan")
	}
	return err
}

func (h *handler) tasks(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	src, id, err := eventRef(r)
	if err != nil {
		return err
	}
	list, err := h.svc.Tasks(r.Context(), src, id)
	if err != nil {
		return taskNotFound(err)
	}
	return httpx.OK(w, list)
}

var (
	taskTitleOpts = validate.StrOpts{Trim: true, Min: 2, Max: 200}
	nullable      = validate.Rule{Optional: true, Nullable: true}
)

// optionalTime reads a nullable ISO datetime: sent reports presence, v is
// nil for null.
func optionalTime(f *validate.Form, key string) (sent bool, v *time.Time) {
	if _, sent = f.Fields()[key]; !sent {
		return false, nil
	}
	s := f.Str(key, nullable, validate.StrOpts{Check: validate.DatetimeCheck})
	if s == nil {
		return true, nil
	}
	t, _ := validate.ParseJSDate(*s)
	return true, &t
}

func (h *handler) addTask(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	f := validate.New(validate.ReadBody(r))
	src := f.Enum("source", validate.Rule{}, []string{string(eventsc.SourceCRM), string(eventsc.SourceSite)})
	eventID := f.UUID("event_id", validate.Rule{})
	in := TaskInput{
		Kind:           f.StrDefault("kind", "other", validate.StrOpts{Check: validate.EnumCheck(TaskKinds)}),
		Title:          f.StrDefault("title", "", taskTitleOpts),
		AssigneeUserID: f.UUID("assignee_user_id", nullable),
	}
	_, in.DueAt = optionalTime(f, "due_at")
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	t, err := h.svc.AddTask(r.Context(), eventsc.Source(*src), *eventID, in, user.ID)
	if err != nil {
		return taskNotFound(err)
	}
	return httpx.Data(w, http.StatusCreated, t)
}

func (h *handler) patchTask(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	p := TaskPatch{
		Kind:  f.Enum("kind", validate.Rule{Optional: true}, TaskKinds),
		Title: f.Str("title", validate.Rule{Optional: true}, taskTitleOpts),
		Done:  f.Bool("done", validate.Rule{Optional: true}),
	}
	if _, sent := f.Fields()["assignee_user_id"]; sent {
		v := f.UUID("assignee_user_id", nullable)
		p.AssigneeUserID = &v
	}
	if sent, v := optionalTime(f, "due_at"); sent {
		p.DueAt = &v
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	t, err := h.svc.PatchTask(r.Context(), id, p, user.ID)
	if err != nil {
		return err
	}
	if t == nil {
		return httpx.NotFound("Tugas tidak ditemukan")
	}
	return httpx.OK(w, t)
}

func (h *handler) removeTask(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	ok, err := h.svc.RemoveTask(r.Context(), id)
	if err != nil {
		return err
	}
	if !ok {
		return httpx.NotFound("Tugas tidak ditemukan")
	}
	return httpx.OK(w, map[string]string{"id": id})
}

/* ── feeds ───────────────────────────────────────────────────────────── */

func (h *handler) feeds(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	list, err := h.svc.Feeds(r.Context(), user.ID)
	if err != nil {
		return err
	}
	return httpx.OK(w, list)
}

// feedURL is the absolute subscription URL as the request saw the host.
func feedURL(r *http.Request, token string) string {
	scheme := "https"
	if !httpx.SecureRequest(r) {
		scheme = "http"
	}
	return scheme + "://" + r.Host + FeedPath + "?token=" + token
}

func (h *handler) createFeed(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	f := validate.New(validate.ReadBody(r))
	branchID := f.UUID("branch_id", nullable)
	label := f.StrDefault("label", "", validate.StrOpts{Trim: true, Max: 80})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	id, token, err := h.svc.CreateFeed(r.Context(), user.ID, branchID, label)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, map[string]string{"id": id, "url": feedURL(r, token)})
}

func (h *handler) revokeFeed(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	ok, err := h.svc.RevokeFeed(r.Context(), id, user.ID)
	if err != nil {
		return err
	}
	if !ok {
		return httpx.NotFound("Langganan tidak ditemukan")
	}
	return httpx.OK(w, map[string]string{"id": id})
}

// feedICS serves the subscription; the token in the query is the only
// credential, so an unknown one is a plain 404.
func (h *handler) feedICS(w http.ResponseWriter, r *http.Request) error {
	token := r.URL.Query().Get("token")
	if len(token) != 64 {
		return httpx.NotFound("Kalender tidak ditemukan")
	}
	ics, found, err := h.svc.FeedICS(r.Context(), token)
	if err != nil {
		return err
	}
	if !found {
		return httpx.NotFound("Kalender tidak ditemukan")
	}
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Content-Disposition", `inline; filename="nuhabit-events.ics"`)
	w.Header().Set("Cache-Control", "private, max-age=900")
	_, err = w.Write([]byte(ics))
	return err
}
