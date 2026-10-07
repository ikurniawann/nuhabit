package engagement

import (
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/engagement/domain"
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

var (
	looseUUID = regexp.MustCompile(`^(?i)[0-9a-f-]{36}$`)
	isoDate   = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

// clauses builds a WHERE list with numbered parameters.
type clauses struct {
	where  []string
	params []any
}

func (c *clauses) add(clause func(p string) string, value any) {
	c.params = append(c.params, value)
	c.where = append(c.where, clause("$"+strconv.Itoa(len(c.params))))
}

func (c clauses) sql(extra ...string) string {
	all := append(slices.Clone(c.where), extra...)
	if len(all) == 0 {
		return ""
	}
	return "WHERE " + strings.Join(all, " AND ")
}

const reviewFrom = `FROM crm.member_reviews r
    JOIN pos.pos_customers c ON c.id = r.customer_id
    LEFT JOIN configuration.branches b ON b.id = r.branch_id`

// listReviews mirrors listMemberReviews. The summary uses the outlet, date
// and search filters only, so status and star filters do not move the
// average. Unvalidated ids reach PostgreSQL as text, as node-postgres sends
// them, so a malformed one is a 400.
func (h *handler) listReviews(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateMemberReviews); err != nil {
		return err
	}
	sp := r.URL.Query()
	var base clauses
	if id := sp.Get("branch_id"); looseUUID.MatchString(id) {
		base.add(func(p string) string { return "r.branch_id = " + p + "::text::uuid" }, id)
	}
	if from := sp.Get("from"); isoDate.MatchString(from) {
		base.add(func(p string) string {
			return "(r.created_at AT TIME ZONE 'Asia/Jakarta')::date >= " + p + "::text::date"
		}, from)
	}
	if to := sp.Get("to"); isoDate.MatchString(to) {
		base.add(func(p string) string {
			return "(r.created_at AT TIME ZONE 'Asia/Jakarta')::date <= " + p + "::text::date"
		}, to)
	}
	if q := strings.TrimSpace(sp.Get("q")); q != "" {
		base.add(func(p string) string {
			return "(c.name ILIKE " + p + " OR c.phone ILIKE " + p + " OR r.comment ILIKE " + p + ")"
		}, "%"+q+"%")
	}
	list := clauses{where: slices.Clone(base.where), params: slices.Clone(base.params)}
	if status := sp.Get("status"); slices.Contains([]string{"new", "replied", "hidden"}, status) {
		list.add(func(p string) string { return "r.status = " + p }, status)
	}
	if rating := kit.ToNumber(sp.Get("rating")); rating == float64(int(rating)) && rating >= 1 && rating <= 5 {
		list.add(func(p string) string { return "r.rating = " + p }, int(rating))
	}

	ctx := r.Context()
	// order_number and order_total come from POS through OrderReads; the
	// placeholders keep the TS column order.
	reviews, err := kit.Query(ctx, h.db, `SELECT r.id, r.order_id, NULL::text AS order_number, NULL::float8 AS order_total,
              r.rating, r.comment, r.status, r.reply, r.replied_at, r.created_at,
              c.id AS customer_id, c.name AS member_name, c.phone AS member_phone,
              r.branch_id, b.name AS outlet_name, u.full_name AS replied_by_name
         `+reviewFrom+`
         LEFT JOIN configuration.users u ON u.id = r.replied_by
         `+list.sql()+`
        ORDER BY r.created_at DESC
        LIMIT 200`, list.params...)
	if err != nil {
		return err
	}
	if err := h.attachOrders(r, reviews); err != nil {
		return err
	}
	rows, err := h.db.Query(ctx, `SELECT r.branch_id::text, b.name AS branch_name, r.rating::float8, count(*)::float8 AS n
         `+reviewFrom+`
         `+base.sql("r.status <> 'hidden'")+`
        GROUP BY r.branch_id, b.name, r.rating`, base.params...)
	if err != nil {
		return err
	}
	counts, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.RatingCount, error) {
		var c domain.RatingCount
		err := row.Scan(&c.BranchID, &c.BranchName, &c.Rating, &c.N)
		return c, err
	})
	if err != nil {
		return err
	}
	outlets, err := kit.Query(ctx, h.db, `SELECT DISTINCT b.id, b.name FROM crm.member_reviews r
         JOIN configuration.branches b ON b.id = r.branch_id ORDER BY b.name`)
	if err != nil {
		return err
	}
	return kit.OK(w, struct {
		Reviews []*kit.Row           `json:"reviews"`
		Summary domain.ReviewSummary `json:"summary"`
		Outlets []*kit.Row           `json:"outlets"`
	}{reviews, domain.SummarizeReviews(counts), outlets})
}

func (h *handler) attachOrders(r *http.Request, reviews []*kit.Row) error {
	if len(reviews) == 0 {
		return nil
	}
	ids := make([]string, len(reviews))
	for i, rv := range reviews {
		ids[i] = rv.Str("order_id")
	}
	orders, err := h.orders.OrderSummaries(r.Context(), h.db, ids)
	if err != nil {
		return err
	}
	for _, rv := range reviews {
		o := orders[rv.Str("order_id")]
		if o.Number != nil {
			rv.Set("order_number", *o.Number)
		}
		if o.Total != nil {
			rv.Set("order_total", *o.Total)
		}
	}
	return nil
}

// reviewPatch is memberReviewPatchSchema parsed: exactly one of the two.
type reviewPatch struct {
	reply  *string
	status string
}

// unionIssue is zod's invalid_union issue.
type unionIssue struct {
	Code    string             `json:"code"`
	Errors  [][]validate.Issue `json:"errors"`
	Path    []any              `json:"path"`
	Message string             `json:"message"`
}

// aborted mirrors zod's util.aborted: an issue other than a failed check.
func aborted(issues []validate.Issue) bool {
	return slices.ContainsFunc(issues, func(is validate.Issue) bool {
		return is.Code == "invalid_type" || is.Code == "invalid_value"
	})
}

// parseReviewPatch mirrors z.union([{reply}, {status}]) under
// parseCrmInput: the first option that parses wins; when both fail and
// exactly one did not abort, its issues are reported, else invalid_union.
func parseReviewPatch(body any) (*reviewPatch, error) {
	replyForm := validate.New(body, true)
	reply := replyForm.Str("reply", required, validate.StrOpts{Trim: true, Min: 2, Max: domain.ReviewReplyMax})
	if replyForm.Valid() {
		return &reviewPatch{reply: reply}, nil
	}
	statusForm := validate.New(body, true)
	status := statusForm.Enum("status", required, []string{"hidden", "visible"})
	if statusForm.Valid() {
		return &reviewPatch{status: *status}, nil
	}
	replyIssues := replyMinMessage(replyForm.Issues())
	switch a, b := aborted(replyIssues), aborted(statusForm.Issues()); {
	case !a && b:
		return nil, httpx.BadRequest("Data tidak valid", replyIssues)
	case a && !b:
		return nil, httpx.BadRequest("Data tidak valid", statusForm.Issues())
	}
	return nil, httpx.BadRequest("Data tidak valid", []unionIssue{{
		Code: "invalid_union", Errors: [][]validate.Issue{replyIssues, statusForm.Issues()}, Path: []any{}, Message: "Invalid input",
	}})
}

// replyMinMessage applies the schema's custom min(2) message.
func replyMinMessage(issues []validate.Issue) []validate.Issue {
	out := slices.Clone(issues)
	for i, is := range out {
		if is.Code == "too_small" {
			out[i].Message = "Balasan minimal 2 karakter"
		}
	}
	return out
}

type reviewState struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// updateReview replies to a review (the member is notified) or hides /
// shows it again; showing restores replied or new.
func (h *handler) updateReview(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.Require(r, kit.GateMemberReviews)
	if err != nil {
		return err
	}
	body, err := kit.ReadJSON(r)
	if err != nil {
		return err
	}
	patch, err := parseReviewPatch(body)
	if err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("id")
	var out *reviewState
	var sent notifications
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		var row reviewState
		var err error
		if patch.reply != nil {
			var customerID string
			err = tx.QueryRow(ctx, `UPDATE crm.member_reviews
            SET reply = $2, replied_at = now(), replied_by = $3, status = 'replied', updated_at = now()
          WHERE id = $1::text::uuid RETURNING id::text, customer_id::text, status`,
				id, domain.CleanReviewText(*patch.reply, domain.ReviewReplyMax), user.ID).Scan(&row.ID, &customerID, &row.Status)
			if err == nil {
				err = sent.notify(ctx, tx, customerID, domain.PushMessage{Type: "review_reply", Title: "Ulasan Anda dibalas",
					Body: "Tim kami membalas ulasan Anda. Lihat di menu Ulasan."})
			}
		} else {
			err = tx.QueryRow(ctx, `UPDATE crm.member_reviews
          SET status = CASE WHEN $2 = 'hidden' THEN 'hidden'
                            WHEN reply IS NOT NULL THEN 'replied' ELSE 'new' END,
              updated_at = now()
        WHERE id = $1::text::uuid RETURNING id::text, status`, id, patch.status).Scan(&row.ID, &row.Status)
		}
		if database.IsNoRows(err) {
			return nil
		}
		if err == nil {
			out = &row
		}
		return err
	})
	if err != nil {
		return err
	}
	if out == nil {
		return httpx.NotFound("Ulasan tidak ditemukan")
	}
	h.send(sent)
	return kit.OK(w, out)
}
