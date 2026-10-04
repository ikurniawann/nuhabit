package posops

import (
	"net/http"

	"nuhabit/backend/internal/platform/module"
)

// Reservation routes (app/api/pos/reservations). Their catch renders any
// error's message, QueryBuilder errors included.
func (h *Handler) reservationRoutes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/pos/reservations", Handler: caught(pgMessage, h.listReservations)},
		{Pattern: "POST /api/pos/reservations", Handler: caught(pgMessage, h.createReservation)},
		{Pattern: "PATCH /api/pos/reservations/{id}", Handler: caught(pgMessage, h.updateReservation)},
		{Pattern: "POST /api/pos/reservations/{id}/seat", Handler: caught(pgMessage, h.seatReservation)},
	}
}

// destructured is `const { first, ... } = await request.json()`: a null
// body throws the destructuring TypeError.
func destructured(r *http.Request, first string) (any, error) {
	body, err := jsonBody(r)
	if err == nil && body == nil {
		return nil, &jsError{msg: "Cannot destructure property '" + first + "' of 'body' as it is null."}
	}
	return body, err
}

func (h *Handler) listReservations(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePos(r, "Authentication required"); err != nil {
		return err
	}
	f := reservationFilter{Date: queryParam(r, "date")}
	if s := queryParam(r, "status"); s != nil && *s != "undefined" && *s != "all" {
		f.Status = s
	}
	if t := queryParam(r, "table_id"); t != nil && *t != "undefined" {
		f.TableID = t
	}
	rows, err := h.svc.ListReservations(r.Context(), f)
	if err != nil {
		return err
	}
	return okData(w, rows)
}

func (h *Handler) createReservation(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePos(r, "Authentication required"); err != nil {
		return err
	}
	body, err := destructured(r, "table_id")
	if err != nil {
		return err
	}
	row, err := h.svc.CreateReservation(r.Context(), body)
	if err != nil {
		return err
	}
	return writeObj(w, http.StatusCreated, NewObj("success", true, "data", row))
}

func (h *Handler) updateReservation(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.requirePos(r, "Authentication required"); err != nil {
		return err
	}
	body, err := destructured(r, "status")
	if err != nil {
		return err
	}
	row, err := h.svc.UpdateReservation(r.Context(), r.PathValue("id"), body)
	if err != nil {
		return err
	}
	return okData(w, row)
}

func (h *Handler) seatReservation(w http.ResponseWriter, r *http.Request) error {
	user, err := h.requirePos(r, "Authentication required")
	if err != nil {
		return err
	}
	seated, err := h.svc.SeatReservation(r.Context(), user.ID, r.PathValue("id"), jsonBodyOr(r, emptyObject()))
	if err != nil {
		return err
	}
	return okData(w, seated)
}
