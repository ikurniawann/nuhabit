package investor

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"

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

// Routes lists the staff routes. Investor pages need read on any investor
// menu; the editor needs the matching action on investor.updates. The
// digest toggle is the one write an investor has, on their own row.
func (h *handler) Routes() []module.Route {
	portal, editor := iam.Investor, iam.InvestorUpdates
	read := func(fn auth.StaffFunc) http.Handler { return auth.Staff(h.guard, fn, iam.Can("read", portal)) }
	return []module.Route{
		{Pattern: "GET /api/investor/overview", Handler: read(h.overview)},
		{Pattern: "GET /api/investor/performance", Handler: read(h.performance)},
		{Pattern: "GET /api/investor/branches", Handler: read(h.branches)},
		{Pattern: "GET /api/investor/updates", Handler: read(h.published)},
		{Pattern: "GET /api/investor/documents", Handler: read(h.documents)},
		{Pattern: "GET /api/investor/digest", Handler: read(h.digest)},
		{Pattern: "PUT /api/investor/digest", Handler: read(h.setDigest)},
		{Pattern: "GET /api/investor/updates/manage", Handler: auth.Staff(h.guard, h.manage, iam.Can("read", editor))},
		{Pattern: "POST /api/investor/updates", Handler: auth.Staff(h.guard, h.create, iam.Can("create", editor))},
		{Pattern: "PATCH /api/investor/updates/{id}", Handler: auth.Staff(h.guard, h.edit, iam.Can("update", editor))},
		{Pattern: "PUT /api/investor/updates/{id}/published", Handler: auth.Staff(h.guard, h.publish, iam.Can("update", editor))},
		{Pattern: "DELETE /api/investor/updates/{id}", Handler: auth.Staff(h.guard, h.remove, iam.Can("delete", editor))},
		{Pattern: "POST /api/investor/updates/{id}/attachments", Handler: auth.Staff(h.guard, h.attach, iam.Can("update", editor))},
		{Pattern: "DELETE /api/investor/updates/{id}/attachments/{attachmentId}", Handler: auth.Staff(h.guard, h.detach, iam.Can("update", editor))},
	}
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

func (h *handler) overview(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	branch, err := branchParam(r.URL.Query())
	if err != nil {
		return err
	}
	o, cached, err := h.svc.Overview(r.Context(), branch)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "data": o, "cached": cached})
}

func (h *handler) performance(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	q := r.URL.Query()
	branch, err := branchParam(q)
	if err != nil {
		return err
	}
	months, _ := strconv.Atoi(q.Get("months"))
	p, cached, err := h.svc.Performance(r.Context(), branch, months)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "data": p, "cached": cached})
}

func (h *handler) branches(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	list, err := h.svc.Branches(r.Context())
	if err != nil {
		return err
	}
	return httpx.OK(w, list)
}

func (h *handler) published(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	list, err := h.svc.Published(r.Context())
	if err != nil {
		return err
	}
	return httpx.OK(w, list)
}

func (h *handler) documents(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	list, err := h.svc.Documents(r.Context())
	if err != nil {
		return err
	}
	return httpx.OK(w, list)
}

func (h *handler) digest(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	enabled, err := h.svc.DigestEnabled(r.Context(), u.ID)
	if err != nil {
		return err
	}
	return httpx.OK(w, map[string]bool{"enabled": enabled})
}

func (h *handler) setDigest(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	if err := h.svc.SetDigest(r.Context(), u.ID, body.Enabled); err != nil {
		return err
	}
	return httpx.OK(w, map[string]bool{"enabled": body.Enabled})
}

func (h *handler) manage(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	list, err := h.svc.Manage(r.Context())
	if err != nil {
		return err
	}
	return httpx.OK(w, list)
}

func (h *handler) create(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	var in UpdateInput
	if err := httpx.DecodeJSON(r, &in); err != nil {
		return err
	}
	out, err := h.svc.CreateUpdate(r.Context(), in, u.ID, u.FullName)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, out)
}

func (h *handler) edit(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	var in UpdateInput
	if err := httpx.DecodeJSON(r, &in); err != nil {
		return err
	}
	out, err := h.svc.EditUpdate(r.Context(), id, in)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) publish(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	var body struct {
		Published bool `json:"published"`
	}
	if err := httpx.DecodeJSON(r, &body); err != nil {
		return err
	}
	out, err := h.svc.SetPublished(r.Context(), id, body.Published)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) remove(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteUpdate(r.Context(), id); err != nil {
		return err
	}
	return httpx.OK(w, map[string]string{"id": id})
}

func (h *handler) attach(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	form, err := storage.ReadForm(r, storage.MaxRequestBytes)
	if errors.Is(err, storage.ErrBodyTooLarge) {
		return httpx.BadRequest("Berkas maksimal 10 MB")
	}
	if err != nil {
		return httpx.BadRequest("Unggahan tidak valid")
	}
	out, err := h.svc.AddAttachment(r.Context(), id, form.File("file"))
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, out)
}

func (h *handler) detach(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	attachmentID, err := validate.PathUUID(r, "attachmentId")
	if err != nil {
		return err
	}
	out, err := h.svc.RemoveAttachment(r.Context(), id, attachmentID)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}
