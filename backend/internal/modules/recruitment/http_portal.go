package recruitment

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"nuhabit/backend/internal/modules/recruitment/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

// Candidate portal routes (no login; the link token is the identity) and
// the offer response routes.

func (h *handler) psikotesSession(w http.ResponseWriter, r *http.Request) error {
	session, err := h.svc.requirePortal(r.Context(), psikotesPortal, r.PathValue("token"), "get")
	if err != nil {
		return err
	}
	data, err := h.svc.PsikotesPortal(r.Context(), session)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", data)
}

func (h *handler) startPsikotes(w http.ResponseWriter, r *http.Request) error {
	if err := assertBodySize(r, 10_000, bodyTooLarge); err != nil {
		return err
	}
	session, err := h.svc.requirePortal(r.Context(), psikotesPortal, r.PathValue("token"), "start")
	if err != nil {
		return err
	}
	updated, err := h.svc.StartPsikotesSession(r.Context(), session, func() (bool, error) {
		f := form(r)
		consent := f.Bool("webcam_consent", validate.Rule{})
		if err := fixedIssue(f, "Payload tidak valid"); err != nil {
			return false, err
		}
		return *consent, nil
	})
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", orNull(updated), "message", "Sesi dimulai")
}

func (h *handler) finishPsikotes(w http.ResponseWriter, r *http.Request) error {
	session, err := h.svc.requirePortal(r.Context(), psikotesPortal, r.PathValue("token"), "finish")
	if err != nil {
		return err
	}
	body, err := h.svc.FinishPsikotesSession(r.Context(), session)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, body)
}

// runningTest loads the session (bucket), requires it in progress and loads
// the test of the path.
func (h *handler) runningTest(r *http.Request, bucket string) (testView, error) {
	session, err := h.svc.requirePortal(r.Context(), psikotesPortal, r.PathValue("token"), bucket)
	if err != nil {
		return testView{}, err
	}
	if err := assertInProgress(session, "Sesi sudah berakhir"); err != nil {
		return testView{}, err
	}
	return h.svc.requireTest(r.Context(), session.Str("id"), r.PathValue("testId"))
}

func (h *handler) startTest(w http.ResponseWriter, r *http.Request) error {
	session, err := h.svc.requirePortal(r.Context(), psikotesPortal, r.PathValue("token"), "test_start")
	if err != nil {
		return err
	}
	if err := assertInProgress(session, "Sesi belum dimulai atau sudah berakhir"); err != nil {
		return err
	}
	data, err := h.svc.StartTest(r.Context(), session.Str("id"), r.PathValue("testId"))
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", data)
}

func (h *handler) saveAnswers(w http.ResponseWriter, r *http.Request) error {
	if err := assertBodySize(r, 100_000, bodyTooLarge); err != nil {
		return err
	}
	test, err := h.runningTest(r, "answers")
	if err != nil {
		return err
	}
	saved, err := h.svc.SaveAnswers(r.Context(), test, func() (map[string]string, error) {
		answers, ok := parseAnswers(form(r))
		if !ok {
			return nil, httpx.BadRequest("Payload tidak valid")
		}
		return answers, nil
	})
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", object("saved", saved), "message", "Jawaban tersimpan")
}

func (h *handler) finishTest(w http.ResponseWriter, r *http.Request) error {
	if err := assertBodySize(r, 100_000, bodyTooLarge); err != nil {
		return err
	}
	test, err := h.runningTest(r, "test_finish")
	if err != nil {
		return err
	}
	// optional {answers} flush; an invalid body is ignored
	flush, _ := parseAnswers(form(r))
	body, err := h.svc.FinishTest(r.Context(), test, flush)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, body)
}

func (h *handler) portalChat(kind portalKind) httpx.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		session, err := h.svc.requirePortal(r.Context(), kind, r.PathValue("token"), "chat")
		if err != nil {
			return err
		}
		rows, err := h.svc.Chat(r.Context(), kind.sessionType, session.Str("id"), r.URL.Query().Get("after"))
		if err != nil {
			return err
		}
		return reply(w, http.StatusOK, "data", rows)
	}
}

func (h *handler) portalPostChat(kind portalKind) httpx.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		session, err := h.svc.requirePortal(r.Context(), kind, r.PathValue("token"), "chat")
		if err != nil {
			return err
		}
		// candidates may chat from the moment they get the link
		if st := session.Str("status"); st != "in_progress" && st != "sent" {
			return httpx.Conflict("Sesi sudah berakhir")
		}
		message, ok := parseChatMessage(form(r))
		if !ok {
			return httpx.BadRequest("Pesan tidak valid")
		}
		name := session.StrPtr("candidate_name")
		saved, err := h.svc.PostChat(r.Context(), kind.sessionType, session.Str("id"), "candidate", name, message)
		if err != nil {
			return err
		}
		return reply(w, http.StatusCreated, "data", orNull(saved))
	}
}

func (h *handler) portalFrame(kind portalKind) httpx.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		if err := assertBodySize(r, 1024*1024, bodyTooLarge); err != nil {
			return err
		}
		session, err := h.svc.requirePortal(r.Context(), kind, r.PathValue("token"), "frame")
		if err != nil {
			return err
		}
		if err := assertInProgress(session, "Sesi tidak sedang berjalan"); err != nil {
			return err
		}
		frame, ok := parseFrame(form(r))
		if !ok {
			return httpx.BadRequest("Frame tidak valid")
		}
		if err := h.svc.SaveFrame(r.Context(), kind.sessionType, session.Str("id"), frame); err != nil {
			return err
		}
		return reply(w, http.StatusOK, "data", object("ok", true))
	}
}

func (h *handler) portalOffers(kind portalKind) httpx.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		session, err := h.svc.requirePortal(r.Context(), kind, r.PathValue("token"), "webrtc")
		if err != nil {
			return err
		}
		offers, err := h.svc.PendingOffers(r.Context(), session, kind.sessionType)
		if err != nil {
			return err
		}
		return reply(w, http.StatusOK, "data", object("offers", offers))
	}
}

func (h *handler) portalAnswer(kind portalKind) httpx.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		session, err := h.svc.requirePortal(r.Context(), kind, r.PathValue("token"), "webrtc")
		if err != nil {
			return err
		}
		if err := assertInProgress(session, "Sesi tidak sedang berjalan"); err != nil {
			return err
		}
		offerID, sdp, ok := parseSignal(form(r), nil)
		if !ok {
			return httpx.BadRequest("Payload tidak valid")
		}
		answered, err := h.svc.AnswerOffer(r.Context(), kind.sessionType, session.Str("id"), offerID, sdp)
		if err != nil {
			return err
		}
		return reply(w, http.StatusOK, "data", object("ok", answered))
	}
}

// ── offers ──────────────────────────────────────────────────────────────────

func (h *handler) offerSession(w http.ResponseWriter, r *http.Request) error {
	offer, err := h.svc.requirePortal(r.Context(), offerPortal, r.PathValue("token"), "get")
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", object("offer", OfferForCandidate(offer)))
}

// clientIP is cf-connecting-ip, else the first x-forwarded-for hop, else nil.
func clientIP(r *http.Request) *string {
	if v := r.Header.Values("Cf-Connecting-Ip"); len(v) > 0 {
		ip := strings.Join(v, ", ")
		return &ip
	}
	if v := r.Header.Values("X-Forwarded-For"); len(v) > 0 {
		ip := strings.TrimSpace(strings.Split(strings.Join(v, ", "), ",")[0])
		return &ip
	}
	return nil
}

func (h *handler) respondOffer(w http.ResponseWriter, r *http.Request) error {
	offer, err := h.svc.requirePortal(r.Context(), offerPortal, r.PathValue("token"), "respond")
	if err != nil {
		return err
	}
	updated, err := h.svc.RespondOffer(r.Context(), offer, clientIP(r), func() (offerResponseInput, error) {
		f := form(r)
		in := parseOfferRespond(f)
		return in, pathIssue(f)
	})
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", orNull(updated), "message", "Respons Anda tercatat")
}

// manualOfferResponse is PUT /api/offers/[id]/response. Its own failures
// answer {error} without "success" and anything unexpected is a 500
// "Internal server error", as the TS route's try/catch does; guard errors
// keep the ApiError body.
func (h *handler) manualOfferResponse(w http.ResponseWriter, r *http.Request) {
	fail := func(status int, msg string) { _ = reply(w, status, "error", msg) }
	u, err := h.guard.RequireMenuPrefix(r, iam.HrisRecruitment...)
	if err != nil {
		var appErr *httpx.Error
		if errors.As(err, &appErr) {
			httpx.WriteError(w, r, appErr)
			return
		}
		slog.ErrorContext(r.Context(), "[offer-response] PUT failed", "error", err)
		fail(http.StatusInternalServerError, "Internal server error")
		return
	}
	id := r.PathValue("id")
	if !domain.IsUUID(id) {
		fail(http.StatusBadRequest, "ID offer tidak valid")
		return
	}
	if allowed, err := h.svc.allow(r.Context(), "offer_response_put_"+u.ID, 100); err != nil {
		fail(http.StatusInternalServerError, "Internal server error")
		return
	} else if !allowed {
		fail(http.StatusTooManyRequests, "Terlalu banyak permintaan, coba lagi sebentar lagi")
		return
	}
	f := form(r)
	in := parseManualResponse(f)
	if err := pathIssue(f); err != nil {
		fail(http.StatusBadRequest, err.Error())
		return
	}
	updated, found, err := h.svc.RecordManualResponse(r.Context(), id, in, Actor{ID: u.ID, FullName: u.FullName, Role: u.Role})
	var appErr *httpx.Error
	switch {
	case errors.As(err, &appErr):
		fail(appErr.Status, appErr.Message)
	case err != nil:
		slog.ErrorContext(r.Context(), "[offer-response] PUT failed", "error", err)
		fail(http.StatusInternalServerError, "Internal server error")
	case !found:
		fail(http.StatusNotFound, "Offer tidak ditemukan")
	default:
		_ = reply(w, http.StatusOK, "data", orNull(updated), "message", "Respons tercatat")
	}
}
