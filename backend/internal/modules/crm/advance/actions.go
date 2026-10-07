package advance

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/advance/domain"
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/safehttp"
)

// actionCtx mirrors ActionContext.
type actionCtx struct {
	ruleID, runID          *string
	companyID, branchID    *string
	subjectType, subjectID string
	rec                    *record
	template               map[string]any
	actorUserID            *string
}

// webhookTimeout is AbortSignal.timeout(10_000) on the workflow webhook.
const webhookTimeout = 10 * time.Second

// msgWebhookBlocked is the action's reason when safehttp refuses the URL.
const msgWebhookBlocked = "URL webhook ditolak: hanya https ke alamat publik"

// runActions runs the actions before the first wait now (one failure does
// not stop the rest) and queues the ones after it in crm_scheduled_actions.
func (h *handler) runActions(ctx context.Context, actions []workflowAction, ac *actionCtx) (results []map[string]any, scheduled bool, failed int, err error) {
	now, later, delayMs := domain.SplitAtWait(actions, func(a workflowAction) (bool, float64, float64) {
		return a.Type == "wait", deref(a.Days, 0), deref(a.Hours, 0)
	})
	results = []map[string]any{}
	for _, a := range now {
		res, err := h.executeAction(ctx, a, ac)
		if err != nil {
			failed++
			results = append(results, map[string]any{"type": a.Type, "ok": false, "reason": errMessage(err)})
			continue
		}
		results = append(results, res)
		if res["ok"] == false {
			failed++
		}
	}
	if len(later) == 0 {
		return results, false, failed, nil
	}
	raws := make([]json.RawMessage, len(later))
	for i, a := range later {
		raws[i] = a.raw
	}
	payload := coalesce(ac.template["event"], map[string]any{})
	_, err = h.db.Exec(ctx, `INSERT INTO crm.crm_scheduled_actions
       (rule_id, run_id, company_id, branch_id, subject_type, subject_id, actions, context, run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::text::jsonb, $8::text::jsonb, $9)`,
		ac.ruleID, ac.runID, ac.companyID, ac.branchID, ac.subjectType, ac.subjectID, jsonbText(raws),
		jsonbText(map[string]any{"actor_user_id": ac.actorUserID, "payload": payload}),
		h.now().Add(time.Duration(delayMs)*time.Millisecond))
	return results, err == nil, failed, err
}

// executeAction runs one action. Database actions run in their own
// transaction (a savepoint inside a caller's transaction) so a failing
// statement only fails that action; outbound HTTP runs outside any.
func (h *handler) executeAction(ctx context.Context, a workflowAction, ac *actionCtx) (map[string]any, error) {
	switch a.Type {
	case "send_wa":
		return h.sendWhatsAppAction(ctx, a, ac)
	case "webhook":
		return h.webhookAction(ctx, a, ac)
	case "wait":
		return map[string]any{"type": a.Type, "ok": true}, nil
	case "create_task", "assign_owner", "update_field", "notify_in_app":
		var out map[string]any
		err := database.WithTx(ctx, h.db, func(tx pgx.Tx) (err error) {
			out, err = h.executeDBAction(ctx, tx, a, ac)
			return err
		})
		return out, err
	}
	return nil, errors.New("Cannot read properties of undefined (reading 'ok')")
}

func (h *handler) executeDBAction(ctx context.Context, q database.Querier, a workflowAction, ac *actionCtx) (map[string]any, error) {
	rec, records := ac.rec, h.ports.Records
	result := map[string]any{"type": a.Type}
	switch a.Type {
	case "create_task":
		var owner *string
		switch assign := deref(a.AssignTo, ""); assign {
		case "owner":
			owner = rec.str("owner_user_id")
		case "creator":
			owner = ac.actorUserID
		default:
			owner = a.AssignTo
		}
		days := 1.0
		if a.DueInDays != nil {
			days = *a.DueInDays
		}
		due := h.now().Add(time.Duration(days * float64(24*time.Hour))).In(domain.Jakarta)
		due = time.Date(due.Year(), due.Month(), due.Day(), 9, 0, 0, 0, domain.Jakarta)
		t := Task{
			CompanyID: coalesceStr(ac.companyID, rec.str("company_id")), BranchID: coalesceStr(ac.branchID, rec.str("branch_id")),
			SubjectType: &ac.subjectType, SubjectID: &ac.subjectID,
			ActivityType: deref(a.ActivityType, ""), Title: domain.SliceUTF16(domain.RenderTemplate(deref(a.Title, ""), ac.template), 200),
			DueAt: due, Priority: deref(a.Priority, ""), OwnerUserID: owner, CreatedBy: ac.actorUserID,
		}
		switch ac.subjectType {
		case "lead":
			t.LeadID = &ac.subjectID
		case "deal":
			t.DealID = &ac.subjectID
		case "task":
			t.SubjectType, t.SubjectID = rec.str("subject_type"), rec.str("subject_id")
		}
		if deref(a.Notes, "") != "" {
			notes := domain.RenderTemplate(*a.Notes, ac.template)
			t.Notes = &notes
		}
		id, err := records.CreateTask(ctx, q, t)
		if err != nil {
			return nil, err
		}
		result["ok"], result["task_id"] = true, id
	case "assign_owner":
		if deref(a.OnlyIfEmpty, false) && rec.str("owner_user_id") != nil {
			result["ok"], result["skipped"] = true, "sudah ada owner"
			return result, nil
		}
		userID := deref(a.UserID, "")
		if deref(a.Strategy, "") == "round_robin" && len(a.UserIDs) > 0 {
			var previous int
			if err := q.QueryRow(ctx, `SELECT count(*) FROM crm.crm_workflow_runs WHERE rule_id = $1`, ac.ruleID).Scan(&previous); err != nil {
				return nil, err
			}
			userID, _ = domain.PickRoundRobin(a.UserIDs, previous)
		}
		if userID == "" {
			result["ok"], result["reason"] = false, "tidak ada kandidat owner"
			return result, nil
		}
		if err := records.SetOwner(ctx, q, ac.subjectType, ac.subjectID, userID); err != nil {
			return nil, err
		}
		rec.set("owner_user_id", userID)
		result["ok"], result["owner_user_id"] = true, userID
	case "update_field":
		field := deref(a.Field, "")
		if !domain.CanUpdateField(ac.subjectType, field) {
			result["ok"], result["reason"] = false, "field tidak diizinkan"
			return result, nil
		}
		var value any
		if len(a.Value) > 0 {
			_ = json.Unmarshal(a.Value, &value)
		}
		if err := records.UpdateField(ctx, q, ac.subjectType, ac.subjectID, field, pgText(value)); err != nil {
			return nil, err
		}
		rec.set(field, value)
		result["ok"], result["field"] = true, field
	case "notify_in_app":
		ids, err := h.resolveUserIDs(ctx, q, deref(a.To, ""), ac, a.UserID, a.Role)
		if err != nil {
			return nil, err
		}
		link := subjectLink(ac.subjectType, ac.subjectID, rec)
		n, err := h.notifyUsers(ctx, q, ids, domain.RenderTemplate(deref(a.Title, ""), ac.template),
			domain.RenderTemplate(deref(a.Message, ""), ac.template), &link,
			map[string]any{"rule_id": ac.ruleID, "subject_type": ac.subjectType, "subject_id": ac.subjectID})
		if err != nil {
			return nil, err
		}
		result["ok"], result["notified"] = n > 0, n
	}
	return result, nil
}

func (h *handler) sendWhatsAppAction(ctx context.Context, a workflowAction, ac *actionCtx) (map[string]any, error) {
	result := map[string]any{"type": a.Type}
	gw := h.ports.WhatsApp.LoadGateway(ctx, h.db)
	if gw == nil {
		result["ok"], result["reason"] = false, "WA gateway belum dikonfigurasi"
		return result, nil
	}
	valid := func(raw string) string {
		if p := domain.NormalizePhone(raw); domain.IsValidNormalizedPhone(p) {
			return p
		}
		return ""
	}
	var target string
	switch to := deref(a.To, ""); {
	case to == "number" && deref(a.Number, "") != "":
		target = valid(*a.Number)
	case to == "pic":
		raw := coalesce(ac.rec.get("pic_phone"), ac.rec.get("phone"), "")
		target = valid(domain.JSString(raw))
	default:
		phone, err := h.ownerPhone(ctx, ac.rec.str("owner_user_id"))
		if err != nil {
			return nil, err
		}
		target = phone
	}
	if target == "" {
		result["ok"], result["reason"] = false, "nomor tujuan tidak tersedia"
		return result, nil
	}
	sent := gw.SendText(ctx, target, domain.RenderTemplate(deref(a.Message, ""), ac.template))
	result["ok"], result["to"] = sent.Success, target
	if !sent.Success {
		result["reason"] = sent.Reason
	}
	return result, nil
}

// ownerPhone is the normalized WhatsApp number of a user's employee
// record, "" when unusable.
func (h *handler) ownerPhone(ctx context.Context, userID *string) (string, error) {
	if userID == nil {
		return "", nil
	}
	phone, err := h.ports.Employees.Phone(ctx, h.db, *userID)
	if err != nil || phone == nil {
		return "", err
	}
	if p := domain.NormalizePhone(*phone); domain.IsValidNormalizedPhone(p) {
		return p, nil
	}
	return "", nil
}

// webhookAction POSTs the record to the rule's URL, signed with
// HMAC-SHA256 of the body when the action has a secret.
func (h *handler) webhookAction(ctx context.Context, a workflowAction, ac *actionCtx) (map[string]any, error) {
	body, err := kit.MarshalNoEscape(struct {
		RuleID      *string  `json:"rule_id"`
		SubjectType string   `json:"subject_type"`
		SubjectID   string   `json:"subject_id"`
		Record      *kit.Row `json:"record"`
		SentAt      string   `json:"sent_at"`
	}{ac.ruleID, ac.subjectType, ac.subjectID, ac.rec.row, kit.ISO(h.now())})
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, webhookTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, deref(a.URL, ""), bytes.NewReader(body))
	if err != nil {
		return nil, errors.New("fetch failed")
	}
	req.Header.Set("Content-Type", "application/json")
	if secret := deref(a.Secret, ""); secret != "" {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write(body)
		signature := hex.EncodeToString(mac.Sum(nil))
		req.Header.Set("X-NuHabit-Signature", signature)
		// The old header keeps existing receivers working.
		req.Header.Set("X-BCDCoffee-Signature", signature)
	}
	resp, err := h.client.Do(req)
	if err != nil {
		if errors.Is(err, safehttp.ErrBlocked) {
			return nil, errors.New(msgWebhookBlocked)
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, errors.New("The operation was aborted due to timeout")
		}
		return nil, errors.New("fetch failed")
	}
	resp.Body.Close()
	return map[string]any{"type": a.Type, "ok": resp.StatusCode >= 200 && resp.StatusCode <= 299, "status": resp.StatusCode}, nil
}

// resolveUserIDs picks the notify_in_app recipients: the named user, the
// active users of a role, else the record owner (or the event's actor).
func (h *handler) resolveUserIDs(ctx context.Context, q database.Querier, target string, ac *actionCtx, userID, role *string) ([]string, error) {
	if target == "user" && deref(userID, "") != "" {
		return []string{*userID}, nil
	}
	if target == "role" && deref(role, "") != "" {
		return h.userIDs(ctx, q, `SELECT id::text FROM configuration.users
       WHERE role = $1 AND status = 'active' AND ($2::uuid IS NULL OR company_id IS NULL OR company_id = $2)
       LIMIT 50`, *role, ac.companyID)
	}
	if owner := ac.rec.str("owner_user_id"); owner != nil {
		return []string{*owner}, nil
	}
	if ac.actorUserID != nil {
		return []string{*ac.actorUserID}, nil
	}
	return nil, nil
}

func (h *handler) userIDs(ctx context.Context, q database.Querier, sql string, args ...any) ([]string, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// notifyUsers inserts one in-app alert per distinct user (title cut to 150
// and message to 1000 UTF-16 units) and returns how many it wrote.
func (h *handler) notifyUsers(ctx context.Context, q database.Querier, userIDs []string, title, message string, link *string, metadata map[string]any) (int, error) {
	seen := map[string]bool{}
	n := 0
	for _, uid := range userIDs {
		if seen[uid] {
			continue
		}
		seen[uid] = true
		if err := h.ports.Notifications.Notify(ctx, q, uid, domain.SliceUTF16(title, 150), domain.SliceUTF16(message, 1000), link, jsonbText(metadata)); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

func subjectLink(object, id string, rec *record) string {
	switch object {
	case "lead":
		return "/dashboard/sales-funnel/leads/" + id
	case "deal":
		return "/dashboard/sales-funnel/pipeline?deal=" + id
	case "account":
		return "/dashboard/sales-funnel/accounts/" + id
	case "contact":
		phone := coalesce(rec.get("phone"), "")
		return "/dashboard/sales-funnel/contacts?q=" + domain.EncodeURIComponent(domain.JSString(phone))
	case "task":
		return "/dashboard/sales-funnel/tasks?task=" + id
	case "quotation":
		return "/dashboard/sales-funnel/pipeline?deal=" + domain.JSString(coalesce(rec.get("deal_id"), ""))
	}
	return ""
}

// pgText is the text node-postgres sends for a JavaScript value (nil for
// null): numbers in JS form, objects as JSON, arrays as array literals.
func pgText(v any) *string {
	var s string
	switch x := v.(type) {
	case nil:
		return nil
	case string:
		s = x
	case float64, bool:
		s = domain.JSString(x)
	case []any:
		s = arrayLiteral(x)
	default:
		s = jsonbText(x)
	}
	return &s
}

func arrayLiteral(items []any) string {
	parts := make([]string, len(items))
	for i, it := range items {
		switch x := it.(type) {
		case nil:
			parts[i] = "NULL"
		case []any:
			parts[i] = arrayLiteral(x)
		default:
			e := strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(*pgText(x))
			parts[i] = `"` + e + `"`
		}
	}
	return "{" + strings.Join(parts, ",") + "}"
}
