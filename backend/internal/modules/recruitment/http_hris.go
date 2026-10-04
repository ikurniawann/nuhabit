package recruitment

import (
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"nuhabit/backend/internal/modules/recruitment/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// readRecord is readJson(request, z.record(z.string(), z.unknown())).
func readRecord(r *http.Request) (map[string]any, error) {
	v, ok := validate.ReadBody(r)
	if !ok {
		return nil, httpx.BadRequest("Body JSON tidak valid")
	}
	m, isObj := v.(map[string]any)
	if !isObj {
		msg := "Invalid input: expected record, received " + jsTypeName(v)
		return nil, httpx.BadRequest(msg, []validate.Issue{{Code: "invalid_type", Path: []any{}, Message: msg}})
	}
	return m, nil
}

func (h *handler) listJobOpenings(w http.ResponseWriter, r *http.Request, _ Actor) error {
	rows, err := h.svc.repo.ListJobOpenings(r.Context(), h.svc.db)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", rows)
}

func (h *handler) createJobOpening(w http.ResponseWriter, r *http.Request, _ Actor) error {
	body, err := readRecord(r)
	if err != nil {
		return err
	}
	row, err := h.svc.SaveJobOpening(r.Context(), "", body)
	if err != nil {
		return err
	}
	return reply(w, http.StatusCreated, "data", row, "message", "Lowongan berhasil dibuat")
}

func (h *handler) updateJobOpening(w http.ResponseWriter, r *http.Request, _ Actor) error {
	body, err := readRecord(r)
	if err != nil {
		return err
	}
	row, err := h.svc.SaveJobOpening(r.Context(), r.PathValue("id"), body)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", row, "message", "Lowongan berhasil diperbarui")
}

func (h *handler) deleteJobOpening(w http.ResponseWriter, r *http.Request, _ Actor) error {
	if err := h.svc.repo.DeleteJobOpening(r.Context(), h.svc.db, r.PathValue("id")); err != nil {
		return err
	}
	return reply(w, http.StatusOK, "message", "Lowongan berhasil dihapus")
}

// publicJobOpenings is the careers page feed (no login). A query failure
// answers 500 {data: [], error: <pg message>} like the TS route.
func (h *handler) publicJobOpenings(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.repo.PublishedJobOpenings(r.Context(), h.svc.db)
	if err != nil {
		slog.ErrorContext(r.Context(), "Job openings query error", "error", err)
		msg := err.Error()
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			msg = pgErr.Message
		}
		_ = reply(w, http.StatusInternalServerError, "data", []any{}, "error", msg)
		return
	}
	_ = reply(w, http.StatusOK, "data", rows)
}

func (h *handler) promote(w http.ResponseWriter, r *http.Request, _ Actor) error {
	v, ok := validate.ReadBody(r)
	if !ok {
		return httpx.BadRequest("Body JSON tidak valid")
	}
	f := validate.New(v, true)
	in := parsePromotion(f)
	if err := firstIssue(f); err != nil {
		return err
	}
	out, err := h.svc.Promote(r.Context(), in)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, out)
}

func (h *handler) listPositions(w http.ResponseWriter, r *http.Request, _ Actor) error {
	var brandID *string
	if b := r.URL.Query().Get("brand_id"); b != "" {
		if !domain.IsUUID(b) {
			return httpx.BadRequest("Brand tidak valid")
		}
		brandID = &b
	}
	rows, err := h.svc.repo.ListPositions(r.Context(), h.svc.db, brandID)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", rows, "count", len(rows))
}

func (h *handler) createPosition(w http.ResponseWriter, r *http.Request, _ Actor) error {
	v, ok := validate.ReadBody(r)
	if !ok {
		// validateBody rethrows the JSON SyntaxError, which apiHandler turns into a 500
		return errors.New("positions: request body is not JSON")
	}
	f := validate.New(v, true)
	in := parsePosition(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	row, err := h.svc.repo.InsertPosition(r.Context(), h.svc.db, in)
	if err != nil {
		return err
	}
	return reply(w, http.StatusCreated, "data", orNull(row))
}

// ── live monitoring (HR) ────────────────────────────────────────────────────

func (h *handler) liveSessions(w http.ResponseWriter, r *http.Request, _ Actor) error {
	rows, err := h.svc.repo.OnlineSessions(r.Context(), h.svc.db)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", rows)
}

func (h *handler) liveChat(w http.ResponseWriter, r *http.Request, _ Actor) error {
	t := r.PathValue("type")
	session, err := h.svc.requireLiveSession(r.Context(), t, r.PathValue("id"))
	if err != nil {
		return err
	}
	rows, err := h.svc.Chat(r.Context(), t, session.Str("id"), r.URL.Query().Get("after"))
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", rows)
}

func (h *handler) livePostChat(w http.ResponseWriter, r *http.Request, a Actor) error {
	t := r.PathValue("type")
	session, err := h.svc.requireLiveSession(r.Context(), t, r.PathValue("id"))
	if err != nil {
		return err
	}
	message, ok := parseChatMessage(form(r))
	if !ok {
		return httpx.BadRequest("Pesan tidak valid")
	}
	name := a.FullName
	if name == "" {
		name = "HRD"
	}
	saved, err := h.svc.PostChat(r.Context(), t, session.Str("id"), "hr", &name, message)
	if err != nil {
		return err
	}
	return reply(w, http.StatusCreated, "data", orNull(saved))
}

// dateString is String(date) of a JS Date on a UTC server.
func dateString(t time.Time) string {
	return t.UTC().Format("Mon Jan 02 2006 15:04:05") + " GMT+0000 (Coordinated Universal Time)"
}

// decodeBase64 is Buffer.from(s, "base64"): stops at padding and tolerates
// a missing one.
func decodeBase64(s string) []byte {
	if i := strings.IndexByte(s, '='); i >= 0 {
		s = s[:i]
	}
	if len(s)%4 == 1 {
		s = s[:len(s)-1]
	}
	b, _ := base64.RawStdEncoding.DecodeString(s)
	return b
}

func (h *handler) liveFrame(w http.ResponseWriter, r *http.Request, _ Actor) error {
	t, id := r.PathValue("type"), r.PathValue("id")
	if !domain.IsLiveSessionType(t) || !domain.IsUUID(id) {
		return httpx.BadRequest("Sesi tidak valid")
	}
	frame, err := h.svc.repo.LatestFrame(r.Context(), h.svc.db, t, id)
	if err != nil {
		return err
	}
	if frame == nil {
		return httpx.NotFound("Belum ada frame")
	}
	img := decodeBase64(frame.Str("frame_base64"))
	hd := w.Header()
	hd.Set("Content-Type", "image/jpeg")
	hd.Set("Cache-Control", "no-store")
	if at := frame.Time("updated_at"); at != nil {
		hd.Set("X-Frame-Updated-At", dateString(*at))
	}
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Content-Length", strconv.Itoa(len(img)))
	w.WriteHeader(http.StatusOK)
	_, err = w.Write(img)
	return err
}

func (h *handler) livePutOffer(w http.ResponseWriter, r *http.Request, _ Actor) error {
	t, id := r.PathValue("type"), r.PathValue("id")
	running := false
	if domain.IsLiveSessionType(t) {
		var err error
		if running, err = h.svc.isLiveSessionRunning(r.Context(), t, id); err != nil {
			return err
		}
	}
	if !running {
		return httpx.NotFound("Sesi tidak sedang berjalan")
	}
	offerID, sdp, ok := parseSignal(form(r), domain.IsOfferID)
	if !ok {
		return httpx.BadRequest("Payload tidak valid")
	}
	if err := h.svc.repo.PutOffer(r.Context(), h.svc.db, t, id, offerID, sdp, h.svc.now()); err != nil {
		return err
	}
	return reply(w, http.StatusCreated, "data", object("ok", true))
}

func (h *handler) liveAnswer(w http.ResponseWriter, r *http.Request, _ Actor) error {
	t, id := r.PathValue("type"), r.PathValue("id")
	if !domain.IsLiveSessionType(t) || !domain.IsUUID(id) {
		return httpx.BadRequest("Sesi tidak valid")
	}
	offerID := r.URL.Query().Get("offer_id")
	if !domain.IsOfferID(offerID) {
		return httpx.BadRequest("offer_id tidak valid")
	}
	answer, err := h.svc.repo.OfferAnswer(r.Context(), h.svc.db, t, id, offerID, h.svc.now())
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", object("sdp", answer))
}
