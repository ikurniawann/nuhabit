package recruitment

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/recruitment/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// HR side of psikotes: the question bank, answer breakdowns and manual
// review. Answer keys leave the server only through these staff routes.

const msgInstrumentNotFound = "Instrumen tidak ditemukan"

// UpdateInstrument patches an instrument; 404 when missing.
func (s *Service) UpdateInstrument(ctx context.Context, id string, in instrumentInput) (*Row, error) {
	row, err := s.repo.UpdateInstrument(ctx, s.db, id, in)
	if err == nil && row == nil {
		err = httpx.NotFound(msgInstrumentNotFound)
	}
	return row, err
}

func (s *Service) instrumentKind(ctx context.Context, id string) (string, error) {
	kind, ok, err := s.repo.InstrumentKind(ctx, s.db, id)
	if err == nil && !ok {
		err = httpx.NotFound(msgInstrumentNotFound)
	}
	return kind, err
}

// ListQuestions lists an instrument's bank; 404 for an unknown instrument.
func (s *Service) ListQuestions(ctx context.Context, instrumentID string) ([]*Row, error) {
	if _, err := s.instrumentKind(ctx, instrumentID); err != nil {
		return nil, err
	}
	return s.repo.ListQuestions(ctx, s.db, instrumentID)
}

// parseQuestionFor validates a question with the schema of the instrument
// kind (mcq, else forced choice).
type parseQuestionFor func(kind string) (questionInput, error)

// CreateQuestion adds a question; drawing instruments have no bank.
func (s *Service) CreateQuestion(ctx context.Context, instrumentID string, parse parseQuestionFor) (*Row, error) {
	kind, err := s.instrumentKind(ctx, instrumentID)
	if err != nil {
		return nil, err
	}
	if kind == "drawing" {
		return nil, httpx.BadRequest("Instrumen tes gambar tidak memiliki bank soal — atur instruksi di config")
	}
	in, err := parse(kind)
	if err != nil {
		return nil, err
	}
	return s.repo.InsertQuestion(ctx, s.db, instrumentID, in)
}

const msgQuestionNotFound = "Soal tidak ditemukan"

// UpdateQuestion replaces a question, validated by its instrument kind.
func (s *Service) UpdateQuestion(ctx context.Context, id string, parse parseQuestionFor) (*Row, error) {
	kind, ok, err := s.repo.QuestionKind(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, httpx.NotFound(msgQuestionNotFound)
	}
	in, err := parse(kind)
	if err != nil {
		return nil, err
	}
	return s.repo.UpdateQuestion(ctx, s.db, id, in)
}

// DeleteQuestion hard-deletes a question.
func (s *Service) DeleteQuestion(ctx context.Context, id string) (*Row, error) {
	row, err := s.repo.DeleteQuestion(ctx, s.db, id)
	if err == nil && row == nil {
		err = httpx.NotFound(msgQuestionNotFound)
	}
	return row, err
}

const msgTestNotFound = "Tes tidak ditemukan"

// AnswerDetail is the HR breakdown of a test: MCQ in the order of the score
// snapshot (deleted questions have a null body), PAPI over the active bank.
func (s *Service) AnswerDetail(ctx context.Context, id string) (*Row, error) {
	test, err := s.repo.AnswerDetailTest(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if test == nil {
		return nil, httpx.NotFound(msgTestNotFound)
	}
	switch test.Str("instrument_kind") {
	case "drawing":
		return nil, httpx.BadRequest("Tes gambar tidak memiliki rincian soal")
	case "mcq":
		var detail struct {
			PerQuestion []struct {
				ID         string          `json:"id"`
				Given      json.RawMessage `json:"given"`
				CorrectKey json.RawMessage `json:"correct_key"`
				IsCorrect  json.RawMessage `json:"is_correct"`
			} `json:"per_question"`
		}
		_ = test.JSON("score_detail", &detail)
		items := []*Row{}
		if len(detail.PerQuestion) == 0 {
			return object("kind", "mcq", "items", items), nil
		}
		ids := make([]string, len(detail.PerQuestion))
		for i, p := range detail.PerQuestion {
			ids[i] = p.ID
		}
		rows, err := s.repo.QuestionsByID(ctx, s.db, "id, body, options", ids)
		if err != nil {
			return nil, err
		}
		byID := map[string]*Row{}
		for _, r := range rows {
			byID[r.Str("id")] = r
		}
		for _, p := range detail.PerQuestion {
			var body, options any
			if q := byID[p.ID]; q != nil {
				body, options = q.Get("body"), q.Get("options")
			}
			items = append(items, object("id", p.ID, "body", body, "options", options,
				"given", rawOrNull(p.Given), "correct_key", rawOrNull(p.CorrectKey), "is_correct", rawOrNull(p.IsCorrect)))
		}
		return object("kind", "mcq", "items", items), nil
	}
	// forced choice (PAPI): every active pair in bank order, with the choice
	// stored under answers.answers.
	var stored struct {
		Answers map[string]any `json:"answers"`
	}
	_ = test.JSON("answers", &stored)
	rows, err := s.repo.ActiveBank(ctx, s.db, test.Str("instrument_id"))
	if err != nil {
		return nil, err
	}
	items := make([]*Row, len(rows))
	for i, r := range rows {
		var given any
		if g, ok := stored.Answers[r.Str("id")].(string); ok && (g == "a" || g == "b") {
			given = g
		}
		items[i] = object("id", r.Get("id"), "body", r.Get("body"), "options", r.Get("options"), "given", given)
	}
	return object("kind", "forced_choice", "items", items), nil
}

func rawOrNull(v json.RawMessage) any {
	if len(v) == 0 {
		return nil
	}
	return v
}

// ReviewTest stores HR's review of a projective test with its activity.
func (s *Service) ReviewTest(ctx context.Context, id, notes string, actor Actor) (*Row, error) {
	test, err := s.repo.ReviewTarget(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if test == nil {
		return nil, httpx.NotFound(msgTestNotFound)
	}
	if !domain.IsReviewable(test.Str("status")) {
		return nil, httpx.Conflict("Tes ini tidak dalam antrian review manual")
	}
	var saved *Row
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		if saved, err = s.repo.SaveReview(ctx, tx, id, notes, actor); err != nil {
			return err
		}
		_, err = s.repo.LogActivity(ctx, tx, test.Str("candidate_id"), "psikotes_reviewed",
			"Hasil tes "+test.Str("instrument_name")+" direview manual", actor)
		return err
	})
	return saved, err
}

// ProctorEvents lists a session's proctoring evidence; 404 when missing.
func (s *Service) ProctorEvents(ctx context.Context, sessionType, id string) ([]*Row, error) {
	rows, found, err := s.repo.ProctorEvents(ctx, s.db, sessionType, id)
	if err == nil && !found {
		err = httpx.NotFound("Sesi tidak ditemukan")
	}
	return rows, err
}
