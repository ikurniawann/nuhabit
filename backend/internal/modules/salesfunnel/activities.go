package salesfunnel

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/salesfunnel/domain"
	"nuhabit/backend/internal/modules/salesfunnel/pgrow"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/validate"
)

// lib/sales-funnel/activities-server.ts and tasks.ts

const activityColumns = `
  a.id, a.lead_id, a.deal_id, a.subject_type, a.subject_id, a.activity_type,
  a.title, a.notes, a.due_at, a.done_at, a.status, a.priority, a.recurrence,
  a.reminder_at, a.reminder_channels, a.parent_task_id,
  a.owner_user_id, a.reminder_sent_at, a.created_at,
  u.full_name AS owner_name,
  d.title AS deal_title,
  COALESCE(dl.org_name, l.org_name, acc.name, con_acc.name, cust.name) AS org_name,
  COALESCE(dl.pic_name, l.pic_name, con.name, cust.name) AS pic_name,
  COALESCE(dl.pic_phone, l.pic_phone, con.phone, cust.phone) AS pic_phone,
  CASE a.subject_type
    WHEN 'deal' THEN d.title
    WHEN 'lead' THEN l.org_name
    WHEN 'account' THEN acc.name
    WHEN 'contact' THEN con.name
    WHEN 'member' THEN cust.name
    ELSE COALESCE(d.title, l.org_name)
  END AS subject_name`

const activityJoins = `
  FROM crm.crm_sales_activities a
  LEFT JOIN configuration.users u ON u.id = a.owner_user_id
  LEFT JOIN crm.crm_sales_deals d ON d.id = a.deal_id
  LEFT JOIN crm.crm_sales_leads dl ON dl.id = d.lead_id
  LEFT JOIN crm.crm_sales_leads l ON l.id = a.lead_id
  LEFT JOIN crm.crm_accounts acc ON a.subject_type = 'account' AND acc.id = a.subject_id
  LEFT JOIN crm.crm_contacts con ON a.subject_type = 'contact' AND con.id = a.subject_id
  LEFT JOIN crm.crm_accounts con_acc ON con_acc.id = con.account_id
  LEFT JOIN pos.pos_customers cust ON a.subject_type = 'member' AND cust.id = a.subject_id`

func (h *handler) listActivities(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	subjectType := queryStr(r, "subject_type")
	if !domain.Contains(domain.TaskSubjectTypes, subjectType) {
		subjectType = ""
	}
	subjectID := queryStr(r, "subject_id")
	if !domain.IsUUID(subjectID) {
		subjectID = ""
	}
	if subject := domain.ResolveTaskSubject(subjectType, subjectID, queryStr(r, "deal_id"), queryStr(r, "lead_id")); subject != nil {
		if _, err := h.requireSubject(ctx, subject.Type, subject.ID, u); err != nil {
			return err
		}
		where, params := "(a.subject_type = $2 AND a.subject_id = $1)", []any{subject.ID, subject.Type}
		switch subject.Type {
		case "deal":
			where, params = "a.deal_id = $1", []any{subject.ID}
		case "lead":
			where, params = "(a.lead_id = $1 OR (a.subject_type = 'lead' AND a.subject_id = $1))", []any{subject.ID}
		}
		rows, err := pgrow.Query(ctx, h.db, `SELECT `+activityColumns+` `+activityJoins+`
     WHERE a.deleted_at IS NULL AND `+where+`
     ORDER BY COALESCE(a.due_at, a.created_at) DESC
     LIMIT 500`, params...)
		if err != nil {
			return err
		}
		return ok(w, rows)
	}
	s, err := h.salesScope(ctx, u)
	if err != nil {
		return err
	}
	where := domain.NewWhere([]string{"a.deleted_at IS NULL"}, 1)
	domain.ScopeConditions(where, "a", u.ID, u.Role, s)
	if owner := queryStr(r, "owner_user_id"); domain.IsUUID(owner) {
		where.Add("a.owner_user_id = ?", owner)
	}
	switch status := queryStr(r, "status"); {
	case domain.Contains(domain.TaskStatuses, status):
		where.Add("a.status = ?", status)
	case status == "open_all":
		where.Push("a.status IN ('open', 'in_progress')")
	}
	if priority := queryStr(r, "priority"); domain.Contains(domain.TaskPriorities, priority) {
		where.Add("a.priority = ?", priority)
	}
	switch queryStr(r, "view") {
	case "today":
		where.Push("a.status IN ('open', 'in_progress')")
		where.Push("a.due_at IS NOT NULL")
		where.Push("a.due_at < (CURRENT_DATE + 1)::timestamptz")
	case "upcoming":
		where.Push("a.status IN ('open', 'in_progress')")
		where.Push("(a.due_at IS NULL OR a.due_at >= (CURRENT_DATE + 1)::timestamptz)")
	case "range":
		from, to := queryStr(r, "from"), queryStr(r, "to")
		if !domain.IsParsableISODate(from) || !domain.IsParsableISODate(to) {
			return badRequest("view=range membutuhkan from & to (YYYY-MM-DD)")
		}
		where.Add("a.due_at >= ?::date::timestamptz", from)
		where.Add("a.due_at < (?::date + 1)::timestamptz", to)
	}
	rows, err := pgrow.Query(ctx, h.db, `SELECT `+activityColumns+` `+activityJoins+`
     WHERE `+where.SQL()+`
     ORDER BY a.due_at ASC NULLS LAST,
              CASE a.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
              a.created_at DESC
     LIMIT 500`, where.Params...)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

// parseRecurrence is recurrenceSchema (strict) at key; nil when absent or null.
func parseRecurrence(f *validate.Form) *domain.Recurrence {
	if v, present := f.Fields()["recurrence"]; !present || v == nil {
		return nil
	}
	c := f.Child("recurrence")
	if c.Fields() == nil {
		return nil
	}
	rec := domain.Recurrence{Freq: str(c.Enum("freq", validate.Rule{}, domain.RecurrenceFreqs)), Interval: 1}
	if n := c.Int("interval", validate.Rule{HasDefault: true}, numRange(1, 52)); n != nil {
		rec.Interval = *n
	}
	rec.Until = c.Str("until", validate.Rule{Nullable: true, HasDefault: true}, validate.StrOpts{Check: isoDateCheck})
	strict(c, "freq", "interval", "until")
	return &rec
}

func datetime(f *validate.Form, key string) *string {
	return f.Str(key, optNull, validate.StrOpts{Check: validate.DatetimeCheck})
}

func reminderChannels(f *validate.Form) []string {
	return f.Strings("reminder_channels", opt, 3, validate.StrOpts{Check: validate.EnumCheck(domain.ReminderChannels)})
}

// taskInput is createTaskSchema.
type taskInput struct {
	SubjectType, SubjectID, DealID, LeadID *string
	ActivityType, Priority, Status         string
	Title, Notes, DueAt, ReminderAt        *string
	ReminderChannels                       []string
	Recurrence                             *domain.Recurrence
	OwnerUserID                            *string
	IsDone                                 bool
}

func parseCreateTask(f *validate.Form) taskInput {
	var in taskInput
	in.SubjectType = f.Enum("subject_type", opt, domain.TaskSubjectTypes)
	in.SubjectID = f.UUID("subject_id", optNull)
	in.DealID = f.UUID("deal_id", optNull)
	in.LeadID = f.UUID("lead_id", optNull)
	in.ActivityType = enumDefault(f, "activity_type", domain.ActivityTypes, "tugas")
	in.Title = f.Str("title", optNull, trimMax(200))
	in.Notes = f.Str("notes", optNull, trimMax(2000))
	in.DueAt = datetime(f, "due_at")
	in.ReminderAt = datetime(f, "reminder_at")
	in.ReminderChannels = reminderChannels(f)
	in.Priority = enumDefault(f, "priority", domain.TaskPriorities, "normal")
	in.Status = enumDefault(f, "status", domain.TaskStatuses, "open")
	in.Recurrence = parseRecurrence(f)
	in.OwnerUserID = f.UUID("owner_user_id", optNull)
	in.IsDone = f.BoolDefault("is_done", false)
	if !aborted(f) {
		if str(in.DealID) == "" && str(in.LeadID) == "" && (str(in.SubjectType) == "" || str(in.SubjectID) == "") {
			f.Fail(nil, "custom", "Task harus terkait lead, deal, account, contact, atau member")
		}
		if in.Recurrence != nil && str(in.DueAt) == "" {
			f.Fail(nil, "custom", "Task berulang wajib punya jatuh tempo")
		}
	}
	return in
}

func jsonText(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func (h *handler) createActivity(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	in := parseCreateTask(f)
	if err := validationErr(f); err != nil {
		return err
	}
	ctx := r.Context()
	subject := domain.ResolveTaskSubject(str(in.SubjectType), str(in.SubjectID), str(in.DealID), str(in.LeadID))
	if subject == nil {
		return badRequest("Task harus terkait lead, deal, account, contact, atau member")
	}
	venue, err := h.requireSubject(ctx, subject.Type, subject.ID, u)
	if err != nil {
		return err
	}
	var companyID, branchID string
	if venue != nil {
		companyID, branchID = venue.CompanyID, venue.BranchID
	} else {
		s, err := h.salesScope(ctx, u)
		if err != nil {
			return err
		}
		if companyID, branchID, err = h.requireVenue(ctx, s, venueMissingShort); err != nil {
			return err
		}
	}
	if err := h.assertOwner(ctx, u, ptrAny(in.OwnerUserID), companyID); err != nil {
		return err
	}
	status := domain.ResolveTaskStatus(in.Status, &in.IsDone)
	var doneAt any
	if status == "done" {
		doneAt = pgrow.ISO(h.now())
	}
	var recurrence any
	if in.Recurrence != nil {
		recurrence = jsonText(in.Recurrence)
	}
	reminderAt := ptrAny(in.ReminderAt)
	if reminderAt == nil {
		reminderAt = ptrAny(in.DueAt)
	}
	channels := in.ReminderChannels
	if channels == nil {
		channels = domain.DefaultReminderChannels
	}
	owner := orNull(in.OwnerUserID)
	if owner == nil && u.Role == "sales" {
		owner = u.ID
	}
	var leadID, dealID any
	switch subject.Type {
	case "lead":
		leadID = subject.ID
	case "deal":
		dealID = subject.ID
	}
	var row *pgrow.Row
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		row, err = pgrow.QueryOne(ctx, tx, `INSERT INTO crm.crm_sales_activities
       (company_id, branch_id, lead_id, deal_id, subject_type, subject_id,
        activity_type, title, notes, due_at, done_at, status, priority,
        recurrence, reminder_at, reminder_channels, owner_user_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             $14::text::jsonb, $15, $16::text::jsonb, $17, $18)
     RETURNING id, activity_type, title, due_at, done_at, status, priority`,
			companyID, branchID, leadID, dealID, subject.Type, subject.ID, in.ActivityType, orNull(in.Title), orNull(in.Notes),
			ptrAny(in.DueAt), doneAt, status, in.Priority, recurrence, reminderAt, jsonText(channels), owner, u.ID)
		if err != nil {
			return err
		}
		eventType := "task.created"
		if status == "done" {
			eventType = "task.done"
		}
		return emit(ctx, tx, crmEvent{eventType: eventType, subjectType: "task", subjectID: row.Str("id"),
			companyID: companyID, branchID: branchID, actorID: u.ID,
			payload: map[string]any{"activity_type": in.ActivityType, "subject_type": subject.Type, "subject_id": subject.ID}})
	})
	if err != nil {
		return err
	}
	return created(w, row, "Task dicatat")
}

func (h *handler) updateActivity(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	activity, err := h.require(ctx, "activity", id, u)
	if err != nil {
		return err
	}
	f, err := form(r)
	if err != nil {
		return err
	}
	fields := domain.NewFields()
	patchEnum(f, fields, "activity_type", domain.ActivityTypes)
	patchStr(f, fields, "title", true, trimMax(200))
	patchStr(f, fields, "notes", true, trimMax(2000))
	for _, k := range []string{"due_at", "reminder_at"} {
		if has(f, k) {
			fields.Set(k, ptrAny(datetime(f, k)))
		}
	}
	channels := reminderChannels(f)
	patchEnum(f, fields, "priority", domain.TaskPriorities)
	statusIn := str(f.Enum("status", opt, domain.TaskStatuses))
	hasRecurrence := has(f, "recurrence")
	recurrence := parseRecurrence(f)
	hasOwner := has(f, "owner_user_id")
	owner := f.UUID("owner_user_id", optNull)
	isDone := f.Bool("is_done", opt)
	strict(f, "activity_type", "title", "notes", "due_at", "reminder_at", "reminder_channels", "priority", "status",
		"recurrence", "owner_user_id", "is_done")
	if err := validationErr(f); err != nil {
		return err
	}
	if err := h.assertOwner(ctx, u, ptrAny(owner), activity.CompanyID); err != nil {
		return err
	}
	set := domain.NewUpdateSet()
	fields.Each(func(k string, v any) { set.Set(k, v, "") })
	if hasOwner {
		set.Set("owner_user_id", ptrAny(owner), "")
	}
	if hasRecurrence {
		var v any
		if recurrence != nil {
			v = jsonText(recurrence)
		}
		set.Set("recurrence", v, "::text::jsonb")
	}
	if channels != nil {
		set.Set("reminder_channels", jsonText(channels), "::text::jsonb")
	}
	if fields.Has("reminder_at") || fields.Has("due_at") {
		set.Raw("reminder_sent_at = NULL")
		set.Raw("in_app_notified_at = NULL")
	}
	status := domain.ResolveTaskStatus(statusIn, isDone)
	if status != "" {
		set.Set("status", status, "")
		var doneAt any
		if status == "done" {
			doneAt = pgrow.ISO(h.now())
		}
		set.Set("done_at", doneAt, "")
	}
	sql, values, idParam, okSet := set.Build(activity.ID)
	if !okSet {
		return badRequest(domain.NoFieldsChanged)
	}
	var row *pgrow.Row
	var nextID any
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		row, err = pgrow.QueryOne(ctx, tx, `UPDATE crm.crm_sales_activities SET `+sql+`
     WHERE id = `+idParam+`
     RETURNING id, company_id, branch_id, lead_id, deal_id, subject_type,
               subject_id, activity_type, title, notes, due_at, reminder_at,
               reminder_channels, status, priority, recurrence, owner_user_id,
               parent_task_id, created_by, done_at`, values...)
		if err != nil || row == nil {
			return err
		}
		if status == "done" && row.Get("recurrence") != nil && !domain.IsTaskOpen(row.Str("status")) {
			if nextID, err = spawnRecurringSuccessor(ctx, tx, row); err != nil {
				return err
			}
		}
		eventType := "task.updated"
		if status == "done" {
			eventType = "task.done"
		}
		return emit(ctx, tx, crmEvent{eventType: eventType, subjectType: "task", subjectID: activity.ID,
			companyID: row.Str("company_id"), branchID: row.Str("branch_id"), actorID: u.ID,
			payload: map[string]any{"activity_type": row.Get("activity_type"), "status": row.Get("status"),
				"subject_type": row.Get("subject_type"), "subject_id": row.Get("subject_id")}})
	})
	if err != nil {
		return err
	}
	if row == nil {
		return okMsg(w, pgrow.New("next_task_id", nil), "Task diperbarui")
	}
	row.Set("next_task_id", nextID)
	msg := "Task diperbarui"
	if nextID != nil {
		msg = "Task selesai — kemunculan berikutnya dijadwalkan"
	}
	return okMsg(w, row, msg)
}

// spawnRecurringSuccessor creates the next occurrence of a completed
// recurring task (idempotent per series root and due date); nil when the
// recurrence is invalid or the series is over.
func spawnRecurringSuccessor(ctx context.Context, q database.Querier, task *pgrow.Row) (any, error) {
	rec, valid := domain.ParseRecurrence(task.JSON("recurrence"))
	due, hasDue := task.Time("due_at")
	if !valid || !hasDue {
		return nil, nil
	}
	var reminder *time.Time
	if t, ok := task.Time("reminder_at"); ok {
		t = t.Truncate(time.Millisecond)
		reminder = &t
	}
	nextDue, nextReminder, ok := domain.SpawnNextTask(due.Truncate(time.Millisecond), reminder, rec)
	if !ok {
		return nil, nil
	}
	rootID := task.Str("parent_task_id")
	if rootID == "" {
		rootID = task.Str("id")
	}
	existing, err := scanID(ctx, q, `SELECT id::text FROM crm.crm_sales_activities
     WHERE deleted_at IS NULL AND (parent_task_id = $1 OR id = $1)
       AND due_at = $2 LIMIT 1`, rootID, pgrow.ISO(nextDue))
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return *existing, nil
	}
	var reminderAt any
	if nextReminder != nil {
		reminderAt = pgrow.ISO(*nextReminder)
	}
	channels := "[\"wa\",\"in_app\"]"
	if raw, ok := task.Get("reminder_channels").(json.RawMessage); ok {
		channels = string(raw)
	}
	created, err := scanID(ctx, q, `INSERT INTO crm.crm_sales_activities
       (company_id, branch_id, lead_id, deal_id, subject_type, subject_id,
        activity_type, title, notes, due_at, status, priority, recurrence,
        reminder_at, reminder_channels, owner_user_id, parent_task_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', $11, $12::text::jsonb,
             $13, $14::text::jsonb, $15, $16, $17)
     RETURNING id::text`,
		task.Get("company_id"), task.Get("branch_id"), task.Get("lead_id"), task.Get("deal_id"), task.Get("subject_type"),
		task.Get("subject_id"), task.Get("activity_type"), task.Get("title"), task.Get("notes"), pgrow.ISO(nextDue),
		task.Get("priority"), jsonText(rec), reminderAt, channels, task.Get("owner_user_id"), rootID, task.Get("created_by"))
	if err != nil || created == nil {
		return nil, err
	}
	return *created, nil
}

func (h *handler) deleteActivity(w http.ResponseWriter, r *http.Request) error {
	u, err := h.requireUser(r)
	if err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	if _, err := h.require(ctx, "activity", id, u); err != nil {
		return err
	}
	if _, err := h.db.Exec(ctx, `UPDATE crm.crm_sales_activities SET deleted_at = now(), updated_at = now() WHERE id = $1`, id); err != nil {
		return err
	}
	return noContent(w)
}
