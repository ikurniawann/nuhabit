package gymcomplaints

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/gymcomplaints/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// Guard is the slice of platform/auth the handlers use; tests swap it.
type Guard interface {
	auth.Granter
	RequireMember(r *http.Request) (string, error)
}

type handler struct {
	svc   *Service
	guard Guard
}

var (
	read   = iam.Can("read", iam.GymComplaints)
	create = iam.Can("create", iam.GymComplaints)
	update = iam.Can("update", iam.GymComplaints)
	// manage is the delete grant: managers, marketing and admins delete
	// tickets and edit the SLA, escalation contacts and categories; the
	// front desk does not.
	manage = iam.Can("delete", iam.GymComplaints)
	// coach is Kelas Saya: a coach reads the tickets linked to them.
	coach = iam.Can("read", iam.GymMyClasses)
)

// Routes lists the staff (/api/gym/**) and member portal routes.
func (h *handler) Routes() []module.Route {
	staff := func(fn auth.StaffFunc, grants ...iam.Grant) http.Handler { return auth.Staff(h.guard, fn, grants...) }
	return []module.Route{
		{Pattern: "GET /api/gym/complaints", Handler: staff(h.list, read)},
		{Pattern: "POST /api/gym/complaints", Handler: staff(h.create, create)},
		{Pattern: "GET /api/gym/complaints/options", Handler: staff(h.options, read, create)},
		{Pattern: "GET /api/gym/complaints/member-classes", Handler: staff(h.memberClasses, read, create)},
		{Pattern: "GET /api/gym/complaints/report", Handler: staff(h.report, read)},
		{Pattern: "GET /api/gym/complaints/settings", Handler: staff(h.settings, read)},
		{Pattern: "PUT /api/gym/complaints/settings", Handler: staff(h.saveSettings, manage)},
		{Pattern: "GET /api/gym/complaints/categories", Handler: staff(h.categories, read)},
		{Pattern: "PUT /api/gym/complaints/categories", Handler: staff(h.saveCategories, manage)},
		{Pattern: "GET /api/gym/complaints/conversations/{conversationId}/ticket", Handler: staff(h.forConversation, read, create)},
		{Pattern: "POST /api/gym/complaints/conversations/{conversationId}/ticket", Handler: staff(h.fromConversation, create)},
		{Pattern: "GET /api/gym/complaints/{id}", Handler: staff(h.get, read)},
		{Pattern: "PATCH /api/gym/complaints/{id}", Handler: staff(h.update, update)},
		{Pattern: "DELETE /api/gym/complaints/{id}", Handler: staff(h.delete, manage)},
		{Pattern: "POST /api/gym/complaints/{id}/status", Handler: staff(h.move, update)},
		{Pattern: "POST /api/gym/complaints/{id}/assign", Handler: staff(h.assign, update)},
		{Pattern: "POST /api/gym/complaints/{id}/notes", Handler: staff(h.note, update)},
		{Pattern: "GET /api/gym/my-classes/complaints", Handler: staff(h.mine, coach)},

		{Pattern: "GET /api/member-portal/gym/feedback", Handler: h.member(h.myTickets)},
		{Pattern: "POST /api/member-portal/gym/feedback", Handler: h.member(h.submit)},
		{Pattern: "GET /api/member-portal/gym/feedback/options", Handler: h.member(h.memberOptions)},
		{Pattern: "GET /api/member-portal/gym/feedback/{id}", Handler: h.member(h.myTicket)},
		{Pattern: "POST /api/member-portal/gym/feedback/{id}/confirm", Handler: h.member(h.confirm)},
		{Pattern: "POST /api/member-portal/gym/feedback/{id}/reopen", Handler: h.member(h.reopen)},
	}
}

type memberFunc func(w http.ResponseWriter, r *http.Request, customerID string) error

func (h *handler) member(fn memberFunc) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		customerID, err := h.guard.RequireMember(r)
		if err != nil {
			return err
		}
		return fn(w, r, customerID)
	})
}

func optionalUUID(v string) (*string, error) {
	if v == "" {
		return nil, nil
	}
	if !validate.IsUUID(v) {
		return nil, httpx.BadRequest("ID tidak valid")
	}
	return &v, nil
}

// uuids checks every non-nil id of a body.
func uuids(ids ...*string) error {
	for _, id := range ids {
		if id != nil && !validate.IsUUID(*id) {
			return httpx.BadRequest("ID tidak valid")
		}
	}
	return nil
}

// ── Staff ────────────────────────────────────────────────────────────────────

func (h *handler) list(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	q := r.URL.Query()
	f := Filter{Status: q.Get("status"), Category: q.Get("category"), Priority: q.Get("priority"), Source: q.Get("source"),
		Search: strings.TrimSpace(q.Get("q")), Overdue: q.Get("overdue") == "1", Limit: 25}
	if f.Status != "" && f.Status != "open" && f.Status != "active" && !domain.ValidStatus(f.Status) {
		return httpx.BadRequest("Status tidak valid")
	}
	for key, dst := range map[string]*string{"branch_id": &f.BranchID, "coach_id": &f.CoachID, "customer_id": &f.CustomerID} {
		v := q.Get(key)
		if v != "" && !validate.IsUUID(v) {
			return httpx.BadRequest("ID tidak valid")
		}
		*dst = v
	}
	switch owner := q.Get("owner"); {
	case owner == "me":
		f.OwnerUserID = user.ID
	case owner != "" && !validate.IsUUID(owner):
		return httpx.BadRequest("ID tidak valid")
	default:
		f.OwnerUserID = owner
	}
	if n, err := strconv.Atoi(q.Get("limit")); err == nil && n > 0 {
		f.Limit = min(n, 200)
	}
	if n, err := strconv.Atoi(q.Get("offset")); err == nil && n > 0 {
		f.Offset = n
	}
	page, err := h.svc.List(r.Context(), f)
	if err != nil {
		return err
	}
	return httpx.OK(w, page)
}

// ticketBody is the create and "Jadikan tiket" form.
type ticketBody struct {
	Source       string  `json:"source"`
	Category     string  `json:"category"`
	Priority     string  `json:"priority"`
	Title        string  `json:"title"`
	Description  string  `json:"description"`
	CustomerID   *string `json:"customer_id"`
	ContactName  *string `json:"contact_name"`
	ContactPhone *string `json:"contact_phone"`
	CoachID      *string `json:"coach_id"`
	SessionID    *string `json:"session_id"`
	BranchID     *string `json:"branch_id"`
	OwnerUserID  *string `json:"owner_user_id"`
}

func (b ticketBody) ticket() (NewTicket, error) {
	if err := uuids(b.CustomerID, b.CoachID, b.SessionID, b.BranchID, b.OwnerUserID); err != nil {
		return NewTicket{}, err
	}
	return NewTicket{Source: domain.Source(b.Source), Category: b.Category, Priority: b.Priority, Title: b.Title,
		Description: b.Description, CustomerID: b.CustomerID, ContactName: b.ContactName, ContactPhone: b.ContactPhone,
		CoachID: b.CoachID, SessionID: b.SessionID, BranchID: b.BranchID, OwnerUserID: b.OwnerUserID}, nil
}

func (h *handler) create(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	var body ticketBody
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	if body.Source == "" {
		body.Source = string(domain.SourceDesk)
	}
	if body.Category == "" {
		return httpx.BadRequest("Pilih kategori")
	}
	in, err := body.ticket()
	if err != nil {
		return err
	}
	out, err := h.svc.Create(r.Context(), user.ID, in)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, out)
}

func (h *handler) options(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	out, err := h.svc.Options(r.Context())
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) memberClasses(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id := r.URL.Query().Get("customer_id")
	if !validate.IsUUID(id) {
		return httpx.BadRequest("customer_id wajib diisi")
	}
	out, err := h.svc.MemberClasses(r.Context(), id)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

// maxReportDays caps a report at a year.
const maxReportDays = 366

func (h *handler) report(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	q := r.URL.Query()
	today := localtime.DayKey(h.svc.now(), localtime.Jakarta)
	from, to := q.Get("from"), q.Get("to")
	if from == "" {
		from = today[:8] + "01"
	}
	if to == "" {
		to = today
	}
	f, errF := time.Parse(time.DateOnly, from)
	t, errT := time.Parse(time.DateOnly, to)
	if errF != nil || errT != nil || t.Before(f) {
		return httpx.BadRequest("Rentang tanggal tidak valid")
	}
	if t.Sub(f) >= maxReportDays*24*time.Hour {
		return httpx.BadRequest("Rentang laporan maksimal satu tahun")
	}
	branch, err := optionalUUID(q.Get("branch_id"))
	if err != nil {
		return err
	}
	out, err := h.svc.Report(r.Context(), from, to, branch)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) settings(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	branch, err := optionalUUID(r.URL.Query().Get("branch_id"))
	if err != nil {
		return err
	}
	out, err := h.svc.Settings(r.Context(), branch)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) saveSettings(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	var body SettingsInput
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	if err := uuids(body.BranchID, body.EscalationUserID); err != nil {
		return err
	}
	out, err := h.svc.SaveSettings(r.Context(), user.ID, body)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) categories(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	out, err := h.svc.Categories(r.Context(), true)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) saveCategories(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	var body struct {
		Categories []Category `json:"categories"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	if len(body.Categories) == 0 || len(body.Categories) > 30 {
		return httpx.BadRequest("Isi 1 sampai 30 kategori")
	}
	for i, c := range body.Categories {
		body.Categories[i].Code, body.Categories[i].Label = strings.TrimSpace(c.Code), strings.TrimSpace(c.Label)
		if body.Categories[i].Label == "" {
			return httpx.BadRequest("Nama kategori wajib diisi")
		}
	}
	out, err := h.svc.SaveCategories(r.Context(), body.Categories)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) forConversation(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := validate.PathUUID(r, "conversationId")
	if err != nil {
		return err
	}
	out, err := h.svc.ForConversation(r.Context(), id)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) fromConversation(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	id, err := validate.PathUUID(r, "conversationId")
	if err != nil {
		return err
	}
	var body ticketBody
	if r.ContentLength != 0 {
		if err := httpx.DecodeJSON(r, &body); err != nil {
			return err
		}
	}
	in, err := body.ticket()
	if err != nil {
		return err
	}
	out, err := h.svc.FromConversation(r.Context(), user.ID, id, in)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, out)
}

func (h *handler) get(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	out, err := h.svc.Get(r.Context(), id)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) update(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	var body Patch
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	if err := uuids(body.CoachID, body.SessionID, body.BranchID); err != nil {
		return err
	}
	if err := h.svc.Update(r.Context(), user.ID, id, body); err != nil {
		return err
	}
	return h.get(w, r, user)
}

func (h *handler) delete(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.Delete(r.Context(), id); err != nil {
		return err
	}
	return httpx.OK(w, map[string]string{"id": id})
}

func (h *handler) move(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	var body struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	if !domain.ValidStatus(body.Status) {
		return httpx.BadRequest("Status tidak valid")
	}
	if err := h.svc.Move(r.Context(), user.ID, id, domain.Status(body.Status), body.Note); err != nil {
		return err
	}
	return h.get(w, r, user)
}

func (h *handler) assign(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	var body struct {
		UserID *string `json:"user_id"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	if err := uuids(body.UserID); err != nil {
		return err
	}
	if err := h.svc.Assign(r.Context(), user.ID, id, body.UserID); err != nil {
		return err
	}
	return h.get(w, r, user)
}

func (h *handler) note(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	var body struct {
		Body   string `json:"body"`
		Public bool   `json:"public"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	if err := h.svc.Note(r.Context(), user.ID, id, body.Body, body.Public); err != nil {
		return err
	}
	return h.get(w, r, user)
}

func (h *handler) mine(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	out, err := h.svc.ForCoachUser(r.Context(), user.ID)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

// ── Member app ───────────────────────────────────────────────────────────────

func (h *handler) myTickets(w http.ResponseWriter, r *http.Request, customerID string) error {
	out, err := h.svc.MyTickets(r.Context(), customerID)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) submit(w http.ResponseWriter, r *http.Request, customerID string) error {
	var body MemberReport
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	if err := uuids(body.SessionID, body.CoachID); err != nil {
		return err
	}
	out, err := h.svc.Submit(r.Context(), customerID, body)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, out)
}

func (h *handler) memberOptions(w http.ResponseWriter, r *http.Request, customerID string) error {
	out, err := h.svc.MemberOptions(r.Context(), customerID)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) myTicket(w http.ResponseWriter, r *http.Request, customerID string) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	out, err := h.svc.MyTicket(r.Context(), customerID, id)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) confirm(w http.ResponseWriter, r *http.Request, customerID string) error {
	return h.memberMove(w, r, customerID, domain.Confirmed)
}

func (h *handler) reopen(w http.ResponseWriter, r *http.Request, customerID string) error {
	return h.memberMove(w, r, customerID, domain.Reopened)
}

func (h *handler) memberMove(w http.ResponseWriter, r *http.Request, customerID string, to domain.Status) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if r.ContentLength != 0 {
		if err := httpx.DecodeJSON(r, &body); err != nil {
			return err
		}
	}
	if err := h.svc.MemberMove(r.Context(), customerID, id, to, body.Reason); err != nil {
		return err
	}
	return h.myTicket(w, r, customerID)
}
