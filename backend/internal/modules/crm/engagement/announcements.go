package engagement

import (
	"net/http"
	"regexp"
	"strconv"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/engagement/domain"
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/validate"
)

// listAnnouncements is the announcement history, newest first, with the
// number of members who read it.
func (h *handler) listAnnouncements(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateEngagement); err != nil {
		return err
	}
	rows, err := kit.Query(r.Context(), h.db, `SELECT a.id, a.title, a.body, a.kind, a.audience, a.recipient_count, a.sent_at, a.image_url, a.link_url,
            (SELECT count(*)::int FROM crm.member_notifications n
              WHERE n.announcement_id = a.id AND n.read_at IS NOT NULL) AS read_count
       FROM crm.member_announcements a ORDER BY a.sent_at DESC NULLS LAST LIMIT 100`)
	if err != nil {
		return err
	}
	return kit.OK(w, rows)
}

var imageURLRe = regexp.MustCompile(`^(/api/files/|https://)`)

func imageURLCheck(s string) (string, string, bool) {
	return "invalid_format", "URL gambar tidak valid", imageURLRe.MatchString(s)
}

func portalLinkCheck(s string) (string, string, bool) {
	return "custom", "Tujuan portal tidak dikenal", domain.IsPortalLink(s)
}

// announcementInput is announcementSchema parsed; audienceJSON holds only
// the audience keys the client sent, as zod outputs them.
type announcementInput struct {
	title, body, kind string
	audience          domain.Audience
	audienceJSON      *kit.Row
	imageURL, linkURL *string
	preview           bool
}

func parseAnnouncement(f *validate.Form) announcementInput {
	var in announcementInput
	title := f.Str("title", required, validate.StrOpts{Trim: true, Min: 3, Max: 120})
	body := f.Str("body", required, validate.StrOpts{Trim: true, Min: 3, Max: 1000})
	kind := f.Enum("kind", required, []string{"announcement", "promo"})
	aud := f.Child("audience")
	in.audienceJSON = kit.NewRow()
	if codes := aud.Strings("tier_codes", optional, 20, validate.StrOpts{Min: 1, Max: 40}); codes != nil {
		in.audience.TierCodes = codes
		in.audienceJSON.Set("tier_codes", codes)
	}
	if v := aud.Int("min_visits", optional, bounds(0, 10_000)); v != nil {
		in.audience.MinVisits = v
		in.audienceJSON.Set("min_visits", *v)
	}
	if v := aud.Int("inactive_days", optional, bounds(0, 3_650)); v != nil {
		in.audience.InactiveDays = v
		in.audienceJSON.Set("inactive_days", *v)
	}
	in.imageURL = f.Str("image_url", nullOpt, validate.StrOpts{Trim: true, Max: 500, Check: imageURLCheck})
	in.linkURL = f.Str("link_url", nullOpt, validate.StrOpts{Trim: true, Max: 60, Check: portalLinkCheck})
	in.preview = ptrTrue(f.Bool("preview", optional))
	if title != nil && body != nil && kind != nil {
		in.title, in.body, in.kind = *title, *body, *kind
	}
	return in
}

func ptrTrue(b *bool) bool { return b != nil && *b }

// emptyToNil is `value || null` for an optional string.
func emptyToNil(s *string) *string {
	if s == nil || *s == "" {
		return nil
	}
	return s
}

// sendAnnouncement stores the announcement and copies it into the inbox of
// every member in the audience, or with preview only counts them. Pushes go
// out after the commit.
func (h *handler) sendAnnouncement(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.Require(r, kit.GateEngagement)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	in := parseAnnouncement(f)
	if err := kit.CrmInputErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	where, params := domain.AudienceWhere(in.audience)
	if in.preview {
		var n int
		if err := h.db.QueryRow(ctx, `SELECT count(*)::int AS n FROM pos.pos_customers c WHERE `+where, params...).Scan(&n); err != nil {
			return err
		}
		return kit.OK(w, struct {
			Recipients int `json:"recipients"`
		}{n})
	}
	imageURL, linkURL := emptyToNil(in.imageURL), emptyToNil(in.linkURL)
	audience, err := kit.MarshalNoEscape(in.audienceJSON)
	if err != nil {
		return err
	}
	var result struct {
		ID         string `json:"id"`
		Recipients int64  `json:"recipients"`
	}
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO crm.member_announcements (title, body, kind, audience, created_by, sent_at, image_url, link_url)
       VALUES ($1, $2, $3, $4::text::jsonb, $5, now(), $6, $7) RETURNING id::text`,
			in.title, in.body, in.kind, string(audience), user.ID, imageURL, linkURL).Scan(&result.ID); err != nil {
			return err
		}
		ph := func(i int) string { return "$" + strconv.Itoa(len(params)+i) }
		tag, err := tx.Exec(ctx, `INSERT INTO crm.member_notifications (customer_id, type, title, body, announcement_id, image_url, link_url)
       SELECT c.id, `+ph(1)+`, `+ph(2)+`, `+ph(3)+`, `+ph(4)+`::uuid, `+ph(5)+`, `+ph(6)+`
         FROM pos.pos_customers c WHERE `+where,
			append(params, in.kind, in.title, in.body, result.ID, imageURL, linkURL)...)
		if err != nil {
			return err
		}
		result.Recipients = tag.RowsAffected()
		_, err = tx.Exec(ctx, `UPDATE crm.member_announcements SET recipient_count = $1 WHERE id = $2`, result.Recipients, result.ID)
		return err
	})
	if err != nil {
		return err
	}
	if h.push != nil {
		msg := domain.PushMessage{Type: in.kind, Title: in.title, Body: in.body}
		if linkURL != nil {
			msg.Link = *linkURL
		}
		h.push.SendAnnouncement(result.ID, msg)
	}
	return kit.OK(w, result)
}

// checkinLog is the last 200 QR scans (accepted or denied) plus today's
// (WIB) summary.
func (h *handler) checkinLog(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateEngagement); err != nil {
		return err
	}
	ctx := r.Context()
	checkins, err := kit.Query(ctx, h.db, `SELECT k.id, k.decision, k.reason, k.created_at, c.name AS member_name, c.phone AS member_phone,
              u.full_name AS cashier_name
         FROM crm.member_checkins k
         LEFT JOIN pos.pos_customers c ON c.id = k.customer_id
         LEFT JOIN configuration.users u ON u.id = k.scanned_by
        ORDER BY k.created_at DESC LIMIT 200`)
	if err != nil {
		return err
	}
	today, err := kit.QueryOne(ctx, h.db, `SELECT count(*) FILTER (WHERE decision = 'accepted')::int AS accepted,
              count(*) FILTER (WHERE decision = 'denied')::int AS denied,
              count(DISTINCT customer_id) FILTER (WHERE decision = 'accepted')::int AS members
         FROM crm.member_checkins
        WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'`)
	if err != nil {
		return err
	}
	return kit.OK(w, struct {
		Checkins []*kit.Row `json:"checkins"`
		Today    *kit.Row   `json:"today"`
	}{checkins, today})
}
