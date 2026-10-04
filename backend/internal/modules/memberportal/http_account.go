package memberportal

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/httpx"
)

var isoDayRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// parseProfileUpdate mirrors profileSchema in profile/route.ts.
func parseProfileUpdate(body map[string]any) (ProfileUpdate, bool) {
	var in ProfileUpdate
	optString := func(key string) (*string, bool) {
		v, present := body[key]
		if !present {
			return nil, true
		}
		s, isString := v.(string)
		if !isString {
			return nil, false
		}
		return &s, true
	}
	if s, valid := optString("name"); !valid {
		return in, false
	} else if s != nil {
		name := strings.TrimSpace(*s)
		if domain.JSLength(name) < 1 || domain.JSLength(name) > 160 {
			return in, false
		}
		in.Name = &name
	}
	if s, valid := optString("email"); !valid {
		return in, false
	} else if s != nil {
		email := strings.TrimSpace(*s)
		switch {
		case isZodEmail(email) && domain.JSLength(email) <= 160:
			in.Email = &email
		case *s == "":
			in.Email = s
		default:
			return in, false
		}
	}
	if s, valid := optString("birth_date"); !valid {
		return in, false
	} else if s != nil {
		if *s != "" && !isoDayRe.MatchString(*s) {
			return in, false
		}
		in.BirthDate = s
	}
	if s, valid := optString("gender"); !valid {
		return in, false
	} else if s != nil {
		if *s != "male" && *s != "female" && *s != "" {
			return in, false
		}
		in.Gender = s
	}
	if s, valid := optString("city"); !valid {
		return in, false
	} else if s != nil {
		city := strings.TrimSpace(*s)
		if domain.JSLength(city) > 120 {
			return in, false
		}
		in.City = &city
	}
	if s, valid := optString("photo_url"); !valid {
		return in, false
	} else if s != nil {
		photo := strings.TrimSpace(*s)
		if domain.JSLength(photo) > 500 {
			return in, false
		}
		in.PhotoURL = &photo
	}
	if v, present := body["wa_consent"]; present {
		b, isBool := v.(bool)
		if !isBool {
			return in, false
		}
		in.WAConsent = &b
	}
	return in, true
}

type profileSavedBody struct {
	Success bool         `json:"success"`
	Data    ProfileSaved `json:"data"`
	Message string       `json:"message"`
}

// PUT /profile.
func (h *Handler) updateProfile(w http.ResponseWriter, r *http.Request, customerID string) error {
	body, isObject := readBody(r)
	in, valid := parseProfileUpdate(body)
	if !isObject || !valid {
		return fail(400, "Data profil tidak valid")
	}
	saved, err := h.svc.UpdateProfile(r.Context(), customerID, in)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, profileSavedBody{Success: true, Data: *saved, Message: saved.SuccessMessage})
}

// GET /visits.
func (h *Handler) visits(w http.ResponseWriter, r *http.Request, customerID string) error {
	view, err := h.svc.Visits(r.Context(), customerID)
	if err != nil {
		return err
	}
	view.Venues = nonNil(view.Venues)
	return ok(w, view)
}

// GET /transactions.
func (h *Handler) transactions(w http.ResponseWriter, r *http.Request, customerID string) error {
	view, err := h.svc.Transactions(r.Context(), customerID)
	if err != nil {
		return err
	}
	view.Wallet, view.Orders = nonNil(view.Wallet), nonNil(view.Orders)
	return ok(w, view)
}

// GET /orders/{id}.
func (h *Handler) orderDetail(w http.ResponseWriter, r *http.Request, customerID string) error {
	view, err := h.svc.OrderDetail(r.Context(), customerID, r.PathValue("id"))
	if err != nil {
		return err
	}
	return ok(w, view)
}

// GET /notifications.
func (h *Handler) notifications(w http.ResponseWriter, r *http.Request, customerID string) error {
	view, err := h.svc.Inbox(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, view)
}

// POST /notifications { ids? } marks the given (or all) notifications read.
func (h *Handler) markNotifications(w http.ResponseWriter, r *http.Request, customerID string) error {
	body, isObject := readBody(r)
	if !isObject {
		return fail(400, "Data tidak valid")
	}
	var ids []string
	if raw, present := body["ids"]; present {
		list, isList := raw.([]any)
		if !isList {
			return fail(400, "Data tidak valid")
		}
		for _, item := range list {
			id, isString := item.(string)
			if !isString || !isUUID(id) {
				return fail(400, "Data tidak valid")
			}
			ids = append(ids, id)
		}
	}
	if err := h.svc.repo.MarkRead(r.Context(), customerID, ids); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// POST /notifications/track { id, event } records the first open/click.
func (h *Handler) trackNotification(w http.ResponseWriter, r *http.Request, customerID string) error {
	body, _ := readBody(r)
	id, _ := body["id"].(string)
	event, _ := body["event"].(string)
	if !isUUID(id) || (event != "open" && event != "click") {
		return fail(400, "Data tidak valid")
	}
	link, found, err := h.svc.repo.TrackNotification(r.Context(), customerID, id, event)
	if err != nil {
		return err
	}
	if !found {
		return fail(404, "Notifikasi tidak ditemukan")
	}
	return ok(w, map[string]*string{"link_url": link})
}

// GET /push: the VAPID public key (null when push is off) and device count.
func (h *Handler) pushStatus(w http.ResponseWriter, r *http.Request, customerID string) error {
	n, err := h.svc.repo.PushDeviceCount(r.Context(), customerID)
	if err != nil {
		return err
	}
	var key *string
	if h.svc.pusher != nil {
		if k := h.svc.pusher.PublicKey(); k != "" {
			key = &k
		}
	}
	return ok(w, struct {
		PublicKey *string `json:"public_key"`
		Devices   int     `json:"devices"`
	}{key, n})
}

// POST /push { endpoint, keys: { p256dh, auth } } saves this device.
func (h *Handler) pushSubscribe(w http.ResponseWriter, r *http.Request, customerID string) error {
	body, _ := readBody(r)
	endpoint, _ := body["endpoint"].(string)
	keys, _ := body["keys"].(map[string]any)
	p256dh, _ := keys["p256dh"].(string)
	authKey, _ := keys["auth"].(string)
	if !isZodURL(endpoint) || domain.JSLength(endpoint) > 1000 ||
		p256dh == "" || domain.JSLength(p256dh) > 200 || authKey == "" || domain.JSLength(authKey) > 100 {
		return fail(400, "Langganan notifikasi tidak valid")
	}
	var ua *string
	if v := r.Header.Get("User-Agent"); v != "" {
		cut := domain.JSSlice(v, 300)
		ua = &cut
	}
	if err := h.svc.repo.SavePushSubscription(r.Context(), customerID, endpoint, p256dh, authKey, ua); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// DELETE /push { endpoint } turns push off on this device.
func (h *Handler) pushUnsubscribe(w http.ResponseWriter, r *http.Request, customerID string) error {
	body, _ := readBody(r)
	endpoint, _ := body["endpoint"].(string)
	if !isZodURL(endpoint) || domain.JSLength(endpoint) > 1000 {
		return fail(400, "Data tidak valid")
	}
	if err := h.svc.repo.DeletePushSubscription(r.Context(), customerID, endpoint); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

// POST /qr issues a single-use check-in QR valid for 60 seconds.
func (h *Handler) issueQR(w http.ResponseWriter, r *http.Request, customerID string) error {
	qr, err := h.svc.repo.IssueQR(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, qr)
}

// GET /app/home.
func (h *Handler) homeFeed(w http.ResponseWriter, r *http.Request, customerID string) error {
	feed, err := h.svc.HomeFeed(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, feed)
}

// GET /app/home/bookings.
func (h *Handler) homeBookings(w http.ResponseWriter, r *http.Request, customerID string) error {
	list, err := h.svc.ActiveBookings(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, list)
}

// GET /app/home/visits.
func (h *Handler) homeVisits(w http.ResponseWriter, r *http.Request, customerID string) error {
	list, err := h.svc.GateVisits(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, list)
}

// GET /app/home/announcements/{id}.
func (h *Handler) homeAnnouncement(w http.ResponseWriter, r *http.Request, customerID string) error {
	view, err := h.svc.AnnouncementByID(r.Context(), customerID, r.PathValue("id"))
	if err != nil {
		return err
	}
	return ok(w, view)
}

// GET /app/home/me.
func (h *Handler) account(w http.ResponseWriter, r *http.Request, customerID string) error {
	view, err := h.svc.Account(r.Context(), h.credits, customerID)
	if err != nil {
		return err
	}
	return ok(w, view)
}

// PATCH /app/home/me { emergencyContact?, acceptWaiver? }.
func (h *Handler) saveAccount(w http.ResponseWriter, r *http.Request, customerID string) error {
	raw, parsed := readRaw(r)
	body, isObject := raw.(map[string]any)
	if !parsed || !isObject {
		return fail(400, "Data tidak valid")
	}
	setContact := false
	var contact []byte
	if v, present := body["emergencyContact"]; present {
		setContact = true
		if v != nil {
			m, isMap := v.(map[string]any)
			if !isMap {
				return fail(400, "Data tidak valid")
			}
			c, valid := emergencyContact(m)
			if !valid {
				return fail(400, "Data tidak valid")
			}
			contact, _ = json.Marshal(c)
		}
	}
	accept := false
	if v, present := body["acceptWaiver"]; present {
		if v != true {
			return fail(400, "Data tidak valid")
		}
		accept = true
	}
	if err := h.svc.repo.SaveAccount(r.Context(), customerID, setContact, contact, accept, domain.WaiverVersion); err != nil {
		return err
	}
	return ok(w, map[string]bool{"ok": true})
}

type emergencyContactBody struct {
	Name     string `json:"name"`
	Phone    string `json:"phone"`
	Relation string `json:"relation"`
}

// emergencyContact mirrors the zod object: trimmed name 1-100, phone 6-30,
// relation 1-60; unknown keys dropped.
func emergencyContact(m map[string]any) (emergencyContactBody, bool) {
	get := func(key string, min, max int) (string, bool) {
		s, isString := m[key].(string)
		if !isString {
			return "", false
		}
		s = strings.TrimSpace(s)
		n := domain.JSLength(s)
		return s, n >= min && n <= max
	}
	name, ok1 := get("name", 1, 100)
	phone, ok2 := get("phone", 6, 30)
	relation, ok3 := get("relation", 1, 60)
	return emergencyContactBody{Name: name, Phone: phone, Relation: relation}, ok1 && ok2 && ok3
}
