package recruitment

import (
	"net/http"

	"nuhabit/backend/internal/modules/recruitment/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// orNull keeps a missing row as JSON null.
func orNull(r *Row) any {
	if r == nil {
		return nil
	}
	return r
}

// candidateID is the {id} path value checked with isUuid (400 otherwise).
func candidateID(r *http.Request) (string, error) {
	id := r.PathValue("id")
	if !domain.IsUUID(id) {
		return "", httpx.BadRequest(msgBadCandidateID)
	}
	return id, nil
}

func (h *handler) listCandidates(w http.ResponseWriter, r *http.Request, a Actor) error {
	// keyed to the user: X-Forwarded-For can be forged
	key := "candidates_get_" + a.ID
	if !h.svc.allow(key, domain.DefaultRateLimit) {
		return httpx.TooManyRequests("")
	}
	q, f := parseCandidateListQuery(r)
	if !f.Valid() {
		msg := f.Issues()[0].Message
		if msg == "" {
			msg = "Parameter tidak valid"
		}
		return httpx.BadRequest(msg, f.Issues())
	}
	page, err := h.svc.ListCandidates(r.Context(), q)
	if err != nil {
		return err
	}
	h.rateHeaders(w, key)
	return httpx.JSON(w, http.StatusOK, page)
}

func (h *handler) createCandidate(w http.ResponseWriter, r *http.Request, a Actor) error {
	key := "candidates_post_" + a.ID
	if !h.svc.allow(key, domain.DefaultRateLimit) {
		return httpx.TooManyRequests("")
	}
	f := form(r)
	in := parseCandidate(f, false)
	if err := firstIssue(f); err != nil {
		return err
	}
	row, err := h.svc.CreateCandidate(r.Context(), in, a)
	if err != nil {
		return err
	}
	h.rateHeaders(w, key)
	return reply(w, http.StatusCreated, "data", orNull(row), "message", "Kandidat berhasil ditambahkan")
}

func (h *handler) getCandidate(w http.ResponseWriter, r *http.Request, _ Actor) error {
	row, err := h.svc.GetCandidate(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", row)
}

func (h *handler) updateCandidate(w http.ResponseWriter, r *http.Request, _ Actor) error {
	id := r.PathValue("id")
	if _, err := h.svc.requireCandidate(r.Context(), id); err != nil {
		return err
	}
	f := form(r)
	in := parseCandidate(f, true)
	if err := firstIssue(f); err != nil {
		return err
	}
	row, err := h.svc.UpdateCandidate(r.Context(), id, in)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", orNull(row))
}

func (h *handler) listNotes(w http.ResponseWriter, r *http.Request, _ Actor) error {
	id := r.PathValue("id")
	if _, err := h.svc.requireCandidate(r.Context(), id); err != nil {
		return err
	}
	rows, err := h.svc.repo.ListNotes(r.Context(), h.svc.db, id)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", rows)
}

func (h *handler) addNote(w http.ResponseWriter, r *http.Request, a Actor) error {
	f := form(r)
	content := parseNote(f)
	if err := firstIssue(f); err != nil {
		return err
	}
	id := r.PathValue("id")
	if _, err := h.svc.requireCandidate(r.Context(), id); err != nil {
		return err
	}
	note, err := h.svc.AddNote(r.Context(), id, content, a)
	if err != nil {
		return err
	}
	return reply(w, http.StatusCreated, "data", orNull(note), "message", "Catatan tersimpan")
}

func (h *handler) listActivities(w http.ResponseWriter, r *http.Request, _ Actor) error {
	id := r.PathValue("id")
	if _, err := h.svc.requireCandidate(r.Context(), id); err != nil {
		return err
	}
	rows, err := h.svc.repo.ListActivities(r.Context(), h.svc.db, id)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", rows)
}

// logTemplate records that HR opened a WhatsApp template (the only manual
// activity the whitelist allows).
func (h *handler) logTemplate(w http.ResponseWriter, r *http.Request, a Actor) error {
	if err := h.svc.enforce("candidate_activities_post_"+a.ID, domain.DefaultRateLimit, domain.TooManyRequests); err != nil {
		return err
	}
	template, _ := form(r).Fields()["template"].(string)
	label, ok := domain.WATemplateLabel(template)
	if !ok {
		return httpx.BadRequest("Template tidak dikenal")
	}
	id := r.PathValue("id")
	if _, err := h.svc.requireCandidate(r.Context(), id); err != nil {
		return err
	}
	row, err := h.svc.repo.LogActivity(r.Context(), h.svc.db, id, "wa_template_sent", `Template WA "`+label+`" dibuka`, a)
	if err != nil {
		return err
	}
	return reply(w, http.StatusCreated, "data", orNull(row), "message", "Aktivitas tercatat")
}

// moveStage is the only path that changes a candidate's status, so every
// move leaves an activity with the HR name.
func (h *handler) moveStage(w http.ResponseWriter, r *http.Request, a Actor) error {
	status, _ := form(r).Fields()["status"].(string)
	if _, ok := domain.StatusLabel(status); !ok {
		return httpx.BadRequest("Status tidak valid")
	}
	res, msg, err := h.svc.MoveStage(r.Context(), r.PathValue("id"), status, a)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", res, "message", msg)
}

func (h *handler) getScreening(w http.ResponseWriter, r *http.Request, _ Actor) error {
	id, err := candidateID(r)
	if err != nil {
		return err
	}
	row, err := h.svc.repo.GetScreening(r.Context(), h.svc.db, id)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", orNull(row))
}

func (h *handler) saveScreening(w http.ResponseWriter, r *http.Request, a Actor) error {
	id, err := candidateID(r)
	if err != nil {
		return err
	}
	if err := h.svc.enforce("candidate_screening_put_"+a.ID, domain.DefaultRateLimit, domain.TooManyRequests); err != nil {
		return err
	}
	f := form(r)
	in := parseScreening(f)
	if err := firstIssue(f); err != nil {
		return err
	}
	if _, err := h.svc.requireCandidate(r.Context(), id); err != nil {
		return err
	}
	saved, err := h.svc.SaveScreening(r.Context(), id, in, a)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", orNull(saved), "message", "Hasil screening tersimpan")
}

func (h *handler) psikotesPanel(w http.ResponseWriter, r *http.Request, a Actor) error {
	id, err := candidateID(r)
	if err != nil {
		return err
	}
	data, err := h.svc.PsikotesPanel(r.Context(), id, a.Role)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", data)
}

func (h *handler) invitePsikotes(w http.ResponseWriter, r *http.Request, a Actor) error {
	id, err := candidateID(r)
	if err != nil {
		return err
	}
	if err := h.svc.enforce("psikotes_session_create_"+a.ID, 20, domain.TooManyRequests); err != nil {
		return err
	}
	f := form(r)
	in := parsePsikotesInvite(f)
	if err := firstIssue(f); err != nil {
		return err
	}
	session, err := h.svc.InvitePsikotes(r.Context(), id, in, a)
	if err != nil {
		return err
	}
	return reply(w, http.StatusCreated, "data", orNull(session), "message", "Undangan tes dibuat")
}

func (h *handler) savePsikotesSummary(w http.ResponseWriter, r *http.Request, a Actor) error {
	id, err := candidateID(r)
	if err != nil {
		return err
	}
	if err := h.svc.enforce("psikotes_summary_put_"+a.ID, domain.DefaultRateLimit, domain.TooManyRequests); err != nil {
		return err
	}
	f := form(r)
	in := parsePsikotesSummary(f)
	if err := firstIssue(f); err != nil {
		return err
	}
	if _, err := h.svc.requireCandidate(r.Context(), id); err != nil {
		return err
	}
	saved, err := h.svc.SavePsikotesSummary(r.Context(), id, in, a)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", orNull(saved), "message", "Rekomendasi psikotes tersimpan")
}

func (h *handler) interviewPanel(w http.ResponseWriter, r *http.Request, a Actor) error {
	id, err := candidateID(r)
	if err != nil {
		return err
	}
	data, err := h.svc.InterviewPanel(r.Context(), id, a.Role)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", data)
}

func (h *handler) inviteInterview(w http.ResponseWriter, r *http.Request, a Actor) error {
	id, err := candidateID(r)
	if err != nil {
		return err
	}
	if err := h.svc.enforce("interview_session_create_"+a.ID, 20, domain.TooManyRequests); err != nil {
		return err
	}
	f := form(r)
	in := parseInterviewInvite(f)
	if err := firstIssue(f); err != nil {
		return err
	}
	session, err := h.svc.InviteInterview(r.Context(), id, in, a)
	if err != nil {
		return err
	}
	return reply(w, http.StatusCreated, "data", orNull(session), "message", "Undangan interview dibuat")
}

func (h *handler) offerPanel(w http.ResponseWriter, r *http.Request, a Actor) error {
	id, err := candidateID(r)
	if err != nil {
		return err
	}
	data, err := h.svc.OfferPanel(r.Context(), id, a.Role)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", data)
}

func (h *handler) createOffer(w http.ResponseWriter, r *http.Request, a Actor) error {
	id, err := candidateID(r)
	if err != nil {
		return err
	}
	if err := h.svc.enforce("offer_create_"+a.ID, 20, domain.TooManyRequests); err != nil {
		return err
	}
	f := form(r)
	in := parseOffer(f)
	if err := firstIssue(f); err != nil {
		return err
	}
	offer, err := h.svc.CreateOffer(r.Context(), id, in, a)
	if err != nil {
		return err
	}
	return reply(w, http.StatusCreated, "data", orNull(offer), "message", "Offer dibuat")
}
