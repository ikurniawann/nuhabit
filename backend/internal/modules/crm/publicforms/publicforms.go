package publicforms

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/crm/advance"
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/marketing/domain"
	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/ratelimit"
	"nuhabit/backend/internal/platform/validate"
)

// Leads writes the sales-funnel leads a submission creates
// (crm.crm_sales_*, owned by sales-funnel); internal/app adapts
// salesfunnel.Records.
type Leads interface {
	// Duplicate is the live lead of the company with this phone and org
	// name (case-insensitive), "" when none.
	Duplicate(ctx context.Context, q database.Querier, companyID, phone, orgName string) (string, error)
	// AppendNote appends a paragraph to the lead's notes.
	AppendNote(ctx context.Context, q database.Querier, leadID, note string) error
	// Create inserts a 'baru' lead with the given temperature and returns
	// its id.
	Create(ctx context.Context, q database.Querier, in NewLead) (string, error)
	// RecentByPhone is the newest live lead of the company with this phone
	// created after since, "" when none.
	RecentByPhone(ctx context.Context, q database.Querier, companyID, phone string, since time.Time) (string, error)
}

// NewLead is a lead created from a form.
type NewLead struct {
	CompanyID                   string
	BranchID                    *string
	OrgName, OrgType, Source    string
	Temperature                 string
	PicName, PicPhone, PicEmail *string
	City, Notes                 *string
	Custom                      string // jsonb text
	Attribution                 Attribution
}

type handler struct {
	db      database.DB
	leads   Leads
	engine  advance.Emitter
	limiter *ratelimit.Limiter
	log     *slog.Logger
	now     func() time.Time
}

// Routes mounts the public form routes. advance ports back the CRM event
// engine and the sales notifications.
func Routes(d module.Deps, _ *xp.Engine, p advance.Ports, leads Leads) []module.Route {
	return newHandler(d.DB, d, p, leads).routes()
}

func newHandler(db database.DB, d module.Deps, p advance.Ports, leads Leads) *handler {
	now := d.Now
	if now == nil {
		now = time.Now
	}
	log := d.Log
	if log == nil {
		log = slog.Default()
	}
	return &handler{db: db, leads: leads, engine: advance.NewEmitter(db, d, p), limiter: ratelimit.New(db), log: log, now: now}
}

func (h *handler) routes() []module.Route {
	return []module.Route{
		{Pattern: "GET /api/public/crm/forms/{slug}", Handler: httpx.Handle(h.get)},
		{Pattern: "POST /api/public/crm/forms/{slug}", Handler: httpx.Handle(h.submit)},
		{Pattern: "POST /api/public/site/trial", Handler: httpx.Handle(h.trial)},
	}
}

// form is PublicFormRow.
type form struct {
	ID, Slug, Name, Title        string
	CompanyID, BranchID          *string
	Description, RedirectURL     *string
	Fields                       []domain.PublicField
	SubmitLabel, SuccessMessage  string
	DefaultSource                string
	LeadTemperature              string
	NotifyUserIDs, NotifyNumbers []string
}

var slugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,49}$`)

// loadForm is loadPublicForm + requirePublicForm: an active form by slug,
// 404 otherwise (a bad slug never reaches the database).
func (h *handler) loadForm(ctx context.Context, slug string) (*form, error) {
	notFound := httpx.NotFound("Form tidak ditemukan")
	if !slugPattern.MatchString(slug) {
		return nil, notFound
	}
	var f form
	var fields, userIDs, numbers []byte
	err := h.db.QueryRow(ctx, `SELECT id::text, company_id::text, branch_id::text, slug, name, title, description, fields,
		  submit_label, success_message, redirect_url, default_source, lead_temperature, notify_user_ids, notify_numbers
		FROM crm.crm_forms
		WHERE slug = $1 AND is_active AND deleted_at IS NULL`, slug).Scan(&f.ID, &f.CompanyID, &f.BranchID, &f.Slug, &f.Name,
		&f.Title, &f.Description, &fields, &f.SubmitLabel, &f.SuccessMessage, &f.RedirectURL, &f.DefaultSource, &f.LeadTemperature, &userIDs, &numbers)
	if database.IsNoRows(err) {
		return nil, notFound
	}
	if err != nil {
		return nil, err
	}
	f.Fields = formFields(decode(fields))
	f.NotifyUserIDs, f.NotifyNumbers = stringList(decode(userIDs)), stringList(decode(numbers))
	return &f, nil
}

// decode reads stored JSON with numbers as json.Number, which the validate
// checks expect (a float64 width would fail every stored field and drop
// the form back to the defaults).
func decode(raw []byte) any {
	v, _ := kit.DecodeLoose(raw)
	return v
}

// stringList is idList: the string entries of a JSON array.
func stringList(v any) []string {
	var out []string
	items, _ := v.([]any)
	for _, it := range items {
		if s, ok := it.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

var fieldKeyRe = regexp.MustCompile(`^[a-z][a-z0-9_]{1,39}$`)

// formFields is formFields: the stored definition, or the default fields
// when it is empty or no entry passes publicFieldSchema. (marketing keeps
// the same parser unexported for the admin side.)
func formFields(raw any) []domain.PublicField {
	items, _ := raw.([]any)
	var out []domain.PublicField
	for _, it := range items {
		f := validate.New(it, true)
		str := func(key string, o validate.StrOpts) string {
			if s := f.Str(key, validate.Rule{}, o); s != nil {
				return *s
			}
			return ""
		}
		nullable := validate.Rule{Optional: true, Nullable: true}
		optional := func(key string, max int) domain.OptionalText {
			_, set := f.Fields()[key]
			return domain.OptionalText{Set: set, Value: f.Str(key, nullable, validate.StrOpts{Trim: true, Max: max})}
		}
		fd := domain.PublicField{
			Key: str("key", validate.StrOpts{Trim: true, Check: func(s string) (string, string, bool) {
				return "invalid_format", "key: huruf kecil, angka, underscore; diawali huruf", fieldKeyRe.MatchString(s)
			}}),
			Label:    str("label", validate.StrOpts{Trim: true, Min: 1, Max: 120}),
			Type:     str("type", validate.StrOpts{Check: validate.EnumCheck(domain.PublicFieldTypes)}),
			Required: f.BoolDefault("required", false),
		}
		fd.Placeholder = optional("placeholder", 120)
		fd.HelpText = optional("help_text", 200)
		fd.Options = f.Strings("options", validate.Rule{HasDefault: true}, 50, validate.StrOpts{Trim: true, Min: 1, Max: 100})
		fd.Width = 2
		if n := f.Int("width", validate.Rule{HasDefault: true}, validate.NumOpts{Min: validate.Bound(1), Max: validate.Bound(2)}); n != nil {
			fd.Width = *n
		}
		if f.Valid() {
			out = append(out, fd)
		}
	}
	if len(out) == 0 {
		return domain.DefaultFormFields
	}
	return out
}

// get is the form definition for the public page.
func (h *handler) get(w http.ResponseWriter, r *http.Request) error {
	f, err := h.loadForm(r.Context(), r.PathValue("slug"))
	if err != nil {
		return err
	}
	return kit.OK(w, struct {
		Slug           string               `json:"slug"`
		Title          string               `json:"title"`
		Description    *string              `json:"description"`
		Fields         []domain.PublicField `json:"fields"`
		SubmitLabel    string               `json:"submit_label"`
		SuccessMessage string               `json:"success_message"`
		RedirectURL    *string              `json:"redirect_url"`
	}{f.Slug, f.Title, f.Description, f.Fields, f.SubmitLabel, f.SuccessMessage, f.RedirectURL})
}

// submitted is the success body: the form's message and redirect.
type submitted struct {
	Message     string  `json:"message"`
	RedirectURL *string `json:"redirect_url"`
}

// submit is a public submission → lead + scoring + workflow + sales
// notification. The per-IP limit runs before any database work.
func (h *handler) submit(w http.ResponseWriter, r *http.Request) error {
	ip := clientIP(r.Header)
	allowed, _, err := h.limiter.Sliding(r.Context(), "crm-form:"+ip, 5, 5*time.Minute, h.now())
	if err != nil {
		return err
	}
	if !allowed {
		return httpx.TooManyRequests("Terlalu banyak kiriman — coba lagi beberapa menit lagi")
	}
	ctx := r.Context()
	f, err := h.loadForm(ctx, r.PathValue("slug"))
	if err != nil {
		return err
	}
	raw, present := validate.ReadBody(r)
	if !present {
		return httpx.BadRequest("Isian tidak terbaca")
	}
	var userAgent *string
	if ua := r.Header.Get("user-agent"); ua != "" {
		userAgent = &ua
	}
	done, err := h.submitForm(ctx, f, raw, ip, userAgent)
	if err != nil {
		return err
	}
	return kit.OK(w, done)
}

// submitForm is submitPublicForm: every submission is recorded (rejected
// ones too); a bot gets the success answer so it learns nothing; 400 for
// invalid fields, 503 when no venue is configured.
func (h *handler) submitForm(ctx context.Context, f *form, raw any, ip string, userAgent *string) (submitted, error) {
	done := submitted{f.SuccessMessage, f.RedirectURL}
	payload, _ := raw.(map[string]any)
	if payload == nil {
		payload = map[string]any{}
	}
	if raw == nil {
		raw = map[string]any{}
	}
	attribution := ParseAttribution(payload)
	record := func(leadID *string, status, reason string) error {
		body, _ := json.Marshal(raw)
		utm, _ := json.Marshal(attribution)
		var reasonCol, ua *string
		if reason != "" {
			r := sliceUTF16(reason, 200)
			reasonCol = &r
		}
		if userAgent != nil {
			u := sliceUTF16(*userAgent, 300)
			ua = &u
		}
		_, err := h.db.Exec(ctx, `INSERT INTO crm.crm_form_submissions (form_id, lead_id, payload, utm, ip_hash, user_agent, status, reason)
			VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8)`,
			f.ID, leadID, string(body), string(utm), HashIP(ip), ua, status, reasonCol)
		return err
	}

	if bot, reason := IsLikelyBot(payload, h.now()); bot {
		return done, record(nil, "rejected", reason)
	}
	sub := ValidateSubmission(f.Fields, payload)
	if !sub.OK() {
		if err := record(nil, "rejected", "validasi gagal"); err != nil {
			return done, err
		}
		return done, httpx.BadRequest("Periksa kembali isian Anda", sub.Errors)
	}
	leadID, duplicate, err := h.createLead(ctx, f, sub, attribution)
	if err != nil {
		return done, err
	}
	if leadID == "" {
		if err := record(nil, "rejected", "venue belum dikonfigurasi"); err != nil {
			return done, err
		}
		return done, httpx.Status(http.StatusServiceUnavailable, "Form belum siap menerima kiriman. Hubungi kami lewat WhatsApp.")
	}
	status := "ok"
	if duplicate {
		status = "duplicate"
	}
	if err := record(&leadID, status, ""); err != nil {
		return done, err
	}
	if _, err := h.db.Exec(ctx, `UPDATE crm.crm_forms SET submission_count = submission_count + 1, updated_at = now() WHERE id = $1`, f.ID); err != nil {
		return done, err
	}
	// A notification never fails the answer to the submitter.
	if !duplicate {
		h.notifyNewLead(ctx, f, leadID, sub, attribution)
	}
	return done, nil
}

func customText(custom map[string]any, key string) string {
	s, _ := custom[key].(string)
	return s
}

// leadValue is `submission.lead[key] ?? null`.
func leadValue(lead map[string]string, key string) *string {
	if v, ok := lead[key]; ok {
		return &v
	}
	return nil
}

// createLead is createLeadFromSubmission: an existing (company, phone, org)
// lead is reused with the submission appended as a note; "" when the form
// has no company and no CRM default venue is set.
func (h *handler) createLead(ctx context.Context, f *form, sub Submission, a Attribution) (id string, duplicate bool, err error) {
	companyID, branchID := f.CompanyID, f.BranchID
	if companyID == nil {
		venue := kit.DefaultVenue(ctx, h.db)
		companyID = venue.CompanyID
		if branchID == nil {
			branchID = venue.BranchID
		}
	}
	if companyID == nil {
		return "", false, nil
	}
	// A form may split the name (first_name, last_name); the lead keeps one.
	if sub.Lead["pic_name"] == "" {
		if n := jsTrim(customText(sub.Custom, "first_name") + " " + customText(sub.Custom, "last_name")); n != "" {
			sub.Lead["pic_name"] = n
		}
	}
	orgName := LeadOrgName(sub.Lead)
	picName := orgName
	if n := sub.Lead["pic_name"]; n != "" {
		picName = n
	}
	var phone *string
	if p := sub.Lead["pic_phone"]; p != "" {
		n := NormalizePhone(p)
		phone = &n
	}
	if phone != nil {
		existing, err := h.leads.Duplicate(ctx, h.db, *companyID, *phone, orgName)
		if err != nil {
			return "", false, err
		}
		if existing != "" {
			if note := jsTrim(sub.Lead["notes"]); note != "" {
				text := sliceUTF16("[Form publik "+FormatDate(h.now())+"] "+note, 4000)
				if err := h.leads.AppendNote(ctx, h.db, existing, text); err != nil {
					return "", false, err
				}
			}
			return existing, true, nil
		}
	}
	custom, _ := json.Marshal(sub.Custom)
	orgType := "lainnya"
	if t := sub.Lead["org_type"]; t != "" {
		orgType = t
	}
	id, err = h.leads.Create(ctx, h.db, NewLead{
		CompanyID: *companyID, BranchID: branchID, OrgName: orgName, OrgType: orgType,
		Source: SourceFromAttribution(a, f.DefaultSource), Temperature: f.LeadTemperature,
		PicName: &picName, PicPhone: phone, PicEmail: leadValue(sub.Lead, "pic_email"),
		City: leadValue(sub.Lead, "city"), Notes: leadValue(sub.Lead, "notes"), Custom: string(custom), Attribution: a,
	})
	if err != nil || id == "" {
		return "", false, err
	}
	// Scoring and workflow run as for a lead created on the dashboard
	// (sales-funnel emits lead.created too).
	h.engine.Emit(ctx, advance.Event{
		EventType: "lead.created", SubjectType: "lead", SubjectID: id, CompanyID: companyID, BranchID: branchID,
		Payload: map[string]any{"source": "public_form", "form_slug": f.Slug, "utm": a},
	})
	return id, false, nil
}

// notifyNewLead alerts sales in-app and over WhatsApp; failures are logged.
func (h *handler) notifyNewLead(ctx context.Context, f *form, leadID string, sub Submission, a Attribution) {
	link := "/dashboard/sales-funnel/leads/" + leadID
	if len(f.NotifyUserIDs) > 0 {
		message := "Dari form publik " + f.Name
		if p := sub.Lead["pic_phone"]; p != "" {
			message += " · " + p
		}
		if _, err := h.engine.NotifyUsers(ctx, f.NotifyUserIDs, "Lead baru: "+LeadOrgName(sub.Lead), message, &link,
			map[string]any{"form_id": f.ID, "lead_id": leadID}); err != nil {
			h.log.Error("[public-form] notify gagal", "error", err)
		}
	}
	var numbers []string
	seen := map[string]bool{}
	add := func(p string) {
		if IsValidNormalizedPhone(p) && !seen[p] {
			seen[p] = true
			numbers = append(numbers, p)
		}
	}
	for _, raw := range f.NotifyNumbers {
		add(NormalizePhone(raw))
	}
	for _, uid := range f.NotifyUserIDs {
		if p, err := h.engine.EmployeePhone(ctx, uid); err == nil && p != nil {
			add(NormalizePhone(*p))
		}
	}
	message := BuildLeadAlert(f.Name, sub.Lead, a)
	for _, target := range numbers {
		configured, err := h.engine.WhatsApp(ctx, target, message)
		if !configured {
			return
		}
		if err != nil {
			h.log.Error("[public-form] WA gagal", "error", err)
		}
	}
}

// clientIP is clientIpFromHeaders.
func clientIP(h http.Header) string {
	if ip := strings.TrimSpace(h.Get("cf-connecting-ip")); ip != "" {
		return ip
	}
	if first := strings.TrimSpace(strings.Split(h.Get("x-forwarded-for"), ",")[0]); first != "" {
		return first
	}
	if ip := strings.TrimSpace(h.Get("x-real-ip")); ip != "" {
		return ip
	}
	return "unknown"
}
