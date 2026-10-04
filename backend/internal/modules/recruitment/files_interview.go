package recruitment

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/recruitment/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/jsmath"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/validate"
)

// The candidate's interview AI portal (interview-runner.ts, interview-ai.ts):
// start, answer by voice or text, then the next question or the closing
// summary; recordings and TTS audio live in storage/private/interview/<id>.

const (
	maxAudioBytes      = 15 * 1024 * 1024
	maxAnswerChars     = 4000
	maxChunkBytes      = 8 * 1024 * 1024
	maxPartBytes       = 400 * 1024 * 1024 // ~2 hours at ~500 kbps
	invalidPayload     = "Payload tidak valid"
	interviewNotActive = "Sesi tidak sedang berjalan"
	maxQuestionsDef    = 8
	maxQuestionsLimit  = 15
)

var partPattern = regexp.MustCompile(`^[0-9]{10,16}$`)

const turnColumns = `id, session_id, turn_no, topic, question, question_audio_path,
  answer_audio_path, answer_transcript, answer_mode, asked_at, answered_at`

func (f *fileHandler) turns(ctx context.Context, sessionID string) ([]*Row, error) {
	return collect(f.db().Query(ctx, `SELECT `+turnColumns+` FROM recruitment.interview_ai_turns
     WHERE session_id = $1 ORDER BY turn_no`, sessionID))
}

func (f *fileHandler) activeTurn(ctx context.Context, sessionID string) (*Row, error) {
	return collectOne(f.db().Query(ctx, `SELECT `+turnColumns+` FROM recruitment.interview_ai_turns
     WHERE session_id = $1 AND answered_at IS NULL
     ORDER BY turn_no LIMIT 1`, sessionID))
}

// sessionMaxQuestions is config.max_questions clamped to 3..15 (8 when
// missing or invalid).
func sessionMaxQuestions(session *Row) int {
	var cfg map[string]any
	_ = session.JSON("config", &cfg)
	n := float64(maxQuestionsDef)
	if v, ok := cfg["max_questions"]; ok && v != nil {
		n = jsNumber(v)
	}
	if math.IsNaN(n) || math.IsInf(n, 0) || n < 3 {
		return maxQuestionsDef
	}
	return int(math.Min(maxQuestionsLimit, jsmath.Round(n)))
}

// sanitizedTurn is sanitizeTurnForCandidate: no storage paths.
func sanitizedTurn(t *Row) *Row {
	return object("id", t.Get("id"), "turn_no", t.Get("turn_no"), "question", t.Get("question"),
		"answer_transcript", t.Get("answer_transcript"), "answered_at", t.Get("answered_at"), "asked_at", t.Get("asked_at"))
}

func turnWithAudio(t *Row, audio []byte) *Row {
	out := sanitizedTurn(t)
	var b64 any
	if audio != nil {
		b64 = base64.StdEncoding.EncodeToString(audio)
	}
	out.Set("question_audio_base64", b64)
	return out
}

// GET /api/interview/session/{token}: never the AI summary; the active
// question's TTS audio comes along so it replays after a reload.
func (f *fileHandler) interviewSession(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	session, err := f.svc.requirePortal(ctx, interviewPortal, r.PathValue("token"), "get")
	if err != nil {
		return err
	}
	turns, err := f.turns(ctx, session.Str("id"))
	if err != nil {
		return err
	}
	sanitized := make([]*Row, len(turns))
	var current *Row
	for i, t := range turns {
		sanitized[i] = sanitizedTurn(t)
		if current == nil && t.Get("answered_at") == nil {
			current = t
		}
	}
	var currentTurn any
	if current != nil {
		var audio []byte
		if p := current.Str("question_audio_path"); p != "" {
			audio, _, _ = f.store.ReadPrivate(p)
		}
		currentTurn = turnWithAudio(current, audio)
	}
	return reply(w, http.StatusOK, "data", object(
		"session", object(
			"status", session.Get("status"),
			"candidate_name", session.Get("candidate_name"),
			"position_title", session.Get("position_title"),
			"webcam_consent", session.Get("webcam_consent"),
			"max_questions", sessionMaxQuestions(session),
			"expires_at", session.Get("expires_at"),
			"started_at", session.Get("started_at"),
			"completed_at", session.Get("completed_at"),
		),
		"turns", sanitized,
		"current_turn", currentTurn,
	))
}

// speak is speakQuestion: TTS is best effort, the interview goes on as
// text when it fails.
func (f *fileHandler) speak(ctx context.Context, sessionID, question string) (audio []byte, path *string) {
	audio = f.svc.ports.Speech.Synthesize(ctx, f.db(), question)
	if audio == nil {
		return nil, nil
	}
	saved, err := f.store.SavePrivateAudio(audio, "interview/"+sessionID+"/questions")
	if err != nil {
		f.svc.log.Error("[interview] TTS audio not saved", "error", err)
		return audio, nil
	}
	return audio, &saved
}

// POST /api/interview/session/{token}/start: camera consent required.
// Idempotent: a running session returns its active question.
func (f *fileHandler) startInterview(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	session, err := f.svc.requirePortal(ctx, interviewPortal, r.PathValue("token"), "start")
	if err != nil {
		return err
	}
	id := session.Str("id")
	switch session.Str("status") {
	case "completed", "expired":
		return httpx.Conflict("Sesi interview sudah berakhir")
	case "in_progress":
		turn, err := f.activeTurn(ctx, id)
		if err != nil {
			return err
		}
		var data any
		if turn != nil {
			data = sanitizedTurn(turn)
		}
		return reply(w, http.StatusOK, "data", object("turn", data))
	}

	in := form(r)
	if in.Valid() {
		if consent, _ := in.Fields()["webcam_consent"].(bool); !consent {
			in.Fail("webcam_consent", "invalid_value", "Interview mewajibkan kamera aktif — izinkan kamera untuk memulai")
		}
	}
	if err := firstIssue(in); err != nil {
		return err
	}
	first := f.nextQuestion(ctx, session, nil)
	if first.question == "" {
		return httpx.Status(http.StatusInternalServerError, "Gagal menyiapkan pertanyaan pertama")
	}
	audio, path := f.speak(ctx, id, first.question)
	var turn *Row
	err = database.WithTx(ctx, f.db(), func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE recruitment.interview_ai_sessions
       SET status = 'in_progress', webcam_consent = true, started_at = now()
       WHERE id = $1 AND status = 'sent'`, id); err != nil {
			return err
		}
		var err error
		turn, err = collectOne(tx.Query(ctx, `INSERT INTO recruitment.interview_ai_turns
         (session_id, turn_no, topic, question, question_audio_path)
       VALUES ($1, 1, $2, $3, $4)
       ON CONFLICT (session_id, turn_no) DO UPDATE SET turn_no = EXCLUDED.turn_no
       RETURNING `+turnColumns, id, first.topic, first.question, path))
		return err
	})
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", object("turn", turnWithAudio(turn, audio)))
}

// POST /api/interview/session/{token}/answer: multipart turn_id, mode
// voice|text, audio | answer_text.
func (f *fileHandler) answerInterview(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	session, err := f.svc.requirePortal(ctx, interviewPortal, r.PathValue("token"), "answer")
	if err != nil {
		return err
	}
	if err := assertInProgress(session, interviewNotActive); err != nil {
		return err
	}
	limit := int64(maxAudioBytes + 64*1024)
	if err := assertBodySize(r, limit, bodyTooLarge); err != nil {
		return err
	}
	in, err := readForm(r, limit, invalidPayload, bodyTooLarge)
	if err != nil {
		return err
	}
	id := session.Str("id")
	turnID, mode := in.Value("turn_id"), in.Value("mode")
	if !domain.IsUUID(turnID) || (mode != "voice" && mode != "text") {
		return httpx.BadRequest(invalidPayload)
	}
	turn, err := collectOne(f.db().Query(ctx, `SELECT `+turnColumns+` FROM recruitment.interview_ai_turns
     WHERE id = $1 AND session_id = $2`, turnID, id))
	if err != nil {
		return err
	}
	if turn == nil {
		return httpx.NotFound("Pertanyaan tidak ditemukan")
	}
	if turn.Get("answered_at") != nil {
		return httpx.Conflict("Pertanyaan ini sudah dijawab")
	}

	var transcript string
	var audioPath, model *string
	if mode == "voice" {
		if transcript, audioPath, err = f.voiceAnswer(ctx, id, in.File("audio")); err != nil {
			return err
		}
		m := whisperModel
		model = &m
	} else {
		transcript = domain.JSSlice(validate.JSTrim(in.Value("answer_text")), maxAnswerChars)
		if transcript == "" {
			return httpx.BadRequest("Jawaban kosong")
		}
	}
	var stored *string
	if transcript != "" {
		stored = &transcript
	}
	updated, err := collectOne(f.db().Query(ctx, `UPDATE recruitment.interview_ai_turns
     SET answer_transcript = $3, answer_audio_path = $4, answer_mode = $5,
         transcribe_model = $6, answered_at = now()
     WHERE id = $1 AND session_id = $2 AND answered_at IS NULL
     RETURNING `+turnColumns, turnID, id, stored, audioPath, mode, model))
	if err != nil {
		return err
	}
	if updated == nil {
		return httpx.Conflict("Pertanyaan ini sudah dijawab")
	}

	all, err := f.turns(ctx, id)
	if err != nil {
		return err
	}
	next := f.nextQuestion(ctx, session, all)
	if next.question == "" {
		if err := f.closeInterview(ctx, session, all); err != nil {
			return err
		}
		return reply(w, http.StatusOK, "data", object("done", true))
	}
	audio, path := f.speak(ctx, id, next.question)
	nextTurn, err := collectOne(f.db().Query(ctx, `INSERT INTO recruitment.interview_ai_turns
       (session_id, turn_no, topic, question, question_audio_path)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (session_id, turn_no) DO NOTHING
     RETURNING `+turnColumns, id, updated.Int("turn_no")+1, next.topic, next.question, path))
	if err != nil {
		return err
	}
	if nextTurn != nil {
		return reply(w, http.StatusOK, "data", object("done", false, "turn", turnWithAudio(nextTurn, audio)))
	}
	// a parallel request inserted it first: return the active turn
	existing, err := f.activeTurn(ctx, id)
	if err != nil {
		return err
	}
	var data any
	if existing != nil {
		data = turnWithAudio(existing, nil)
	}
	return reply(w, http.StatusOK, "data", object("done", false, "turn", data))
}

// voiceAnswer transcribes first: when Whisper fails nothing is stored and
// the candidate can resend.
func (f *fileHandler) voiceAnswer(ctx context.Context, sessionID string, audio *storage.File) (string, *string, error) {
	if audio == nil || audio.Size() == 0 {
		return "", nil, httpx.BadRequest("Rekaman suara kosong")
	}
	if audio.Size() > maxAudioBytes {
		return "", nil, httpx.Status(http.StatusRequestEntityTooLarge, "Rekaman terlalu besar (maks 15 MB)")
	}
	mime := storage.SniffAudio(audio.Data)
	if mime == "" {
		return "", nil, httpx.BadRequest("Format audio tidak dikenali")
	}
	transcript, err := f.ai.transcribe(ctx, f.db(), audio.Data, mime)
	if err != nil {
		f.svc.log.Error("[interview-answer] transcribe failed", "error", err)
		return "", nil, httpx.Status(http.StatusBadGateway, "Gagal mentranskrip suara — coba kirim ulang, atau ketik jawaban Anda")
	}
	path, err := f.store.SavePrivateAudio(audio.Data, "interview/"+sessionID+"/answers")
	if err != nil {
		return "", nil, err
	}
	return transcript, &path, nil
}

// closeInterview completes the session with a best-effort AI summary: a
// failing AI must not leave the session hanging.
func (f *fileHandler) closeInterview(ctx context.Context, session *Row, turns []*Row) error {
	summary, model, err := f.summarize(ctx, session, turns)
	if err != nil {
		f.svc.log.Error("[interview-answer] summarize failed", "error", err)
	}
	var summaryJSON, summaryModel *string
	suffix := ""
	if summary != nil {
		b, err := json.Marshal(summary)
		if err != nil {
			return err
		}
		s := string(b)
		summaryJSON, summaryModel, suffix = &s, &model, " — kesimpulan AI tersedia"
	}
	return database.WithTx(ctx, f.db(), func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE recruitment.interview_ai_sessions
       SET status = 'completed', completed_at = now(),
           ai_summary = $2, summary_model = $3,
           summarized_at = CASE WHEN $2::jsonb IS NULL THEN NULL ELSE now() END
       WHERE id = $1`, session.Str("id"), summaryJSON, summaryModel); err != nil {
			return err
		}
		return f.svc.repo.LogAnonymousActivity(ctx, tx, session.Str("candidate_id"), "interview_ai_completed",
			"Interview AI selesai ("+strconv.Itoa(len(turns))+" pertanyaan)"+suffix)
	})
}

// ── interviewer AI (interview-ai.ts) ────────────────────────────────────────

var interviewTopics = []string{"pembuka", "keahlian", "motivasi", "ketersediaan", "gaji"}

// fallbackQuestions are asked when DeepSeek fails, in topic order.
var fallbackQuestions = map[string]string{
	"pembuka":      "Perkenalkan diri Anda secara singkat, lalu ceritakan pengalaman kerja atau kegiatan yang paling relevan dengan posisi ini.",
	"keahlian":     "Keahlian apa yang paling Anda kuasai dan bagaimana Anda biasa menggunakannya dalam pekerjaan sehari-hari?",
	"motivasi":     "Apa yang membuat Anda tertarik melamar posisi ini?",
	"ketersediaan": "Kapan Anda bisa mulai bekerja, dan apakah ada kendala lokasi atau jam kerja yang perlu kami ketahui?",
	"gaji":         "Berapa ekspektasi gaji Anda untuk posisi ini?",
}

const questionPrompt = `Kamu adalah AI interviewer HR yang ramah dan profesional, berbahasa Indonesia.
Tugasmu menanyakan hal-hal BASIC screening ke kandidat, satu pertanyaan per giliran, mencakup topik wajib berikut secara berurutan (boleh follow-up singkat bila jawaban menarik/kurang jelas):
1. pembuka — perkenalan & pengalaman relevan
2. keahlian — keahlian teknis utama & contoh penggunaannya
3. motivasi — alasan melamar & pemahaman posisi
4. ketersediaan — kapan bisa mulai, kendala lokasi/jam kerja
5. gaji — ekspektasi gaji

Balas HANYA dengan JSON valid (tanpa markdown) berbentuk:
{"action": "ask"|"finish", "topic": string|null, "question": string|null}

Ketentuan:
- "topic" salah satu dari: pembuka, keahlian, motivasi, ketersediaan, gaji.
- Pertanyaan singkat (1-2 kalimat), sopan, mudah dipahami, TANPA menyebut skor/penilaian.
- Maksimal satu follow-up per topik; setelah semua topik tertanya (terutama gaji sudah ditanya), balas {"action":"finish","topic":null,"question":null}.
- Jangan menanyakan SARA, status pernikahan, agama, atau hal di luar konteks pekerjaan.
- Jangan mengulang pertanyaan yang sudah ditanyakan.`

const summaryPrompt = `Kamu adalah asisten HR yang menyimpulkan hasil interview screening basic secara INDIKATIF.
Balas HANYA dengan JSON valid (tanpa markdown) berbentuk:
{
  "ringkasan": string,
  "relevansi": {"skor": number, "kesimpulan": "relevan"|"cukup_relevan"|"kurang_relevan", "alasan": string},
  "keahlian": [string],
  "ekspektasi_gaji": {"disebutkan": boolean, "nilai": string|null, "catatan": string},
  "red_flags": [string],
  "perhatikan_saat_interview_lanjutan": [string],
  "keterbatasan": string
}
Ketentuan:
- Dasarkan HANYA pada transkrip — jangan mengarang informasi yang tidak disebutkan kandidat.
- "ringkasan": 2-4 kalimat bahasa Indonesia, nada netral-profesional.
- "relevansi.skor": 0-100 kecocokan jawaban kandidat dengan posisi (pakai kata "cenderung/mengindikasikan" di alasan, hindari klaim pasti).
- "keahlian": daftar keahlian yang DISEBUT kandidat (maks 8).
- "ekspektasi_gaji.nilai": angka/rentang persis seperti disebut kandidat, null bila tidak disebut.
- "red_flags": hal yang perlu diwaspadai (jawaban kosong/berputar, ketidaksesuaian, dsb) — boleh kosong.
- "perhatikan_saat_interview_lanjutan": 2-5 hal konkret utk digali interviewer manusia.
- "keterbatasan": 1-2 kalimat menegaskan ini kesimpulan indikatif dari interview basic oleh AI, bukan keputusan final — keputusan tetap di tangan HRD.`

// nextQ is a question to ask; an empty question finishes the interview.
type nextQ struct {
	question string
	topic    *string
}

func ask(topic, question string) nextQ { return nextQ{question: question, topic: &topic} }

// transcriptContext renders the turns for the prompts (12000 characters).
func transcriptContext(turns []*Row) string {
	if len(turns) == 0 {
		return "(belum ada tanya-jawab)"
	}
	blocks := make([]string, len(turns))
	for i, t := range turns {
		head := "#" + strconv.Itoa(t.Int("turn_no"))
		if topic := t.Str("topic"); topic != "" {
			head += " [" + topic + "]"
		}
		answer := validate.JSTrim(t.Str("answer_transcript"))
		if answer == "" {
			answer = "(tidak menjawab)"
		}
		blocks[i] = head + "\nAI: " + t.Str("question") + "\nKandidat: " + answer
	}
	return domain.JSSlice(strings.Join(blocks, "\n\n"), 12_000)
}

// nextQuestion is generateNextInterviewQuestion: the first question is
// static, gaji is forced into the last slot, and a failing DeepSeek falls
// back to the first topic not asked yet so the interview never stalls.
func (f *fileHandler) nextQuestion(ctx context.Context, session *Row, turns []*Row) nextQ {
	maxQ := sessionMaxQuestions(session)
	asked := len(turns)
	if asked >= maxQ {
		return nextQ{}
	}
	name, position := session.Str("candidate_name"), session.Str("position_title")
	if asked == 0 {
		at := ""
		if position != "" {
			at = " posisi " + position
		}
		return ask("pembuka", "Halo "+name+"! Terima kasih sudah meluangkan waktu untuk interview"+at+". "+fallbackQuestions["pembuka"])
	}
	var topics []string
	for _, t := range turns {
		if topic := t.Str("topic"); topic != "" && !slices.Contains(topics, topic) {
			topics = append(topics, topic)
		}
	}
	gajiAsked := slices.Contains(topics, "gaji")
	if !gajiAsked && asked >= maxQ-1 {
		return ask("gaji", fallbackQuestions["gaji"])
	}

	lines := []string{"KANDIDAT: " + name}
	if position != "" {
		lines = append(lines, "POSISI YANG DILAMAR: "+position)
	}
	askedList := strings.Join(topics, ", ")
	if askedList == "" {
		askedList = "(belum ada)"
	}
	lines = append(lines,
		"PERTANYAAN TERPAKAI: "+strconv.Itoa(asked)+"/"+strconv.Itoa(maxQ)+" (sisakan slot utk topik yang belum tertanya)",
		"TOPIK SUDAH DITANYA: "+askedList,
		"\nPERCAKAPAN SEJAUH INI:\n"+transcriptContext(turns),
		"\nTentukan langkah berikutnya.")
	parsed, _, err := f.ai.deepseekJSON(ctx, f.db(), questionPrompt, strings.Join(lines, "\n"))
	if err == nil {
		action := field(parsed, "action")
		question, isStr := field(parsed, "question").(string)
		switch {
		case action == "finish" && !gajiAsked:
			return ask("gaji", fallbackQuestions["gaji"])
		case action == "finish":
			return nextQ{}
		case action == "ask" && isStr && validate.JSTrim(question) != "":
			q := nextQ{question: domain.JSSlice(validate.JSTrim(question), 600)}
			if topic, ok := field(parsed, "topic").(string); ok && slices.Contains(interviewTopics, topic) {
				q.topic = &topic
			}
			return q
		}
	}
	for _, topic := range interviewTopics {
		if !slices.Contains(topics, topic) {
			return ask(topic, fallbackQuestions[topic])
		}
	}
	return nextQ{}
}

// summarize is summarizeInterview with its normalization of the answer.
func (f *fileHandler) summarize(ctx context.Context, session *Row, turns []*Row) (*Row, string, error) {
	position := "POSISI: (tidak diisi)"
	if p := session.Str("position_title"); p != "" {
		position = "POSISI YANG DILAMAR: " + p
	}
	prompt := "KANDIDAT: " + session.Str("candidate_name") + "\n" + position + "\n\nTRANSKRIP INTERVIEW:\n" + transcriptContext(turns)
	raw, model, err := f.ai.deepseekJSON(ctx, f.db(), summaryPrompt, prompt)
	if err != nil {
		return nil, "", err
	}
	if raw == nil {
		return nil, "", errors.New("DeepSeek mengembalikan null")
	}
	rel, gaji := field(raw, "relevansi"), field(raw, "ekspektasi_gaji")
	kesimpulan, _ := field(rel, "kesimpulan").(string)
	if kesimpulan != "relevan" && kesimpulan != "cukup_relevan" && kesimpulan != "kurang_relevan" {
		kesimpulan = "cukup_relevan"
	}
	skor := field(rel, "skor")
	if skor == nil {
		skor = 0.0
	}
	var nilai any
	if v := field(gaji, "nilai"); jsTruthy(v) {
		nilai = domain.JSSlice(jsString(v), 120)
	}
	return object(
		"ringkasan", domain.JSSlice(strOr(field(raw, "ringkasan"), ""), 2000),
		"relevansi", object(
			"skor", clampScore(jsNumber(skor)),
			"kesimpulan", kesimpulan,
			"alasan", domain.JSSlice(strOr(field(rel, "alasan"), ""), 2000),
		),
		"keahlian", stringList(field(raw, "keahlian"), 8, 120),
		"ekspektasi_gaji", object(
			"disebutkan", jsTruthy(field(gaji, "disebutkan")),
			"nilai", nilai,
			"catatan", domain.JSSlice(strOr(field(gaji, "catatan"), ""), 500),
		),
		"red_flags", stringList(field(raw, "red_flags"), 6, 300),
		"perhatikan_saat_interview_lanjutan", stringList(field(raw, "perhatikan_saat_interview_lanjutan"), 5, 300),
		"keterbatasan", domain.JSSlice(strOr(field(raw, "keterbatasan"),
			"Kesimpulan indikatif dari interview basic oleh AI — keputusan tetap di tangan HRD."), 500),
	), model, nil
}

// stringList is (Array.isArray(v) ? v : []).slice(0, n).map(s => String(s).slice(0, chars)).
func stringList(v any, n, chars int) []string {
	items := arrayOf(v)
	out := make([]string, 0, min(n, len(items)))
	for _, it := range items[:min(n, len(items))] {
		out = append(out, domain.JSSlice(jsString(it), chars))
	}
	return out
}

// ── recordings ──────────────────────────────────────────────────────────────

// POST /api/interview/session/{token}/recording-chunk: webm chunks
// (10 s timeslice) appended to one part file per recording; a reload
// starts a new part so every file keeps a valid webm header.
func (f *fileHandler) recordingChunk(w http.ResponseWriter, r *http.Request) error {
	limit := int64(maxChunkBytes + 64*1024)
	if err := assertBodySize(r, limit, "Chunk terlalu besar"); err != nil {
		return err
	}
	session, err := f.svc.requirePortal(r.Context(), interviewPortal, r.PathValue("token"), "recording")
	if err != nil {
		return err
	}
	if err := assertInProgress(session, interviewNotActive); err != nil {
		return err
	}
	in, err := readForm(r, limit, invalidPayload, "Chunk terlalu besar")
	if err != nil {
		return err
	}
	part, chunk := in.Value("part"), in.File("chunk")
	if !partPattern.MatchString(part) || chunk == nil || chunk.Size() == 0 {
		return httpx.BadRequest(invalidPayload)
	}
	if chunk.Size() > maxChunkBytes {
		return httpx.Status(http.StatusRequestEntityTooLarge, "Chunk terlalu besar")
	}
	rel := "interview/" + session.Str("id") + "/recording/part-" + part + ".webm"
	unlock := f.chunks.lock(rel)
	size, err := f.store.AppendPrivateChunk(rel, chunk.Data, maxPartBytes)
	unlock()
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "Kuota") {
			status = http.StatusTooManyRequests
		}
		return httpx.Status(status, err.Error())
	}
	return reply(w, http.StatusOK, "data", object("ok", true, "size", size))
}

// GET /api/interview/sessions/{id}/recordings: one session's video parts,
// played through /api/interview/files.
func (f *fileHandler) recordings(w http.ResponseWriter, r *http.Request, _ Actor) error {
	id, err := pathUUID(r, "ID sesi tidak valid")
	if err != nil {
		return err
	}
	exists, err := queryStrings(r.Context(), f.db(), "SELECT id::text FROM recruitment.interview_ai_sessions WHERE id = $1", id)
	if err != nil {
		return err
	}
	if len(exists) == 0 {
		return httpx.NotFound("Sesi tidak ditemukan")
	}
	dir := "interview/" + id + "/recording"
	out := []*Row{}
	for _, e := range f.store.ListPrivate(dir) {
		out = append(out, object("path", dir+"/"+e.Name, "size", e.Size, "modified_at", httpx.JSTime(e.ModifiedAt)))
	}
	return reply(w, http.StatusOK, "data", out)
}
