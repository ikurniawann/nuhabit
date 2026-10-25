package payroll

import (
	"errors"
	"net/http"
	"net/url"

	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/validate"
)

// taskRoutes are the to-do views over department tasks, guarded by the
// IAM menus tasks (own list), tasks.team (every department's board) and
// tasks.kpi. The service then scopes by assignee, headed department and
// those menus. Creating tasks and acting on occurrences stay on the
// session routes above (POST /api/hris/dept-tasks, PATCH .../occurrences).
func (h *handler) taskRoutes() []module.Route {
	own, team, kpi := iam.Tasks, iam.TasksTeam, iam.TasksKpi
	read := []iam.Grant{iam.Can("read", own), iam.Can("read", team)}
	write := []iam.Grant{iam.Can("update", own), iam.Can("update", team)}
	staff := func(pattern string, fn auth.StaffFunc, grants ...iam.Grant) module.Route {
		return module.Route{Pattern: pattern, Handler: auth.Staff(h.guard, fn, grants...)}
	}
	return []module.Route{
		staff("GET /api/hris/dept-tasks/meta", h.taskMeta, iam.Can("read", own), iam.Can("read", team), iam.Can("read", kpi)),
		staff("GET /api/hris/dept-tasks/items", h.taskItems, read...),
		staff("GET /api/hris/dept-tasks/monitor", h.taskMonitor, read...),
		staff("GET /api/hris/dept-tasks/kpi", h.kpiTasks, iam.Can("read", own), iam.Can("read", team), iam.Can("read", kpi)),
		staff("GET /api/hris/dept-tasks/kpi/contributions", h.taskContributions, iam.Can("read", own), iam.Can("read", kpi), iam.Can("read", iam.HrisPerformance)),
		staff("GET /api/hris/dept-tasks/occurrences/{id}", h.occurrenceDetail, read...),
		staff("POST /api/hris/dept-tasks/occurrences/{id}/attachments", h.uploadAttachment, write...),
		staff("GET /api/hris/dept-tasks/occurrences/{id}/attachments/{attId}", h.downloadAttachment, read...),
		staff("DELETE /api/hris/dept-tasks/occurrences/{id}/attachments/{attId}", h.deleteAttachment, write...),
	}
}

func optUUID(q url.Values, key, label string) (*string, error) {
	raw := q.Get(key)
	if raw == "" {
		return nil, nil
	}
	if !validate.IsUUID(raw) {
		return nil, httpx.BadRequest(label + " tidak valid")
	}
	return &raw, nil
}

func (h *handler) taskMeta(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	v, err := h.viewActor(r.Context(), u)
	if err != nil {
		return err
	}
	out, err := h.svc.taskMeta(r.Context(), v)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

// taskItems is GET /api/hris/dept-tasks/items?scope=mine|team&view=today|
// week|month|all&month=YYYY-MM&department_id&assignee_employee_id&status&
// kpi_indicator_id&q.
func (h *handler) taskItems(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	v, err := h.viewActor(r.Context(), u)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	f := itemFilter{Scope: q.Get("scope"), View: q.Get("view"), Month: q.Get("month"), Q: q.Get("q")}
	if f.Scope != "team" {
		f.Scope = "mine"
	}
	if f.DepartmentID, err = optUUID(q, "department_id", "Departemen"); err != nil {
		return err
	}
	if f.AssigneeID, err = optUUID(q, "assignee_employee_id", "Penanggung jawab"); err != nil {
		return err
	}
	if f.IndicatorID, err = optUUID(q, "kpi_indicator_id", "Indikator"); err != nil {
		return err
	}
	if st := q.Get("status"); st != "" {
		for _, s := range domain.OccurrenceStatuses {
			if s == st {
				f.Status = &st
			}
		}
		if f.Status == nil {
			return httpx.BadRequest("Status tidak valid")
		}
	}
	out, err := h.svc.listItems(r.Context(), v, f)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

// taskMonitor is GET /api/hris/dept-tasks/monitor?month=YYYY-MM[&department_id].
func (h *handler) taskMonitor(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	v, err := h.viewActor(r.Context(), u)
	if err != nil {
		return err
	}
	dept, err := optUUID(r.URL.Query(), "department_id", "Departemen")
	if err != nil {
		return err
	}
	out, err := h.svc.monitor(r.Context(), v, dept, r.URL.Query().Get("month"))
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

// kpiTasks is GET /api/hris/dept-tasks/kpi?department_id&month=YYYY-MM.
func (h *handler) kpiTasks(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	v, err := h.viewActor(r.Context(), u)
	if err != nil {
		return err
	}
	dept, err := optUUID(r.URL.Query(), "department_id", "Departemen")
	if err != nil {
		return err
	}
	out, err := h.svc.kpiTasks(r.Context(), v, dept, r.URL.Query().Get("month"))
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

// taskContributions is GET /api/hris/dept-tasks/kpi/contributions?employee_id&month=YYYY-MM.
func (h *handler) taskContributions(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	v, err := h.viewActor(r.Context(), u)
	if err != nil {
		return err
	}
	employee := r.URL.Query().Get("employee_id")
	if !validate.IsUUID(employee) {
		return httpx.BadRequest("Karyawan tidak valid")
	}
	out, err := h.svc.contributions(r.Context(), v, employee, r.URL.Query().Get("month"))
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) occurrenceDetail(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	v, err := h.viewActor(r.Context(), u)
	if err != nil {
		return err
	}
	out, err := h.svc.occurrenceDetail(r.Context(), v, id)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

// formOverhead is room for the multipart framing on top of the file.
const formOverhead = 64 << 10

// uploadAttachment is POST /api/hris/dept-tasks/occurrences/{id}/attachments
// (multipart field "file").
func (h *handler) uploadAttachment(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	v, err := h.viewActor(r.Context(), u)
	if err != nil {
		return err
	}
	form, err := storage.ReadForm(r, MaxAttachmentBytes+formOverhead)
	if errors.Is(err, storage.ErrBodyTooLarge) {
		return httpx.BadRequest("Ukuran file maksimal 10 MB")
	}
	if err != nil {
		return httpx.BadRequest("Form unggahan tidak valid")
	}
	file := form.File("file")
	if file == nil {
		return httpx.BadRequest("File wajib diisi")
	}
	att, err := h.svc.addAttachment(r.Context(), v, id, file)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusCreated, att)
}

// downloadAttachment is GET .../attachments/{attId}?inline=1.
func (h *handler) downloadAttachment(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	attID, err := validate.PathUUID(r, "attId")
	if err != nil {
		return err
	}
	v, err := h.viewActor(r.Context(), u)
	if err != nil {
		return err
	}
	data, mime, name, err := h.svc.readAttachment(r.Context(), v, id, attID)
	if err != nil {
		return err
	}
	inline := r.URL.Query().Get("inline") == "1" && !storage.MustForceAttachment(mime)
	storage.WritePrivateFile(w, data, mime, "private, no-store", storage.ContentDisposition(name, inline))
	return nil
}

func (h *handler) deleteAttachment(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	attID, err := validate.PathUUID(r, "attId")
	if err != nil {
		return err
	}
	v, err := h.viewActor(r.Context(), u)
	if err != nil {
		return err
	}
	if err := h.svc.deleteAttachment(r.Context(), v, id, attID); err != nil {
		return err
	}
	return httpx.OK(w, map[string]string{"id": attID})
}
