package gymdesk

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"nuhabit/backend/internal/modules/gymdesk/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

type handler struct {
	svc   *Service
	guard auth.Granter
}

// Routes lists the staff routes.
func (h *handler) Routes() []module.Route {
	members, reports := iam.GymMembers, iam.GymReports
	return []module.Route{
		{Pattern: "GET /api/gym/members", Handler: auth.Staff(h.guard, h.listMembers, iam.Can("read", members))},
		{Pattern: "POST /api/gym/members", Handler: auth.Staff(h.guard, h.register, iam.Can("create", members))},
		{Pattern: "GET /api/gym/members/{id}", Handler: auth.Staff(h.guard, h.member, iam.Can("read", members))},
		{Pattern: "PATCH /api/gym/members/{id}", Handler: auth.Staff(h.guard, h.updateMember, iam.Can("update", members))},
		// Staff notes need only read: anyone who can open the member can
		// leave a note and delete their own.
		{Pattern: "POST /api/gym/members/{id}/notes", Handler: auth.Staff(h.guard, h.addNote, iam.Can("read", members))},
		{Pattern: "DELETE /api/gym/members/{id}/notes/{noteId}", Handler: auth.Staff(h.guard, h.deleteNote, iam.Can("read", members))},
		{Pattern: "GET /api/gym/reports/branches", Handler: auth.Staff(h.guard, h.branches, iam.Can("read", members, reports))},
		{Pattern: "GET /api/gym/reports/classes", Handler: auth.Staff(h.guard, h.classReport, iam.Can("read", reports))},
		{Pattern: "GET /api/gym/reports/revenue", Handler: auth.Staff(h.guard, h.revenueReport, iam.Can("read", reports))},
		{Pattern: "GET /api/gym/reports/members", Handler: auth.Staff(h.guard, h.membersReport, iam.Can("read", reports))},
		{Pattern: "GET /api/gym/checkin/log", Handler: auth.Staff(h.guard, h.checkinLog, iam.Can("read", iam.GymCheckin))},
	}
}

func ok(w http.ResponseWriter, data any) error { return httpx.Data(w, http.StatusOK, data) }

func pathUUID(r *http.Request, key string) (string, error) {
	id := r.PathValue(key)
	if !validate.IsUUID(id) {
		return "", httpx.BadRequest("ID tidak valid")
	}
	return id, nil
}

/* ── Query parameters ──────────────────────────────────────────────────── */

const (
	defaultPageSize = 25
	maxPageSize     = 100
	// Reports default to the last 30 days and span at most a year.
	defaultReportDays = 30
	maxReportDays     = 366
)

func flag(q url.Values, key string) bool {
	v := q.Get(key)
	return v == "1" || v == "true"
}

func pageParams(q url.Values) (int, int) {
	page, err := strconv.Atoi(q.Get("page"))
	if err != nil || page < 1 {
		page = 1
	}
	size, err := strconv.Atoi(q.Get("page_size"))
	if err != nil || size < 1 {
		size = defaultPageSize
	}
	return page, min(size, maxPageSize)
}

func branchParam(q url.Values) (*string, error) {
	raw := q.Get("branch_id")
	if raw == "" {
		return nil, nil
	}
	if !validate.IsUUID(raw) {
		return nil, httpx.BadRequest("Cabang tidak valid")
	}
	return &raw, nil
}

// period reads from and to as days in zone.
func (h *handler) period(q url.Values, defaultDays int, zone *time.Location) (domain.Period, error) {
	p, err := domain.ParsePeriod(q.Get("from"), q.Get("to"), h.svc.now(), defaultDays, maxReportDays, zone)
	if errors.Is(err, domain.ErrPeriod) {
		return p, httpx.BadRequest(err.Error())
	}
	return p, err
}

// reportParams reads branch_id, then from and to as days in that branch's
// zone; without a branch the days are Jakarta days.
func (h *handler) reportParams(r *http.Request) (domain.Period, *string, error) {
	q := r.URL.Query()
	branch, err := branchParam(q)
	if err != nil {
		return domain.Period{}, nil, err
	}
	zone, err := localtime.BranchZone(r.Context(), h.svc.db, branch)
	if err != nil {
		return domain.Period{}, nil, err
	}
	p, err := h.period(q, defaultReportDays, zone)
	return p, branch, err
}

/* ── Members ──────────────────────────────────────────────────────────── */

func (h *handler) listMembers(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	q := r.URL.Query()
	branch, err := branchParam(q)
	if err != nil {
		return err
	}
	page, size := pageParams(q)
	out, err := h.svc.ListMembers(r.Context(), MemberFilter{
		Q: strings.TrimSpace(q.Get("q")), ActivePass: flag(q, "active_pass"), HasCredits: flag(q, "has_credits"),
		Expiring: flag(q, "expiring"), Inactive: flag(q, "inactive"), BranchID: branch, Page: page, PageSize: size,
	})
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h *handler) register(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	var body struct {
		Name  string `json:"name"`
		Phone string `json:"phone"`
		Email string `json:"email"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	id, err := h.svc.Register(r.Context(), NewMember(body))
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, http.StatusCreated, map[string]string{"id": id}, "Member terdaftar")
}

func (h *handler) member(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	out, err := h.svc.Member360(r.Context(), id, user.ID)
	if err != nil {
		return err
	}
	if out == nil {
		return httpx.NotFound("Member tidak ditemukan")
	}
	return ok(w, out)
}

// profileBody is the PATCH body: absent keys keep their value.
type profileBody struct {
	Name             *string         `json:"name"`
	Phone            *string         `json:"phone"`
	Email            *string         `json:"email"`
	BirthDate        *string         `json:"birth_date"`
	EmergencyContact json.RawMessage `json:"emergency_contact"`
}

func (h *handler) updateMember(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	var body profileBody
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	patch := ProfilePatch{Name: body.Name, Phone: body.Phone, Email: body.Email, BirthDate: body.BirthDate}
	// A key that is present, null included, sets the contact.
	if body.EmergencyContact != nil {
		patch.EmergencyContactSet = true
		if err := json.Unmarshal(body.EmergencyContact, &patch.EmergencyContact); err != nil {
			return httpx.BadRequest("Kontak darurat belum lengkap", map[string]string{"field": "emergency_contact"})
		}
	}
	if err := h.svc.UpdateProfile(r.Context(), id, patch); err != nil {
		return err
	}
	return ok(w, map[string]string{"id": id})
}

func (h *handler) addNote(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	var body struct {
		Body string `json:"body"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	text := strings.TrimSpace(body.Body)
	if text == "" || utf8.RuneCountInString(text) > NoteMaxLength {
		return httpx.BadRequest("Catatan wajib diisi, maksimal 2000 karakter")
	}
	name := user.FullName
	if name == "" {
		name = user.Email
	}
	note, err := h.svc.AddNote(r.Context(), id, user.ID, name, text)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, note)
}

func (h *handler) deleteNote(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	id, err := pathUUID(r, "id")
	if err != nil {
		return err
	}
	noteID, err := pathUUID(r, "noteId")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteNote(r.Context(), id, noteID, user.ID); err != nil {
		return err
	}
	return ok(w, map[string]string{"id": noteID})
}

/* ── Reports ──────────────────────────────────────────────────────────── */

func (h *handler) branches(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	out, err := h.svc.Branches(r.Context())
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h *handler) classReport(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	p, branch, err := h.reportParams(r)
	if err != nil {
		return err
	}
	out, err := h.svc.ClassReport(r.Context(), p, branch)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h *handler) revenueReport(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	p, branch, err := h.reportParams(r)
	if err != nil {
		return err
	}
	out, err := h.svc.RevenueReport(r.Context(), p, branch)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h *handler) membersReport(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	p, branch, err := h.reportParams(r)
	if err != nil {
		return err
	}
	out, err := h.svc.MembersReport(r.Context(), p, branch)
	if err != nil {
		return err
	}
	return ok(w, out)
}

/* ── Check-in log ─────────────────────────────────────────────────────── */

// checkinLog pages scans in a date range (default today); format=csv
// downloads the range instead.
func (h *handler) checkinLog(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	q := r.URL.Query()
	// The log spans branches: its days and times are Jakarta's.
	p, err := h.period(q, 1, localtime.Jakarta)
	if err != nil {
		return err
	}
	f := LogFilter{Period: p}
	if d := q.Get("decision"); d == "allowed" || d == "denied" {
		f.Decision = &d
	}
	if q.Get("format") == "csv" {
		body, err := h.svc.CheckinCSV(r.Context(), f)
		if err != nil {
			return err
		}
		name := "checkin-" + p.From.Format("20060102") + "-" + p.To.AddDate(0, 0, -1).Format("20060102") + ".csv"
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
		_, err = w.Write(body)
		return err
	}
	f.Page, f.PageSize = pageParams(q)
	out, err := h.svc.CheckinLog(r.Context(), f)
	if err != nil {
		return err
	}
	return ok(w, out)
}
