package recruitment

import (
	"net/http"

	"nuhabit/backend/internal/modules/recruitment/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// pathUUID is assertUuid on the {id} path value.
func pathUUID(r *http.Request, message string) (string, error) {
	id := r.PathValue("id")
	if !domain.IsUUID(id) {
		return "", httpx.BadRequest(message)
	}
	return id, nil
}

func (h *handler) listInstruments(w http.ResponseWriter, r *http.Request, a Actor) error {
	if err := h.svc.enforce("psikotes_instruments_get_"+a.ID, domain.DefaultRateLimit, domain.TooManyRequests); err != nil {
		return err
	}
	rows, err := h.svc.repo.ListInstruments(r.Context(), h.svc.db)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", rows)
}

func (h *handler) updateInstrument(w http.ResponseWriter, r *http.Request, a Actor) error {
	id, err := pathUUID(r, "ID instrumen tidak valid")
	if err != nil {
		return err
	}
	if err := h.svc.enforce("psikotes_instrument_put_"+a.ID, domain.DefaultRateLimit, domain.TooManyRequests); err != nil {
		return err
	}
	f := form(r)
	in := parseInstrumentUpdate(f)
	if err := pathIssue(f); err != nil {
		return err
	}
	row, err := h.svc.UpdateInstrument(r.Context(), id, in)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", row, "message", "Instrumen tersimpan")
}

func (h *handler) listQuestions(w http.ResponseWriter, r *http.Request, a Actor) error {
	id, err := pathUUID(r, "ID instrumen tidak valid")
	if err != nil {
		return err
	}
	if err := h.svc.enforce("psikotes_questions_get_"+a.ID, domain.DefaultRateLimit, domain.TooManyRequests); err != nil {
		return err
	}
	rows, err := h.svc.ListQuestions(r.Context(), id)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", rows)
}

// questionParser validates the body with the schema of the instrument kind.
func questionParser(r *http.Request) parseQuestionFor {
	return func(kind string) (questionInput, error) {
		f := form(r)
		var in questionInput
		if kind == "mcq" {
			in = parseMcqQuestion(f)
		} else {
			in = parsePapiQuestion(f)
		}
		return in, pathIssue(f)
	}
}

func (h *handler) createQuestion(w http.ResponseWriter, r *http.Request, a Actor) error {
	id, err := pathUUID(r, "ID instrumen tidak valid")
	if err != nil {
		return err
	}
	if err := h.svc.enforce("psikotes_question_post_"+a.ID, domain.DefaultRateLimit, domain.TooManyRequests); err != nil {
		return err
	}
	row, err := h.svc.CreateQuestion(r.Context(), id, questionParser(r))
	if err != nil {
		return err
	}
	return reply(w, http.StatusCreated, "data", orNull(row), "message", "Soal tersimpan")
}

func (h *handler) updateQuestion(w http.ResponseWriter, r *http.Request, a Actor) error {
	id, err := pathUUID(r, "ID soal tidak valid")
	if err != nil {
		return err
	}
	if err := h.svc.enforce("psikotes_question_put_"+a.ID, domain.DefaultRateLimit, domain.TooManyRequests); err != nil {
		return err
	}
	row, err := h.svc.UpdateQuestion(r.Context(), id, questionParser(r))
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", orNull(row), "message", "Soal tersimpan")
}

func (h *handler) deleteQuestion(w http.ResponseWriter, r *http.Request, a Actor) error {
	id, err := pathUUID(r, "ID soal tidak valid")
	if err != nil {
		return err
	}
	if err := h.svc.enforce("psikotes_question_delete_"+a.ID, domain.DefaultRateLimit, domain.TooManyRequests); err != nil {
		return err
	}
	row, err := h.svc.DeleteQuestion(r.Context(), id)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", row, "message", "Soal dihapus")
}

func (h *handler) answerDetail(w http.ResponseWriter, r *http.Request, _ Actor) error {
	id, err := pathUUID(r, "ID tes tidak valid")
	if err != nil {
		return err
	}
	data, err := h.svc.AnswerDetail(r.Context(), id)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", data)
}

func (h *handler) reviewTest(w http.ResponseWriter, r *http.Request, a Actor) error {
	id, err := pathUUID(r, "ID tes tidak valid")
	if err != nil {
		return err
	}
	if err := h.svc.enforce("psikotes_review_put_"+a.ID, domain.DefaultRateLimit, domain.TooManyRequests); err != nil {
		return err
	}
	f := form(r)
	notes := parseReview(f)
	if err := pathIssue(f); err != nil {
		return err
	}
	saved, err := h.svc.ReviewTest(r.Context(), id, notes, a)
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", orNull(saved), "message", "Review tersimpan")
}

func (h *handler) proctorEvents(sessionType string) staffFunc {
	return func(w http.ResponseWriter, r *http.Request, _ Actor) error {
		id, err := pathUUID(r, "ID sesi tidak valid")
		if err != nil {
			return err
		}
		rows, err := h.svc.ProctorEvents(r.Context(), sessionType, id)
		if err != nil {
			return err
		}
		return reply(w, http.StatusOK, "data", rows)
	}
}
