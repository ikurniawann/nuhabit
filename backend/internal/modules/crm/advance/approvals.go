package advance

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/advance/domain"
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/scope"
)

// The quotation discount approval flow of lib/crm/approvals-server.ts.

const inboxLimit = 200

// approvalInbox lists approval requests. view=mine (default): waiting on me
// at the current level, or requested by me; view=all (not for sales): every
// request in scope. status=pending (default)|approved|rejected|all.
func (h *handler) approvalInbox(w http.ResponseWriter, r *http.Request) error {
	u, err := h.auth.RequireMenuPrefix(r, iam.SalesFunnel...)
	if err != nil {
		return err
	}
	ctx := r.Context()
	s, err := scope.Load(ctx, h.db, u.ID)
	if err != nil {
		return err
	}
	query := r.URL.Query()
	view := "mine"
	if query.Get("view") == "all" && u.Role != "sales" {
		view = "all"
	}
	status := "pending"
	if v, ok := query["status"]; ok {
		status = v[0]
	}

	conds := []string{"r.object = 'quotation'"}
	args := []any{}
	if s.CompanyID != nil && *s.CompanyID != "" {
		args = append(args, *s.CompanyID)
		conds = append(conds, fmt.Sprintf("r.company_id = $%d", len(args)))
	}
	if status != "all" {
		args = append(args, status)
		conds = append(conds, fmt.Sprintf("r.status = $%d", len(args)))
	}
	args = append(args, u.ID, u.Role)
	userP, roleP := len(args)-1, len(args)
	waitingOnMe := fmt.Sprintf(`EXISTS (SELECT 1 FROM crm.crm_approval_steps s
                     WHERE s.request_id = r.id AND s.level = r.current_level AND s.status = 'pending'
                       AND (s.approver_user_id = $%d OR s.approver_role = $%d OR $%d = 'super_admin'))`, userP, roleP, roleP)
	if view == "mine" {
		conds = append(conds, fmt.Sprintf("(r.requested_by = $%d OR %s)", userP, waitingOnMe))
	}
	sql := `SELECT r.id, r.status, r.current_level, r.discount_percent, r.amount, r.note, r.created_at, r.resolved_at,
            r.subject_id AS quotation_id, u.full_name AS requested_by_name,
            (SELECT json_agg(json_build_object('level', s.level, 'status', s.status, 'approver_role', s.approver_role,
                                               'approver_user_id', s.approver_user_id, 'decided_at', s.decided_at,
                                               'comment', s.comment, 'decided_by_name', du.full_name) ORDER BY s.level)
               FROM crm.crm_approval_steps s LEFT JOIN configuration.users du ON du.id = s.decided_by
              WHERE s.request_id = r.id) AS steps,
            ` + waitingOnMe + ` AS can_decide
     FROM crm.crm_approval_requests r
     LEFT JOIN configuration.users u ON u.id = r.requested_by
     WHERE ` + strings.Join(conds, " AND ") + `
     ORDER BY (r.status = 'pending') DESC, r.created_at DESC, r.id`

	// The quotation, deal and lead columns come from the sales funnel; a
	// request whose quotation is gone drops out like the TS inner join, so
	// pages are read until 200 rows survive.
	out := []*kit.Row{}
	for offset := 0; len(out) < inboxLimit; offset += inboxLimit {
		reqs, err := kit.Query(ctx, h.db, fmt.Sprintf("%s LIMIT %d OFFSET %d", sql, inboxLimit, offset), args...)
		if err != nil {
			return err
		}
		ids := make([]string, len(reqs))
		for i, req := range reqs {
			ids[i] = req.Str("quotation_id")
		}
		quotes, err := h.ports.Sales.InboxQuotations(ctx, h.db, ids)
		if err != nil {
			return err
		}
		for _, req := range reqs {
			q, ok := quotes[req.Str("quotation_id")]
			if !ok || len(out) == inboxLimit {
				continue
			}
			row := kit.NewRow()
			for _, k := range []string{"id", "status", "current_level", "discount_percent", "amount", "note", "created_at", "resolved_at", "quotation_id"} {
				row.Set(k, req.Get(k))
			}
			for _, k := range []string{"quote_number", "total", "subtotal", "discount_nominal", "quotation_status", "deal_id", "deal_title", "org_name", "pic_name"} {
				row.Set(k, q.Get(k))
			}
			for _, k := range []string{"requested_by_name", "steps", "can_decide"} {
				row.Set(k, req.Get(k))
			}
			out = append(out, row)
		}
		if len(reqs) < inboxLimit {
			break
		}
	}
	return kit.OK(w, out)
}

type decisionResult struct {
	OK        bool   `json:"ok"`
	Status    string `json:"status"`
	NextLevel *int   `json:"next_level"`
}

// decideApproval records an approver's decision on the current level.
func (h *handler) decideApproval(w http.ResponseWriter, r *http.Request) error {
	u, err := h.auth.RequireUser(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	decision, comment := parseDecision(f)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	ctx := r.Context()
	var res decisionResult
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) (err error) {
		res, err = h.decide(ctx, tx, id, decision, comment, u)
		return err
	})
	if err != nil {
		return err
	}
	if res.NextLevel != nil {
		if err := h.notifyApprovers(ctx, id, *res.NextLevel); err != nil {
			h.log.Error("[crm-approval] notifikasi gagal", "error", err)
		}
	}
	if err := h.emitApprovalDecisionEvent(ctx, id, u.ID, res.Status, decision); err != nil {
		return err
	}
	msg := "Ditolak"
	switch res.Status {
	case "approved":
		msg = "Disetujui — quotation boleh dikirim"
	case "pending":
		msg = fmt.Sprintf("Disetujui tingkat ini — lanjut ke tingkat %d", *res.NextLevel)
	}
	return kit.OK(w, res, msg)
}

// decide mirrors decideApproval; the request row is locked so two approvers
// cannot decide the same level at once.
func (h *handler) decide(ctx context.Context, tx pgx.Tx, id, decision string, comment *string, u *auth.User) (decisionResult, error) {
	var req struct {
		status      string
		level       int
		subjectID   string
		requestedBy *string
	}
	err := tx.QueryRow(ctx, `SELECT status, current_level, subject_id::text, requested_by::text
       FROM crm.crm_approval_requests WHERE id = $1::text::uuid FOR UPDATE`, id).
		Scan(&req.status, &req.level, &req.subjectID, &req.requestedBy)
	if database.IsNoRows(err) {
		return decisionResult{}, httpx.NotFound("Permintaan approval tidak ditemukan")
	}
	if err != nil {
		return decisionResult{}, err
	}
	if req.status != "pending" {
		return decisionResult{}, httpx.Conflict("Permintaan sudah diputuskan")
	}
	var stepID string
	var role, userID *string
	err = tx.QueryRow(ctx, `SELECT id::text, approver_role, approver_user_id::text FROM crm.crm_approval_steps
       WHERE request_id = $1::text::uuid AND level = $2 AND status = 'pending'`, id, req.level).Scan(&stepID, &role, &userID)
	if database.IsNoRows(err) {
		return decisionResult{}, httpx.Conflict("Tingkat approval tidak ditemukan")
	}
	if err != nil {
		return decisionResult{}, err
	}
	if !domain.CanDecideStep(role, userID, u.ID, u.Role) {
		return decisionResult{}, httpx.Forbidden("Anda bukan approver tingkat ini")
	}
	stepStatus := "rejected"
	if decision == "approve" {
		stepStatus = "approved"
	}
	if _, err := tx.Exec(ctx, `UPDATE crm.crm_approval_steps SET status = $2, decided_by = $3, decided_at = now(), comment = $4 WHERE id = $1`,
		stepID, stepStatus, u.ID, comment); err != nil {
		return decisionResult{}, err
	}
	sales := h.ports.Sales
	quote, err := sales.QuotationLink(ctx, tx, req.subjectID)
	if err != nil {
		return decisionResult{}, err
	}
	var link *string
	quoteNumber := ""
	if quote != nil {
		l := "/dashboard/sales-funnel/pipeline?deal=" + quote.DealID
		link, quoteNumber = &l, quote.QuoteNumber
	}
	resolve := func(status, title, fallback string) (decisionResult, error) {
		if _, err := tx.Exec(ctx, `UPDATE crm.crm_approval_requests SET status = $2, resolved_at = now(), resolved_by = $3 WHERE id = $1::text::uuid`,
			id, status, u.ID); err != nil {
			return decisionResult{}, err
		}
		if err := sales.SetQuotationApprovalStatus(ctx, tx, req.subjectID, status); err != nil {
			return decisionResult{}, err
		}
		if req.requestedBy != nil {
			msg := fallback
			if comment != nil {
				msg = *comment
			}
			if _, err := h.notifyUsers(ctx, tx, []string{*req.requestedBy}, "Diskon "+quoteNumber+" "+title, msg, link,
				map[string]any{"request_id": id}); err != nil {
				return decisionResult{}, err
			}
		}
		return decisionResult{OK: true, Status: status}, nil
	}
	if decision == "reject" {
		return resolve("rejected", "DITOLAK", "Ditolak oleh approver")
	}
	var next int
	err = tx.QueryRow(ctx, `SELECT level FROM crm.crm_approval_steps WHERE request_id = $1::text::uuid AND status = 'pending' ORDER BY level LIMIT 1`, id).Scan(&next)
	if database.IsNoRows(err) {
		return resolve("approved", "DISETUJUI", "Quotation boleh dikirim")
	}
	if err != nil {
		return decisionResult{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE crm.crm_approval_requests SET current_level = $2 WHERE id = $1::text::uuid`, id, next); err != nil {
		return decisionResult{}, err
	}
	return decisionResult{OK: true, Status: "pending", NextLevel: &next}, nil
}

// notifyApprovers tells the approvers of a level (in-app, then WhatsApp
// through the gateway when configured).
func (h *handler) notifyApprovers(ctx context.Context, requestID string, level int) error {
	var companyID, subjectID, discount string
	var amount, requester *string
	err := h.db.QueryRow(ctx, `SELECT r.company_id::text, r.subject_id::text, r.discount_percent::text, r.amount::text, u.full_name
       FROM crm.crm_approval_requests r LEFT JOIN configuration.users u ON u.id = r.requested_by
       WHERE r.id = $1::text::uuid`, requestID).Scan(&companyID, &subjectID, &discount, &amount, &requester)
	if database.IsNoRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	subject, err := h.ports.Sales.ApprovalSubject(ctx, h.db, subjectID)
	if err != nil || subject == nil {
		return err
	}
	var role, userID *string
	err = h.db.QueryRow(ctx, `SELECT approver_role, approver_user_id::text FROM crm.crm_approval_steps WHERE request_id = $1::text::uuid AND level = $2`,
		requestID, level).Scan(&role, &userID)
	if database.IsNoRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var ids []string
	switch {
	case userID != nil:
		ids = []string{*userID}
	case role != nil:
		if ids, err = h.userIDs(ctx, h.db, `SELECT id::text FROM configuration.users
       WHERE role = $1 AND status = 'active' AND (company_id IS NULL OR company_id = $2)
       LIMIT 50`, *role, companyID); err != nil {
			return err
		}
	}
	pct := domain.FormatJSNumber(domain.JSNumber(discount))
	title := fmt.Sprintf("Approval diskon %s%% — %s", pct, subject.QuoteNumber)
	message := fmt.Sprintf("%s · %s · total %s", subject.OrgName, subject.DealTitle, kit.FormatRupiah(kit.ToNumber(deref(amount, ""))))
	if deref(requester, "") != "" {
		message += " · diajukan " + *requester
	}
	link := "/dashboard/sales-funnel/approvals?request=" + requestID
	if err := database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		_, err := h.notifyUsers(ctx, tx, ids, title, message, &link, map[string]any{"request_id": requestID, "level": level})
		return err
	}); err != nil {
		return err
	}

	gw := h.ports.WhatsApp.LoadGateway(ctx, h.db)
	if gw == nil {
		return nil
	}
	text := fmt.Sprintf("🔔 *Approval Diskon Quotation*\n\n%s — %s\nDeal: %s\nDiskon: *%s%%* (tingkat %d)\n%s\n\nBuka CRM → Sales → Approval untuk menyetujui/menolak.",
		subject.QuoteNumber, subject.OrgName, subject.DealTitle, pct, level, message)
	for _, uid := range ids {
		phone, err := h.ownerPhone(ctx, &uid)
		if err != nil {
			return err
		}
		if phone == "" {
			continue
		}
		if ok, reason := gw.SendText(ctx, phone, text); !ok {
			h.log.Error("[crm-approval] WA approver gagal", "reason", reason)
		}
	}
	return nil
}

// emitApprovalDecisionEvent emits quotation.status_changed after a decision
// (it triggers workflow rules and rescores the lead).
func (h *handler) emitApprovalDecisionEvent(ctx context.Context, requestID, actorID, approval, decision string) error {
	var subjectID, companyID string
	var branchID *string
	err := h.db.QueryRow(ctx, `SELECT subject_id::text, company_id::text, branch_id::text FROM crm.crm_approval_requests WHERE id = $1::text::uuid`,
		requestID).Scan(&subjectID, &companyID, &branchID)
	if database.IsNoRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	h.emitCrmEvent(ctx, crmEvent{
		EventType: "quotation.status_changed", SubjectType: "quotation", SubjectID: subjectID,
		CompanyID: &companyID, BranchID: branchID, ActorUserID: &actorID,
		Payload: map[string]any{"approval": approval, "decision": decision},
	})
	return nil
}
