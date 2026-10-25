package gymcare

import (
	"encoding/json"
	"math"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/gymcare/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

type handler struct {
	svc   *Service
	guard Guard
}

var (
	// manager is the first grant of every care route: medical detail of
	// every member.
	manager = iam.Can("read_medical", iam.GymMemberFlags)
	// portal lets coaches in from Kelas Saya and the PT pages.
	portal = []iam.Grant{
		iam.Can("read", iam.GymMyClasses),
		iam.Can("read_own", iam.GymSessions),
		iam.Can("read_own", iam.GymPt),
	}
	// desk is every staff screen that shows a member: the flags page, the
	// member 360, check-in, session rosters and PT.
	desk = []iam.Grant{
		iam.Can("read", iam.GymMemberFlags),
		iam.Can("read", iam.GymMembers),
		iam.Can("read", iam.GymCheckin),
		iam.Can("read", iam.GymSessions, iam.GymBookings),
		iam.Can("read", iam.GymPt),
	}
)

func flagsCan(action string) []iam.Grant { return []iam.Grant{iam.Can(action, iam.GymMemberFlags)} }

// Routes lists the staff and member routes.
func (h *handler) Routes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/gym/member-flag-types", Handler: h.staff(h.types, desk, portal...)},
		{Pattern: "POST /api/gym/member-flag-types", Handler: h.staff(h.createType, flagsCan("create"))},
		{Pattern: "PATCH /api/gym/member-flag-types/{id}", Handler: h.staff(h.updateType, flagsCan("update"))},
		{Pattern: "GET /api/gym/member-flags", Handler: h.staff(h.list, flagsCan("read"))},
		{Pattern: "GET /api/gym/member-flags/members", Handler: h.staff(h.forMembers, desk, portal...)},
		{Pattern: "POST /api/gym/member-flags", Handler: h.staff(h.add, flagsCan("create"), portal...)},
		{Pattern: "PATCH /api/gym/member-flags/{id}", Handler: h.staff(h.edit, flagsCan("update"), portal...)},
		{Pattern: "DELETE /api/gym/member-flags/{id}", Handler: h.staff(h.remove, flagsCan("delete"), portal...)},
		{Pattern: "POST /api/gym/member-flags/{id}/review", Handler: h.staff(h.review, flagsCan("update"), portal...)},
		{Pattern: "GET /api/gym/health-declarations/{customerId}", Handler: h.staff(h.staffParq, nil, portal...)},
		{Pattern: "GET /api/gym/coach-notes", Handler: h.staff(h.rosterNotes, nil, portal...)},
		{Pattern: "GET /api/gym/coach-notes/members/{id}", Handler: h.staff(h.history, nil, portal...)},
		{Pattern: "POST /api/gym/coach-notes", Handler: h.staff(h.addNote, nil, portal...)},
		{Pattern: "POST /api/gym/coach-notes/{id}/release", Handler: h.staff(h.releaseNote, nil, portal...)},
		{Pattern: "DELETE /api/gym/coach-notes/{id}", Handler: h.staff(h.deleteNote, nil, portal...)},

		{Pattern: "GET /api/member-portal/gym/health", Handler: h.member(h.memberParq)},
		{Pattern: "POST /api/member-portal/gym/health", Handler: h.member(h.submitParq)},
	}
}

type viewerFunc func(w http.ResponseWriter, r *http.Request, v Viewer) error

// staff guards a route with the manager grant, then staffGrants, then
// coach portal grants; the grant that matched sets Viewer.Manager and
// Viewer.Staff.
func (h *handler) staff(fn viewerFunc, staffGrants []iam.Grant, portalGrants ...iam.Grant) http.Handler {
	grants := slices.Concat([]iam.Grant{manager}, staffGrants, portalGrants)
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		user, matched, err := h.guard.RequireAnyGrant(r, grants...)
		if err != nil {
			return err
		}
		name := user.FullName
		if name == "" {
			name = user.Email
		}
		return fn(w, r, Viewer{ID: user.ID, Name: name, Manager: matched == 0, Staff: matched <= len(staffGrants)})
	})
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

/* ── Params ──────────────────────────────────────────────────────────────── */

// maxMembers bounds the ids of one roster lookup.
const maxMembers = 200

// idsParam reads ids (comma separated uuids) from key.
func idsParam(q url.Values, key string) ([]string, error) {
	raw := strings.TrimSpace(q.Get(key))
	if raw == "" {
		return []string{}, nil
	}
	parts := strings.Split(raw, ",")
	if len(parts) > maxMembers {
		return nil, httpx.BadRequest("Maksimal 200 member sekali minta")
	}
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if !validate.IsUUID(p) {
			return nil, httpx.BadRequest("Id member tidak valid")
		}
		if !slices.Contains(out, p) {
			out = append(out, p)
		}
	}
	return out, nil
}

func pageParams(q url.Values) (int, int) {
	page, err := strconv.Atoi(q.Get("page"))
	if err != nil || page < 1 {
		page = 1
	}
	size, err := strconv.Atoi(q.Get("page_size"))
	if err != nil || size < 1 {
		size = 25
	}
	return page, min(size, 100)
}

// dateField reads an optional "YYYY-MM-DD" or null. set is false when the
// key is absent.
func dateField(f *validate.Form, key string) (set bool, out *time.Time, err error) {
	raw, present := f.Fields()[key]
	if !present {
		return false, nil, nil
	}
	if raw == nil {
		return true, nil, nil
	}
	s, ok := raw.(string)
	if !ok {
		return true, nil, httpx.BadRequest("Tanggal berakhir tidak valid")
	}
	d, err := time.Parse(time.DateOnly, s)
	if err != nil {
		return true, nil, httpx.BadRequest("Tanggal berakhir tidak valid")
	}
	return true, &d, nil
}

// body reads a JSON object body.
func body(r *http.Request) (*validate.Form, error) {
	raw, present := validate.ReadBody(r)
	obj, ok := raw.(map[string]any)
	if !present || !ok {
		return nil, httpx.BadRequest("Data tidak valid")
	}
	return validate.New(obj, true), nil
}

func optString(f *validate.Form, key string) (*string, error) {
	raw, present := f.Fields()[key]
	if !present || raw == nil {
		return nil, nil
	}
	s, ok := raw.(string)
	if !ok {
		return nil, httpx.BadRequest("Data tidak valid", map[string]string{"field": key})
	}
	s = strings.TrimSpace(s)
	return &s, nil
}

func optInt(f *validate.Form, key string) (*int, bool, error) {
	raw, present := f.Fields()[key]
	if !present {
		return nil, false, nil
	}
	if raw == nil {
		return nil, true, nil
	}
	n, ok := raw.(json.Number)
	v, err := n.Int64()
	if !ok || err != nil || v < math.MinInt32 || v > math.MaxInt32 {
		return nil, true, httpx.BadRequest("Data tidak valid", map[string]string{"field": key})
	}
	i := int(v)
	return &i, true, nil
}

func optBool(f *validate.Form, key string) (*bool, error) {
	raw, present := f.Fields()[key]
	if !present || raw == nil {
		return nil, nil
	}
	b, ok := raw.(bool)
	if !ok {
		return nil, httpx.BadRequest("Data tidak valid", map[string]string{"field": key})
	}
	return &b, nil
}

/* ── Types ───────────────────────────────────────────────────────────────── */

func (h *handler) types(w http.ResponseWriter, r *http.Request, _ Viewer) error {
	out, err := h.svc.Types(r.Context(), r.URL.Query().Get("all") == "1")
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func typeInput(r *http.Request) (domain.TypeInput, error) {
	var in domain.TypeInput
	f, err := body(r)
	if err != nil {
		return in, err
	}
	if in.Label, err = optString(f, "label"); err != nil {
		return in, err
	}
	cat, err := optString(f, "category")
	if err != nil {
		return in, err
	}
	if cat != nil {
		c := domain.Category(*cat)
		in.Category = &c
	}
	if in.Color, err = optString(f, "color"); err != nil {
		return in, err
	}
	if in.Icon, err = optString(f, "icon"); err != nil {
		return in, err
	}
	days, set, err := optInt(f, "default_expiry_days")
	if err != nil {
		return in, err
	}
	if set {
		in.DefaultExpiryDays = &days
	}
	if in.SortOrder, _, err = optInt(f, "sort_order"); err != nil {
		return in, err
	}
	in.Active, err = optBool(f, "is_active")
	return in, err
}

func (h *handler) createType(w http.ResponseWriter, r *http.Request, _ Viewer) error {
	in, err := typeInput(r)
	if err != nil {
		return err
	}
	out, err := h.svc.CreateType(r.Context(), in)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, out)
}

func (h *handler) updateType(w http.ResponseWriter, r *http.Request, _ Viewer) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	in, err := typeInput(r)
	if err != nil {
		return err
	}
	if err := h.svc.UpdateType(r.Context(), id, in); err != nil {
		return err
	}
	return httpx.OK(w, map[string]string{"id": id})
}

/* ── Flags ───────────────────────────────────────────────────────────────── */

func (h *handler) list(w http.ResponseWriter, r *http.Request, v Viewer) error {
	q := r.URL.Query()
	f := FlagFilter{Q: strings.TrimSpace(q.Get("q"))}
	f.Page, f.PageSize = pageParams(q)
	switch c := domain.Category(q.Get("category")); c {
	case domain.General, domain.Medical:
		f.Category = &c
	case "":
	default:
		return httpx.BadRequest("Kategori tidak valid")
	}
	if t := q.Get("type_id"); t != "" {
		if !validate.IsUUID(t) {
			return httpx.BadRequest("Jenis penanda tidak valid")
		}
		f.TypeID = &t
	}
	out, err := h.svc.List(r.Context(), v, f)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) forMembers(w http.ResponseWriter, r *http.Request, v Viewer) error {
	ids, err := idsParam(r.URL.Query(), "ids")
	if err != nil {
		return err
	}
	out, err := h.svc.ForMembers(r.Context(), v, ids)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) add(w http.ResponseWriter, r *http.Request, v Viewer) error {
	f, err := body(r)
	if err != nil {
		return err
	}
	customer := f.UUID("customer_id", validate.Rule{})
	typeID := f.UUID("type_id", validate.Rule{})
	if !f.Valid() {
		return httpx.BadRequest("Member dan jenis penanda wajib dipilih")
	}
	note, err := optString(f, "note")
	if err != nil {
		return err
	}
	in := NewFlag{CustomerID: *customer, TypeID: *typeID}
	if note != nil {
		in.Note = *note
	}
	if in.ExpiresSet, in.ExpiresOn, err = dateField(f, "expires_on"); err != nil {
		return err
	}
	out, err := h.svc.Add(r.Context(), v, in)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, out)
}

func (h *handler) edit(w http.ResponseWriter, r *http.Request, v Viewer) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	f, err := body(r)
	if err != nil {
		return err
	}
	var p FlagPatch
	if p.Note, err = optString(f, "note"); err != nil {
		return err
	}
	if p.ExpiresSet, p.ExpiresOn, err = dateField(f, "expires_on"); err != nil {
		return err
	}
	if err := h.svc.Edit(r.Context(), v, id, p); err != nil {
		return err
	}
	return httpx.OK(w, map[string]string{"id": id})
}

func (h *handler) remove(w http.ResponseWriter, r *http.Request, v Viewer) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.Remove(r.Context(), v, id); err != nil {
		return err
	}
	return httpx.OK(w, map[string]string{"id": id})
}

func (h *handler) review(w http.ResponseWriter, r *http.Request, v Viewer) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	f, err := body(r)
	if err != nil {
		return err
	}
	decision, err := optString(f, "decision")
	if err != nil {
		return err
	}
	note, err := optString(f, "note")
	if err != nil {
		return err
	}
	if decision == nil {
		decision = new(string)
	}
	if note == nil {
		note = new(string)
	}
	if err := h.svc.Review(r.Context(), v, id, *decision, *note); err != nil {
		return err
	}
	return httpx.OK(w, map[string]string{"id": id})
}

/* ── PAR-Q ───────────────────────────────────────────────────────────────── */

func (h *handler) staffParq(w http.ResponseWriter, r *http.Request, v Viewer) error {
	id, err := validate.PathUUID(r, "customerId")
	if err != nil {
		return err
	}
	out, err := h.svc.StaffParq(r.Context(), v, id)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) memberParq(w http.ResponseWriter, r *http.Request, customerID string) error {
	out, err := h.svc.MemberParq(r.Context(), customerID)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) submitParq(w http.ResponseWriter, r *http.Request, customerID string) error {
	f, err := body(r)
	if err != nil {
		return err
	}
	raw, _ := f.Fields()["answers"].(map[string]any)
	answers, ok := domain.ParseParqAnswers(raw)
	if !ok {
		return httpx.Coded(http.StatusBadRequest, "PARQ_INCOMPLETE", "Jawab semua pertanyaan dulu", nil)
	}
	details, err := optString(f, "details")
	if err != nil {
		return err
	}
	if details == nil {
		details = new(string)
	}
	out, err := h.svc.SubmitParq(r.Context(), customerID, answers, *details)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, out)
}

/* ── Coach notes ─────────────────────────────────────────────────────────── */

func (h *handler) rosterNotes(w http.ResponseWriter, r *http.Request, v Viewer) error {
	ids, err := idsParam(r.URL.Query(), "customer_ids")
	if err != nil {
		return err
	}
	out, err := h.svc.RosterNotes(r.Context(), v, ids)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) history(w http.ResponseWriter, r *http.Request, v Viewer) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	out, err := h.svc.History(r.Context(), v, id)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) addNote(w http.ResponseWriter, r *http.Request, v Viewer) error {
	f, err := body(r)
	if err != nil {
		return err
	}
	customer := f.UUID("customer_id", validate.Rule{})
	session := f.UUID("session_id", validate.Rule{Optional: true, Nullable: true})
	pt := f.UUID("pt_appointment_id", validate.Rule{Optional: true, Nullable: true})
	carry, err := optBool(f, "carry_forward")
	if err != nil {
		return err
	}
	text, err := optString(f, "body")
	if err != nil {
		return err
	}
	if !f.Valid() || text == nil {
		return httpx.BadRequest("Member, sesi dan isi catatan wajib diisi")
	}
	in := NewNote{CustomerID: *customer, SessionID: session, PTAppointmentID: pt, Body: *text, CarryForward: carry != nil && *carry}
	out, err := h.svc.AddNote(r.Context(), v, in)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, out)
}

func (h *handler) releaseNote(w http.ResponseWriter, r *http.Request, v Viewer) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.ReleaseNote(r.Context(), v, id); err != nil {
		return err
	}
	return httpx.OK(w, map[string]string{"id": id})
}

func (h *handler) deleteNote(w http.ResponseWriter, r *http.Request, v Viewer) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteNote(r.Context(), v, id); err != nil {
		return err
	}
	return httpx.OK(w, map[string]string{"id": id})
}
