package resort

import (
	"net/http"
	"time"

	"nuhabit/backend/internal/modules/resort/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// Guard is the slice of platform/auth the handlers use; tests swap it.
type Guard interface {
	RequireMenuPrefix(r *http.Request, prefixes ...string) (*auth.User, error)
	RequireMenuAction(r *http.Request, action string, prefixes ...string) (*auth.User, error)
}

type handler struct {
	svc    *Service
	guard  Guard
	venues Venues
	now    func() time.Time
}

type venueFunc func(w http.ResponseWriter, r *http.Request, v Venue) error

// Routes lists every /api/resort route.
func (h *handler) Routes() []module.Route {
	read := func(pattern string, fn venueFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: h.venue("", fn)}
	}
	act := func(pattern, action string, fn venueFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: h.venue(action, fn)}
	}
	return []module.Route{
		read("GET /api/resort/availability", h.availability),
		read("GET /api/resort/front-office", h.frontOffice),
		read("GET /api/resort/reservations", h.listReservations),
		act("POST /api/resort/reservations", "create", h.createReservation),
		read("GET /api/resort/reservations/{id}", h.reservationDetail),
		act("PATCH /api/resort/reservations/{id}", "update", h.updateReservation),
		act("POST /api/resort/reservations/{id}/charges", "update", h.addCharge),
		act("POST /api/resort/reservations/{id}/status", "update", h.changeStatus),
		read("GET /api/resort/room-types", h.listRoomTypes),
		act("POST /api/resort/room-types", "create", h.createRoomType),
		act("PATCH /api/resort/room-types/{id}", "update", h.updateRoomType),
		act("DELETE /api/resort/room-types/{id}", "delete", h.removeRoomType),
		read("GET /api/resort/rooms", h.listRooms),
		act("POST /api/resort/rooms", "create", h.createRoom),
		act("PATCH /api/resort/rooms/{id}", "update", h.updateRoom),
		act("DELETE /api/resort/rooms/{id}", "delete", h.removeRoom),
	}
}

// venue is requireResortContext: the IAM guard (menu prefix, or the action
// when one is given), then the venue; an unresolved venue is 409.
func (h *handler) venue(action string, fn venueFunc) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		var u *auth.User
		var err error
		if action == "" {
			u, err = h.guard.RequireMenuPrefix(r, iam.Resort...)
		} else {
			u, err = h.guard.RequireMenuAction(r, action, iam.Resort...)
		}
		if err != nil {
			return err
		}
		company, branch, err := h.venues.Resolve(r.Context(), u.ID)
		if err != nil {
			return err
		}
		if company == "" || branch == "" {
			return httpx.Conflict("Venue resort belum dikonfigurasi")
		}
		return fn(w, r, Venue{UserID: u.ID, ActorName: actorName(u.FullName), CompanyID: company, BranchID: branch})
	})
}

// parse is validateBody: read the body, run the schema, 400 on issues.
func parse[T any](r *http.Request, schema func(*validate.Form) T) (T, error) {
	var zero T
	f, err := readForm(r)
	if err != nil {
		return zero, err
	}
	in := schema(f)
	if err := f.Err("Validation failed"); err != nil {
		return zero, err
	}
	return in, nil
}

// idOnly is the `{ id }` answer of a PATCH with nothing to change.
type idOnly struct {
	ID string `json:"id"`
}

// messageOnly writes {"success":true,"message":msg}.
func messageOnly(w http.ResponseWriter, msg string) error {
	return httpx.JSON(w, http.StatusOK, struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}{true, msg})
}

// updated answers a PATCH: `{ id }` when nothing changed.
func updated(w http.ResponseWriter, id string, row *Row, msg string) error {
	if row == nil {
		return httpx.Data(w, http.StatusOK, idOnly{id})
	}
	return httpx.DataMessage(w, http.StatusOK, row, msg)
}

func (h *handler) availability(w http.ResponseWriter, r *http.Request, v Venue) error {
	q := r.URL.Query()
	var exclude *string
	if q.Has("exclude_reservation_id") {
		id := q.Get("exclude_reservation_id")
		exclude = &id
	}
	data, err := h.svc.Availability(r.Context(), v.BranchID, q.Get("check_in"), q.Get("check_out"), exclude)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, data)
}

func (h *handler) frontOffice(w http.ResponseWriter, r *http.Request, v Venue) error {
	date := r.URL.Query().Get("date")
	if !domain.ValidDate(date) {
		date = h.now().In(jakarta).Format("2006-01-02")
	}
	data, err := h.svc.FrontOfficeBoard(r.Context(), v.BranchID, date)
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, data)
}

var jakarta = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		return time.FixedZone("WIB", 7*3600)
	}
	return loc
}()

func (h *handler) listReservations(w http.ResponseWriter, r *http.Request, v Venue) error {
	q := r.URL.Query()
	rows, err := h.svc.ListReservations(r.Context(), v.BranchID, ReservationFilters{
		Status: q.Get("status"), From: q.Get("from"), To: q.Get("to"), Search: validate.JSTrim(q.Get("search")),
	})
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, rows)
}

func (h *handler) createReservation(w http.ResponseWriter, r *http.Request, v Venue) error {
	in, err := parse(r, reservationCreate)
	if err != nil {
		return err
	}
	data, msg, err := h.svc.CreateReservation(r.Context(), v, in)
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, http.StatusCreated, data, msg)
}

func (h *handler) reservationDetail(w http.ResponseWriter, r *http.Request, v Venue) error {
	detail, err := h.svc.ReservationDetail(r.Context(), v.BranchID, r.PathValue("id"))
	if err != nil {
		return err
	}
	if detail == nil {
		return httpx.NotFound("Reservasi tidak ditemukan")
	}
	return httpx.Data(w, http.StatusOK, detail)
}

func (h *handler) updateReservation(w http.ResponseWriter, r *http.Request, v Venue) error {
	p, err := parse(r, reservationPatch)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	row, err := h.svc.UpdateReservation(r.Context(), v.BranchID, id, p)
	if err != nil {
		return err
	}
	return updated(w, id, row, "Reservasi diperbarui")
}

func (h *handler) addCharge(w http.ResponseWriter, r *http.Request, v Venue) error {
	in, err := parse(r, folioCharge)
	if err != nil {
		return err
	}
	data, msg, err := h.svc.AddFolioCharge(r.Context(), v, r.PathValue("id"), in)
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, http.StatusCreated, data, msg)
}

func (h *handler) changeStatus(w http.ResponseWriter, r *http.Request, v Venue) error {
	in, err := parse(r, statusChange)
	if err != nil {
		return err
	}
	data, msg, err := h.svc.ChangeStatus(r.Context(), v, r.PathValue("id"), in)
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, http.StatusOK, data, msg)
}

func (h *handler) listRoomTypes(w http.ResponseWriter, r *http.Request, v Venue) error {
	data, err := h.svc.RoomTypesWithSeasons(r.Context(), v.BranchID, r.URL.Query().Get("all") == "1")
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, data)
}

func (h *handler) createRoomType(w http.ResponseWriter, r *http.Request, v Venue) error {
	in, err := parse(r, roomTypeCreate)
	if err != nil {
		return err
	}
	row, err := h.svc.CreateRoomType(r.Context(), v, in)
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, http.StatusCreated, row, "Tipe kamar "+in.Name+" dibuat")
}

func (h *handler) updateRoomType(w http.ResponseWriter, r *http.Request, v Venue) error {
	p, err := parse(r, roomTypePatch)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	row, err := h.svc.UpdateRoomType(r.Context(), v.BranchID, id, p)
	if err != nil {
		return err
	}
	return updated(w, id, row, "Tipe kamar diperbarui")
}

func (h *handler) removeRoomType(w http.ResponseWriter, r *http.Request, v Venue) error {
	msg, err := h.svc.RemoveRoomType(r.Context(), v.BranchID, r.PathValue("id"))
	if err != nil {
		return err
	}
	return messageOnly(w, msg)
}

func (h *handler) listRooms(w http.ResponseWriter, r *http.Request, v Venue) error {
	rows, err := h.svc.ListRooms(r.Context(), v.BranchID, r.URL.Query().Get("room_type_id"))
	if err != nil {
		return err
	}
	return httpx.Data(w, http.StatusOK, rows)
}

func (h *handler) createRoom(w http.ResponseWriter, r *http.Request, v Venue) error {
	in, err := parse(r, roomCreate)
	if err != nil {
		return err
	}
	row, err := h.svc.CreateRoom(r.Context(), v, in)
	if err != nil {
		return err
	}
	return httpx.DataMessage(w, http.StatusCreated, row, "Kamar "+in.Name+" dibuat")
}

func (h *handler) updateRoom(w http.ResponseWriter, r *http.Request, v Venue) error {
	p, err := parse(r, roomPatch)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	row, err := h.svc.UpdateRoom(r.Context(), v.BranchID, id, p)
	if err != nil {
		return err
	}
	return updated(w, id, row, "Kamar diperbarui")
}

func (h *handler) removeRoom(w http.ResponseWriter, r *http.Request, v Venue) error {
	msg, err := h.svc.RemoveRoom(r.Context(), v.BranchID, r.PathValue("id"))
	if err != nil {
		return err
	}
	return messageOnly(w, msg)
}
