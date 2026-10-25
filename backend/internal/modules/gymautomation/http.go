package gymautomation

import (
	"net/http"
	"regexp"

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

// Routes lists the staff routes.
func (h *handler) Routes() []module.Route {
	read, update := iam.Can("read", iam.GymAutomation), iam.Can("update", iam.GymAutomation)
	return []module.Route{
		{Pattern: "GET /api/gym/automation/jobs", Handler: auth.Staff(h.guard, h.jobs, read)},
		{Pattern: "PATCH /api/gym/automation/jobs/{name}", Handler: auth.Staff(h.guard, h.saveJob, update)},
		{Pattern: "POST /api/gym/automation/jobs/{name}/run", Handler: auth.Staff(h.guard, h.runJob, update)},
		{Pattern: "GET /api/gym/automation/members", Handler: auth.Staff(h.guard, h.searchMembers, read)},
		{Pattern: "GET /api/gym/automation/members/{id}/notifications", Handler: auth.Staff(h.guard, h.memberLog, read)},
	}
}

var jobName = regexp.MustCompile(`^[a-z0-9-]+\.[a-z0-9-]+$`)

func pathJob(r *http.Request) (string, error) {
	name := r.PathValue("name")
	if !jobName.MatchString(name) {
		return "", httpx.NotFound("Job tidak ditemukan")
	}
	return name, nil
}

func (h *handler) jobs(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	out, err := h.svc.Jobs(r.Context())
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) saveJob(w http.ResponseWriter, r *http.Request, u *auth.User) error {
	name, err := pathJob(r)
	if err != nil {
		return err
	}
	f := validate.New(validate.ReadBody(r))
	p := JobPatch{Enabled: f.Bool("enabled", validate.Rule{Optional: true})}
	if _, sent := f.Fields()["settings"]; sent {
		settings := f.Child("settings")
		p.Settings = map[string]int{}
		for key := range settings.Fields() {
			if v := settings.Int(key, validate.Rule{}, validate.NumOpts{}); v != nil {
				p.Settings[key] = *v
			}
		}
	}
	if err := f.ErrAtPath("Data tidak valid"); err != nil {
		return err
	}
	if err := h.svc.SaveJob(r.Context(), name, p, u.ID); err != nil {
		return err
	}
	return httpx.OK(w, map[string]string{"name": name})
}

func (h *handler) runJob(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	name, err := pathJob(r)
	if err != nil {
		return err
	}
	if err := h.svc.RunJob(r.Context(), name); err != nil {
		return err
	}
	return httpx.DataMessage(w, http.StatusOK, map[string]string{"name": name}, "Job selesai dijalankan")
}

func (h *handler) searchMembers(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	out, err := h.svc.SearchMembers(r.Context(), r.URL.Query().Get("q"))
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}

func (h *handler) memberLog(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	id, err := validate.PathUUID(r, "id")
	if err != nil {
		return err
	}
	out, err := h.svc.MemberLog(r.Context(), id)
	if err != nil {
		return err
	}
	return httpx.OK(w, out)
}
