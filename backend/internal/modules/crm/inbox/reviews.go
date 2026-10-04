package inbox

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/inbox/domain"
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Ports lib/crm/google-reviews-inbox-server.ts and google-reviews-server.ts:
// the Google review list, replies (low ratings from non-approvers wait for
// approval), approve/reject/ignore, and the sync from Google Business.

// reviewSettings is GoogleReviewSettings (crm_settings gr_*).
type reviewSettings struct {
	ComplaintMaxRating float64 `json:"complaintMaxRating"`
	SLAReplyMinutes    float64 `json:"slaReplyMinutes"`
	SyncEnabled        bool    `json:"syncEnabled"`
}

// settingNumber is readNumber over a jsonb value: numbers, or strings
// through Number(); anything else (or NaN) is the fallback.
func settingNumber(v any, fallback float64) float64 {
	var f float64
	switch x := v.(type) {
	case float64:
		f = x
	case string:
		s := domain.JSTrim(x)
		if s == "" {
			return 0
		}
		n, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return fallback
		}
		f = n
	default:
		return fallback
	}
	if math.IsInf(f, 0) || math.IsNaN(f) {
		return fallback
	}
	return f
}

func loadReviewSettings(ctx context.Context, q database.Querier) (reviewSettings, error) {
	s := reviewSettings{ComplaintMaxRating: 3, SLAReplyMinutes: 1440, SyncEnabled: true}
	rows, err := q.Query(ctx, `SELECT key, value FROM crm.crm_settings WHERE key LIKE 'gr_%'`)
	if err != nil {
		return s, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var raw []byte
		if err := rows.Scan(&key, &raw); err != nil {
			return s, err
		}
		var v any
		_ = json.Unmarshal(raw, &v)
		switch key {
		case "gr_complaint_max_rating":
			s.ComplaintMaxRating = settingNumber(v, 3)
		case "gr_sla_reply_minutes":
			s.SLAReplyMinutes = settingNumber(v, 1440)
		case "gr_sync_enabled":
			s.SyncEnabled = v != false
		}
	}
	return s, rows.Err()
}

func canApproveReplies(role string) bool { return kit.RoleIn(role, "super_admin", "admin") }

func (h *handler) listReviews(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.Require(r, kit.GateInbox)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	var args []any
	var filters []string
	add := func(cond string, v any) {
		args = append(args, v)
		filters = append(filters, cond+"$"+strconv.Itoa(len(args)))
	}
	if s := q.Get("status"); s != "" && s != "all" {
		add("r.status = ", s)
	}
	// Number(rating): missing or blank is 0, outside 1..5. A fraction reaches
	// PostgreSQL as text and fails there (400), as node-postgres sends it.
	if rating := settingNumber(q.Get("rating"), math.NaN()); rating >= 1 && rating <= 5 {
		args = append(args, strconv.FormatFloat(rating, 'f', -1, 64))
		filters = append(filters, "r.star_rating = $"+strconv.Itoa(len(args))+"::text::int")
	}
	if l := q.Get("location"); l != "" && l != "all" {
		add("r.location_id = ", l)
	}
	where := ""
	if len(filters) > 0 {
		where = "WHERE " + strings.Join(filters, " AND ")
	}
	ctx := r.Context()
	settings, err := loadReviewSettings(ctx, h.db)
	if err != nil {
		return err
	}
	reviews, err := kit.Query(ctx, h.db, `SELECT r.id, r.reviewer_name, r.reviewer_photo_url, r.star_rating, r.comment,
            r.review_created_at, r.reply_comment, r.reply_updated_at,
            r.status, r.is_complaint, r.first_reply_seconds, r.location_id,
            r.pending_reply_comment, r.reply_approval_status,
            u.full_name AS replied_by_name,
            pu.full_name AS pending_by_name
       FROM crm.google_reviews r
       LEFT JOIN configuration.users u ON u.id = r.replied_by_user_id
       LEFT JOIN configuration.users pu ON pu.id = r.pending_reply_user_id
      `+where+`
      ORDER BY r.review_created_at DESC
      LIMIT 100`, args...)
	if err != nil {
		return err
	}
	summary, err := kit.QueryOne(ctx, h.db, `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'baru')::int AS belum_dibalas,
            COUNT(*) FILTER (WHERE is_complaint AND status = 'baru')::int AS komplain_terbuka,
            COUNT(*) FILTER (WHERE reply_approval_status = 'pending_approval')::int
              AS menunggu_persetujuan,
            AVG(star_rating)::numeric(3,2) AS rata_rating,
            AVG(first_reply_seconds) FILTER (WHERE first_reply_seconds IS NOT NULL)
              AS rata_waktu_balas
       FROM crm.google_reviews`)
	if err != nil {
		return err
	}
	locations, err := kit.Query(ctx, h.db, `SELECT location_id, COUNT(*)::int AS total
       FROM crm.google_reviews
      WHERE location_id IS NOT NULL
      GROUP BY location_id
      ORDER BY location_id`)
	if err != nil {
		return err
	}
	// The SLA is evaluated on read so a settings change shows at once.
	now := h.now()
	for _, row := range reviews {
		created, _ := row.Time("review_created_at")
		var replied *time.Time
		if t, ok := row.Time("reply_updated_at"); ok {
			replied = &t
		}
		sla := domain.EvaluateReviewSLA(created, settings.SLAReplyMinutes, replied, now)
		row.Set("sla_breached", sla.Breached)
		row.Set("waiting_seconds", sla.WaitingSeconds)
	}
	configured, locationIDs := h.Google.Status(ctx, h.db)
	if locationIDs == nil {
		locationIDs = []string{}
	}
	type integration struct {
		Configured  bool     `json:"configured"`
		LocationIDs []string `json:"locationIds"`
	}
	type viewer struct {
		CanApprove bool `json:"canApprove"`
	}
	return kit.OK(w, struct {
		Reviews     []*kit.Row     `json:"reviews"`
		Summary     *kit.Row       `json:"summary"`
		Locations   []*kit.Row     `json:"locations"`
		Settings    reviewSettings `json:"settings"`
		Integration integration    `json:"integration"`
		Viewer      viewer         `json:"viewer"`
	}{reviews, summary, locations, settings, integration{configured, locationIDs}, viewer{canApproveReplies(user.Role)}})
}

// reviewAction is one member of reviewActionSchema.
type reviewAction struct {
	action, id, comment string
}

func parseReviewAction(body any) (reviewAction, bool) {
	f := validate.New(body, true)
	a := reviewAction{}
	action := f.Enum("action", validate.Rule{}, []string{"reply", "approve_reply", "reject_reply", "ignore", "sync"})
	if !f.Valid() {
		return a, false
	}
	a.action = *action
	if a.action == "sync" {
		return a, true
	}
	if id := f.UUID("id", validate.Rule{}); id != nil {
		a.id = *id
	}
	if a.action == "reply" {
		if c := f.Str("comment", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 4000}); c != nil {
			a.comment = *c
		}
	}
	return a, f.Valid()
}

func (h *handler) reviewAction(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.Require(r, kit.GateInbox)
	if err != nil {
		return err
	}
	body, err := kit.ReadJSON(r)
	if err != nil {
		return err
	}
	payload, ok := parseReviewAction(body)
	if !ok {
		return httpx.BadRequest("Payload tidak valid")
	}
	ctx := r.Context()
	canApprove := canApproveReplies(user.Role)
	switch payload.action {
	case "sync":
		return h.syncReviews(w, ctx)
	case "ignore":
		if _, err := h.db.Exec(ctx, `UPDATE crm.google_reviews SET status = 'diabaikan' WHERE id = $1`, payload.id); err != nil {
			return err
		}
	case "approve_reply", "reject_reply":
		if !canApprove {
			return httpx.Forbidden("Hanya admin/super admin yang boleh menyetujui balasan")
		}
		if payload.action == "approve_reply" {
			err = h.approveReply(ctx, payload.id, user.ID)
		} else {
			err = h.rejectReply(ctx, payload.id, user.ID)
		}
		if err != nil {
			return err
		}
	case "reply":
		pending, err := h.submitReply(ctx, payload.id, payload.comment, user.ID, canApprove)
		if err != nil {
			return err
		}
		return kit.OK(w, struct {
			Pending bool `json:"pending"`
		}{pending})
	}
	return kit.Success(w)
}

const noPendingReply = "Tidak ada balasan yang menunggu persetujuan"

// googleReplyError maps a refused Google call: 409 when the integration is
// not configured, else 502 with Google's reason.
func googleReplyError(res GoogleReply) error {
	if res.NotConfigured {
		return httpx.Conflict(res.Reason)
	}
	return httpx.Status(http.StatusBadGateway, res.Reason)
}

// submitReply mirrors submitReply: a non-approver's reply to a review rated
// <= 2 is stored as a draft awaiting approval; otherwise it is sent to
// Google first and recorded only once Google accepted it.
func (h *handler) submitReply(ctx context.Context, reviewID, comment, userID string, canApprove bool) (bool, error) {
	var rating int32
	err := h.db.QueryRow(ctx, `SELECT star_rating FROM crm.google_reviews WHERE id = $1`, reviewID).Scan(&rating)
	if database.IsNoRows(err) {
		return false, httpx.NotFound("Ulasan tidak ditemukan")
	}
	if err != nil {
		return false, err
	}
	if domain.NeedsReplyApproval(int(rating), canApprove, domain.ReplyApprovalMaxRating) {
		_, err := h.db.Exec(ctx, `UPDATE crm.google_reviews
        SET pending_reply_comment = $2,
            pending_reply_user_id = $3,
            pending_reply_at = now(),
            reply_approval_status = 'pending_approval'
      WHERE id = $1`, reviewID, comment, userID)
		return true, err
	}
	var name string
	err = h.db.QueryRow(ctx, `SELECT review_name FROM crm.google_reviews WHERE id = $1`, reviewID).Scan(&name)
	if database.IsNoRows(err) {
		return false, httpx.NotFound("Ulasan tidak ditemukan")
	}
	if err != nil {
		return false, err
	}
	if sent := h.Google.PutReply(ctx, h.db, name, comment); !sent.OK {
		return false, googleReplyError(sent)
	}
	_, err = h.db.Exec(ctx, `UPDATE crm.google_reviews
        SET reply_comment = $2,
            reply_updated_at = now(),
            replied_by_user_id = $3,
            status = 'dibalas',
            sla_breached = false,
            pending_reply_comment = NULL,
            reply_approval_status = NULL,
            first_reply_seconds = COALESCE(
              first_reply_seconds,
              GREATEST(0, EXTRACT(EPOCH FROM (now() - review_created_at))::int)
            )
      WHERE id = $1`, reviewID, comment, userID)
	return false, err
}

// approveReply sends the pending draft to Google, then records it as the
// official reply under the draft's author.
func (h *handler) approveReply(ctx context.Context, reviewID, approverID string) error {
	var name string
	var draft *string
	err := h.db.QueryRow(ctx, `SELECT review_name, pending_reply_comment
       FROM crm.google_reviews
      WHERE id = $1 AND reply_approval_status = 'pending_approval'`, reviewID).Scan(&name, &draft)
	if database.IsNoRows(err) || (err == nil && (draft == nil || *draft == "")) {
		return httpx.NotFound(noPendingReply)
	}
	if err != nil {
		return err
	}
	if sent := h.Google.PutReply(ctx, h.db, name, *draft); !sent.OK {
		return googleReplyError(sent)
	}
	_, err = h.db.Exec(ctx, `UPDATE crm.google_reviews
        SET reply_comment = pending_reply_comment,
            reply_updated_at = now(),
            replied_by_user_id = COALESCE(pending_reply_user_id, replied_by_user_id),
            status = 'dibalas',
            sla_breached = false,
            first_reply_seconds = COALESCE(
              first_reply_seconds,
              GREATEST(0, EXTRACT(EPOCH FROM (now() - review_created_at))::int)
            ),
            reply_approval_status = 'approved',
            reply_approved_by_user_id = $2,
            reply_approved_at = now(),
            pending_reply_comment = NULL
      WHERE id = $1`, reviewID, approverID)
	return err
}

// rejectReply keeps the draft text so the agent can revise it.
func (h *handler) rejectReply(ctx context.Context, reviewID, approverID string) error {
	tag, err := h.db.Exec(ctx, `UPDATE crm.google_reviews
        SET reply_approval_status = 'rejected',
            reply_approved_by_user_id = $2,
            reply_approved_at = now()
      WHERE id = $1 AND reply_approval_status = 'pending_approval'`, reviewID, approverID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound(noPendingReply)
	}
	return nil
}

// syncSummary is SyncSummary without its error fields.
type syncSummary struct {
	Fetched  int `json:"fetched"`
	Inserted int `json:"inserted"`
	Updated  int `json:"updated"`
	Skipped  int `json:"skipped"`
}

func syncError(w http.ResponseWriter, reason string, notConfigured bool) error {
	status := http.StatusBadGateway
	if notConfigured {
		status = http.StatusConflict
	}
	return httpx.JSON(w, status, struct {
		Success       bool   `json:"success"`
		Error         string `json:"error"`
		NotConfigured bool   `json:"notConfigured,omitempty"`
	}{false, reason, notConfigured})
}

// syncReviews mirrors syncGoogleReviews: upsert every review idempotently
// on review_id without overwriting our own work status; a new review
// rated <= 2 pings the owner once.
func (h *handler) syncReviews(w http.ResponseWriter, ctx context.Context) error {
	settings, err := loadReviewSettings(ctx, h.db)
	if err != nil {
		return err
	}
	if !settings.SyncEnabled {
		return syncError(w, "Sinkronisasi dinonaktifkan", false)
	}
	fetched := h.Google.FetchReviews(ctx, h.db)
	if !fetched.OK {
		return syncError(w, fetched.Reason, fetched.NotConfigured)
	}
	out := syncSummary{Fetched: len(fetched.Reviews)}
	for _, raw := range fetched.Reviews {
		var resource domain.ReviewResource
		var review *domain.Review
		if json.Unmarshal(raw, &resource) == nil {
			review = domain.NormalizeReview(resource)
		}
		if review == nil {
			out.Skipped++
			continue
		}
		inserted, err := upsertReview(ctx, h.db, review, float64(review.StarRating) <= settings.ComplaintMaxRating)
		if err != nil {
			out.Skipped++
			h.log.Error("[google-reviews] Gagal menyimpan ulasan", "error", errorMessage(err))
			continue
		}
		if !inserted {
			out.Updated++
			continue
		}
		out.Inserted++
		if review.StarRating <= 2 {
			h.Notifier.Fire("reviewRendah", review.ReviewID, domain.ReviewRendahMessage(review.ReviewerName, review.StarRating, review.Comment))
		}
	}
	return kit.OK(w, out)
}

// upsertReview stores one review in its own savepoint so a bad row only
// skips itself; it reports whether the row was new.
func upsertReview(ctx context.Context, db database.DB, rv *domain.Review, complaint bool) (bool, error) {
	var inserted bool
	err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `INSERT INTO crm.google_reviews
       (review_id, review_name, location_id, reviewer_name, reviewer_photo_url, star_rating, comment,
        review_created_at, review_updated_at, reply_comment, reply_updated_at,
        status, is_complaint, synced_at)
     VALUES ($11, $1, $12, $2, $3, $4, $5, $6, $7, $8, $9,
             CASE WHEN $8::text IS NOT NULL THEN 'dibalas' ELSE 'baru' END, $10, now())
     ON CONFLICT (review_id) DO UPDATE SET
       review_name = EXCLUDED.review_name,
       location_id = COALESCE(EXCLUDED.location_id, crm.google_reviews.location_id),
       reviewer_name = EXCLUDED.reviewer_name,
       reviewer_photo_url = EXCLUDED.reviewer_photo_url,
       star_rating = EXCLUDED.star_rating,
       comment = EXCLUDED.comment,
       review_updated_at = EXCLUDED.review_updated_at,
       is_complaint = EXCLUDED.is_complaint,
       reply_comment = COALESCE(crm.google_reviews.reply_comment, EXCLUDED.reply_comment),
       reply_updated_at = COALESCE(crm.google_reviews.reply_updated_at, EXCLUDED.reply_updated_at),
       status = CASE
         WHEN crm.google_reviews.status = 'diabaikan' THEN 'diabaikan'
         WHEN COALESCE(crm.google_reviews.reply_comment, EXCLUDED.reply_comment) IS NOT NULL
           THEN 'dibalas'
         ELSE 'baru'
       END,
       synced_at = now()
     RETURNING (xmax = 0) AS inserted`,
			rv.ReviewName, rv.ReviewerName, rv.ReviewerPhotoURL, rv.StarRating, rv.Comment,
			rv.CreatedAt, rv.UpdatedAt, rv.ReplyComment, rv.ReplyUpdatedAt, complaint,
			rv.ReviewID, rv.LocationID).Scan(&inserted)
	})
	return inserted, err
}
