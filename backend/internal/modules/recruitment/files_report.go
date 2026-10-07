package recruitment

import (
	"context"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/text/unicode/norm"

	"nuhabit/backend/internal/modules/recruitment/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/jsmath"
	"nuhabit/backend/internal/platform/pdfgen"
)

// GET /api/candidates/{id}/report: the candidate's pipeline report as a
// PDF (lib/recruitment/pipeline-report*.ts), built on every request so it
// follows the latest data; available from the Offer stage.

func (f *fileHandler) pipelineReport(w http.ResponseWriter, r *http.Request, a Actor) error {
	ctx := r.Context()
	id, err := pathUUID(r, msgBadCandidateID)
	if err != nil {
		return err
	}
	if err := f.svc.enforce(ctx, "pipeline_report_"+a.ID, 30, domain.TooManyRequests); err != nil {
		return err
	}
	data, err := f.reportData(ctx, id)
	if err != nil {
		return err
	}
	if data == nil {
		return httpx.NotFound(msgCandidateNotFound)
	}
	if status := data.candidate.Str("status"); status != "offer" && status != "hired" {
		return httpx.Conflict("Laporan pipeline tersedia mulai tahap Offer")
	}
	pdf, err := buildPipelineReport(data, f.svc.now())
	if err != nil {
		return err
	}
	h := w.Header()
	h.Set("Content-Type", "application/pdf")
	h.Set("Content-Length", strconv.Itoa(len(pdf)))
	h.Set("Content-Disposition", `attachment; filename="`+reportFileName(data.candidate.Str("full_name"))+`"`)
	h.Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(pdf)
	return nil
}

type reportData struct {
	candidate, aiAnalysis, screening, psikotesSummary, hired *Row
	psikotesTests, interviews, offers, activities            []*Row
}

// reportData is getPipelineReportData; nil when the candidate is missing.
func (f *fileHandler) reportData(ctx context.Context, id string) (*reportData, error) {
	q := f.db()
	candidate, err := collectOne(q.Query(ctx, `SELECT c.id, c.full_name, c.email, c.phone, c.domicile, c.source, c.status,
            c.last_experience, c.last_education, c.expected_salary, c.created_at,
            p.title AS position_title
     FROM recruitment.candidates c
     LEFT JOIN hris.positions p ON p.id = c.position_id
     WHERE c.id = $1`, id))
	if err != nil || candidate == nil {
		return nil, err
	}
	d := &reportData{candidate: candidate}
	one := func(dst **Row, sql string) {
		if err == nil {
			*dst, err = collectOne(q.Query(ctx, sql, id))
		}
	}
	many := func(dst *[]*Row, sql string) {
		if err == nil {
			*dst, err = collect(q.Query(ctx, sql, id))
		}
	}
	one(&d.aiAnalysis, `SELECT match_score, match_reason, summary, model, updated_at
       FROM recruitment.candidate_ai_analysis WHERE candidate_id = $1`)
	one(&d.screening, `SELECT contacted, interested, availability_note, confirmed_salary,
              willing_shift, willing_placement, notes, recommendation,
              updated_by_name, updated_at
       FROM recruitment.candidate_screenings WHERE candidate_id = $1`)
	many(&d.psikotesTests, `SELECT s.id AS session_id, s.status AS session_status,
              s.completed_at AS session_completed_at,
              i.name AS instrument_name, t.status, t.score,
              t.review_notes, t.reviewed_by_name, t.ai_insight
       FROM recruitment.psikotes_sessions s
       JOIN recruitment.psikotes_session_tests t ON t.session_id = s.id
       JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
       WHERE s.candidate_id = $1
       ORDER BY s.created_at ASC, t.sort_order ASC`)
	one(&d.psikotesSummary, `SELECT recommendation, notes, updated_by_name, updated_at
       FROM recruitment.candidate_psikotes_summary WHERE candidate_id = $1`)
	many(&d.interviews, `SELECT s.status, s.invited_at, s.completed_at, s.ai_summary, s.summary_model,
              (SELECT count(*) FROM recruitment.interview_ai_turns t
               WHERE t.session_id = s.id AND t.answered_at IS NOT NULL) AS turn_count
       FROM recruitment.interview_ai_sessions s
       WHERE s.candidate_id = $1
       ORDER BY s.created_at ASC`)
	many(&d.offers, `SELECT version, status, position_title, base_salary, start_date,
              sent_at, expires_at, responded_at, response_note, created_by_name
       FROM recruitment.candidate_offers
       WHERE candidate_id = $1
       ORDER BY version ASC`)
	many(&d.activities, `SELECT activity_type, description, created_by_name, created_at
       FROM recruitment.candidate_activities
       WHERE candidate_id = $1
       ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	if d.hired, err = f.svc.ports.Hired.Hired(ctx, q, id); err != nil {
		return nil, err
	}
	return d, nil
}

// ── labels and formatters (pipeline-report-format.ts) ───────────────────────

var (
	pipelineStatusLabels = map[string]string{
		"applied": "Applied", "screening": "Screening", "psikotes": "Psikotes", "interview": "Interview",
		"offer": "Offer", "hired": "Hired", "talent_pool": "Talent Pool", "rejected": "Ditolak",
	}
	recommendationLabels = map[string]string{"lolos": "Lolos", "hold": "Hold", "tidak_lolos": "Tidak Lolos"}
	relevansiLabels      = map[string]string{"relevan": "Relevan", "cukup_relevan": "Cukup Relevan", "kurang_relevan": "Kurang Relevan"}
	offerStatusLabels    = map[string]string{
		"sent": "Terkirim", "negotiating": "Negosiasi", "accepted": "Diterima", "declined": "Ditolak", "expired": "Kedaluwarsa",
	}
	employmentStatusLabels  = map[string]string{"probation": "Probation", "contract": "Kontrak", "permanent": "Tetap", "internship": "Magang"}
	observationSourceLabels = map[string]string{"ai": "Otomatis (AI vision)", "manual": "Manual (HRD)"}
	psikotesTestLabels      = map[string]string{
		"pending": "Belum dikerjakan", "in_progress": "Sedang dikerjakan", "selesai": "Selesai",
		"perlu_review": "Perlu Review", "reviewed": "Sudah Direview",
	}
	idMonths = []string{"Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus",
		"September", "Oktober", "November", "Desember"}
)

func labelOf(labels map[string]string, key string) string {
	if key == "" {
		return "-"
	}
	if l, ok := labels[key]; ok {
		return l
	}
	return key
}

// reportNumber is Number(v) for a column value; false for null, "" and NaN.
func reportNumber(v any) (float64, bool) {
	var n float64
	switch x := v.(type) {
	case string:
		if x == "" {
			return 0, false
		}
		n = domain.JSNumber(x)
	case float64:
		n = x
	case int32:
		n = float64(x)
	case int16:
		n = float64(x)
	default:
		return 0, false
	}
	return n, !math.IsNaN(n) && !math.IsInf(n, 0)
}

// formatIdr is "Rp 5.000.000"; "-" for empty or non-numeric values.
func formatIdr(v any) string {
	n, ok := reportNumber(v)
	if !ok {
		return "-"
	}
	return "Rp " + pdfgen.Thousands(n)
}

// formatScore is "87/100".
func formatScore(v any) string {
	n, ok := reportNumber(v)
	if !ok {
		return "-"
	}
	return strconv.FormatFloat(jsmath.Round(n), 'f', -1, 64) + "/100"
}

func boolLabel(v any) string {
	b, ok := v.(bool)
	switch {
	case !ok:
		return "-"
	case b:
		return "Ya"
	}
	return "Tidak"
}

// reportTime reads a timestamp column or an ISO string from jsonb.
func reportTime(v any) (time.Time, bool) {
	switch x := v.(type) {
	case httpx.JSTime:
		return time.Time(x), true
	case time.Time:
		return x, true
	case string:
		t, ok := parseDateLike(x)
		return t, ok
	}
	return time.Time{}, false
}

// formatDate is toLocaleDateString("id-ID", {day, month: "long", year}) in
// Jakarta: "15 Juli 2026".
func formatDate(v any) string {
	t, ok := reportTime(v)
	if !ok {
		return "-"
	}
	t = t.In(jakarta)
	return strconv.Itoa(t.Day()) + " " + idMonths[t.Month()-1] + " " + strconv.Itoa(t.Year())
}

// formatDateTime adds the 2-digit time: "15 Juli 2026 pukul 16.30".
func formatDateTime(v any) string {
	t, ok := reportTime(v)
	if !ok {
		return "-"
	}
	return formatDate(t) + " pukul " + t.In(jakarta).Format("15.04")
}

var slugRuns = regexp.MustCompile(`[^a-z0-9]+`)

// reportFileName is "laporan-pipeline-budi-santoso.pdf".
func reportFileName(fullName string) string {
	var b strings.Builder
	for _, r := range norm.NFKD.String(strings.ToLower(fullName)) {
		if r < 0x300 || r > 0x36f {
			b.WriteRune(r)
		}
	}
	slug := strings.Trim(slugRuns.ReplaceAllString(b.String(), "-"), "-")
	slug = domain.JSSlice(slug, 60)
	if slug == "" {
		slug = "kandidat"
	}
	return "laporan-pipeline-" + slug + ".pdf"
}

// sanitizeText maps the common symbols Helvetica cannot print and drops
// the rest outside Latin-1 (plus – — • …).
func sanitizeText(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch r {
		case '→':
			b.WriteString("->")
		case '←':
			b.WriteString("<-")
		case '✔':
			b.WriteString("v")
		case '✖':
			b.WriteString("x")
		case '’', '‘', '‚':
			b.WriteByte('\'')
		case '“', '”', '„':
			b.WriteByte('"')
		case '–', '—', '•', '…':
			b.WriteRune(r)
		default:
			if r <= 0xFF {
				b.WriteRune(r)
			}
		}
	}
	return b.String()
}

// ── PDF (pipeline-report-pdf.ts) ────────────────────────────────────────────

const (
	colorText   = "#1f2937"
	colorMuted  = "#6b7280"
	colorAccent = "#0369a1"
	colorLine   = "#e5e7eb"
)

// reportDoc tracks the font size pdfkit keeps across doc.font() calls.
type reportDoc struct {
	*pdfgen.Doc
	size float64
}

func (d *reportDoc) font(f pdfgen.Font) *reportDoc { d.Font(f, d.size); return d }

func (d *reportDoc) fontSize(size float64) *reportDoc {
	d.size = size
	return d
}

func (d *reportDoc) sectionTitle(title string) {
	d.EnsureSpace(60)
	d.MoveDown(1)
	d.Color(colorAccent)
	d.fontSize(12).font(pdfgen.HelveticaBold)
	d.Para(title, pdfgen.TextOpts{})
	d.HLine(d.Y+2, colorLine, 0.8)
	d.MoveDown(0.5)
	d.Color(colorText)
	d.fontSize(9.5).font(pdfgen.Helvetica)
}

func (d *reportDoc) keyValue(label, value string) {
	d.EnsureSpace(16)
	x, y := d.Left(), d.Y
	const labelWidth = 150
	d.font(pdfgen.Helvetica).Color(colorMuted)
	d.Text(label, x, y, pdfgen.TextOpts{Width: labelWidth})
	d.Color(colorText)
	if value = sanitizeText(value); value == "" {
		value = "-"
	}
	d.Text(value, x+labelWidth, y, pdfgen.TextOpts{Width: d.ContentWidth() - labelWidth})
	d.X = x
	d.MoveDown(0.2)
}

func (d *reportDoc) heading(text string) {
	d.font(pdfgen.HelveticaBold)
	d.Para(text, pdfgen.TextOpts{})
	d.font(pdfgen.Helvetica)
}

func (d *reportDoc) paragraph(text string) {
	d.EnsureSpace(24)
	d.font(pdfgen.Helvetica).Color(colorText)
	d.Para(sanitizeText(text), pdfgen.TextOpts{})
	d.MoveDown(0.3)
}

func (d *reportDoc) bullets(items []string) {
	for _, item := range items {
		d.EnsureSpace(14)
		d.font(pdfgen.Helvetica).Color(colorText)
		d.Text("•  "+sanitizeText(item), d.Left()+8, d.Y, pdfgen.TextOpts{Width: d.ContentWidth() - 8})
	}
	d.MoveDown(0.3)
}

func (d *reportDoc) emptyNote(text string) {
	d.font(pdfgen.HelveticaOblique).Color(colorMuted)
	d.Para(text, pdfgen.TextOpts{})
	d.font(pdfgen.Helvetica).Color(colorText)
	d.MoveDown(0.3)
}

// drawingInsight is the stored psikotes_session_tests.ai_insight.
type drawingInsight struct {
	Observation       string  `json:"observation"`
	ObservationSource string  `json:"observation_source"`
	VisionModel       *string `json:"vision_model"`
	Model             string  `json:"model"`
	CreatedAt         string  `json:"created_at"`
	Insight           struct {
		Ringkasan string `json:"ringkasan"`
		Indikasi  []struct {
			Aspek   string `json:"aspek"`
			Insight string `json:"insight"`
		} `json:"indikasi"`
		Perhatikan   []string `json:"perhatikan_saat_interview"`
		Keterbatasan string   `json:"keterbatasan"`
	} `json:"insight"`
}

func (d *reportDoc) drawingInsight(ai drawingInsight) {
	d.EnsureSpace(40)
	d.MoveDown(0.2)
	d.font(pdfgen.HelveticaBold).Color(colorAccent)
	d.Para("Analisa AI", pdfgen.TextOpts{})
	d.font(pdfgen.Helvetica).Color(colorText)
	source := ai.ObservationSource
	if source == "" {
		source = "manual"
	}
	d.keyValue("Observasi gambar", ai.Observation+" ("+labelOf(observationSourceLabels, source)+")")
	if ai.Insight.Ringkasan != "" {
		d.keyValue("Ringkasan", ai.Insight.Ringkasan)
	}
	if len(ai.Insight.Indikasi) > 0 {
		d.EnsureSpace(20)
		d.heading("Indikasi:")
		items := make([]string, len(ai.Insight.Indikasi))
		for i, it := range ai.Insight.Indikasi {
			items[i] = it.Aspek + ": " + it.Insight
		}
		d.bullets(items)
	}
	if len(ai.Insight.Perhatikan) > 0 {
		d.EnsureSpace(20)
		d.heading("Perhatikan saat interview:")
		d.bullets(ai.Insight.Perhatikan)
	}
	if ai.Insight.Keterbatasan != "" {
		d.EnsureSpace(16)
		d.font(pdfgen.HelveticaOblique).Color(colorMuted)
		d.Para(sanitizeText(ai.Insight.Keterbatasan), pdfgen.TextOpts{})
		d.font(pdfgen.Helvetica).Color(colorText)
	}
	model := ai.Model
	if ai.VisionModel != nil && *ai.VisionModel != "" {
		model += " + " + *ai.VisionModel
	}
	d.keyValue("Model / waktu analisa", model+" · "+formatDateTime(ai.CreatedAt))
}

// interviewSummary is the stored interview_ai_sessions.ai_summary.
type interviewSummary struct {
	Ringkasan string `json:"ringkasan"`
	Relevansi *struct {
		Skor       any    `json:"skor"`
		Kesimpulan string `json:"kesimpulan"`
		Alasan     string `json:"alasan"`
	} `json:"relevansi"`
	Keahlian       []string `json:"keahlian"`
	EkspektasiGaji *struct {
		Disebutkan bool    `json:"disebutkan"`
		Nilai      *string `json:"nilai"`
		Catatan    *string `json:"catatan"`
	} `json:"ekspektasi_gaji"`
	RedFlags []string `json:"red_flags"`
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

// buildPipelineReport is buildPipelineReportPdf: A4, 48 pt margins, eight
// sections and a "Halaman x dari y" footer.
func buildPipelineReport(data *reportData, now time.Time) ([]byte, error) {
	d := &reportDoc{Doc: pdfgen.New(pdfgen.Options{Size: "A4", Margin: 48, Now: now}), size: 12}
	c := data.candidate

	d.Color(colorText)
	d.fontSize(16).font(pdfgen.HelveticaBold)
	d.Para("Laporan Pipeline Rekrutmen", pdfgen.TextOpts{})
	d.MoveDown(0.15)
	d.fontSize(10).font(pdfgen.Helvetica).Color(colorMuted)
	position := c.Str("position_title")
	if c.Get("position_title") == nil {
		position = "Posisi tidak tercatat"
	}
	d.Para(sanitizeText(c.Str("full_name")+" — "+position), pdfgen.TextOpts{})
	d.Para("Status saat ini: "+labelOf(pipelineStatusLabels, c.Str("status"))+" · Dicetak "+formatDateTime(now), pdfgen.TextOpts{})
	d.fontSize(9.5).font(pdfgen.Helvetica).Color(colorText)

	d.sectionTitle("1. Profil Kandidat")
	d.keyValue("Nama lengkap", c.Str("full_name"))
	d.keyValue("Email", orDash(c.Str("email")))
	d.keyValue("Telepon", orDash(c.Str("phone")))
	d.keyValue("Domisili", orDash(c.Str("domicile")))
	d.keyValue("Sumber lamaran", orDash(c.Str("source")))
	d.keyValue("Pendidikan terakhir", orDash(c.Str("last_education")))
	d.keyValue("Pengalaman terakhir", orDash(c.Str("last_experience")))
	d.keyValue("Ekspektasi gaji", formatIdr(c.Get("expected_salary")))
	d.keyValue("Tanggal melamar", formatDate(c.Get("created_at")))

	d.sectionTitle("2. Analisis CV (AI) — Tahap Applied")
	if a := data.aiAnalysis; a != nil {
		d.keyValue("Skor kecocokan", formatScore(a.Get("match_score")))
		if s := a.Str("match_reason"); s != "" {
			d.keyValue("Alasan", s)
		}
		if s := a.Str("summary"); s != "" {
			d.keyValue("Ringkasan profil", s)
		}
		d.keyValue("Model / waktu analisis", orDash(a.Str("model"))+" · "+formatDateTime(a.Get("updated_at")))
	} else {
		d.emptyNote("Belum ada analisis AI untuk kandidat ini.")
	}

	d.sectionTitle("3. Screening HR")
	if s := data.screening; s != nil {
		d.keyValue("Sudah dihubungi", boolLabel(s.Get("contacted")))
		d.keyValue("Berminat", boolLabel(s.Get("interested")))
		d.keyValue("Ketersediaan", orDash(s.Str("availability_note")))
		d.keyValue("Gaji terkonfirmasi", formatIdr(s.Get("confirmed_salary")))
		d.keyValue("Bersedia shift", boolLabel(s.Get("willing_shift")))
		d.keyValue("Bersedia penempatan", boolLabel(s.Get("willing_placement")))
		if n := s.Str("notes"); n != "" {
			d.keyValue("Catatan", n)
		}
		d.keyValue("Rekomendasi", labelOf(recommendationLabels, s.Str("recommendation")))
		d.keyValue("Diperbarui oleh", orDash(s.Str("updated_by_name"))+" · "+formatDateTime(s.Get("updated_at")))
	} else {
		d.emptyNote("Tahap screening belum diisi.")
	}

	d.sectionTitle("4. Psikotes")
	if len(data.psikotesTests) > 0 {
		for _, t := range data.psikotesTests {
			d.EnsureSpace(30)
			d.heading(sanitizeText(t.Str("instrument_name")))
			d.keyValue("Status", labelOf(psikotesTestLabels, t.Str("status")))
			d.keyValue("Skor", formatScore(t.Get("score")))
			if n := t.Str("review_notes"); n != "" {
				d.keyValue("Catatan review", n)
			}
			if n := t.Str("reviewed_by_name"); n != "" {
				d.keyValue("Direview oleh", n)
			}
			if t.Get("ai_insight") != nil {
				var ai drawingInsight
				if err := t.JSON("ai_insight", &ai); err == nil {
					d.drawingInsight(ai)
				}
			}
			d.MoveDown(0.3)
		}
	} else {
		d.emptyNote("Belum ada sesi psikotes.")
	}
	if s := data.psikotesSummary; s != nil {
		d.heading("Kesimpulan Psikotes")
		d.keyValue("Rekomendasi", labelOf(recommendationLabels, s.Str("recommendation")))
		if n := s.Str("notes"); n != "" {
			d.keyValue("Catatan", n)
		}
		d.keyValue("Diputuskan oleh", orDash(s.Str("updated_by_name"))+" · "+formatDateTime(s.Get("updated_at")))
	}

	d.sectionTitle("5. Interview AI")
	if len(data.interviews) > 0 {
		for i, s := range data.interviews {
			d.EnsureSpace(40)
			if len(data.interviews) > 1 {
				d.heading("Sesi " + strconv.Itoa(i+1))
			}
			d.keyValue("Status sesi", s.Str("status"))
			d.keyValue("Selesai pada", formatDateTime(s.Get("completed_at")))
			d.keyValue("Pertanyaan terjawab", s.Str("turn_count"))
			var summary *interviewSummary
			_ = s.JSON("ai_summary", &summary)
			if summary != nil {
				if summary.Ringkasan != "" {
					d.keyValue("Ringkasan", summary.Ringkasan)
				}
				if rel := summary.Relevansi; rel != nil {
					d.keyValue("Relevansi", formatScore(rel.Skor)+" — "+labelOf(relevansiLabels, rel.Kesimpulan))
					if rel.Alasan != "" {
						d.keyValue("Alasan", rel.Alasan)
					}
				}
				if len(summary.Keahlian) > 0 {
					d.keyValue("Keahlian", strings.Join(summary.Keahlian, ", "))
				}
				if g := summary.EkspektasiGaji; g != nil && g.Disebutkan {
					value := "-"
					if g.Nilai != nil {
						value = *g.Nilai
					} else if g.Catatan != nil {
						value = *g.Catatan
					}
					d.keyValue("Ekspektasi gaji (interview)", value)
				}
				if len(summary.RedFlags) > 0 {
					d.EnsureSpace(20)
					d.heading("Red flags:")
					d.bullets(summary.RedFlags)
				}
			} else {
				d.emptyNote("Sesi belum memiliki kesimpulan AI.")
			}
			d.MoveDown(0.3)
		}
	} else {
		d.emptyNote("Belum ada sesi interview AI.")
	}

	d.sectionTitle("6. Offer")
	if len(data.offers) > 0 {
		for _, o := range data.offers {
			d.EnsureSpace(40)
			d.heading("Offer v" + strconv.Itoa(o.Int("version")) + " — " + labelOf(offerStatusLabels, o.Str("status")))
			d.keyValue("Posisi", orDash(o.Str("position_title")))
			d.keyValue("Gaji pokok", formatIdr(o.Get("base_salary")))
			d.keyValue("Mulai kerja", formatDate(o.Get("start_date")))
			d.keyValue("Dikirim", formatDateTime(o.Get("sent_at")))
			d.keyValue("Berlaku sampai", formatDateTime(o.Get("expires_at")))
			if o.Get("responded_at") != nil {
				d.keyValue("Direspons", formatDateTime(o.Get("responded_at")))
			}
			if n := o.Str("response_note"); n != "" {
				d.keyValue("Catatan respons", n)
			}
			d.keyValue("Dibuat oleh", orDash(o.Str("created_by_name")))
			d.MoveDown(0.3)
		}
	} else {
		d.emptyNote("Belum ada offer yang dibuat.")
	}

	d.sectionTitle("7. Hired — Data Karyawan")
	switch h := data.hired; {
	case h != nil:
		d.keyValue("NIP", orDash(h.Str("nip")))
		d.keyValue("Tanggal promosi", formatDate(h.Get("promotion_date")))
		d.keyValue("Tanggal bergabung", formatDate(h.Get("join_date")))
		d.keyValue("Status kepegawaian", labelOf(employmentStatusLabels, h.Str("employment_status")))
		d.keyValue("Departemen", orDash(h.Str("department_name")))
		d.keyValue("Jabatan", orDash(h.Str("job_title")))
		d.keyValue("Atasan langsung", orDash(h.Str("reporting_to_name")))
		account := "Belum dibuat"
		if h.Bool("has_account") {
			account = "Sudah dibuat"
		}
		d.keyValue("Akun login karyawan", account)
		onboarding := "Belum ada checklist onboarding"
		if total := h.Int("onboarding_total"); total > 0 {
			onboarding = strconv.Itoa(h.Int("onboarding_completed")) + "/" + strconv.Itoa(total) + " item selesai"
		}
		d.keyValue("Onboarding", onboarding)
		active := "Nonaktif"
		if h.Bool("is_active") {
			active = "Aktif"
		}
		d.keyValue("Status karyawan", active)
	case c.Str("status") == "hired":
		d.emptyNote("Kandidat sudah Hired namun belum dipromosikan menjadi karyawan.")
	default:
		d.emptyNote("Kandidat belum berstatus Hired.")
	}

	d.sectionTitle("8. Riwayat Aktivitas Pipeline")
	if len(data.activities) > 0 {
		for _, a := range data.activities {
			d.EnsureSpace(24)
			d.Color(colorMuted)
			d.fontSize(8.5).font(pdfgen.Helvetica)
			line := formatDateTime(a.Get("created_at"))
			if by := a.Str("created_by_name"); by != "" {
				line += " · " + by
			}
			d.Para(sanitizeText(line), pdfgen.TextOpts{})
			d.Color(colorText)
			d.fontSize(9.5)
			d.paragraph(a.Str("description"))
		}
	} else {
		d.emptyNote("Belum ada aktivitas tercatat.")
	}

	d.EachPage(func(page, total int) {
		d.Font(pdfgen.Helvetica, 8).Color(colorMuted)
		d.Text(sanitizeText("NüHabit HRIS · "+c.Str("full_name")+" · Halaman "+strconv.Itoa(page)+" dari "+strconv.Itoa(total)),
			d.Left(), d.PageHeight()-34, pdfgen.TextOpts{Width: d.ContentWidth(), Align: pdfgen.AlignCenter, NoWrap: true})
	})
	return d.Bytes()
}
