package recruitment

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/recruitment/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/storage"
	"nuhabit/backend/internal/platform/validate"
)

// POST /api/portal/submit: the public career form (multipart) creates an
// applied candidate with a required photo and an optional CV, then emails
// the applicant and HRD (portal-application.ts, portal/submit/emails.ts).
// Every value comes from an anonymous applicant: strict checks, every
// value escaped in the emails.

const (
	submitLimit       = 5
	submitWindow      = 10 * time.Minute
	fieldRequired     = "Field wajib belum lengkap"
	maxApplicantBytes = 2 * 1024 * 1024
)

var (
	lineBreaks     = regexp.MustCompile(`[\r\n]+`)
	applicantEmail = regexp.MustCompile(`^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$`)
	cvMimeTypes    = []string{"application/pdf", "application/msword",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
	photoMimeTypes = []string{"image/jpeg", "image/png", "image/webp"}
)

type application struct {
	FullName, Email, Phone, Domicile, Source    string
	PositionID, BrandID, JobOpeningID, Notes    *string
	LastExperience, LastEducation, Availability *string
	ExpectedSalary                              *int64
}

// parseApplication is parseApplicationFields: "Field wajib" wins over a
// format error.
func parseApplication(form *storage.Form) (application, error) {
	var issues []string
	required := func(key string) string {
		v := form.Value(key)
		if v == "" {
			issues = append(issues, fieldRequired)
		}
		return v
	}
	optionalText := func(key string) *string {
		if v := form.Value(key); v != "" {
			return &v
		}
		return nil
	}
	a := application{FullName: required("full_name")}
	if a.Email = required("email"); a.Email != "" {
		if validate.UTF16Len(a.Email) > 255 || !applicantEmail.MatchString(a.Email) {
			issues = append(issues, "Format email tidak valid")
		}
	}
	a.Phone, a.Domicile, a.Source = required("phone"), required("domicile"), required("source")
	a.PositionID, a.BrandID, a.JobOpeningID = optionalText("position_id"), optionalText("brand_id"), optionalText("job_opening_id")
	a.Notes, a.LastExperience = optionalText("notes"), optionalText("last_experience")
	a.LastEducation, a.Availability = optionalText("last_education"), optionalText("availability")
	if v := optionalText("expected_salary"); v != nil {
		if n, ok := jsParseInt(*v); ok {
			a.ExpectedSalary = &n
		}
	}
	switch {
	case slices.Contains(issues, fieldRequired):
		return a, httpx.BadRequest(fieldRequired)
	case len(issues) > 0:
		return a, httpx.BadRequest(issues[0])
	}
	return a, nil
}

// jsParseInt is parseInt(s, 10): leading whitespace, a sign, then digits
// up to the first non-digit.
func jsParseInt(s string) (int64, bool) {
	s = domain.JSTrim(s)
	end := 0
	if end < len(s) && (s[0] == '+' || s[0] == '-') {
		end++
	}
	start := end
	for end < len(s) && s[end] >= '0' && s[end] <= '9' {
		end++
	}
	if end == start {
		return 0, false
	}
	n, err := strconv.ParseInt(s[:end], 10, 64)
	return n, err == nil
}

type uploadRule struct {
	types                             []string
	typeError, sizeError, uploadError string
	bucket                            string
}

func (f *fileHandler) uploadChecked(file *storage.File, rule uploadRule) (string, error) {
	if !slices.Contains(rule.types, file.Type) {
		return "", httpx.BadRequest(rule.typeError)
	}
	if file.Size() > maxApplicantBytes {
		return "", httpx.BadRequest(rule.sizeError)
	}
	url, err := f.store.Upload(rule.bucket, "candidates", file.Data, file.Type, file.Name)
	if err != nil {
		return "", httpx.Status(http.StatusInternalServerError, rule.uploadError+": "+err.Error())
	}
	return url, nil
}

// nonEmptyFile is a file part with content, else nil.
func nonEmptyFile(form *storage.Form, key string) *storage.File {
	if file := form.File(key); file != nil && file.Size() > 0 {
		return file
	}
	return nil
}

func (f *fileHandler) portalSubmit(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	allowed, _, err := f.svc.limiter.Sliding(ctx, "portal-submit:"+rateLimitIP(r.Header), submitLimit, submitWindow, f.svc.now())
	if err != nil {
		return err
	}
	if !allowed {
		return httpx.TooManyRequests("Terlalu banyak lamaran dari jaringan ini. Coba lagi beberapa menit lagi.")
	}
	form, err := storage.ReadForm(r, storage.MaxRequestBytes)
	if err != nil {
		return err // request.formData() throwing is a 500 in the TS
	}
	in, err := parseApplication(form)
	if err != nil {
		return err
	}
	photo := nonEmptyFile(form, "photo")
	if photo == nil {
		return httpx.BadRequest("Pas foto wajib diupload")
	}
	var cvURL *string
	if cv := nonEmptyFile(form, "cv"); cv != nil {
		url, err := f.uploadChecked(cv, uploadRule{types: cvMimeTypes, typeError: "CV harus format PDF atau DOC",
			sizeError: "CV maksimal 2MB", bucket: "cv", uploadError: "Gagal upload CV"})
		if err != nil {
			return err
		}
		cvURL = &url
	}
	photoURL, err := f.uploadChecked(photo, uploadRule{types: photoMimeTypes, typeError: "Foto harus format JPG/PNG",
		sizeError: "Foto maksimal 2MB", bucket: "photos", uploadError: "Gagal upload foto"})
	if err != nil {
		return err
	}

	positionTitle, brandName := "Belum ditentukan", "Umum"
	if in.PositionID != nil && domain.IsUUID(*in.PositionID) {
		if t, err := queryStrings(ctx, f.db(), "SELECT title FROM hris.positions WHERE id = $1", *in.PositionID); err != nil {
			return err
		} else if len(t) > 0 {
			positionTitle = t[0]
		}
	}
	if in.BrandID != nil && domain.IsUUID(*in.BrandID) {
		if n, err := queryStrings(ctx, f.db(), "SELECT name FROM item.brands WHERE id = $1", *in.BrandID); err != nil {
			return err
		} else if len(n) > 0 {
			brandName = n[0]
		}
	}
	var candidateID string
	if err := f.db().QueryRow(ctx, `INSERT INTO recruitment.candidates
       (full_name, email, phone, domicile, source, position_id, brand_id, job_opening_id,
        cv_url, photo_url, notes, status, last_experience, last_education, availability, expected_salary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'applied', $12, $13, $14, $15)
     RETURNING id::text`,
		in.FullName, in.Email, in.Phone, in.Domicile, in.Source, in.PositionID, in.BrandID, in.JobOpeningID,
		cvURL, photoURL, in.Notes, in.LastExperience, in.LastEducation, in.Availability, in.ExpectedSalary,
	).Scan(&candidateID); err != nil {
		return err
	}

	f.sendApplicationEmails(ctx, applicationEmail{
		candidateID: candidateID, fullName: in.FullName, email: in.Email, phone: in.Phone,
		domicile: in.Domicile, source: in.Source, notes: in.Notes,
		positionTitle: positionTitle, brandName: brandName, origin: portalOrigin(r),
	})
	return httpx.JSON(w, http.StatusOK, object("success", true, "message", "Lamaran berhasil dikirim", "candidate_id", candidateID))
}

// rateLimitIP is clientIpFromHeaders: cf-connecting-ip, the left-most
// x-forwarded-for, x-real-ip, else "unknown".
func rateLimitIP(h http.Header) string {
	if ip := strings.TrimSpace(h.Get("cf-connecting-ip")); ip != "" {
		return ip
	}
	if ip := strings.TrimSpace(strings.Split(h.Get("x-forwarded-for"), ",")[0]); ip != "" {
		return ip
	}
	if ip := strings.TrimSpace(h.Get("x-real-ip")); ip != "" {
		return ip
	}
	return "unknown"
}

// portalOrigin is appOrigin(request): the configured app URL, else the
// origin the proxy forwarded, without a trailing slash.
func portalOrigin(r *http.Request) string {
	origin := strings.TrimSpace(os.Getenv("NEXT_PUBLIC_APP_URL"))
	if origin == "" {
		origin = strings.TrimSpace(os.Getenv("NEXT_PUBLIC_BASE_URL"))
	}
	if origin == "" {
		host := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Host"), ",")[0])
		if host == "" {
			host = r.Host
		}
		proto := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0])
		if proto == "" {
			proto = "http"
			if r.TLS != nil {
				proto = "https"
			}
		}
		origin = proto + "://" + host
	}
	return strings.TrimRight(origin, "/")
}

// ── emails ──────────────────────────────────────────────────────────────────

type applicationEmail struct {
	candidateID, fullName, email, phone, domicile, source string
	notes                                                 *string
	positionTitle, brandName, origin                      string
}

var htmlEscaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")

// emailSubject drops CR/LF so an applicant value cannot add a header.
func emailSubject(text string) string {
	return domain.JSSlice(lineBreaks.ReplaceAllString(text, " "), 200)
}

func candidateConfirmationHTML(d applicationEmail) string {
	return `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1a1a1a;">Terima Kasih, ` + htmlEscaper.Replace(d.fullName) + `!</h2>
              <p style="color: #555;">Lamaran kamu untuk posisi <strong>` + htmlEscaper.Replace(d.positionTitle) + `</strong> di <strong>` + htmlEscaper.Replace(d.brandName) + `</strong> sudah kami terima.</p>
              <p style="color: #555;">Tim HRD akan menghubungi kamu melalui WhatsApp atau email dalam 1-3 hari kerja.</p>
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
              <p style="color: #888; font-size: 12px;">Pesan ini dikirim otomatis. Mohon tidak membalas email ini.</p>
            </div>
          `
}

func emailRow(label, valueHTML, extraStyle string) string {
	return `
                <tr>
                  <td style="padding: 8px 0; color: #555;` + extraStyle + `">` + label + `</td>
                  <td style="padding: 8px 0; color: #1a1a1a;">` + valueHTML + `</td>
                </tr>`
}

func hrdNotificationHTML(d applicationEmail) string {
	e := htmlEscaper.Replace
	wa := nonDigit.ReplaceAllString(d.phone, "")
	detailURL := d.origin + "/dashboard/hris/candidates/" + storage.EncodeURIComponent(d.candidateID)
	rows := emailRow("Nama", "<strong>"+e(d.fullName)+"</strong>", " width: 140px;") +
		emailRow("Email", `<a href="mailto:`+e(d.email)+`">`+e(d.email)+`</a>`, "") +
		emailRow("No. WhatsApp", `<a href="https://wa.me/`+wa+`">`+e(d.phone)+`</a>`, "") +
		emailRow("Domisili", e(d.domicile), "") +
		emailRow("Posisi", e(d.positionTitle), "") +
		emailRow("Outlet", e(d.brandName), "") +
		emailRow("Sumber", e(d.source), "")
	if d.notes != nil && *d.notes != "" {
		rows += emailRow("Catatan", e(*d.notes), "")
	}
	return `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1a1a1a;">Lamaran Baru Masuk</h2>
              <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">` + rows + `
              </table>
              <div style="margin-top: 24px;">
                <a href="` + e(detailURL) + `" style="background: #2563eb; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">Lihat di Dashboard</a>
              </div>
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
              <p style="color: #888; font-size: 12px;">Pesan ini dikirim otomatis dari sistem Talent Pool.</p>
            </div>
          `
}

// sendApplicationEmails mails the applicant and, when HRD_EMAIL is set,
// HRD through Resend. Best effort: a failed email never undoes the saved
// application.
func (f *fileHandler) sendApplicationEmails(ctx context.Context, d applicationEmail) {
	key := os.Getenv("RESEND_API_KEY")
	if key == "" {
		return
	}
	from := os.Getenv("FROM_EMAIL")
	if from == "" {
		from = "noreply@aapextechnology.com"
	}
	type message struct{ label, to, subject, html string }
	messages := []message{{"Candidate", d.email, "Lamaran Kamu Sudah Kami Terima", candidateConfirmationHTML(d)}}
	if hrd := os.Getenv("HRD_EMAIL"); hrd != "" {
		messages = append(messages, message{"HRD", hrd,
			emailSubject("[Talent Pool] Lamaran Baru: " + d.fullName + " untuk " + d.positionTitle), hrdNotificationHTML(d)})
	}
	for _, m := range messages {
		body, _ := json.Marshal(map[string]string{"from": from, "to": m.to, "subject": m.subject, "html": m.html})
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(body))
		if err != nil {
			continue
		}
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		res, err := f.ai.http.Do(req)
		if err != nil {
			f.svc.log.Error(m.label+" email error", "error", err)
			continue
		}
		_ = res.Body.Close()
		if res.StatusCode >= 300 {
			f.svc.log.Error(m.label+" email error", "status", res.StatusCode)
		}
	}
}
