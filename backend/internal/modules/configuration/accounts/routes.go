// Package accounts ports the staff account routes: /api/users (accounts
// linked to hris employees) and /api/admin/users (accounts on their own).
// Both sit behind the settings.users menu.
package accounts

import (
	"crypto/rand"
	"net/http"

	"nuhabit/backend/internal/modules/configuration/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
)

type handlers struct {
	d   module.Deps
	svc *service
}

// Routes mounts this area.
func Routes(d module.Deps, db database.DB, p Ports) []module.Route {
	h := handlers{d: d, svc: &service{db: db, ports: p, now: d.Now, random: rand.Reader}}
	return []module.Route{
		{Pattern: "GET /api/users", Handler: httpx.Handle(h.listUsers)},
		{Pattern: "POST /api/users", Handler: httpx.Handle(h.createUser)},
		{Pattern: "GET /api/users/{id}", Handler: httpx.Handle(h.getUser)},
		{Pattern: "PUT /api/users/{id}", Handler: httpx.Handle(h.updateUser)},
		{Pattern: "POST /api/users/{id}/reset-password", Handler: httpx.Handle(h.resetUserPassword)},
		{Pattern: "GET /api/admin/users", Handler: httpx.Handle(h.listAdmins)},
		{Pattern: "POST /api/admin/users", Handler: httpx.Handle(h.createAdmin)},
		{Pattern: "PATCH /api/admin/users/{id}", Handler: httpx.Handle(h.updateAdmin)},
		{Pattern: "POST /api/admin/users/{id}/reset-password", Handler: httpx.Handle(h.resetAdminPassword)},
	}
}

type dataMessage struct {
	Data    any    `json:"data"`
	Message string `json:"message"`
}

func (h handlers) guard(r *http.Request) (string, error) {
	u, err := h.d.Auth.RequireMenuPrefix(r, iam.SettingsUsers...)
	if err != nil {
		return "", err
	}
	return u.ID, nil
}

/* ── /api/users ──────────────────────────────────────────────────────── */

func (h handlers) listUsers(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard(r); err != nil {
		return err
	}
	q, err := parseListQuery(r.URL.Query())
	if err != nil {
		return err
	}
	page, err := h.svc.listUsers(r.Context(), q)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, page)
}

func (h handlers) createUser(w http.ResponseWriter, r *http.Request) error {
	actor, err := h.guard(r)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	b := parseEmployeeBody(f, true)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	data, err := h.svc.createUser(r.Context(), actor, b)
	if err != nil {
		return rethrowUserServiceError(err)
	}
	return httpx.JSON(w, http.StatusCreated, dataMessage{Data: data, Message: "Employee created successfully"})
}

func (h handlers) getUser(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard(r); err != nil {
		return err
	}
	data, err := h.svc.getUser(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	if data == nil {
		return httpx.NotFound("Employee not found")
	}
	return httpx.JSON(w, http.StatusOK, struct {
		Data any `json:"data"`
	}{data})
}

func (h handlers) updateUser(w http.ResponseWriter, r *http.Request) error {
	actor, err := h.guard(r)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	b := parseEmployeeBody(f, false)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	data, err := h.svc.updateUser(r.Context(), actor, r.PathValue("id"), b)
	if err != nil {
		return rethrowUserServiceError(err)
	}
	return httpx.JSON(w, http.StatusOK, dataMessage{Data: data, Message: "Employee updated successfully"})
}

func (h handlers) resetUserPassword(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard(r); err != nil {
		return err
	}
	res, err := h.svc.resetEmployeePassword(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, res)
}

/* ── /api/admin/users ────────────────────────────────────────────────── */

func (h handlers) listAdmins(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard(r); err != nil {
		return err
	}
	data, err := h.svc.listAdmins(r.Context())
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, struct {
		Data any `json:"data"`
	}{data})
}

func (h handlers) createAdmin(w http.ResponseWriter, r *http.Request) error {
	actor, err := h.guard(r)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	b := parseAdminCreate(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	profile, err := h.svc.createAdmin(r.Context(), actor, b)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusCreated, dataMessage{Data: profile, Message: "User berhasil dibuat"})
}

func (h handlers) updateAdmin(w http.ResponseWriter, r *http.Request) error {
	actor, err := h.guard(r)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	b := parseAdminUpdate(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	profile, err := h.svc.updateAdmin(r.Context(), actor, r.PathValue("id"), b)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, dataMessage{Data: profile, Message: "User berhasil diperbarui"})
}

func (h handlers) resetAdminPassword(w http.ResponseWriter, r *http.Request) error {
	actor, err := h.guard(r)
	if err != nil {
		return err
	}
	temp, err := h.svc.resetAdminPassword(r.Context(), actor, r.PathValue("id"))
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, resetResult{Message: "Password sementara berhasil dibuat", TempPassword: temp})
}
