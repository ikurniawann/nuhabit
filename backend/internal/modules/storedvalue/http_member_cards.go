package storedvalue

import (
	"net/http"
	"regexp"

	"nuhabit/backend/internal/modules/storedvalue/domain"
	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/validate"
)

// /api/pos/member-cards/** and /api/pos/member-refunds/** (POS → Unlink
// Card). POS session guard; each route has its own catch-all message.

func (h *Handler) memberCardRoutes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/pos/member-cards", Handler: h.kit.Caught("Gagal memuat data kartu member", h.memberCards)},
		{Pattern: "POST /api/pos/member-cards/{id}/unlink", Handler: h.kit.Caught("Gagal melepas kartu", h.unlinkCard)},
		{Pattern: "POST /api/pos/member-cards/{id}/refund", Handler: h.kit.Caught("Gagal mengajukan refund", h.requestCardRefund)},
		{Pattern: "POST /api/pos/member-refunds/{id}/cancel", Handler: h.kit.Caught("Gagal membatalkan permintaan", h.cancelRefund)},
		{Pattern: "POST /api/pos/member-refunds/{id}/complete", Handler: h.kit.Caught("Gagal menyelesaikan refund", h.completeRefund)},
	}
}

// strictUUID is UUID_RE of the member card routes (any version).
var strictUUID = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func (h *Handler) actor(r *http.Request, u *auth.User) (actorProfile, error) {
	scope, err := h.kit.Dir.UserScope(r.Context(), h.kit.DB, u.ID)
	if err != nil {
		return actorProfile{}, err
	}
	return cardActor(scope), nil
}

func (h *Handler) memberCards(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.kit.PosUser(r); err != nil {
		return err
	}
	q := r.URL.Query()
	out, err := h.cards.Overview(r.Context(), validate.JSTrim(q.Get("search")), domain.NormalizeNfcUID(q.Get("nfc_uid")))
	if err != nil {
		return err
	}
	return kit.OK(w, 200, out)
}

func (h *Handler) unlinkCard(w http.ResponseWriter, r *http.Request) error {
	u, err := h.kit.PosUser(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	if !strictUUID.MatchString(id) {
		return httpx.BadRequest("ID member tidak valid")
	}
	body := kit.BodyObject(r)
	reason, notes, problem := domain.ValidateCardUnlink(body["reason"], body["notes"])
	if problem != "" {
		return httpx.BadRequest(problem)
	}
	actor, err := h.actor(r, u)
	if err != nil {
		return err
	}
	out, err := h.cards.Unlink(r.Context(), id, reason, notes, u.ID, actor)
	if err != nil {
		return err
	}
	who := kit.Deref(out.Customer.Name)
	if who == "" {
		who = out.Customer.Phone
	}
	return kit.MessageData(w, 200, "Kartu "+out.PreviousNfcUID+" dilepas dari "+who+" — saldo tetap utuh", out)
}

func (h *Handler) requestCardRefund(w http.ResponseWriter, r *http.Request) error {
	u, err := h.kit.PosUser(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	if !strictUUID.MatchString(id) {
		return httpx.BadRequest("ID member tidak valid")
	}
	notes, problem := domain.NormalizeNotes(kit.BodyObject(r)["notes"])
	if problem != "" {
		return httpx.BadRequest(problem)
	}
	actor, err := h.actor(r, u)
	if err != nil {
		return err
	}
	out, err := h.cards.RequestRefund(r.Context(), id, notes, u.ID, actor)
	if err != nil {
		return err
	}
	c := out.Customer
	who := kit.Deref(c.Name)
	if who == "" {
		who = c.Phone
	}
	return kit.MessageData(w, 200, "Kartu "+out.PreviousNfcUID+" dilepas & refund "+domain.FormatRupiah(c.ArkCoinBalance)+
		" untuk "+who+" diajukan ke Finance", out)
}

func (h *Handler) cancelRefund(w http.ResponseWriter, r *http.Request) error {
	u, err := h.kit.PosUser(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	if !strictUUID.MatchString(id) {
		return httpx.BadRequest("ID permintaan tidak valid")
	}
	reason, problem := domain.NormalizeNotes(kit.BodyObject(r)["reason"])
	if problem != "" {
		return httpx.BadRequest(problem)
	}
	actor, err := h.actor(r, u)
	if err != nil {
		return err
	}
	cancelled, err := h.cards.CancelRefund(r.Context(), id, reason, u.ID, actor)
	if err != nil {
		return err
	}
	if !cancelled {
		return httpx.Conflict("Permintaan tidak ditemukan atau sudah diproses")
	}
	return kit.MessageData(w, 200, "Permintaan refund dibatalkan — saldo member tetap", struct {
		RequestID string `json:"request_id"`
	}{id})
}

func (h *Handler) completeRefund(w http.ResponseWriter, r *http.Request) error {
	u, err := h.kit.PosUser(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	if !strictUUID.MatchString(id) {
		return httpx.BadRequest("ID permintaan tidak valid")
	}
	body := kit.BodyObject(r)
	notes, problem := domain.NormalizeNotes(body["notes"])
	if problem != "" {
		return httpx.BadRequest(problem)
	}
	pin := validate.JSTrim(domain.JSStringOrEmpty(body["supervisor_pin"]))
	if pin == "" {
		return httpx.BadRequest("Refund Completed membutuhkan PIN supervisor")
	}
	approval, err := h.cards.supervisors.Approve(r.Context(), u.ID, pin)
	if err != nil {
		return err
	}
	if !approval.OK {
		return supervisorRejection(approval)
	}
	actor, err := h.actor(r, u)
	if err != nil {
		return err
	}
	out, err := h.cards.CompleteRefund(r.Context(), id, notes, u.ID, actor, approval.Supervisor)
	if err != nil {
		return err
	}
	return kit.MessageData(w, 200, domain.RefundCompletedMessage(out.Customer.Name, &out.Customer.Phone, out.RefundedAmount), out)
}
