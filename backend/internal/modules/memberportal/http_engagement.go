package memberportal

import (
	"net/http"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/module"
)

func (h *Handler) engagementRoutes() []module.Route {
	return []module.Route{
		{Pattern: "GET " + prefix + "/promos", Handler: h.member("Gagal memuat promo", h.promos)},
		{Pattern: "GET " + prefix + "/events", Handler: h.member("Gagal memuat event", h.events)},
		{Pattern: "POST " + prefix + "/events", Handler: h.member("Gagal mendaftar event", h.bookEvent)},
		{Pattern: "DELETE " + prefix + "/events", Handler: h.member("Gagal membatalkan booking", h.cancelEventBooking)},
		{Pattern: "GET " + prefix + "/challenges", Handler: h.member("Gagal memuat challenge", h.challenges)},
		{Pattern: "POST " + prefix + "/challenges", Handler: h.member("Gagal mengikuti challenge", h.joinChallenge)},
		{Pattern: "GET " + prefix + "/reviews", Handler: h.member("Gagal memuat ulasan", h.reviews)},
		{Pattern: "POST " + prefix + "/reviews", Handler: h.member("Gagal menyimpan ulasan", h.writeReview)},
		{Pattern: "GET " + prefix + "/bills", Handler: h.member("Gagal memuat tagihan", h.bills)},
	}
}

// GET /promos.
func (h *Handler) promos(w http.ResponseWriter, r *http.Request, customerID string) error {
	list, err := h.svc.Promos(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, list)
}

// GET /events: published events that have not ended, with the member's booking.
func (h *Handler) events(w http.ResponseWriter, r *http.Request, customerID string) error {
	list, err := h.svc.repo.OpenEvents(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, nonNil(list))
}

// POST /events { event_id }: confirmed, waitlisted, or denied with a reason.
func (h *Handler) bookEvent(w http.ResponseWriter, r *http.Request, customerID string) error {
	body, _ := readBody(r)
	eventID, _ := body["event_id"].(string)
	if !isUUID(eventID) {
		return fail(400, "Data tidak valid")
	}
	decision, err := h.svc.BookEvent(r.Context(), customerID, eventID)
	if err != nil {
		return err
	}
	if decision.Kind == "deny" {
		return fail(409, domain.BookingDenialLabel[decision.Reason])
	}
	return ok(w, decision)
}

// DELETE /events?booking_id= cancels the member's own booking.
func (h *Handler) cancelEventBooking(w http.ResponseWriter, r *http.Request, customerID string) error {
	bookingID := r.URL.Query().Get("booking_id")
	if !isUUID(bookingID) {
		return fail(400, "ID booking tidak valid")
	}
	result, err := h.svc.CancelEventBooking(r.Context(), customerID, bookingID)
	if err != nil {
		return err
	}
	return ok(w, result)
}

// GET /challenges.
func (h *Handler) challenges(w http.ResponseWriter, r *http.Request, customerID string) error {
	list, err := h.svc.Challenges(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, list)
}

// POST /challenges { challenge_id } joins an active challenge.
func (h *Handler) joinChallenge(w http.ResponseWriter, r *http.Request, customerID string) error {
	body, _ := readBody(r)
	id, _ := body["challenge_id"].(string)
	if !isUUID(id) {
		return fail(400, "Data tidak valid")
	}
	joined, err := h.svc.repo.JoinChallenge(r.Context(), id, customerID)
	if err != nil {
		return err
	}
	if !joined {
		return fail(409, "Challenge ini sudah berakhir atau sudah Anda ikuti")
	}
	return ok(w, map[string]bool{"ok": true})
}

// GET /reviews.
func (h *Handler) reviews(w http.ResponseWriter, r *http.Request, customerID string) error {
	view, err := h.svc.Reviews(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, view)
}

// POST /reviews { order_id, rating, comment? }.
func (h *Handler) writeReview(w http.ResponseWriter, r *http.Request, customerID string) error {
	body, _ := readBody(r)
	orderID, _ := body["order_id"].(string)
	rating, isNumber := body["rating"].(float64)
	var comment *string
	commentValid := true
	if v, present := body["comment"]; present && v != nil {
		s, isString := v.(string)
		commentValid = isString && domain.JSLength(s) <= domain.ReviewCommentMax*2
		comment = &s
	}
	if !isUUID(orderID) || !isNumber || rating != float64(int(rating)) || rating < 1 || rating > 5 || !commentValid {
		return fail(400, "Pilih 1 sampai 5 bintang")
	}
	review, err := h.svc.WriteReview(r.Context(), customerID, orderID, int(rating), comment)
	if err != nil {
		return err
	}
	return ok(w, review)
}

// GET /bills.
func (h *Handler) bills(w http.ResponseWriter, r *http.Request, customerID string) error {
	view, err := h.svc.Bill(r.Context(), customerID)
	if err != nil {
		return err
	}
	return ok(w, view)
}
