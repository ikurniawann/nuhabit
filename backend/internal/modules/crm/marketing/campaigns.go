package marketing

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/marketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

const venueNotConfigured = "Venue belum dikonfigurasi"

// requireVenue mirrors requireCampaignVenue: the default venue with both
// company and branch, 400 otherwise.
func (h *handler) requireVenue(ctx context.Context) (company, branch string, err error) {
	v := kit.DefaultVenue(ctx, h.db)
	if v.CompanyID == nil || *v.CompanyID == "" || v.BranchID == nil || *v.BranchID == "" {
		return "", "", httpx.BadRequest(venueNotConfigured)
	}
	return *v.CompanyID, *v.BranchID, nil
}

func (h *handler) listCampaigns(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateCampaign); err != nil {
		return err
	}
	ctx := r.Context()
	v := kit.DefaultVenue(ctx, h.db)
	if v.BranchID == nil || *v.BranchID == "" {
		return httpx.BadRequest(venueNotConfigured)
	}
	rows, err := kit.Query(ctx, h.db, `SELECT k.id, k.name, k.message_template, k.segment, k.segment_id, sg.name AS segment_name,
            k.promo_campaign_id, k.promo_mode, k.voucher_prefix, k.status,
            k.daily_cap, k.recipients_built, k.created_at, k.channels, k.scheduled_at,
            k.started_at, k.failure_reason, k.inapp_title, k.image_url, k.link_url,
            (SELECT COUNT(*) FROM crm.crm_campaign_recipients r
              WHERE r.campaign_id = k.id AND r.status = 'pending') AS pending_count,
            (SELECT COUNT(*) FROM crm.crm_campaign_recipients r
              WHERE r.campaign_id = k.id AND r.status = 'sent') AS sent_count,
            (SELECT COUNT(*) FROM crm.crm_campaign_recipients r
              WHERE r.campaign_id = k.id AND r.status = 'failed') AS failed_count,
            (SELECT COUNT(*) FROM crm.member_notifications n
              WHERE n.campaign_id = k.id) AS inapp_count
     FROM crm.crm_campaigns k
     LEFT JOIN crm.crm_segments sg ON sg.id = k.segment_id
     WHERE k.branch_id = $1
     ORDER BY k.created_at DESC`, *v.BranchID)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

// parseSchedule mirrors parseSchedule: 400 unless the time is 5 minutes to
// 90 days ahead. The result keeps millisecond precision, like a JS Date.
func (h *handler) parseSchedule(raw string) (time.Time, error) {
	at, ok := validate.ParseJSDate(raw)
	if issue := domain.ValidateSchedule(at, ok, h.now()); issue != "" {
		return time.Time{}, httpx.BadRequest(domain.ScheduleIssueMessages[issue])
	}
	return at.Truncate(time.Millisecond), nil
}

func (h *handler) createCampaign(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.Require(r, kit.GateCampaign)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseCampaign(f, false)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	promoMode := ""
	if in.PromoCampaignID != nil {
		promoMode = "public"
		if in.PromoMode != nil {
			promoMode = *in.PromoMode
		}
	}
	if promoMode == "batch" && emptyToNil(in.VoucherPrefix) == nil {
		return httpx.BadRequest("Mode voucher batch wajib mengisi prefix kode")
	}
	switch domain.ValidateTemplate(*in.MessageTemplate, promoMode) {
	case "template-tanpa-kode":
		return httpx.BadRequest("Mode voucher batch wajib menyebut {kode} di template")
	case "kode-tanpa-promo":
		return httpx.BadRequest("Template memuat {kode} tapi kampanye tidak melampirkan promo")
	}
	var scheduledAt *time.Time
	if s := emptyToNil(in.ScheduledAt); s != nil {
		at, err := h.parseSchedule(*s)
		if err != nil {
			return err
		}
		scheduledAt = &at
	}
	ctx := r.Context()
	company, branch, err := h.requireVenue(ctx)
	if err != nil {
		return err
	}
	segment, err := kit.MarshalNoEscape(domain.NormalizeSegment(in.Segment))
	if err != nil {
		return err
	}
	var mode, prefix *string
	if promoMode != "" {
		mode = &promoMode
	}
	if promoMode == "batch" {
		upper := strings.ToUpper(*in.VoucherPrefix)
		prefix = &upper
	}
	status := "draft"
	if scheduledAt != nil {
		status = "scheduled"
	}
	var id string
	err = h.db.QueryRow(ctx, `INSERT INTO crm.crm_campaigns
       (company_id, branch_id, name, message_template, segment, segment_id,
        promo_campaign_id, promo_mode, voucher_prefix, daily_cap, created_by,
        channels, inapp_title, image_url, link_url, scheduled_at, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING id::text`,
		company, branch, *in.Name, *in.MessageTemplate, string(segment), in.SegmentID,
		in.PromoCampaignID, mode, prefix, in.DailyCap, user.ID,
		domain.NormalizeChannels(in.Channels), emptyToNil(in.InappTitle), emptyToNil(in.ImageURL), emptyToNil(in.LinkURL), scheduledAt, status,
	).Scan(&id)
	if err != nil {
		return err
	}
	msg := "Kampanye dibuat (draft)"
	if scheduledAt != nil {
		msg = "Kampanye dijadwalkan"
	}
	return kit.OK(w, idData{id}, msg)
}

type idData struct {
	ID string `json:"id"`
}

// campaign is STARTABLE_CAMPAIGN_COLUMNS.
type campaign struct {
	ID, CompanyID, BranchID, Name, Status string
	Segment                               []byte
	SegmentID, PromoCampaignID, PromoMode *string
	VoucherPrefix                         *string
	Channels                              []string
	MessageTemplate                       string
	InappTitle, ImageURL, LinkURL         *string
}

const startableColumns = `id::text, company_id::text, branch_id::text, name, status, segment, segment_id::text,
  promo_campaign_id::text, promo_mode, voucher_prefix, channels, message_template,
  inapp_title, image_url, link_url`

func (c *campaign) scan(row interface{ Scan(...any) error }) error {
	return row.Scan(&c.ID, &c.CompanyID, &c.BranchID, &c.Name, &c.Status, &c.Segment, &c.SegmentID,
		&c.PromoCampaignID, &c.PromoMode, &c.VoucherPrefix, &c.Channels, &c.MessageTemplate,
		&c.InappTitle, &c.ImageURL, &c.LinkURL)
}

// requireCampaign mirrors requireCampaign: the campaign in the default
// venue, 404 otherwise.
func (h *handler) requireCampaign(ctx context.Context, id string) (*campaign, error) {
	v := kit.DefaultVenue(ctx, h.db)
	var c campaign
	err := c.scan(h.db.QueryRow(ctx, `SELECT `+startableColumns+`
     FROM crm.crm_campaigns WHERE id = $1::text::uuid AND branch_id = $2::text::uuid`, id, v.BranchID))
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Kampanye tidak ditemukan")
	}
	return &c, err
}

type actionResult struct {
	data    any
	message string
}

func (h *handler) patchCampaign(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateCampaign); err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseCampaign(f, true)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	ctx := r.Context()
	c, err := h.requireCampaign(ctx, r.PathValue("id"))
	if err != nil {
		return err
	}
	action := ""
	if in.Action != nil {
		action = *in.Action
	}
	var res actionResult
	switch action {
	case "start":
		res, err = h.startAction(ctx, c)
	case "schedule":
		res, err = h.scheduleAction(ctx, c, in.ScheduledAt)
	case "":
		res, err = h.editDraft(ctx, c, in)
	default:
		a := statusActions[action]
		if _, err = h.db.Exec(ctx, a.sql, c.ID); err == nil {
			res = actionResult{idData{c.ID}, a.message}
		}
	}
	if err != nil {
		return err
	}
	return kit.OK(w, res.data, res.message)
}

// errStatusChanged is start's "row no longer startable" outcome.
var errStatusChanged = errors.New("campaign status changed")

type startData struct {
	ID       string `json:"id"`
	Inserted int    `json:"inserted"`
	InApp    int    `json:"inApp"`
	Status   string `json:"status"`
}

// startAction builds the queue and moves the campaign to sending. The row
// is locked: the watcher may start the same scheduled campaign.
func (h *handler) startAction(ctx context.Context, c *campaign) (actionResult, error) {
	var res startResult
	err := database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		var status string
		if err := tx.QueryRow(ctx, `SELECT status FROM crm.crm_campaigns WHERE id = $1 FOR UPDATE`, c.ID).Scan(&status); err != nil && !database.IsNoRows(err) {
			return err
		}
		if !slices.Contains([]string{"draft", "paused", "scheduled"}, status) {
			return errStatusChanged
		}
		var err error
		res, err = h.startCampaign(ctx, tx, c)
		return err
	})
	if errors.Is(err, errStatusChanged) {
		return actionResult{}, httpx.Conflict("Status kampanye sudah berubah — muat ulang halaman")
	}
	if err != nil {
		return actionResult{}, err
	}
	parts := []string{strconv.Itoa(res.inserted) + " penerima baru"}
	if res.inApp > 0 {
		parts = append(parts, strconv.Itoa(res.inApp)+" notifikasi in-app terkirim")
	}
	msg := "Kampanye selesai: " + strings.Join(parts, ", ") + "."
	if res.status == "sending" {
		msg = "Kampanye dimulai: " + strings.Join(parts, ", ") + ". WA mengikuti master switch & jam kirim."
	}
	return actionResult{startData{c.ID, res.inserted, res.inApp, res.status}, msg}, nil
}

func (h *handler) scheduleAction(ctx context.Context, c *campaign, rawAt *string) (actionResult, error) {
	if c.Status != "draft" && c.Status != "scheduled" {
		return actionResult{}, httpx.Conflict("Hanya kampanye draft yang bisa dijadwalkan")
	}
	raw := ""
	if rawAt != nil {
		raw = *rawAt
	}
	at, err := h.parseSchedule(raw)
	if err != nil {
		return actionResult{}, err
	}
	if _, err := h.db.Exec(ctx, `UPDATE crm.crm_campaigns SET status = 'scheduled', scheduled_at = $2, updated_at = now()
     WHERE id = $1 AND status IN ('draft', 'scheduled')`, c.ID, at); err != nil {
		return actionResult{}, err
	}
	return actionResult{struct {
		ID          string `json:"id"`
		ScheduledAt string `json:"scheduled_at"`
	}{c.ID, kit.ISO(at)}, "Kampanye dijadwalkan"}, nil
}

// statusActions are the plain status moves; each WHERE guards the legal
// source states.
var statusActions = map[string]struct{ sql, message string }{
	"pause": {`UPDATE crm.crm_campaigns SET status = 'paused', updated_at = now()
          WHERE id = $1 AND status = 'sending'`, "Kampanye dijeda"},
	"cancel": {`UPDATE crm.crm_campaigns SET status = 'cancelled', updated_at = now()
          WHERE id = $1 AND status IN ('draft', 'scheduled', 'sending', 'paused', 'failed')`, "Kampanye dibatalkan"},
	// A failed campaign resumes once the gateway is fixed; the queue stays.
	"resume": {`UPDATE crm.crm_campaigns SET status = 'sending', failure_reason = NULL, updated_at = now()
          WHERE id = $1 AND status IN ('paused', 'failed') AND recipients_built`, "Kampanye dilanjutkan"},
}

// editDraft edits fields of a draft (its queue was not built yet).
func (h *handler) editDraft(ctx context.Context, c *campaign, in campaignInput) (actionResult, error) {
	if c.Status != "draft" {
		return actionResult{}, httpx.Conflict("Hanya kampanye draft yang bisa diedit — jeda/batalkan dulu")
	}
	sets := []string{"updated_at = now()"}
	var values []any
	add := func(col string, v any) {
		values = append(values, v)
		sets = append(sets, col+" = $"+strconv.Itoa(len(values)))
	}
	if in.Name != nil {
		add("name", *in.Name)
	}
	if in.MessageTemplate != nil {
		add("message_template", *in.MessageTemplate)
	}
	if in.HasSegmentID {
		add("segment_id", in.SegmentID)
	}
	if in.HasSegment {
		seg, err := kit.MarshalNoEscape(domain.NormalizeSegment(in.Segment))
		if err != nil {
			return actionResult{}, err
		}
		add("segment", string(seg))
	}
	if in.HasDailyCap {
		add("daily_cap", in.DailyCap)
	}
	if in.Channels != nil {
		add("channels", domain.NormalizeChannels(in.Channels))
	}
	if in.HasInappTitle {
		add("inapp_title", emptyToNil(in.InappTitle))
	}
	if in.HasImageURL {
		add("image_url", emptyToNil(in.ImageURL))
	}
	if in.HasLinkURL {
		add("link_url", emptyToNil(in.LinkURL))
	}
	values = append(values, c.ID)
	if _, err := h.db.Exec(ctx, `UPDATE crm.crm_campaigns SET `+strings.Join(sets, ", ")+` WHERE id = $`+strconv.Itoa(len(values)), values...); err != nil {
		return actionResult{}, err
	}
	return actionResult{idData{c.ID}, "Kampanye diperbarui"}, nil
}

type campaignFunnel struct {
	Total         int     `json:"total"`
	Pending       int     `json:"pending"`
	Sent          int     `json:"sent"`
	Failed        int     `json:"failed"`
	Skipped       int     `json:"skipped"`
	Redeemed      float64 `json:"redeemed"`
	RedeemedValue float64 `json:"redeemed_value"`
}

type campaignInApp struct {
	Sent    int `json:"sent"`
	Opened  int `json:"opened"`
	Clicked int `json:"clicked"`
}

// campaignReport mirrors loadCampaignReport: queue to sent to voucher used.
// Batch mode matches recipients' voucher codes; public mode matches the
// numbers WA reached against the attached promo's redemptions.
func (h *handler) campaignReport(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateCampaign); err != nil {
		return err
	}
	ctx := r.Context()
	v := kit.DefaultVenue(ctx, h.db)
	row, err := kit.QueryOne(ctx, h.db, `SELECT id, name, status, promo_campaign_id, promo_mode, channels,
            scheduled_at, started_at, failure_reason
     FROM crm.crm_campaigns WHERE id = $1::text::uuid AND branch_id = $2::text::uuid`, r.PathValue("id"), v.BranchID)
	if err != nil {
		return err
	}
	if row == nil {
		return httpx.NotFound("Kampanye tidak ditemukan")
	}
	id := row.Str("id")
	var funnel campaignFunnel
	if err := h.db.QueryRow(ctx, `SELECT COUNT(*),
            COUNT(*) FILTER (WHERE status = 'pending'),
            COUNT(*) FILTER (WHERE status = 'sent'),
            COUNT(*) FILTER (WHERE status = 'failed'),
            COUNT(*) FILTER (WHERE status = 'skipped')
     FROM crm.crm_campaign_recipients WHERE campaign_id = $1`, id).
		Scan(&funnel.Total, &funnel.Pending, &funnel.Sent, &funnel.Failed, &funnel.Skipped); err != nil {
		return err
	}
	// In-app: delivered = notification rows; opens and clicks come from the
	// portal's tracking columns.
	var inApp campaignInApp
	if err := h.db.QueryRow(ctx, `SELECT COUNT(*),
            COUNT(*) FILTER (WHERE opened_at IS NOT NULL OR clicked_at IS NOT NULL),
            COUNT(*) FILTER (WHERE clicked_at IS NOT NULL)
     FROM crm.member_notifications WHERE campaign_id = $1`, id).Scan(&inApp.Sent, &inApp.Opened, &inApp.Clicked); err != nil {
		return err
	}
	if promoID := row.StrPtr("promo_campaign_id"); promoID != nil {
		var conv Conversion
		if row.Str("promo_mode") == "batch" {
			var codes []string
			codes, err = h.textColumn(ctx, `SELECT voucher_code FROM crm.crm_campaign_recipients
       WHERE campaign_id = $1 AND voucher_code IS NOT NULL`, id)
			if err == nil {
				conv, err = h.p.Promo.BatchConversion(ctx, h.db, codes)
			}
		} else {
			var phones []string
			phones, err = h.textColumn(ctx, `SELECT phone FROM crm.crm_campaign_recipients
       WHERE campaign_id = $1 AND status = 'sent'`, id)
			if err == nil {
				conv, err = h.p.Promo.PublicConversion(ctx, h.db, *promoID, phones)
			}
		}
		if err != nil {
			return err
		}
		funnel.Redeemed, funnel.RedeemedValue = conv.Count, conv.Value
	}
	summary := kit.NewRow()
	for _, k := range []string{"id", "name", "status", "channels", "scheduled_at", "started_at", "failure_reason"} {
		summary.Set(k, row.Get(k))
	}
	return kit.OK(w, struct {
		Campaign *kit.Row       `json:"campaign"`
		Funnel   campaignFunnel `json:"funnel"`
		InApp    campaignInApp  `json:"in_app"`
	}{summary, funnel, inApp})
}

// textColumn reads one text column of every row.
func (h *handler) textColumn(ctx context.Context, sql string, args ...any) ([]string, error) {
	rows, err := h.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

type campaignPreview struct {
	Count    int        `json:"count"`
	OptedOut int        `json:"optedOut"`
	Sample   []*kit.Row `json:"sample"`
}

// previewCampaign mirrors the campaigns/preview route: the recipient count
// after opt-outs and 5 samples, without sending.
func (h *handler) previewCampaign(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateCampaign); err != nil {
		return err
	}
	body, err := kit.ReadJSON(r)
	if err != nil {
		return err
	}
	if body == nil {
		// `body.segment` on a JSON null throws a TypeError (500).
		return errors.New("campaign preview: body is null")
	}
	obj, _ := body.(map[string]any)
	ctx := r.Context()
	_, branch, err := h.requireVenue(ctx)
	if err != nil {
		return err
	}
	where, params, err := h.resolveCampaignFilter(ctx, h.db, domain.NormalizeSegment(jsValue(obj["segment"])), 2, obj["segment_id"])
	if err != nil {
		return err
	}
	args := append([]any{branch}, params...)
	optoutJoin := `LEFT JOIN crm.crm_marketing_optouts o
       ON o.branch_id = $1
      AND ` + samePhoneSQL("o.phone", "c.phone")
	var out campaignPreview
	if err := scanSimple(ctx, h.db, `SELECT COUNT(*) FILTER (WHERE o.id IS NULL)::int AS total,
            COUNT(*) FILTER (WHERE o.id IS NOT NULL)::int AS opted
     FROM pos.pos_customers c
     `+optoutJoin+`
     WHERE `+where, args, &out.Count, &out.OptedOut); err != nil {
		return err
	}
	if out.Sample, err = querySimple(ctx, h.db, `SELECT c.name, c.phone, c.last_visit::text AS last_visit
     FROM pos.pos_customers c
     `+optoutJoin+`
     WHERE `+where+` AND o.id IS NULL
     ORDER BY c.last_visit DESC NULLS LAST
     LIMIT 5`, args); err != nil {
		return err
	}
	return kit.OK(w, out)
}
