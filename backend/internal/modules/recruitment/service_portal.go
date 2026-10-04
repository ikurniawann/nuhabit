package recruitment

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/recruitment/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// Anonymous candidate portals: the link token is the identity. Rate limits
// are keyed to the session, tighter for routes that write a lot.

// portalKind describes one portal's token rules.
type portalKind struct {
	sessionType string // live session type, "" for offers
	notFound    string
	lifetime    time.Duration
	expirable   []string
	limits      map[string]int
	keyPrefix   string
}

var (
	psikotesPortal = portalKind{
		sessionType: "psikotes", notFound: "Link tes tidak berlaku", lifetime: domain.SessionLinkLifetime,
		expirable: []string{"draft", "sent", "in_progress"}, limits: map[string]int{"upload": 6, "proctor": 12},
		keyPrefix: "psikotes_session_",
	}
	interviewPortal = portalKind{
		sessionType: "interview", notFound: "Link interview tidak berlaku", lifetime: domain.SessionLinkLifetime,
		expirable: []string{"sent", "in_progress"}, limits: map[string]int{"answer": 6, "proctor": 12},
		keyPrefix: "interview_session_",
	}
	offerPortal = portalKind{
		notFound: "Link penawaran tidak berlaku", lifetime: domain.OfferLinkLifetime,
		expirable: []string{"sent", "negotiating"}, keyPrefix: "offer_session_",
	}
)

// requirePortal loads the session (or offer) behind a link token, expiring
// it when its link lapsed, then applies the per-session rate limit of
// bucket. 404 for a malformed or unknown token.
func (s *Service) requirePortal(ctx context.Context, kind portalKind, token, bucket string) (*Row, error) {
	if !domain.IsPortalToken(token) {
		return nil, httpx.NotFound(kind.notFound)
	}
	var row *Row
	var err error
	issuedKey := "invited_at"
	switch kind.sessionType {
	case "psikotes":
		row, err = s.repo.PsikotesSessionByToken(ctx, s.db, token)
	case "interview":
		row, err = s.repo.InterviewSessionByToken(ctx, s.db, token)
	default:
		row, err = s.repo.OfferByToken(ctx, s.db, token)
		issuedKey = "sent_at"
	}
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, httpx.NotFound(kind.notFound)
	}
	status := row.Str("status")
	if slices.Contains(kind.expirable, status) && domain.IsLinkExpired(row.Time("expires_at"), row.Time(issuedKey), kind.lifetime, s.now()) {
		if kind.sessionType == "" {
			err = s.repo.ExpireOffer(ctx, s.db, row.Str("id"))
		} else {
			err = s.repo.ExpireSession(ctx, s.db, kind.sessionType, row.Str("id"))
		}
		if err != nil {
			return nil, err
		}
		row.Set("status", "expired")
	}
	limit, ok := kind.limits[bucket]
	if !ok {
		limit = domain.DefaultRateLimit
	}
	if err := s.enforce(kind.keyPrefix+bucket+"_"+row.Str("id"), limit, domain.TooManyRequests); err != nil {
		return nil, err
	}
	return row, nil
}

// assertInProgress is 409 with message unless the session is running.
func assertInProgress(session *Row, message string) error {
	if session.Str("status") != "in_progress" {
		return httpx.Conflict(message)
	}
	return nil
}

// assertBodySize rejects a declared Content-Length over max with 413.
func assertBodySize(r *http.Request, max int64, message string) error {
	if r.ContentLength > max {
		return httpx.Status(http.StatusRequestEntityTooLarge, message)
	}
	return nil
}

const bodyTooLarge = "Ukuran permintaan terlalu besar"

// ── psikotes portal ─────────────────────────────────────────────────────────

// testView is a session test row with its decoded jsonb columns.
type testView struct {
	row         *Row
	questionIDs []string
	answers     json.RawMessage // answers.answers, nil when absent
	config      map[string]json.RawMessage
}

func newTestView(row *Row) testView {
	t := testView{row: row, config: map[string]json.RawMessage{}}
	var stored struct {
		QuestionIDs []string        `json:"question_ids"`
		Answers     json.RawMessage `json:"answers"`
	}
	_ = row.JSON("answers", &stored)
	t.questionIDs = stored.QuestionIDs
	if len(stored.Answers) > 0 && string(stored.Answers) != "null" {
		t.answers = stored.Answers
	}
	_ = row.JSON("instrument_config", &t.config)
	return t
}

func (t testView) kind() string   { return t.row.Str("instrument_kind") }
func (t testView) status() string { return t.row.Str("status") }

// configValue returns a config key, nil when absent or JSON null.
func (t testView) configValue(key string) json.RawMessage {
	v := t.config[key]
	if len(v) == 0 || string(v) == "null" {
		return nil
	}
	return v
}

// durationSeconds is config.duration_seconds ?? 600 (NaN when not a number).
func (t testView) durationSeconds() float64 {
	v := t.configValue("duration_seconds")
	if v == nil {
		return 600
	}
	var n float64
	if json.Unmarshal(v, &n) != nil {
		return math.NaN()
	}
	return n
}

// deadline is started_at + the instrument duration (nil before start).
func (t testView) deadline() *time.Time {
	started := t.row.Time("started_at")
	d := t.durationSeconds()
	if started == nil || math.IsNaN(d) {
		return nil
	}
	end := time.UnixMilli(started.UnixMilli() + int64(d*1000))
	return &end
}

const answerGrace = 30 * time.Second

func (t testView) pastAnswerGrace(now time.Time) bool {
	d := t.deadline()
	return d != nil && now.UnixMilli() > d.Add(answerGrace).UnixMilli()
}

// savedAnswers decodes answers.answers into strings (non-strings dropped).
func (t testView) savedAnswers() map[string]string {
	out := map[string]string{}
	var raw map[string]any
	_ = json.Unmarshal(t.answers, &raw)
	for k, v := range raw {
		if s, ok := v.(string); ok {
			out[k] = s
		}
	}
	return out
}

// truthy is JS truthiness of a JSON value.
func truthy(v json.RawMessage) bool {
	switch strings.TrimSpace(string(v)) {
	case "", "null", "false", "0", `""`, "-0":
		return false
	}
	var f float64
	if json.Unmarshal(v, &f) == nil {
		return f != 0
	}
	return true
}

// sanitizedTest is sanitizeTestForCandidate: no stored answers.
func (t testView) sanitized() *Row {
	instructions := t.configValue("instructions")
	if instructions == nil {
		instructions = json.RawMessage(`""`)
	}
	duration := t.configValue("duration_seconds")
	if duration == nil {
		duration = json.RawMessage("600")
	}
	return object(
		"id", t.row.Get("id"),
		"status", t.row.Get("status"),
		"sort_order", t.row.Get("sort_order"),
		"started_at", t.row.Get("started_at"),
		"completed_at", t.row.Get("completed_at"),
		"has_attachment", t.row.Str("attachment_path") != "",
		"instrument", object(
			"code", t.row.Get("instrument_code"),
			"name", t.row.Get("instrument_name"),
			"kind", t.row.Get("instrument_kind"),
			"duration_seconds", duration,
			"instructions", instructions,
		),
	)
}

// PsikotesPortal is the portal summary of a session (never questions).
func (s *Service) PsikotesPortal(ctx context.Context, session *Row) (*Row, error) {
	rows, err := s.repo.SessionTests(ctx, s.db, session.Str("id"))
	if err != nil {
		return nil, err
	}
	tests := make([]*Row, len(rows))
	for i, r := range rows {
		tests[i] = newTestView(r).sanitized()
	}
	return object(
		"session", object(
			"status", session.Get("status"),
			"candidate_name", session.Get("candidate_name"),
			"position_title", session.Get("position_title"),
			"webcam_consent", session.Get("webcam_consent"),
			"expires_at", session.Get("expires_at"),
			"started_at", session.Get("started_at"),
			"completed_at", session.Get("completed_at"),
		),
		"tests", tests,
	), nil
}

// StartPsikotesSession records the camera consent and starts the session.
func (s *Service) StartPsikotesSession(ctx context.Context, session *Row, consent func() (bool, error)) (*Row, error) {
	switch session.Str("status") {
	case "expired":
		return nil, httpx.Status(http.StatusGone, "Link tes sudah kedaluwarsa")
	case "completed":
		return nil, httpx.Conflict("Sesi tes sudah selesai")
	}
	ok, err := consent()
	if err != nil {
		return nil, err
	}
	return s.repo.StartPsikotesSession(ctx, s.db, session.Str("id"), ok)
}

// requireTest is requireSessionTest: 404 "Tes tidak ditemukan".
func (s *Service) requireTest(ctx context.Context, sessionID, testID string) (testView, error) {
	if !domain.IsUUID(testID) {
		return testView{}, httpx.NotFound("Tes tidak ditemukan")
	}
	row, err := s.repo.SessionTest(ctx, s.db, sessionID, testID)
	if err != nil {
		return testView{}, err
	}
	if row == nil {
		return testView{}, httpx.NotFound("Tes tidak ditemukan")
	}
	return newTestView(row), nil
}

// StartTest draws the questions once and returns them without keys.
func (s *Service) StartTest(ctx context.Context, sessionID, testID string) (*Row, error) {
	test, err := s.requireTest(ctx, sessionID, testID)
	if err != nil {
		return nil, err
	}
	if test.status() != "pending" && test.status() != "in_progress" {
		return nil, httpx.Conflict("Tes ini sudah diselesaikan")
	}
	if test.status() == "pending" {
		ids := []string{}
		if test.kind() != "drawing" {
			mcq := test.kind() == "mcq"
			limit := 0
			if qc := test.configValue("question_count"); mcq && truthy(qc) {
				var n float64
				_ = json.Unmarshal(qc, &n)
				limit = int(math.Max(1, n))
			}
			if ids, err = s.repo.DrawQuestionIDs(ctx, s.db, test.row.Str("instrument_id"), mcq && truthy(test.configValue("shuffle")), limit); err != nil {
				return nil, err
			}
			if len(ids) == 0 {
				return nil, httpx.Conflict("Bank soal instrumen ini kosong — hubungi HR")
			}
		}
		// conditional on status: of two racing starts only one draws
		if err := s.repo.BeginTest(ctx, s.db, test.row.Str("id"), ids); err != nil {
			return nil, err
		}
		if test, err = s.requireTest(ctx, sessionID, testID); err != nil {
			return nil, err
		}
	}
	questions := []domain.CandidateQuestion{}
	if test.kind() != "drawing" && len(test.questionIDs) > 0 {
		rows, err := s.repo.QuestionsByID(ctx, s.db, "id, body, options", test.questionIDs)
		if err != nil {
			return nil, err
		}
		byID := map[string]*Row{}
		for _, r := range rows {
			byID[r.Str("id")] = r
		}
		ordered := []domain.QuestionRow{}
		for _, id := range test.questionIDs {
			if r := byID[id]; r != nil {
				var opts any
				_ = r.JSON("options", &opts)
				ordered = append(ordered, domain.QuestionRow{ID: id, Body: r.Str("body"), Options: opts})
			}
		}
		questions = domain.SanitizeQuestions(test.kind(), ordered)
	}
	saved := test.answers
	if saved == nil {
		saved = json.RawMessage("{}")
	}
	var endsAt any
	if d := test.deadline(); d != nil {
		endsAt = httpx.JSTime(*d)
	}
	return object("test", test.sanitized(), "questions", questions, "saved_answers", saved, "ends_at", endsAt), nil
}

func (s *Service) assertTestRunning(test testView) error {
	if test.status() != "in_progress" {
		return httpx.Conflict("Tes tidak sedang berjalan")
	}
	if test.pastAnswerGrace(s.now()) {
		return httpx.Conflict("Waktu tes sudah habis")
	}
	return nil
}

// SaveAnswers autosaves drawn answers; returns how many are stored.
func (s *Service) SaveAnswers(ctx context.Context, test testView, answers func() (map[string]string, error)) (int, error) {
	if err := s.assertTestRunning(test); err != nil {
		return 0, err
	}
	in, err := answers()
	if err != nil {
		return 0, err
	}
	stored, err := s.repo.MergeAnswers(ctx, s.db, test.row.Str("id"), domain.PickDrawnAnswers(test.questionIDs, in))
	if err != nil {
		return 0, err
	}
	if stored == nil {
		return 0, httpx.Conflict("Tes tidak sedang berjalan")
	}
	var parsed struct {
		Answers map[string]json.RawMessage `json:"answers"`
	}
	_ = json.Unmarshal(stored, &parsed)
	return len(parsed.Answers), nil
}

// FinishTest scores a test (drawing tests wait for review). The result is
// the whole response body {data, message}.
func (s *Service) FinishTest(ctx context.Context, test testView, flush map[string]string) (*Row, error) {
	id := test.row.Str("id")
	if domain.IsTerminalTest(test.status()) {
		return object("data", object("status", test.status()), "message", "Tes sudah selesai"), nil
	}
	if test.status() != "in_progress" {
		return nil, httpx.Conflict("Tes belum dimulai")
	}
	if test.kind() == "drawing" {
		// past the deadline finish is accepted without a drawing so the
		// session cannot hang; HR sees there is no attachment
		if test.row.Str("attachment_path") == "" && !test.pastAnswerGrace(s.now()) {
			return nil, httpx.BadRequest("Unggah hasil gambar terlebih dahulu")
		}
		updated, err := s.repo.FinishDrawingTest(ctx, s.db, id)
		if err != nil {
			return nil, err
		}
		var data any = object("status", "perlu_review")
		if updated != nil {
			data = updated
		}
		return object("data", data, "message", "Tes selesai — menunggu review HR"), nil
	}

	final := test.savedAnswers()
	for k, v := range domain.PickDrawnAnswers(test.questionIDs, flush) {
		final[k] = v
	}
	ids := test.questionIDs
	if ids == nil {
		ids = []string{}
	}
	rows, err := s.repo.QuestionsByID(ctx, s.db, "id, options, answer_key", ids)
	if err != nil {
		return nil, err
	}
	var score *int
	var detail any
	if test.kind() == "mcq" {
		qs := make([]domain.McqQuestion, len(rows))
		for i, r := range rows {
			var key any
			_ = r.JSON("answer_key", &key)
			qs[i] = domain.McqQuestion{ID: r.Str("id"), Correct: domain.ToMcqAnswerKey(key)}
		}
		n, d := domain.ScoreMcq(qs, final)
		score, detail = &n, d
	} else {
		qs := make([]domain.PapiQuestion, len(rows))
		for i, r := range rows {
			var opts any
			_ = r.JSON("options", &opts)
			a, b := domain.ToPapiScales(opts)
			qs[i] = domain.PapiQuestion{ID: r.Str("id"), ScaleA: a, ScaleB: b}
		}
		detail = domain.ScorePapi(qs, final)
	}
	// conditional on status: of two racing finishes only one writes a score
	updated, err := s.repo.ScoreTest(ctx, s.db, id, final, score, detail)
	if err != nil {
		return nil, err
	}
	var data any = object("id", id, "status", "selesai")
	if updated != nil {
		data = updated
	}
	return object("data", data, "message", "Tes selesai"), nil
}

// FinishPsikotesSession closes the session once every test is terminal;
// only the request that wins the transition logs the activity.
func (s *Service) FinishPsikotesSession(ctx context.Context, session *Row) (*Row, error) {
	done := object("data", object("status", "completed"), "message", "Sesi sudah selesai")
	switch session.Str("status") {
	case "completed":
		return done, nil
	case "in_progress":
	default:
		return nil, httpx.Conflict("Sesi tidak sedang berjalan")
	}
	id := session.Str("id")
	remaining, err := s.repo.UnfinishedTestNames(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if len(remaining) > 0 {
		return nil, httpx.BadRequest("Masih ada tes yang belum selesai: " + strings.Join(remaining, ", "))
	}
	var updated *Row
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		if updated, err = s.repo.CompletePsikotesSession(ctx, tx, id); err != nil || updated == nil {
			return err
		}
		return s.repo.LogSystemActivity(ctx, tx, session.Str("candidate_id"), "psikotes_completed",
			"Kandidat menyelesaikan seluruh rangkaian psikotes online")
	})
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return done, nil
	}
	return object("data", updated, "message", "Seluruh tes selesai — terima kasih"), nil
}

// ── live chat, frames and signaling (both portals and HR) ───────────────────

const maxChatChars = 1000

// Chat lists a session's chat messages.
func (s *Service) Chat(ctx context.Context, sessionType, sessionID, after string) ([]*Row, error) {
	return s.repo.ChatMessages(ctx, s.db, sessionType, sessionID, after)
}

// PostChat stores a message trimmed to 1000 characters; empty is 400.
func (s *Service) PostChat(ctx context.Context, sessionType, sessionID, sender string, senderName *string, message string) (*Row, error) {
	message = domain.JSSlice(domain.JSTrim(message), maxChatChars)
	if message == "" {
		return nil, httpx.BadRequest("Pesan kosong")
	}
	return s.repo.InsertChat(ctx, s.db, sessionType, sessionID, sender, senderName, message)
}

// SaveFrame stores the latest frame without its data URL prefix.
func (s *Service) SaveFrame(ctx context.Context, sessionType, sessionID, frame string) error {
	return s.repo.SaveFrame(ctx, s.db, sessionType, sessionID, frame[strings.Index(frame, ",")+1:])
}

// PendingOffers lists the HR WebRTC offers waiting for the candidate.
func (s *Service) PendingOffers(session *Row, sessionType string) []domain.PendingOffer {
	if session.Str("status") != "in_progress" {
		return []domain.PendingOffer{}
	}
	return s.signals.PendingOffers(sessionType, session.Str("id"), s.now())
}

// AnswerOffer stores the candidate's SDP answer.
func (s *Service) AnswerOffer(sessionType, sessionID, offerID, sdp string) bool {
	return s.signals.PutAnswer(sessionType, sessionID, offerID, sdp, s.now())
}

// ── offer portal ────────────────────────────────────────────────────────────

// OfferForCandidate is offerForCandidate: HR's internal notes stay out.
func OfferForCandidate(o *Row) *Row {
	return object(
		"status", o.Get("status"),
		"version", o.Get("version"),
		"candidate_name", o.Get("candidate_name"),
		"brand_name", o.Get("brand_name"),
		"position_title", o.Get("position_title"),
		"base_salary", numberOrNil(o.Get("base_salary")),
		"benefits", o.Get("benefits"),
		"start_date", o.Get("start_date"),
		"response_note", o.Get("response_note"),
		"responded_at", o.Get("responded_at"),
		"sent_at", o.Get("sent_at"),
		"expires_at", o.Get("expires_at"),
	)
}

const offerClosed = "Penawaran ini sudah tidak bisa direspons"

// RespondOffer records accept / negotiate / decline with time and IP;
// accept and decline are final.
func (s *Service) RespondOffer(ctx context.Context, offer *Row, ip *string, input func() (offerResponseInput, error)) (*Row, error) {
	if !domain.IsOfferOpen(offer.Str("status")) {
		return nil, httpx.Conflict(offerClosed)
	}
	in, err := input()
	if err != nil {
		return nil, err
	}
	var note *string
	if in.Note != nil && *in.Note != "" {
		note = in.Note
	}
	if in.Action == "negotiate" && note == nil {
		return nil, httpx.BadRequest("Tuliskan catatan negosiasi Anda (mis. angka yang diharapkan)")
	}
	var updated *Row
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		updated, err = s.repo.RespondOffer(ctx, tx, offer.Str("id"), domain.OfferStatusForAction[in.Action], note, ip)
		if err != nil || updated == nil {
			return err
		}
		return s.repo.LogAnonymousActivity(ctx, tx, offer.Str("candidate_id"), "offer_response",
			domain.OfferResponseDescription(in.Action, offer.Int("version"), note))
	})
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, httpx.Conflict(offerClosed)
	}
	return updated, nil
}

// RecordManualResponse stores a response HR took by phone or WhatsApp.
// found is false when the offer does not exist.
func (s *Service) RecordManualResponse(ctx context.Context, id string, in manualResponseInput, actor Actor) (updated *Row, found bool, err error) {
	offer, err := s.repo.GetOfferRef(ctx, s.db, id)
	if err != nil || offer == nil {
		return nil, false, err
	}
	if offer.Status == "accepted" || offer.Status == "declined" {
		return nil, true, httpx.Conflict("Offer ini sudah direspons final oleh kandidat")
	}
	note := ""
	if in.Note != nil {
		note = *in.Note
	}
	var notePtr *string
	if note != "" {
		notePtr = &note
	}
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		if updated, err = s.repo.RecordManualResponse(ctx, tx, id, in.Status, notePtr); err != nil {
			return err
		}
		_, err = s.repo.LogActivity(ctx, tx, offer.CandidateID, "offer_response",
			domain.ManualOfferResponseDescription(in.Status, offer.Version, note), actor)
		return err
	})
	return updated, true, err
}
