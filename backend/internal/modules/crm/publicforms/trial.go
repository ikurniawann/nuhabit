package publicforms

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	contractsales "nuhabit/backend/internal/contracts/salesfunnel"
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/validate"
)

// POST /api/public/site/trial: the website's "Start a Trial" form. A
// prospect picks a branch and leaves name, email, phone and two marketing
// consents; the result is a warm 'website' lead with its consents on
// record, a lead.created event for the workflow rules, and a WhatsApp
// confirmation to the prospect.

// ConsentTextVersion names the consent wording the trial form shows
// (features/site-forms/consent.ts carries the same constant). Bump both
// when the wording changes.
const ConsentTextVersion = "2026-10-07.v2"

// trialDedupeWindow: a phone that asked for a trial this recently gets the
// same lead back instead of a second one.
const trialDedupeWindow = 24 * time.Hour

var e164Pattern = regexp.MustCompile(`^\+[1-9]\d{7,14}$`)

func e164Check(s string) (string, string, bool) {
	return "invalid_format", "Phone number must be in international format, e.g. +628123456789", e164Pattern.MatchString(s)
}

func emailCheck(s string) (string, string, bool) {
	return "invalid_format", "Enter a valid email", emailRe.MatchString(s)
}

// trialBranch is the branch the prospect picked.
type trialBranch struct {
	ID, Name, CompanyID string
}

// trialBranchBySlug is a read-only lookup on configuration.branches, like
// the display joins elsewhere in CRM; nil when the slug is unknown.
func (h *handler) trialBranchBySlug(ctx context.Context, slug string) (*trialBranch, error) {
	var b trialBranch
	err := h.db.QueryRow(ctx, `SELECT id::text, name, company_id::text FROM configuration.branches
      WHERE is_active AND (lower(slug) = lower($1) OR (slug IS NULL AND lower(code) = lower($1)))
      ORDER BY created_at LIMIT 1`, slug).Scan(&b.ID, &b.Name, &b.CompanyID)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &b, err
}

// trialResult is the response body. LeadID is null for a bot, which gets
// the same success answer as a person.
type trialResult struct {
	LeadID     *string `json:"lead_id"`
	BranchName *string `json:"branch_name"`
}

type trialInput struct {
	FirstName, LastName, Email, Phone string
	ConsentEmail, ConsentSMS          bool
	SourcePath                        *string
	Attribution                       Attribution
}

func (in trialInput) fullName() string {
	return strings.TrimSpace(in.FirstName + " " + in.LastName)
}

// phoneDigits is the lead's pic_phone: E.164 without the plus (62812…),
// the sales funnel's own spelling.
func (in trialInput) phoneDigits() string { return strings.TrimPrefix(in.Phone, "+") }

func (h *handler) trial(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	ip := clientIP(r.Header)
	allowed, _, err := h.limiter.Sliding(ctx, "site-trial:"+ip, 5, 5*time.Minute, h.now())
	if err != nil {
		return err
	}
	if !allowed {
		return httpx.TooManyRequests("Too many attempts. Try again in a few minutes.")
	}
	raw, present := validate.ReadBody(r)
	if !present {
		return httpx.BadRequest("The request body could not be read")
	}
	payload, _ := raw.(map[string]any)
	if bot, _ := IsLikelyBot(payload, h.now()); bot {
		return kit.OK(w, trialResult{})
	}
	f := validate.New(raw, present)
	slug := f.Str("branch_slug", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 60})
	in := trialInput{
		FirstName:    deref(f.Str("first_name", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 80})),
		LastName:     f.StrDefault("last_name", "", validate.StrOpts{Trim: true, Max: 80}),
		Email:        deref(f.Str("email", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 150, Check: emailCheck})),
		Phone:        deref(f.Str("phone", validate.Rule{}, validate.StrOpts{Trim: true, Check: e164Check})),
		ConsentEmail: f.BoolDefault("consent_email", false),
		ConsentSMS:   f.BoolDefault("consent_sms", false),
		SourcePath:   f.Str("source_path", validate.Rule{Optional: true, Nullable: true}, validate.StrOpts{Trim: true, Max: 500}),
	}
	if err := f.Err("Please check your details"); err != nil {
		return err
	}
	utm, _ := payload["utm"].(map[string]any)
	in.Attribution = ParseAttribution(utm)
	if in.Attribution.LandingPage == nil {
		in.Attribution.LandingPage = in.SourcePath
	}

	branch, err := h.trialBranchBySlug(ctx, *slug)
	if err != nil {
		return err
	}
	if branch == nil {
		return httpx.NotFound("Branch not found")
	}
	var userAgent *string
	if ua := r.Header.Get("user-agent"); ua != "" {
		u := sliceUTF16(ua, 300)
		userAgent = &u
	}
	leadID, fresh, err := h.createTrialLead(ctx, branch, in, HashIP(ip), userAgent)
	if err != nil {
		return err
	}
	if fresh {
		h.confirmTrial(ctx, branch, in)
	}
	return kit.OK(w, trialResult{LeadID: &leadID, BranchName: &branch.Name})
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// createTrialLead returns the lead and whether it was created now. A phone
// seen inside trialDedupeWindow gets its lead back untouched; a live lead
// with the same phone and name (the funnel's unique key) gets a note and
// fresh consent rows; otherwise lead, consents and the lead.created event
// are written in one transaction.
func (h *handler) createTrialLead(ctx context.Context, branch *trialBranch, in trialInput, ipHash string, userAgent *string) (leadID string, fresh bool, err error) {
	phone := in.phoneDigits()
	orgName := in.fullName() + " (trial)"
	if leadID, err = h.leads.RecentByPhone(ctx, h.db, branch.CompanyID, phone, h.now().Add(-trialDedupeWindow)); err != nil || leadID != "" {
		return leadID, false, err
	}
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		existing, err := h.leads.Duplicate(ctx, tx, branch.CompanyID, phone, orgName)
		if err != nil {
			return err
		}
		if existing != "" {
			leadID = existing
			if err := h.leads.AppendNote(ctx, tx, existing, "[Coba gratis "+FormatDate(h.now())+"] Mengajukan coba gratis lagi di "+branch.Name); err != nil {
				return err
			}
			return h.recordConsents(ctx, tx, existing, in, ipHash, userAgent)
		}
		custom, _ := json.Marshal(map[string]any{"trial": true, "branch": branch.Name, "source_path": in.SourcePath})
		name, email := in.fullName(), in.Email
		notes := "Coba gratis di " + branch.Name
		leadID, err = h.leads.Create(ctx, tx, NewLead{
			CompanyID: branch.CompanyID, BranchID: &branch.ID, OrgName: orgName, OrgType: "perorangan",
			Source: "website", Temperature: "hangat",
			PicName: &name, PicPhone: &phone, PicEmail: &email, Notes: &notes,
			Custom: string(custom), Attribution: in.Attribution,
		})
		if err != nil {
			return err
		}
		if leadID == "" {
			return errors.New("trial: lead insert returned no id")
		}
		if err := h.recordConsents(ctx, tx, leadID, in, ipHash, userAgent); err != nil {
			return err
		}
		fresh = true
		return outbox.Publish(ctx, tx, contractsales.TopicCrmEventRaised, "lead:"+leadID, contractsales.CrmEventRaised{
			EventType: "lead.created", SubjectType: "lead", SubjectID: leadID,
			CompanyID: &branch.CompanyID, BranchID: &branch.ID,
			Payload: map[string]any{"source": "website", "form": "trial", "branch": branch.Name, "utm": in.Attribution},
		})
	})
	return leadID, fresh, err
}

// recordConsents writes one crm.lead_consents row per channel, granted or
// not, so a refusal is on record too.
func (h *handler) recordConsents(ctx context.Context, q database.Querier, leadID string, in trialInput, ipHash string, userAgent *string) error {
	for channel, granted := range map[string]bool{"email": in.ConsentEmail, "sms": in.ConsentSMS} {
		if _, err := q.Exec(ctx, `INSERT INTO crm.lead_consents (lead_id, channel, granted, consent_text_version, ip_hash, user_agent, source_path)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`, leadID, channel, granted, ConsentTextVersion, ipHash, userAgent, in.SourcePath); err != nil {
			return err
		}
	}
	return nil
}

// confirmTrial tells the prospect on WhatsApp; a failure is logged, never
// shown to them.
func (h *handler) confirmTrial(ctx context.Context, branch *trialBranch, in trialInput) {
	message := "Thanks, " + in.FirstName + "! We have received your free trial request. " +
		"The " + branch.Name + " team will contact you on WhatsApp to set up your first session."
	if configured, err := h.engine.WhatsApp(ctx, in.phoneDigits(), message); configured && err != nil {
		h.log.Error("[site-trial] WA konfirmasi gagal", "error", err)
	}
}
