package gymsop

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"nuhabit/backend/internal/modules/gymsop/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/validate"
)

type handler struct {
	svc   *Service
	guard auth.Granter
}

var (
	read = iam.Can("read", iam.GymSop)
	// readers reach their own SOPs from Kelas Saya.
	readers = []iam.Grant{
		read,
		iam.Can("read_own", iam.GymSop),
		iam.Can("read", iam.GymMyClasses),
		iam.Can("read_own", iam.GymSessions),
	}
)

// Routes lists the manager and reader routes.
func (h *handler) Routes() []module.Route {
	create, update := iam.Can("create", iam.GymSop), iam.Can("update", iam.GymSop)
	return []module.Route{
		{Pattern: "GET /api/gym/sop", Handler: auth.Staff(h.guard, h.list, read)},
		{Pattern: "POST /api/gym/sop", Handler: auth.Staff(h.guard, h.create, create)},
		{Pattern: "GET /api/gym/sop/roles", Handler: auth.Staff(h.guard, h.roles, create, update)},
		{Pattern: "GET /api/gym/sop/{id}", Handler: auth.Staff(h.guard, h.get, read)},
		{Pattern: "PATCH /api/gym/sop/{id}", Handler: auth.Staff(h.guard, h.update, update)},
		{Pattern: "POST /api/gym/sop/{id}/versions", Handler: auth.Staff(h.guard, h.publish, update)},
		{Pattern: "POST /api/gym/sop/{id}/remind", Handler: auth.Staff(h.guard, h.remind, update)},
		{Pattern: "GET /api/gym/sop/versions/{versionId}/file", Handler: h.reader(h.file)},
		{Pattern: "GET /api/gym/my-classes/sop", Handler: h.reader(h.mine)},
		{Pattern: "POST /api/gym/my-classes/sop/{versionId}/ack", Handler: h.reader(h.ack)},
	}
}

type readerFunc func(w http.ResponseWriter, r *http.Request, user *auth.User, manager bool) error

// reader guards the reader routes; manager is true when read on gym.sop let
// the caller in.
func (h *handler) reader(fn readerFunc) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		user, matched, err := h.guard.RequireAnyGrant(r, readers...)
		if err != nil {
			return err
		}
		return fn(w, r, user, matched == 0)
	})
}

func staff(u *auth.User) Staff {
	name := u.FullName
	if name == "" {
		name = u.Email
	}
	return Staff{ID: u.ID, Name: name}
}

/* ── Manager ─────────────────────────────────────────────────────────────── */

func (h *handler) list(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	out, err := h.svc.List(r.Context())
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
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
	if out == nil {
		return httpx.NotFound("Dokumen SOP tidak ditemukan")
	}
	return httpx.OK(w, out)
}

func (h *handler) roles(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	out, err := h.svc.Roles(r.Context())
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

// versionForm reads a multipart version: title, body, change_note and an
// optional file (PDF).
func versionForm(r *http.Request) (*storage.Form, domain.VersionInput, []byte, string, error) {
	form, err := storage.ReadForm(r, storage.MaxRequestBytes)
	switch {
	case errors.Is(err, storage.ErrBodyTooLarge):
		return nil, domain.VersionInput{}, nil, "", httpx.BadRequest("Lampiran maksimal 10 MB")
	case err != nil:
		return nil, domain.VersionInput{}, nil, "", httpx.BadRequest("Form data tidak valid")
	}
	in := domain.VersionInput{Title: form.Value("title"), Body: form.Value("body"), ChangeNote: form.Value("change_note")}
	var data []byte
	var name string
	if f := form.File("file"); f != nil && f.Size() > 0 {
		data, name = f.Data, f.Name
	}
	return form, in, data, name, nil
}

// roleList reads comma separated role codes.
func roleList(raw string) []string {
	out := []string{}
	for _, p := range strings.Split(raw, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func (h *handler) create(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	form, in, data, name, err := versionForm(r)
	if err != nil {
		return err
	}
	days := domain.DefaultRemindAfterDays
	if raw := strings.TrimSpace(form.Value("remind_after_days")); raw != "" {
		if days, err = strconv.Atoi(raw); err != nil {
			return httpx.BadRequest("Pengingat otomatis 0 sampai 60 hari")
		}
	}
	id, err := h.svc.Create(r.Context(), staff(user), NewDocument{
		VersionInput: in, AudienceRoles: roleList(form.Value("audience_roles")), RemindAfterDays: days, PDF: data, PDFName: name,
	})
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, http.StatusCreated, map[string]string{"id": id}, "SOP diterbitkan")
}

func (h *handler) publish(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	form, in, data, name, err := versionForm(r)
	if err != nil {
		return err
	}
	version, err := h.svc.Publish(r.Context(), staff(user), id, NewVersion{
		VersionInput: in, PDF: data, PDFName: name, KeepAttachment: form.Value("keep_attachment") == "1",
	})
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, http.StatusCreated, map[string]int{"version": version}, "Versi baru diterbitkan")
}

func (h *handler) update(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	raw, present := validate.ReadBody(r)
	f := validate.New(raw, present)
	var p DocumentPatch
	if _, ok := f.Fields()["audience_roles"]; ok {
		p.AudienceSet = true
		p.AudienceRoles = f.Strings("audience_roles", validate.Rule{}, 50, validate.StrOpts{Trim: true, Min: 1, Max: 60})
		if p.AudienceRoles == nil {
			p.AudienceRoles = []string{}
		}
	}
	p.RemindAfterDays = f.Int("remind_after_days", validate.Rule{Optional: true}, validate.NumOpts{Integer: true})
	p.Active = f.Bool("is_active", validate.Rule{Optional: true})
	if !f.Valid() {
		return httpx.BadRequest("Data tidak valid")
	}
	if err := h.svc.Update(r.Context(), id, p); err != nil {
		return err
	}
	return httpx.OK(w, map[string]string{"id": id})
}

func (h *handler) remind(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	out, err := h.svc.Remind(r.Context(), staff(user), id)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

/* ── Readers ─────────────────────────────────────────────────────────────── */

func (h *handler) mine(w http.ResponseWriter, r *http.Request, user *auth.User, _ bool) error {
	out, err := h.svc.Mine(r.Context(), user.ID)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) ack(w http.ResponseWriter, r *http.Request, user *auth.User, _ bool) error {
	id, err := validate.PathUUID(r, "versionId")
	if err != nil {
		return err
	}
	if err := h.svc.Acknowledge(r.Context(), user.ID, id); err != nil {
		return err
	}
	return httpx.OK(w, map[string]string{"version_id": id})
}

func (h *handler) file(w http.ResponseWriter, r *http.Request, user *auth.User, manager bool) error {
	id, err := validate.PathUUID(r, "versionId")
	if err != nil {
		return err
	}
	data, mime, name, err := h.svc.Attachment(r.Context(), user.ID, id, manager)
	if err != nil {
		return err
	}
	storage.WritePrivateFile(w, data, mime, "private, max-age=300", storage.ContentDisposition(name, true))
	return nil
}
