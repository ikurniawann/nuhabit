package recruitment

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/recruitment/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/validate"
)

// Proctoring evidence of both portals (proctor-events.ts), the psikotes
// drawing upload (psikotes-runner.ts) and HR's AI insight on a drawing
// (psikotes-admin.ts, psikotes-ai.ts). Files go to storage/private, which
// HR reads through /api/<type>/files.

const (
	maxSnapshotsPerSession = 300
	maxDrawingBytes        = 8 * 1024 * 1024
)

var (
	psikotesProctorEvents  = []string{"tab_blur", "fullscreen_exit", "paste", "disconnect", "webcam_snapshot"}
	interviewProctorEvents = []string{"tab_blur", "fullscreen_exit", "paste", "disconnect", "webcam_snapshot",
		"face_not_detected", "multiple_faces", "camera_off"}
	snapshotPattern = regexp.MustCompile(`^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$`)
)

type proctorInput struct {
	eventType string
	meta      map[string]any // nil when absent
	snapshot  string
}

// parseProctorEvent is (interview)ProctorEventSchema: the event enum, a
// record of at most 20 short scalar values, and a snapshot data URL only
// for webcam_snapshot.
func parseProctorEvent(f *validate.Form, events []string) proctorInput {
	in := proctorInput{}
	if e := f.Enum("event_type", validate.Rule{}, events); e != nil {
		in.eventType = *e
	}
	if v, sent, done := f.Take("meta", "record", optional); !done && sent {
		meta, ok := v.(map[string]any)
		if !ok {
			f.Fail("meta", "invalid_type", "Invalid input: expected record, received "+jsTypeName(v))
		} else {
			mf := f.Child("meta")
			for k, val := range meta {
				if validate.UTF16Len(k) > 50 {
					mf.Fail(k, "invalid_key", "Invalid key in record")
					continue
				}
				switch x := val.(type) {
				case string:
					if validate.UTF16Len(x) > 200 {
						mf.Fail(k, "too_big", "Too big: expected string to have <=200 characters")
					}
				case json.Number, float64, bool:
				default:
					mf.Fail(k, "invalid_union", "Invalid input")
				}
			}
			if len(meta) > 20 {
				f.Fail("meta", "custom", "Meta terlalu besar")
			}
			in.meta = meta
		}
	}
	if s := f.Str("snapshot", optional, validate.StrOpts{Max: 700_000}); s != nil {
		in.snapshot = *s
		if !snapshotPattern.MatchString(*s) {
			f.Fail("snapshot", "invalid_format", "Format snapshot tidak valid")
		}
	}
	msgs{"snapshot:too_big": "Snapshot terlalu besar"}.apply(f)
	if f.Valid() && in.eventType != "webcam_snapshot" && in.snapshot != "" {
		f.Fail("snapshot", "custom", "Snapshot hanya untuk event webcam_snapshot")
	}
	return in
}

// decodeSnapshot is Buffer.from(base64, "base64"): lenient about padding.
func decodeSnapshot(dataURL string) (mime string, data []byte) {
	head, b64, _ := strings.Cut(dataURL, ",")
	mime = strings.TrimPrefix(head[:strings.Index(head, ";")], "data:")
	if i := strings.IndexByte(b64, '='); i >= 0 {
		b64 = b64[:i]
	}
	if len(b64)%4 == 1 {
		b64 = b64[:len(b64)-1]
	}
	data, _ = base64.RawStdEncoding.DecodeString(b64)
	return mime, data
}

// recordProctorEvent stores the snapshot first for webcam_snapshot, then
// the event row.
func (f *fileHandler) recordProctorEvent(ctx context.Context, sessionType, sessionID string, in proctorInput) (*Row, error) {
	table := proctorEventTable[sessionType]
	var storagePath *string
	if in.eventType == "webcam_snapshot" {
		if in.snapshot == "" {
			return nil, httpx.BadRequest("Snapshot kosong")
		}
		var n int
		if err := f.db().QueryRow(ctx, `SELECT count(*)::int FROM `+table+`
       WHERE session_id = $1 AND event_type = 'webcam_snapshot'`, sessionID).Scan(&n); err != nil {
			return nil, err
		}
		if n >= maxSnapshotsPerSession {
			return nil, httpx.TooManyRequests("Kuota snapshot sesi tercapai")
		}
		mime, data := decodeSnapshot(in.snapshot)
		if storage.SniffImage(data) == "" {
			return nil, httpx.BadRequest("Isi snapshot bukan gambar valid")
		}
		path, err := f.store.SavePrivateImage(data, mime, sessionType+"/"+sessionID+"/proctor")
		if err != nil {
			return nil, httpx.Status(http.StatusInternalServerError, err.Error())
		}
		storagePath = &path
	}
	var meta *string
	if in.meta != nil {
		b, err := json.Marshal(in.meta)
		if err != nil {
			return nil, err
		}
		s := string(b)
		meta = &s
	}
	return collectOne(f.db().Query(ctx, `INSERT INTO `+table+` (session_id, event_type, meta, storage_path)
     VALUES ($1, $2, $3, $4)
     RETURNING id, event_type, created_at`, sessionID, in.eventType, meta, storagePath))
}

// proctorSession loads a running portal session for a proctoring event.
func (f *fileHandler) proctorSession(r *http.Request, kind portalKind) (*Row, error) {
	if err := assertBodySize(r, 1024*1024, bodyTooLarge); err != nil {
		return nil, err
	}
	session, err := f.svc.requirePortal(r.Context(), kind, r.PathValue("token"), "proctor")
	if err != nil {
		return nil, err
	}
	return session, assertInProgress(session, interviewNotActive)
}

func (f *fileHandler) interviewProctorEvent(w http.ResponseWriter, r *http.Request) error {
	session, err := f.proctorSession(r, interviewPortal)
	if err != nil {
		return err
	}
	v := form(r)
	in := parseProctorEvent(v, interviewProctorEvents)
	if err := pathIssue(v); err != nil {
		return err
	}
	if _, err := f.recordProctorEvent(r.Context(), "interview", session.Str("id"), in); err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", object("ok", true))
}

// The psikotes portal accepts a snapshot only with camera consent.
func (f *fileHandler) psikotesProctorEvent(w http.ResponseWriter, r *http.Request) error {
	session, err := f.proctorSession(r, psikotesPortal)
	if err != nil {
		return err
	}
	v := form(r)
	in := parseProctorEvent(v, psikotesProctorEvents)
	if err := pathIssue(v); err != nil {
		return err
	}
	if in.eventType == "webcam_snapshot" && !session.Bool("webcam_consent") {
		return httpx.BadRequest("Consent kamera tidak diberikan")
	}
	created, err := f.recordProctorEvent(r.Context(), "psikotes", session.Str("id"), in)
	if err != nil {
		return err
	}
	return reply(w, http.StatusCreated, "data", orNull(created))
}

// ── drawing upload ──────────────────────────────────────────────────────────

// POST /api/psikotes/session/{token}/tests/{testId}/upload: the photo of a
// drawing test (multipart "file") into storage/private.
func (f *fileHandler) uploadDrawing(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	// rejected before the body is buffered; +1 MB for multipart overhead
	limit := int64(maxDrawingBytes + 1024*1024)
	if err := assertBodySize(r, limit, bodyTooLarge); err != nil {
		return err
	}
	test, err := f.runningTest(r, "upload")
	if err != nil {
		return err
	}
	if test.kind() != "drawing" {
		return httpx.BadRequest("Tes ini tidak menerima unggahan gambar")
	}
	if err := f.svc.assertTestRunning(test); err != nil {
		return err
	}
	var file *storage.File
	if in, err := storage.ReadForm(r, limit); err == nil {
		file = in.File("file")
	}
	switch {
	case file == nil:
		return httpx.BadRequest("File tidak ditemukan di form")
	case !storage.IsAllowedImageMime(file.Type):
		return httpx.BadRequest("Format harus JPG, PNG, atau WebP")
	case file.Size() > maxDrawingBytes:
		return httpx.BadRequest("Ukuran file maksimal 8MB")
	case storage.SniffImage(file.Data) == "":
		return httpx.BadRequest("Isi file bukan gambar JPG/PNG/WebP yang valid")
	}
	sessionID, testID := test.row.Str("session_id"), test.row.Str("id")
	path, err := f.store.SavePrivateImage(file.Data, file.Type, "psikotes/"+sessionID+"/"+testID)
	if err != nil {
		return httpx.Status(http.StatusInternalServerError, err.Error())
	}
	replaced, err := queryStrings(ctx, f.db(), `UPDATE recruitment.psikotes_session_tests SET attachment_path = $2
     WHERE id = $1 AND status = 'in_progress' RETURNING id::text`, testID, path)
	if err != nil || len(replaced) == 0 {
		f.store.DeletePrivate(path)
		if err != nil {
			return err
		}
		return httpx.Conflict("Tes tidak sedang berjalan")
	}
	// a re-upload must not orphan the previous file
	if old := test.row.Str("attachment_path"); old != "" && old != path {
		f.store.DeletePrivate(old)
	}
	return reply(w, http.StatusOK, "data", object("uploaded", true), "message", "Gambar terunggah")
}

// ── AI insight on a drawing ─────────────────────────────────────────────────

var drawingFrameworks = map[string]string{
	"baum": "Tes Baum (menggambar pohon). Aspek yang lazim dibaca: batang (proporsi, " +
		"tekstur), mahkota/dahan, akar (ada/tidak), ukuran & posisi gambar di kertas, " +
		"tekanan & kualitas garis, kelengkapan dan detail tambahan.",
	"dap": "Tes DAP / Draw a Person (menggambar manusia). Aspek yang lazim dibaca: " +
		"proporsi tubuh, detail wajah & anggota tubuh, ukuran & posisi di kertas, " +
		"tekanan garis, kelengkapan (pakaian/aksesori), ekspresi & postur.",
	"wartegg": "Tes Wartegg (WZT, melengkapi 8 kotak stimulus). Aspek yang lazim dibaca: " +
		"respon terhadap tiap stimulus (titik, garis lengkung, garis lurus, dst.), " +
		"urutan pengerjaan bila diketahui, orisinalitas, kualitas & keterkaitan gambar " +
		"dengan karakter stimulus tiap kotak.",
}

const drawingInsightPrompt = `Kamu adalah asisten psikolog HR yang membantu menafsirkan hasil tes proyektif secara INDIKATIF.
Balas HANYA dengan JSON valid (tanpa markdown code fence) berbentuk:
{
  "ringkasan": string,
  "indikasi": [{"aspek": string, "insight": string}],
  "perhatikan_saat_interview": [string],
  "keterbatasan": string
}
Ketentuan:
- Dasarkan HANYA pada observasi yang diberikan HR — jangan mengarang detail gambar yang tidak disebutkan.
- "ringkasan": 2-4 kalimat bahasa Indonesia, nada netral-profesional.
- "indikasi": 3-6 butir; tiap butir mengaitkan satu pengamatan dengan kemungkinan maknanya (pakai kata "cenderung/mengindikasikan", hindari klaim pasti).
- "perhatikan_saat_interview": 2-4 hal konkret yang sebaiknya digali HRD saat interview untuk memvalidasi indikasi.
- "keterbatasan": 1-2 kalimat yang menegaskan ini interpretasi indikatif dari observasi terbatas, bukan diagnosis psikologis, dan keputusan tetap di tangan HRD/psikolog.
- Jika observasi terlalu minim untuk ditafsirkan, katakan itu di "ringkasan" dan minta observasi tambahan di "perhatikan_saat_interview".`

const drawingVisionPrompt = `Kamu adalah asisten psikolog HR yang mendeskripsikan gambar hasil tes proyektif secara OBJEKTIF.
Tugasmu HANYA mendeskripsikan apa yang terlihat — JANGAN menafsirkan makna psikologisnya.
Balas dalam bahasa Indonesia, 4-8 kalimat prosa padat (tanpa markdown, tanpa daftar).
Deskripsikan sesuai aspek yang lazim dibaca pada instrumen yang disebutkan (ukuran & posisi di kertas, kelengkapan bagian, kualitas/tekanan garis, detail yang menonjol atau yang hilang).
Jika gambar buram, kosong, atau bukan hasil tes yang dimaksud, katakan itu apa adanya.`

func framework(code, name string) string {
	if fw, ok := drawingFrameworks[code]; ok {
		return fw
	}
	return "Tes " + name + "."
}

// parseObservation is {observation: "" | string.trim().min(20).max(4000)} optional.
func parseObservation(f *validate.Form) string {
	v, sent, done := f.Take("observation", "string", optional)
	if done || !sent {
		return ""
	}
	s, ok := v.(string)
	if !ok {
		f.Fail("observation", "invalid_union", "Invalid input")
		return ""
	}
	if s == "" {
		return ""
	}
	switch n := validate.UTF16Len(validate.JSTrim(s)); {
	case n < 20:
		f.Fail("observation", "too_small", "Tulis observasi gambar minimal 20 karakter, atau kosongkan agar AI membaca gambarnya")
	case n > 4000:
		f.Fail("observation", "too_big", "Observasi maksimal 4000 karakter")
	}
	return validate.JSTrim(s)
}

// POST /api/psikotes/session-tests/{id}/ai-insight: with an observation HR
// wrote, DeepSeek interprets it; without one OpenAI vision describes the
// drawing first. Cached in ai_insight, regenerable.
func (f *fileHandler) drawingInsight(w http.ResponseWriter, r *http.Request, a Actor) error {
	ctx := r.Context()
	id, err := pathUUID(r, "ID tes tidak valid")
	if err != nil {
		return err
	}
	// LLM calls are expensive: a tighter limit than the default
	if err := f.svc.enforce(ctx, "psikotes_ai_insight_"+a.ID, 10, "Terlalu banyak permintaan analisis, coba lagi sebentar lagi"); err != nil {
		return err
	}
	in := form(r)
	observation := parseObservation(in)
	if err := firstIssue(in); err != nil {
		return err
	}
	test, err := collectOne(f.db().Query(ctx, `SELECT t.status, t.attachment_path,
            i.code AS instrument_code, i.name AS instrument_name,
            i.kind AS instrument_kind, p.title AS position_title
     FROM recruitment.psikotes_session_tests t
     JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
     JOIN recruitment.psikotes_sessions s ON s.id = t.session_id
     JOIN recruitment.candidates c ON c.id = s.candidate_id
     LEFT JOIN hris.positions p ON p.id = c.position_id
     WHERE t.id = $1`, id))
	if err != nil {
		return err
	}
	if test == nil {
		return httpx.NotFound("Tes tidak ditemukan")
	}
	if test.Str("instrument_kind") != "drawing" {
		return httpx.BadRequest("Insight AI hanya untuk tes gambar (Baum/DAP/Wartegg)")
	}
	if !domain.IsReviewable(test.Str("status")) {
		return httpx.Conflict("Tes belum selesai dikerjakan kandidat")
	}
	insight, err := f.createDrawingInsight(ctx, test, observation, a)
	if err != nil {
		var nc notConfigured
		if errors.As(err, &nc) {
			return httpx.BadRequest(nc.Error())
		}
		return err
	}
	b, err := json.Marshal(insight)
	if err != nil {
		return err
	}
	if _, err := f.db().Exec(ctx, `UPDATE recruitment.psikotes_session_tests SET ai_insight = $2::jsonb WHERE id = $1`, id, string(b)); err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", insight, "message", "Insight AI dibuat")
}

func (f *fileHandler) createDrawingInsight(ctx context.Context, test *Row, observation string, a Actor) (*Row, error) {
	code, name := test.Str("instrument_code"), test.Str("instrument_name")
	source := "manual"
	var visionModel any
	if observation == "" {
		described, model, err := f.describeDrawing(ctx, test)
		if err != nil {
			return nil, err
		}
		observation, source, visionModel = domain.JSSlice(described, 4000), "ai", model
	}

	cfg, err := f.ai.deepseek(ctx, f.db())
	if err != nil {
		return nil, err
	}
	lines := []string{"INSTRUMEN: " + name + " — " + framework(code, name)}
	if p := test.Str("position_title"); p != "" {
		lines = append(lines, "POSISI YANG DILAMAR: "+p)
	}
	lines = append(lines, "\nOBSERVASI HR TERHADAP GAMBAR KANDIDAT:\n"+domain.JSSlice(observation, 4000))
	content, err := f.ai.chat(ctx, cfg, chatRequest{label: "DeepSeek", timeout: 90 * time.Second, body: map[string]any{
		"messages":        []chatMessage{{"system", drawingInsightPrompt}, {"user", strings.Join(lines, "\n")}},
		"temperature":     0.3,
		"response_format": jsonObjectFormat(),
	}})
	if err != nil {
		return nil, err
	}
	var parsed any
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return nil, errors.New("Respons DeepSeek bukan JSON valid")
	}
	if parsed == nil {
		return nil, errors.New("Respons DeepSeek null")
	}
	indikasi := []*Row{}
	for _, it := range arrayOf(field(parsed, "indikasi")) {
		switch it.(type) {
		case map[string]any, []any: // i && typeof i === "object"
			indikasi = append(indikasi, object("aspek", strOr(field(it, "aspek"), ""), "insight", strOr(field(it, "insight"), "")))
		}
	}
	perhatikan := []string{}
	for _, it := range arrayOf(field(parsed, "perhatikan_saat_interview")) {
		perhatikan = append(perhatikan, jsString(it))
	}
	return object(
		"observation", observation,
		"observation_source", source,
		"vision_model", visionModel,
		"insight", object(
			"ringkasan", strOr(field(parsed, "ringkasan"), ""),
			"indikasi", indikasi,
			"perhatikan_saat_interview", perhatikan,
			"keterbatasan", strOr(field(parsed, "keterbatasan"), ""),
		),
		"model", cfg.model,
		"created_at", httpx.JSTime(f.svc.now()),
		"created_by_name", a.FullName,
	), nil
}

// describeDrawing is describeAttachment + describeDrawingImage: an
// objective description of the uploaded drawing by OpenAI vision.
func (f *fileHandler) describeDrawing(ctx context.Context, test *Row) (string, string, error) {
	path := test.Str("attachment_path")
	if path == "" {
		return "", "", httpx.BadRequest("Tes ini tidak punya gambar terunggah — tulis observasi manual")
	}
	data, mime, err := f.store.ReadPrivate(path)
	if err != nil {
		return "", "", httpx.NotFound("Berkas gambar tidak ditemukan di storage — tulis observasi manual")
	}
	cfg, err := f.ai.openAI(ctx, f.db(), openAIVisionNotConfigured)
	if err != nil {
		return "", "", err
	}
	code, name := test.Str("instrument_code"), test.Str("instrument_name")
	content, err := f.ai.chat(ctx, cfg, chatRequest{label: "OpenAI", timeout: 90 * time.Second, body: map[string]any{
		"messages": []chatMessage{{"system", drawingVisionPrompt}, {"user", []any{
			map[string]any{"type": "text", "text": "INSTRUMEN: " + name + " — " + framework(code, name) +
				"\nDeskripsikan gambar hasil tes kandidat berikut secara objektif."},
			map[string]any{"type": "image_url", "image_url": map[string]string{
				"url": "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), "detail": "high"}},
		}}},
		"temperature": 0.2,
		"max_tokens":  700,
	}})
	if err != nil {
		return "", "", err
	}
	observation := validate.JSTrim(content)
	if observation == "" {
		return "", "", errors.New("OpenAI tidak mengembalikan deskripsi gambar")
	}
	return observation, cfg.model, nil
}
