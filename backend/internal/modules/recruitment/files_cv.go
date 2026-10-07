package recruitment

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/recruitment/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/extract"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/jsmath"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/validate"
)

// DELETE /api/candidates/{id}: the rows go by CASCADE, the psikotes
// evidence in storage/private (drawings, proctoring snapshots) is purged
// by hand. The deletion is logged because the candidate's activities go
// with it.
func (f *fileHandler) deleteCandidate(w http.ResponseWriter, r *http.Request, a Actor) error {
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := f.svc.requireCandidate(ctx, id); err != nil {
		return err
	}
	sessions, err := queryStrings(ctx, f.db(), "SELECT id::text FROM recruitment.psikotes_sessions WHERE candidate_id = $1", id)
	if err != nil {
		return err
	}
	if _, err := f.db().Exec(ctx, "DELETE FROM recruitment.candidates WHERE id = $1", id); err != nil {
		return err
	}
	if len(sessions) > 0 {
		f.svc.log.Info("[candidates] DELETE "+id+" oleh "+a.FullName+" ("+a.ID+")", "purged_psikotes_folders", len(sessions))
	}
	for _, s := range sessions {
		f.store.DeletePrivateFolder("psikotes/" + s)
	}
	return reply(w, http.StatusOK, "message", "Kandidat dihapus")
}

// ── CV upload ───────────────────────────────────────────────────────────────

var cvExtensions = []string{"pdf", "doc", "docx", "jpg", "jpeg", "png"}

const maxCVBytes = 10 * 1024 * 1024

// readCVFile is readCvFile: the multipart "file", extension and size
// checked, every failure a 400.
func readCVFile(r *http.Request) (*storage.File, error) {
	form, err := storage.ReadForm(r, storage.MaxRequestBytes+64*1024)
	switch {
	case errors.Is(err, storage.ErrBodyTooLarge):
		return nil, httpx.BadRequest("Ukuran file maksimal 10MB")
	case err != nil:
		return nil, httpx.BadRequest("Invalid form data")
	}
	file := form.File("file")
	if file == nil {
		return nil, httpx.BadRequest("File tidak ditemukan")
	}
	if !slices.Contains(cvExtensions, fileExt(file.Name)) {
		return nil, httpx.BadRequest("Tipe file tidak valid. Allowed: " + strings.Join(cvExtensions, ", "))
	}
	if file.Size() > maxCVBytes {
		return nil, httpx.BadRequest("Ukuran file maksimal 10MB")
	}
	return file, nil
}

// fileExt is name.split(".").pop().toLowerCase(): the whole name when it
// has no dot.
func fileExt(name string) string {
	return strings.ToLower(name[strings.LastIndex(name, ".")+1:])
}

func (f *fileHandler) setCVURL(ctx context.Context, id string, url *string) error {
	_, err := f.db().Exec(ctx, "UPDATE recruitment.candidates SET cv_url = $1, updated_at = now() WHERE id = $2", url, id)
	return err
}

func (f *fileHandler) uploadCV(w http.ResponseWriter, r *http.Request, _ Actor) error {
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := f.svc.requireCandidate(ctx, id); err != nil {
		return err
	}
	file, err := readCVFile(r)
	if err != nil {
		return err
	}
	if err := storage.ValidateFile(file.Size(), file.Type); err != nil {
		return httpx.BadRequest(err.Error())
	}
	url, err := f.store.Upload("candidates", "cvs", file.Data, file.Type, file.Name)
	if err != nil {
		f.svc.log.Error("[cv-upload] upload gagal", "error", err)
		return httpx.Status(http.StatusInternalServerError, "Upload gagal")
	}
	if err := f.setCVURL(ctx, id, &url); err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", object("cv_url", url), "message", "CV berhasil diupload")
}

func (f *fileHandler) removeCV(w http.ResponseWriter, r *http.Request, _ Actor) error {
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := f.svc.requireCandidate(ctx, id); err != nil {
		return err
	}
	if err := f.setCVURL(ctx, id, nil); err != nil {
		return err
	}
	return reply(w, http.StatusOK, "message", "CV berhasil dihapus")
}

// ── CV OCR for the manual candidate form (cv-ocr.ts) ────────────────────────

const cvOCRPrompt = `Kamu adalah asisten HR yang membaca CV/resume kandidat (bahasa Indonesia atau Inggris).
Ekstrak data berikut dari CV dan balas HANYA dengan JSON valid (tanpa markdown):
{"full_name": string|null, "email": string|null, "phone": string|null, "domicile": string|null, "last_experience": string|null, "last_education": string|null, "notes": string|null}

Ketentuan:
- "full_name": nama lengkap kandidat (bukan nama perusahaan/referensi).
- "email": alamat email kandidat.
- "phone": nomor HP/WhatsApp kandidat, tulis apa adanya (boleh berawalan 0 atau +62), hanya angka dan tanda + tanpa spasi/strip.
- "domicile": kota/kabupaten domisili kandidat saat ini (cukup nama kota, bukan alamat lengkap).
- "last_experience": pengalaman kerja TERAKHIR/terbaru kandidat, format ringkas "Nama Perusahaan - Posisi (durasi)", contoh: "PT Maju Jaya - Kasir (2 tahun)". Bila fresh graduate tanpa pengalaman, isi null.
- "last_education": pendidikan/lulusan TERAKHIR (jenjang tertinggi yang sudah lulus atau sedang ditempuh), format ringkas "Jenjang - Jurusan - Nama Sekolah/Universitas", contoh: "S1 - Manajemen - Universitas Indonesia" atau "SMA - IPA - SMAN 1 Bandung".
- "notes": ringkasan profil kandidat 2-4 kalimat dalam bahasa Indonesia untuk catatan HR: keahlian utama, sorotan pengalaman/prestasi, sertifikasi bila ada. Tulis faktual berdasarkan isi CV, tanpa opini kelayakan.
- Isi null bila informasi benar-benar tidak ditemukan. Jangan mengarang.`

var cvOCRFields = []string{"full_name", "email", "phone", "domicile", "last_experience", "last_education", "notes"}

// cvContent is buildUserContent: PDFs as a file part, photos as an image
// part, Word documents as their text.
func cvContent(data []byte, name, ext string) (any, error) {
	b64 := base64.StdEncoding.EncodeToString(data)
	switch ext {
	case "pdf":
		return []any{
			map[string]any{"type": "text", "text": "Ekstrak data kandidat dari CV terlampir."},
			map[string]any{"type": "file", "file": map[string]string{"filename": name, "file_data": "data:application/pdf;base64," + b64}},
		}, nil
	case "jpg", "jpeg", "png":
		mime := "image/jpeg"
		if ext == "png" {
			mime = "image/png"
		}
		return []any{
			map[string]any{"type": "text", "text": "Ekstrak data kandidat dari foto/scan CV terlampir."},
			map[string]any{"type": "image_url", "image_url": map[string]string{"url": "data:" + mime + ";base64," + b64}},
		}, nil
	case "doc", "docx":
		text, err := extract.DOCXText(data)
		if err != nil {
			return nil, err
		}
		if text = domain.JSTrim(text); text == "" {
			return nil, errors.New("Tidak ada teks yang bisa dibaca dari dokumen CV")
		}
		return "Ekstrak data kandidat dari teks CV berikut:\n\n" + domain.JSSlice(text, 20_000), nil
	}
	return nil, errors.New("Format file tidak didukung untuk OCR: ." + ext)
}

func (f *fileHandler) cvExtract(w http.ResponseWriter, r *http.Request, a Actor) error {
	ctx := r.Context()
	if err := f.svc.enforce(ctx, "cv_extract_"+a.ID, domain.DefaultRateLimit, "Terlalu banyak permintaan. Coba lagi beberapa saat."); err != nil {
		return err
	}
	file, err := readCVFile(r)
	if err != nil {
		return err
	}
	fields, err := f.ocrCV(ctx, file)
	if err != nil {
		return f.aiError(err, "cv-extract", "OCR CV gagal")
	}
	return reply(w, http.StatusOK, "data", fields)
}

// ocrCV is ocrCandidateCv: OpenAI reads the CV, retrying network failures.
func (f *fileHandler) ocrCV(ctx context.Context, file *storage.File) (*Row, error) {
	cfg, err := f.ai.openAIForOCR(ctx, f.db())
	if err != nil {
		return nil, err
	}
	content, err := cvContent(file.Data, file.Name, fileExt(file.Name))
	if err != nil {
		return nil, err
	}
	raw, err := f.ai.chat(ctx, cfg, chatRequest{label: "OpenAI", timeout: 60 * time.Second, attempts: 3, body: map[string]any{
		"temperature":     0,
		"response_format": jsonObjectFormat(),
		"messages":        []chatMessage{{"system", cvOCRPrompt}, {"user", content}},
	}})
	if err != nil {
		return nil, err
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil, errors.New("Jawaban OpenAI bukan JSON valid")
	}
	out := object()
	for _, k := range cvOCRFields {
		var v any
		if s, ok := parsed[k].(string); ok && domain.JSTrim(s) != "" {
			v = domain.JSTrim(s)
		}
		out.Set(k, v)
	}
	return out, nil
}

// ── CV analysis (cv-extract.ts + deepseek.ts) ───────────────────────────────

const analysisFields = `id, candidate_id, extracted, summary, match_score, match_reason,
  job_context, model, created_at, updated_at`

func (f *fileHandler) getAnalysis(w http.ResponseWriter, r *http.Request, _ Actor) error {
	id, err := pathUUID(r, msgBadCandidateID)
	if err != nil {
		return err
	}
	row, err := collectOne(f.db().Query(r.Context(),
		"SELECT "+analysisFields+" FROM recruitment.candidate_ai_analysis WHERE candidate_id = $1", id))
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", orNull(row))
}

const cvAnalysisPrompt = `Kamu adalah asisten HR yang menganalisis CV kandidat.
Balas HANYA dengan JSON valid (tanpa markdown code fence) berbentuk:
{
  "nama": string|null,
  "email": string|null,
  "no_hp": string|null,
  "sumber": string|null,
  "pendidikan": string|null,
  "pengalaman": string|null,
  "ringkasan": string,
  "skor_kecocokan": number,
  "alasan_kecocokan": string
}
Ketentuan:
- "nama","email","no_hp": ambil dari CV; null jika tidak ditemukan.
- "sumber": dari mana kandidat tahu lowongan JIKA disebut di CV (mis. JobStreet, referral); null jika tidak disebut.
- "pendidikan": ringkasan pendidikan terakhir (jenjang, institusi, jurusan, tahun bila ada).
- "pengalaman": ringkasan pengalaman kerja relevan (posisi, perusahaan, durasi).
- "ringkasan": 2-4 kalimat profil kandidat dalam bahasa Indonesia.
- "skor_kecocokan": 0-100, kecocokan CV terhadap deskripsi pekerjaan yang diberikan. Jika deskripsi pekerjaan tidak tersedia, nilai berdasarkan kualitas & kelengkapan CV dan sebutkan itu di alasan.
- "alasan_kecocokan": 1-3 kalimat alasan skor.`

// formatJobContext prefers the job opening and falls back to the position.
func formatJobContext(job, position *Row) *string {
	var s string
	switch {
	case job != nil:
		lines := []string{"Posisi: " + job.Str("title")}
		if d := job.Str("description"); d != "" {
			lines = append(lines, "Deskripsi: "+d)
		}
		if q := job.Str("requirements"); q != "" {
			lines = append(lines, "Persyaratan: "+q)
		}
		s = strings.Join(lines, "\n")
	case position != nil:
		s = "Posisi: " + position.Str("title")
		if d := position.Str("department"); d != "" {
			s += " — Departemen " + d
		}
		if l := position.Str("level"); l != "" {
			s += " (level " + l + ")"
		}
	default:
		return nil
	}
	return &s
}

// cvText is extractCvText: the file behind cv_url read from uploads.
func (f *fileHandler) cvText(ctx context.Context, cvURL string) (string, extract.Method, error) {
	abs, ok := f.store.UploadPath(cvURL)
	if !ok {
		return "", "", errors.New("URL CV tidak valid")
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", "", errors.New("File CV tidak ditemukan di storage")
	}
	return extract.CV(ctx, data, abs, f.ocr)
}

// cvAnalysis is the part of analyzeCvWithDeepseek's output the route uses.
type cvAnalysis struct {
	extracted              *Row
	summary, reason, model any
	score                  float64
}

// analyzeCVText is analyzeCvWithDeepseek.
func (f *fileHandler) analyzeCVText(ctx context.Context, q database.Querier, cvText string, jobContext *string, method extract.Method) (cvAnalysis, error) {
	cfg, err := f.ai.deepseek(ctx, q)
	if err != nil {
		return cvAnalysis{}, err
	}
	if validate.UTF16Len(cvText) > 12_000 {
		cvText = domain.JSSlice(cvText, 12_000) + "\n…(terpotong)"
	}
	job := "DESKRIPSI PEKERJAAN YANG DILAMAR: (tidak tersedia)"
	if jobContext != nil && *jobContext != "" {
		job = "DESKRIPSI PEKERJAAN YANG DILAMAR:\n" + *jobContext
	}
	content, err := f.ai.chat(ctx, cfg, chatRequest{label: "DeepSeek", timeout: 90 * time.Second, body: map[string]any{
		"messages":        []chatMessage{{"system", cvAnalysisPrompt}, {"user", job + "\n\nISI CV KANDIDAT:\n" + cvText}},
		"temperature":     0.2,
		"response_format": jsonObjectFormat(),
	}})
	if err != nil {
		return cvAnalysis{}, err
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(content), &parsed); err != nil || parsed == nil {
		return cvAnalysis{}, errors.New("Respons DeepSeek bukan JSON valid")
	}
	// JSON.stringify drops the keys the model left out
	extracted := object()
	for _, k := range []string{"nama", "email", "no_hp", "sumber", "pendidikan", "pengalaman"} {
		if v, ok := parsed[k]; ok {
			extracted.Set(k, v)
		}
	}
	extracted.Set("metode_ekstraksi", string(method))
	score := jsNumber(parsed["skor_kecocokan"])
	if _, ok := parsed["skor_kecocokan"]; !ok || math.IsNaN(score) || math.IsInf(score, 0) {
		score = 0
	}
	return cvAnalysis{
		extracted: extracted,
		summary:   pgText(parsed["ringkasan"]),
		reason:    pgText(parsed["alasan_kecocokan"]),
		model:     cfg.model,
		score:     math.Max(0, math.Min(100, jsmath.Round(score))),
	}, nil
}

// pgText is how node-postgres sends a JS value to a text column: strings
// as is, null as NULL, anything else as its JSON.
func pgText(v any) any {
	switch x := v.(type) {
	case nil, string:
		return x
	}
	b, _ := json.Marshal(v)
	return string(b)
}

func (f *fileHandler) analyzeCV(w http.ResponseWriter, r *http.Request, _ Actor) error {
	ctx := r.Context()
	id, err := pathUUID(r, msgBadCandidateID)
	if err != nil {
		return err
	}
	candidate, err := collectOne(f.db().Query(ctx,
		"SELECT cv_url, position_id, job_opening_id FROM recruitment.candidates WHERE id = $1", id))
	if err != nil {
		return err
	}
	if candidate == nil {
		return httpx.NotFound(msgCandidateNotFound)
	}
	cvURL := candidate.Str("cv_url")
	if cvURL == "" {
		return httpx.BadRequest("Kandidat belum memiliki lampiran CV")
	}
	var job, position *Row
	if jobID := candidate.Str("job_opening_id"); jobID != "" {
		if job, err = collectOne(f.db().Query(ctx,
			"SELECT title, description, requirements FROM recruitment.job_openings WHERE id = $1", jobID)); err != nil {
			return err
		}
	}
	if positionID := candidate.Str("position_id"); positionID != "" {
		if position, err = collectOne(f.db().Query(ctx,
			"SELECT title, department, level FROM hris.positions WHERE id = $1", positionID)); err != nil {
			return err
		}
	}
	jobContext := formatJobContext(job, position)

	text, method, err := f.cvText(ctx, cvURL)
	var result cvAnalysis
	if err == nil {
		result, err = f.analyzeCVText(ctx, f.db(), text, jobContext, method)
	}
	if err != nil {
		return f.aiError(err, "ai-analysis", "Analisis CV gagal")
	}
	extracted, err := json.Marshal(result.extracted)
	if err != nil {
		return err
	}
	row, err := collectOne(f.db().Query(ctx, `INSERT INTO recruitment.candidate_ai_analysis
       (candidate_id, cv_text, extracted, summary, match_score, match_reason, job_context, model, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, now())
     ON CONFLICT (candidate_id) DO UPDATE SET
       cv_text = EXCLUDED.cv_text,
       extracted = EXCLUDED.extracted,
       summary = EXCLUDED.summary,
       match_score = EXCLUDED.match_score,
       match_reason = EXCLUDED.match_reason,
       job_context = EXCLUDED.job_context,
       model = EXCLUDED.model,
       updated_at = now()
     RETURNING `+analysisFields,
		id, text, string(extracted), result.summary, int64(result.score), result.reason, jobContext, result.model))
	if err != nil {
		return err
	}
	return reply(w, http.StatusOK, "data", orNull(row), "message", "Analisis CV selesai")
}
