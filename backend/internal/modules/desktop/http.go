package desktop

import (
	"errors"
	"io"
	"net/http"

	"nuhabit/backend/internal/modules/desktop/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

type handlers struct{ svc *Service }

// failure is the {success:false, error} body of a route's catch block.
type failure struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
}

// bare is the {error} body of the routes whose catch block has no success.
type bare struct {
	Error string `json:"error"`
}

// handle renders an ApiError with its envelope and anything else as a
// logged 500 with the route's own body.
func (h handlers) handle(route string, fail any, fn httpx.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := fn(w, r)
		if err == nil {
			return
		}
		var ae *httpx.Error
		if errors.As(err, &ae) {
			httpx.WriteError(w, r, err)
			return
		}
		h.svc.log.ErrorContext(r.Context(), "["+route+"] gagal", "error", err)
		_ = httpx.JSON(w, http.StatusInternalServerError, fail)
	})
}

// Routes lists the module's routes. POST and DELETE /api/desktop/wallpapers
// stay in Next: they write uploads to Next's local storage.
func (h handlers) Routes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/desktop/inbox", Handler: h.handle("desktop/inbox", failure{Error: "Gagal memuat daftar keputusan"}, h.inbox)},
		{Pattern: "GET /api/desktop/overview", Handler: h.handle("desktop:overview", bare{"Gagal memuat ringkasan"}, h.overview)},
		{Pattern: "GET /api/desktop/preferences", Handler: h.handle("desktop/preferences", failure{Error: "Gagal memuat preferensi"}, h.preferences)},
		{Pattern: "PUT /api/desktop/preferences", Handler: h.handle("desktop/preferences", failure{Error: "Gagal menyimpan preferensi"}, h.savePreferences)},
		{Pattern: "GET /api/desktop/search", Handler: h.handle("desktop/search", failure{Error: "Pencarian gagal"}, h.search)},
		{Pattern: "GET /api/desktop/status", Handler: h.handle("desktop/status", failure{Error: "Gagal memuat status"}, h.status)},
		{Pattern: "GET /api/desktop/stream", Handler: h.handle("desktop/stream", bare{"Gagal membuka aliran"}, h.stream)},
		{Pattern: "GET /api/desktop/wallpapers", Handler: h.handle("desktop/wallpapers", failure{Error: "Gagal memuat wallpaper"}, h.wallpapers)},
	}
}

func (h handlers) inbox(w http.ResponseWriter, r *http.Request) error {
	user, err := h.svc.users.RequireUser(r)
	if err != nil {
		return err
	}
	sections, err := h.svc.Inbox(r.Context(), user)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, struct {
		Sections []*InboxSection `json:"sections"`
	}{sections})
}

func (h handlers) overview(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.svc.requireBoard(r); err != nil {
		return err
	}
	data, cached := h.svc.CachedOverview(r.Context(), domain.ParsePeriod(r.URL.Query().Get("periode")))
	return httpx.JSON(w, http.StatusOK, struct {
		Data   *Overview `json:"data"`
		Cached bool      `json:"cached"`
	}{data, cached})
}

func (h handlers) preferences(w http.ResponseWriter, r *http.Request) error {
	user, err := h.svc.users.RequireUser(r)
	if err != nil {
		return err
	}
	prefs, err := h.svc.Preferences(r.Context(), user.ID)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, prefs)
}

func (h handlers) savePreferences(w http.ResponseWriter, r *http.Request) error {
	user, err := h.svc.users.RequireUser(r)
	if err != nil {
		return err
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	prefs, err := h.svc.SavePreferences(r.Context(), user.ID, body)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, prefs)
}

func (h handlers) search(w http.ResponseWriter, r *http.Request) error {
	user, err := h.svc.users.RequireUser(r)
	if err != nil {
		return err
	}
	res, err := h.svc.Search(r.Context(), user, r.URL.Query().Get("q"))
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, res)
}

func (h handlers) status(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.svc.users.RequireUser(r); err != nil {
		return err
	}
	res, err := h.svc.Status(r.Context())
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, res)
}

// wallpapers is public: the desktop also shows to signed-out visitors.
func (h handlers) wallpapers(w http.ResponseWriter, r *http.Request) error {
	items, err := h.svc.Wallpapers(r.Context())
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, items)
}
