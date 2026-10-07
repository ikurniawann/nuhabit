package marketing

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"math/big"
	"slices"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/marketing/domain"
	"nuhabit/backend/internal/platform/database"
)

// samePhoneSQL compares two phone columns in 62xxx form: opt-outs are stored
// normalized (628...) while pos_customers keeps 08..., so raw digits never
// match.
func samePhoneSQL(a, b string) string {
	norm := func(col string) string {
		return `regexp_replace(regexp_replace(` + col + `, '\D', '', 'g'), '^0', '62')`
	}
	return norm(a) + " = " + norm(b)
}

// segmentIDParam is how node-postgres would send `body.segment_id ?? null`
// to `WHERE id = $1`: falsy values mean "no saved segment"; anything else
// becomes text (a non-uuid then fails in PostgreSQL with 22P02).
func segmentIDParam(v any) (string, bool) {
	switch x := v.(type) {
	case nil:
		return "", false
	case string:
		return x, x != ""
	case bool:
		return "true", x
	case json.Number, float64:
		f := domain.JSNumber(x)
		return domain.JSString(x), f != 0
	}
	b, _ := kit.MarshalNoEscape(v)
	return string(b), true
}

// resolveCampaignFilter mirrors resolveCampaignFilter: a saved member
// segment's filter when segmentID names an active one, else the inline
// segment (never silently the whole customer base).
func (h *handler) resolveCampaignFilter(ctx context.Context, q database.Querier, seg domain.CampaignSegment, startIndex int, segmentID any) (string, []any, error) {
	id, ok := segmentIDParam(segmentID)
	if !ok {
		where, params := domain.BuildSegmentFilter(seg, startIndex)
		return where, params, nil
	}
	var source string
	var raw []byte
	err := q.QueryRow(ctx, `SELECT source, definition FROM crm.crm_segments
     WHERE id = $1::text::uuid AND deleted_at IS NULL AND is_active`, id).Scan(&source, &raw)
	if err != nil && !database.IsNoRows(err) {
		return "", nil, err
	}
	if err != nil || source != "member" {
		where, params := domain.BuildSegmentFilter(seg, startIndex)
		return where, params, nil
	}
	def, err := kit.DecodeLoose(raw)
	if err != nil {
		return "", nil, err
	}
	where, params := domain.BuildSegmentWhere(parseStoredSegment("member", def), "c", startIndex, nil)
	// The minimal number guard of the inline path stays.
	return where + " AND length(trim(c.phone)) >= 8", params, nil
}

type startResult struct {
	inserted int
	inApp    int
	status   string
}

type recipient struct{ id, customerID string }

// startCampaign mirrors startCampaign: build the queue, deliver the in-app
// channel at once and leave WA to the watcher. A campaign without WA is done
// immediately and its queue is marked skipped so the watcher never sends.
func (h *handler) startCampaign(ctx context.Context, tx pgx.Tx, c *campaign) (startResult, error) {
	var seg any
	if len(c.Segment) > 0 {
		var err error
		if seg, err = kit.DecodeLoose(c.Segment); err != nil {
			return startResult{}, err
		}
	}
	where, params, err := h.resolveCampaignFilter(ctx, tx, domain.NormalizeSegment(seg), 4, nilIfEmpty(c.SegmentID))
	if err != nil {
		return startResult{}, err
	}
	rows, err := querySimple(ctx, tx, `INSERT INTO crm.crm_campaign_recipients
       (company_id, branch_id, campaign_id, customer_id, name, phone)
     SELECT $1, $2, $3, c.id, c.name,
            regexp_replace(c.phone, '\D', '', 'g')
     FROM pos.pos_customers c
     LEFT JOIN crm.crm_marketing_optouts o
       ON o.branch_id = $2
      AND `+samePhoneSQL("o.phone", "c.phone")+`
     WHERE `+where+` AND o.id IS NULL
     ON CONFLICT (campaign_id, customer_id) DO NOTHING
     RETURNING id, customer_id`, append([]any{c.CompanyID, c.BranchID, c.ID}, params...))
	if err != nil {
		return startResult{}, err
	}
	inserted := make([]recipient, len(rows))
	for i, row := range rows {
		inserted[i] = recipient{row.Str("id"), row.Str("customer_id")}
	}
	if c.PromoMode != nil && *c.PromoMode == "batch" && c.PromoCampaignID != nil && c.VoucherPrefix != nil && len(inserted) > 0 {
		if err := h.assignVouchers(ctx, tx, c, inserted); err != nil {
			return startResult{}, err
		}
	}
	channels := domain.NormalizeChannels(c.Channels)
	res := startResult{inserted: len(inserted), status: "sending"}
	if slices.Contains(channels, "in_app") {
		if res.inApp, err = deliverInApp(ctx, tx, c); err != nil {
			return startResult{}, err
		}
	}
	if !slices.Contains(channels, "wa") {
		res.status = "done"
		if _, err := tx.Exec(ctx, `UPDATE crm.crm_campaign_recipients SET status = 'skipped', fail_reason = 'kanal-wa-mati'
        WHERE campaign_id = $1 AND status = 'pending'`, c.ID); err != nil {
			return startResult{}, err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE crm.crm_campaigns
        SET status = $2, recipients_built = true, failure_reason = NULL,
            started_at = COALESCE(started_at, now()), updated_at = now()
      WHERE id = $1`, c.ID, res.status)
	return res, err
}

func nilIfEmpty(s *string) any {
	if s == nil || *s == "" {
		return nil
	}
	return *s
}

// assignVouchers gives every new recipient a single-use code in the promo
// engine inside the same transaction; a collision is retried 5 times.
func (h *handler) assignVouchers(ctx context.Context, tx pgx.Tx, c *campaign, recipients []recipient) error {
	for _, rc := range recipients {
		assigned := false
		for attempt := 0; attempt < 5 && !assigned; attempt++ {
			code, err := voucherCode(*c.VoucherPrefix)
			if err != nil {
				return err
			}
			if assigned, err = h.p.Promo.IssueCode(ctx, tx, c.CompanyID, c.BranchID, *c.PromoCampaignID, code); err != nil {
				return err
			}
			if assigned {
				if _, err := tx.Exec(ctx, `UPDATE crm.crm_campaign_recipients SET voucher_code = $2 WHERE id = $1`, rc.id, code); err != nil {
					return err
				}
			}
		}
		if !assigned {
			return errors.New("Gagal membuat kode voucher unik — coba prefix lain")
		}
	}
	return nil
}

// voucherCharset avoids look-alike characters (generateVoucherCode).
const voucherCharset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// voucherCode mirrors generateVoucherCode: PREFIX-XXXXXX from crypto/rand,
// since a voucher is a bearer secret.
func voucherCode(prefix string) (string, error) {
	suffix := make([]byte, 6)
	for i := range suffix {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(voucherCharset))))
		if err != nil {
			return "", err
		}
		suffix[i] = voucherCharset[n.Int64()]
	}
	return prefix + "-" + string(suffix), nil
}

// deliverInApp copies the campaign into each recipient's portal inbox.
// Idempotent through the (campaign_id, customer_id) unique index.
func deliverInApp(ctx context.Context, tx pgx.Tx, c *campaign) (int, error) {
	rows, err := tx.Query(ctx, `SELECT customer_id::text, name, voucher_code FROM crm.crm_campaign_recipients WHERE campaign_id = $1`, c.ID)
	if err != nil {
		return 0, err
	}
	var ids, bodies []string
	for rows.Next() {
		var id, name string
		var code *string
		if err := rows.Scan(&id, &name, &code); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
		bodies = append(bodies, domain.RenderInAppBody(c.MessageTemplate, name, code))
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(ids) == 0 {
		return 0, err
	}
	title := c.Name
	if c.InappTitle != nil && *c.InappTitle != "" {
		title = *c.InappTitle
	}
	tag, err := tx.Exec(ctx, `INSERT INTO crm.member_notifications
       (customer_id, type, title, body, image_url, link_url, campaign_id)
     SELECT t.customer_id, 'campaign', $3, t.body, $4, $5, $1
       FROM unnest($2::uuid[], $6::text[]) AS t(customer_id, body)
     ON CONFLICT (campaign_id, customer_id) WHERE campaign_id IS NOT NULL DO NOTHING`,
		c.ID, ids, title, c.ImageURL, c.LinkURL, bodies)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}
