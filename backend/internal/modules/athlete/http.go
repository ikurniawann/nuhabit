package athlete

import (
	"net/http"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

const (
	trainPrefix  = "/api/member-portal/app/train"
	homeSettings = "/api/member-portal/app/home/settings"
)

type handler struct {
	svc  *Service
	auth *auth.Service
}

// memberHandler is one Train route body: it gets the member's customer id and
// returns the payload for {"success":true,"data":...}.
type memberHandler func(r *http.Request, customerID string) (any, error)

// member mirrors athleteRoute: auth.MemberHandler gives 401 "Unauthorized"
// without a session, keeps a *httpx.Error's status and message, and turns
// anything else into 500 with the route's failure message.
func (h *handler) member(fail string, fn memberHandler) http.Handler {
	return h.auth.MemberHandler(fail, func(w http.ResponseWriter, r *http.Request, customerID string) error {
		data, err := fn(r, customerID)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "data": data})
	})
}

// uuidParam is a path id; anything but a UUID is treated as missing (404).
func uuidParam(r *http.Request, key string) (string, error) {
	v := r.PathValue(key)
	if !isGUID(v) {
		return "", httpx.NotFound("Data tidak ditemukan")
	}
	return v, nil
}

// body decodes and validates a JSON body; any failure is 400 with message.
func body[B any, T any](r *http.Request, validate func(B) (T, bool), message string) (T, error) {
	var b B
	var zero T
	if !decodeBody(r, &b) {
		return zero, httpx.BadRequest(message)
	}
	v, ok := validate(b)
	if !ok {
		return zero, httpx.BadRequest(message)
	}
	return v, nil
}

// withID wraps a handler that needs a UUID path parameter.
func withID(key string, fn func(r *http.Request, customerID, id string) (any, error)) memberHandler {
	return func(r *http.Request, customerID string) (any, error) {
		id, err := uuidParam(r, key)
		if err != nil {
			return nil, err
		}
		return fn(r, customerID, id)
	}
}

const gearMessage = "Nama gear 2-60 karakter, jenis SHOES atau BIKE"

func (h *handler) routes() []module.Route {
	s := h.svc
	route := func(pattern, fail string, fn memberHandler) module.Route {
		return module.Route{Pattern: pattern, Handler: h.member(fail, fn)}
	}
	t := func(method, path string) string { return method + " " + trainPrefix + path }

	return []module.Route{
		// Feed & activities.
		route(t("GET", "/feed"), "Gagal memuat feed", func(r *http.Request, c string) (any, error) {
			return s.Feed(r.Context(), c, r.URL.Query().Get("scope") == "following")
		}),
		route(t("GET", "/activities"), "Gagal memuat aktivitas", func(r *http.Request, c string) (any, error) {
			return s.MyActivities(r.Context(), c)
		}),
		route(t("POST", "/activities"), "Gagal menyimpan aktivitas", func(r *http.Request, c string) (any, error) {
			in, err := body(r, saveActivityBody.validate, "Data aktivitas tidak valid")
			if err != nil {
				return nil, err
			}
			return s.SaveActivity(r.Context(), c, in)
		}),
		route(t("GET", "/activities/{id}"), "Gagal memuat aktivitas", withID("id", func(r *http.Request, c, id string) (any, error) {
			return s.ActivityDetail(r.Context(), c, id)
		})),
		route(t("PATCH", "/activities/{id}"), "Gagal memperbarui aktivitas", withID("id", func(r *http.Request, c, id string) (any, error) {
			patch, err := body(r, updateActivityBody.validate, "Data aktivitas tidak valid")
			if err != nil {
				return nil, err
			}
			return s.UpdateActivity(r.Context(), c, id, patch)
		})),
		route(t("DELETE", "/activities/{id}"), "Gagal menghapus aktivitas", withID("id", func(r *http.Request, c, id string) (any, error) {
			return map[string]bool{"deleted": true}, s.DeleteActivity(r.Context(), c, id)
		})),
		route(t("POST", "/activities/{id}/kudos"), "Gagal memberi kudos", withID("id", func(r *http.Request, c, id string) (any, error) {
			return s.ToggleKudos(r.Context(), c, id)
		})),
		route(t("POST", "/activities/{id}/comments"), "Gagal mengirim komentar", withID("id", func(r *http.Request, c, id string) (any, error) {
			text, err := body(r, commentBody.validate, "Komentar 1-500 karakter")
			if err != nil {
				return nil, err
			}
			return s.AddComment(r.Context(), c, id, text)
		})),

		// Routes & heatmap.
		route(t("GET", "/routes"), "Gagal memuat rute", func(r *http.Request, c string) (any, error) {
			return s.Routes(r.Context(), c)
		}),
		route(t("POST", "/routes"), "Gagal menyimpan rute", func(r *http.Request, c string) (any, error) {
			in, err := body(r, saveRouteBody.validate, "Nama rute 2-80 karakter")
			if err != nil {
				return nil, err
			}
			return s.SaveRoute(r.Context(), c, in.ActivityID, in.Name)
		}),
		route(t("DELETE", "/routes/{id}"), "Gagal menghapus rute", withID("id", func(r *http.Request, c, id string) (any, error) {
			return map[string]bool{"ok": true}, s.DeleteRoute(r.Context(), c, id)
		})),
		route(t("GET", "/heatmap"), "Gagal memuat heatmap", func(r *http.Request, c string) (any, error) {
			return s.Heatmap(r.Context(), c)
		}),

		// Stats, gear & settings.
		route(t("GET", "/stats"), "Gagal memuat statistik", func(r *http.Request, c string) (any, error) {
			return s.Stats(r.Context(), c)
		}),
		route(t("GET", "/gear"), "Gagal memuat gear", func(r *http.Request, c string) (any, error) {
			return s.GearList(r.Context(), c)
		}),
		route(t("POST", "/gear"), "Gagal menambah gear", func(r *http.Request, c string) (any, error) {
			in, err := body(r, gearBody.validate, gearMessage)
			if err != nil {
				return nil, err
			}
			return s.UpsertGear(r.Context(), c, nil, in)
		}),
		route(t("PATCH", "/gear/{id}"), "Gagal memperbarui gear", withID("id", func(r *http.Request, c, id string) (any, error) {
			in, err := body(r, gearBody.validate, gearMessage)
			if err != nil {
				return nil, err
			}
			return s.UpsertGear(r.Context(), c, &id, in)
		})),
		route(t("GET", "/settings"), "Gagal memuat pengaturan", func(r *http.Request, c string) (any, error) {
			return s.Settings(r.Context(), c)
		}),
		route(t("PUT", "/settings"), "Gagal menyimpan pengaturan", func(r *http.Request, c string) (any, error) {
			patch, err := body(r, settingsBody.validate, "Pengaturan tidak valid (target 1-1000 km)")
			if err != nil {
				return nil, err
			}
			return s.UpdateSettings(r.Context(), c, patch)
		}),

		// Segments, challenges, clubs, social.
		route(t("GET", "/segments"), "Gagal memuat segment", func(r *http.Request, c string) (any, error) {
			return s.Segments(r.Context(), c)
		}),
		route(t("GET", "/segments/{id}"), "Gagal memuat segment", withID("id", func(r *http.Request, c, id string) (any, error) {
			return s.SegmentDetail(r.Context(), c, id)
		})),
		route(t("GET", "/challenges"), "Gagal memuat tantangan", func(r *http.Request, c string) (any, error) {
			return s.Challenges(r.Context(), c)
		}),
		route(t("POST", "/challenges/{id}/join"), "Gagal ikut tantangan", withID("id", func(r *http.Request, c, id string) (any, error) {
			return map[string]bool{"joined": true}, s.JoinChallenge(r.Context(), c, id)
		})),
		route(t("DELETE", "/challenges/{id}/join"), "Gagal keluar dari tantangan", withID("id", func(r *http.Request, c, id string) (any, error) {
			return map[string]bool{"joined": false}, s.LeaveChallenge(r.Context(), c, id)
		})),
		route(t("GET", "/clubs"), "Gagal memuat klub", func(r *http.Request, c string) (any, error) {
			return s.Clubs(r.Context(), c)
		}),
		route(t("POST", "/clubs/{id}/toggle"), "Gagal memperbarui klub", withID("id", func(r *http.Request, c, id string) (any, error) {
			joined, err := s.ToggleClub(r.Context(), c, id)
			return map[string]bool{"joined": joined}, err
		})),
		route(t("GET", "/social"), "Gagal memuat atlet", func(r *http.Request, c string) (any, error) {
			return s.Social(r.Context(), c, jsSlice(r.URL.Query().Get("q"), 60))
		}),
		route(t("POST", "/follow/{memberId}"), "Gagal memperbarui follow", withID("memberId", func(r *http.Request, c, id string) (any, error) {
			following, err := s.ToggleFollow(r.Context(), c, id)
			return map[string]bool{"following": following}, err
		})),
		route(t("GET", "/athletes/{memberId}"), "Gagal memuat profil atlet", withID("memberId", func(r *http.Request, c, id string) (any, error) {
			return s.Profile(r.Context(), c, id)
		})),

		// Home tab settings: the same gym.athlete_settings row, without the weekly goal.
		route("GET "+homeSettings, "Gagal memuat pengaturan", func(r *http.Request, c string) (any, error) {
			return s.HomeSettings(r.Context(), c)
		}),
		route("PATCH "+homeSettings, "Gagal menyimpan pengaturan", func(r *http.Request, c string) (any, error) {
			patch, err := body(r, homeSettingsBody.validate, "Data tidak valid")
			if err != nil {
				return nil, err
			}
			return map[string]bool{"ok": true}, s.PatchHomeSettings(r.Context(), c, patch)
		}),
	}
}
