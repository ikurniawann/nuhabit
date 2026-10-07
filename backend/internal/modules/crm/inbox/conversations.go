package inbox

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/crm/inbox/domain"
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Ports lib/crm/inbox-server.ts: conversation list, detail with member
// context, and agent actions.

const conversationNotFound = "Percakapan tidak ditemukan"

func (h *handler) listConversations(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.Require(r, kit.GateInbox)
	if err != nil {
		return err
	}
	q := r.URL.Query()
	var args []any
	var filters []string
	add := func(cond string, v any) {
		args = append(args, v)
		filters = append(filters, fmt.Sprintf(cond, len(args)))
	}
	if s := q.Get("status"); s != "" && s != "all" {
		add("v.status = $%d", s)
	}
	switch q.Get("assigned") {
	case "me":
		add("v.assigned_user_id = $%d", user.ID)
	case "unassigned":
		filters = append(filters, "v.assigned_user_id IS NULL")
	}
	if c := q.Get("channel"); c == "whatsapp" || c == "instagram" {
		add("v.channel = $%d", c)
	}
	if search := domain.JSTrim(q.Get("search")); search != "" {
		args = append(args, "%"+strings.NewReplacer("%", "", "_", "").Replace(search)+"%")
		n := len(args)
		filters = append(filters, fmt.Sprintf("(v.external_id LIKE $%d OR v.display_name ILIKE $%d OR c.name ILIKE $%d)", n, n, n))
	}
	where := ""
	if len(filters) > 0 {
		where = "WHERE " + strings.Join(filters, " AND ")
	}
	ctx := r.Context()
	conversations, err := kit.Query(ctx, h.db, `SELECT v.id, v.phone, v.channel, v.external_id, v.display_name,
            v.status, v.assigned_user_id, v.unread_count,
            v.last_message_at, v.last_message_preview,
            v.is_complaint, v.category, v.priority, v.sla_response_breached,
            v.awaiting_since,
            c.id AS customer_id, c.name AS customer_name,
            c.membership_tier, c.member_type,
            u.full_name AS assigned_name
       FROM crm.wa_conversations v
       LEFT JOIN pos.pos_customers c ON c.id = v.customer_id
       LEFT JOIN configuration.users u ON u.id = v.assigned_user_id
      `+where+`
      ORDER BY v.last_message_at DESC NULLS LAST
      LIMIT 100`, args...)
	if err != nil {
		return err
	}
	totals, err := kit.QueryOne(ctx, h.db, `SELECT COALESCE(SUM(unread_count), 0)::int AS total_unread,
            COUNT(*) FILTER (WHERE status IN ('open','in_progress'))::int AS total_active,
            COUNT(*) FILTER (WHERE sla_response_breached AND status <> 'resolved')::int AS total_breached,
            COUNT(*) FILTER (WHERE is_complaint AND status <> 'resolved')::int AS total_complaints,
            COUNT(*) FILTER (WHERE channel = 'whatsapp')::int AS total_whatsapp,
            COUNT(*) FILTER (WHERE channel = 'instagram')::int AS total_instagram
       FROM crm.wa_conversations`)
	if err != nil {
		return err
	}
	return kit.OK(w, struct {
		Conversations []*kit.Row `json:"conversations"`
		Totals        *kit.Row   `json:"totals"`
	}{conversations, totals})
}

func (h *handler) conversationDetail(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateInbox); err != nil {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	conversation, err := kit.QueryOne(ctx, h.db, `SELECT v.id, v.phone, v.channel, v.external_id, v.display_name,
            v.status, v.assigned_user_id, v.unread_count,
            v.last_message_at, v.customer_id,
            v.is_complaint, v.category, v.priority,
            v.awaiting_since, v.first_response_seconds, v.resolution_seconds,
            v.sla_response_breached, v.escalated_at, v.csat_score,
            u.full_name AS assigned_name
       FROM crm.wa_conversations v
       LEFT JOIN configuration.users u ON u.id = v.assigned_user_id
      WHERE v.id = $1::text::uuid`, id)
	if err != nil {
		return err
	}
	if conversation == nil {
		return httpx.NotFound(conversationNotFound)
	}
	messages, err := kit.Query(ctx, h.db, `SELECT m.id, m.direction, m.message_type, m.body, m.media_type, m.status,
              m.error_reason, m.wa_from_me, m.created_at,
              u.full_name AS sent_by_name
         FROM crm.wa_messages m
         LEFT JOIN configuration.users u ON u.id = m.sent_by_user_id
        WHERE m.conversation_id = $1
        ORDER BY m.created_at ASC
        LIMIT 300`, id)
	if err != nil {
		return err
	}
	member, err := h.memberContext(ctx, conversation.StrPtr("customer_id"))
	if err != nil {
		return err
	}
	notes, err := kit.Query(ctx, h.db, `SELECT n.id, n.body, n.created_at, u.full_name AS author_name
         FROM crm.wa_internal_notes n
         LEFT JOIN configuration.users u ON u.id = n.author_user_id
        WHERE n.conversation_id = $1
        ORDER BY n.created_at DESC
        LIMIT 50`, id)
	if err != nil {
		return err
	}
	return kit.OK(w, struct {
		Conversation *kit.Row   `json:"conversation"`
		Messages     []*kit.Row `json:"messages"`
		Member       *kit.Row   `json:"member"`
		Notes        []*kit.Row `json:"notes"`
	}{conversation, messages, member, notes})
}

// memberContext is the linked member: profile, five latest orders and
// five latest redemptions (nil without a member).
func (h *handler) memberContext(ctx context.Context, customerID *string) (*kit.Row, error) {
	if customerID == nil {
		return nil, nil
	}
	customer, err := kit.QueryOne(ctx, h.db, `SELECT c.id, c.name, c.phone, c.member_type, c.visit_count,
              c.total_xp::float AS total_xp,
              c.ark_coin_balance::float AS ark_coin_balance,
              t.name AS tier_name
         FROM pos.pos_customers c
         LEFT JOIN LATERAL (
           SELECT name FROM crm.crm_membership_tiers
            WHERE is_active AND min_lifetime_xp <= COALESCE(c.total_xp, 0)
            ORDER BY rank DESC LIMIT 1
         ) t ON true
        WHERE c.id = $1`, *customerID)
	if err != nil {
		return nil, err
	}
	orders, err := h.Orders.RecentOrders(ctx, h.db, *customerID)
	if err != nil {
		return nil, err
	}
	redemptions, err := kit.Query(ctx, h.db, `SELECT r.redemption_number, r.status, r.requested_at, w.name AS reward_name
         FROM crm.crm_redemptions r
         JOIN crm.crm_rewards w ON w.id = r.reward_id
        WHERE r.customer_id = $1
        ORDER BY r.requested_at DESC LIMIT 5`, *customerID)
	if err != nil {
		return nil, err
	}
	if customer == nil {
		return nil, nil
	}
	customer.Set("recent_orders", orders)
	customer.Set("recent_redemptions", redemptions)
	return customer, nil
}

var (
	csCategories = []string{"produk", "layanan", "pembayaran", "lainnya"}
	csPriorities = []string{"low", "normal", "high", "urgent"}
	csStatuses   = []string{"open", "in_progress", "waiting_customer", "resolved"}
)

// conversationAction is one member of conversationActionSchema.
type conversationAction struct {
	action      string
	text        string // reply message or note body (trimmed)
	status      string
	isComplaint bool
	category    *string
	priority    *string
}

// parseConversationAction mirrors conversationActionSchema.safeParse.
func parseConversationAction(body any) (conversationAction, bool) {
	f := validate.New(body, true)
	a := conversationAction{}
	action := f.Enum("action", validate.Rule{}, []string{"reply", "assign_me", "unassign", "set_status", "mark_read", "set_complaint", "add_note"})
	if !f.Valid() {
		return a, false
	}
	a.action = *action
	switch a.action {
	case "reply":
		if s := f.Str("message", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 2000}); s != nil {
			a.text = *s
		}
	case "add_note":
		if s := f.Str("body", validate.Rule{}, validate.StrOpts{Trim: true, Min: 1, Max: 2000}); s != nil {
			a.text = *s
		}
	case "set_status":
		if s := f.Enum("status", validate.Rule{}, csStatuses); s != nil {
			a.status = *s
		}
	case "set_complaint":
		if b := f.Bool("is_complaint", validate.Rule{}); b != nil {
			a.isComplaint = *b
		}
		a.category = f.Enum("category", validate.Rule{Optional: true, Nullable: true}, csCategories)
		a.priority = f.Enum("priority", validate.Rule{Optional: true}, csPriorities)
	}
	return a, f.Valid()
}

type conversationRef struct {
	id, channel, externalID string
	phone, displayName      *string
	category, priority      *string
}

func (h *handler) conversationAction(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.Require(r, kit.GateInbox)
	if err != nil {
		return err
	}
	body, err := kit.ReadJSON(r)
	if err != nil {
		return err
	}
	payload, ok := parseConversationAction(body)
	if !ok {
		return httpx.BadRequest("Payload tidak valid")
	}
	ctx := r.Context()
	var c conversationRef
	err = h.db.QueryRow(ctx, `SELECT id::text, phone, channel, external_id, display_name, category, priority
       FROM crm.wa_conversations WHERE id = $1::text::uuid`, r.PathValue("id")).
		Scan(&c.id, &c.phone, &c.channel, &c.externalID, &c.displayName, &c.category, &c.priority)
	if database.IsNoRows(err) {
		return httpx.NotFound(conversationNotFound)
	}
	if err != nil {
		return err
	}

	switch payload.action {
	case "mark_read":
		_, err = h.db.Exec(ctx, `UPDATE crm.wa_conversations SET unread_count = 0 WHERE id = $1`, c.id)
	case "unassign":
		_, err = h.db.Exec(ctx, `UPDATE crm.wa_conversations SET assigned_user_id = NULL WHERE id = $1`, c.id)
	case "assign_me":
		_, err = h.db.Exec(ctx, `UPDATE crm.wa_conversations
            SET assigned_user_id = $2,
                status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END
          WHERE id = $1`, c.id, user.ID)
	case "set_complaint":
		err = h.setComplaint(ctx, c, payload)
	case "add_note":
		// Internal notes are never sent to the customer.
		_, err = h.db.Exec(ctx, `INSERT INTO crm.wa_internal_notes (conversation_id, author_user_id, body)
         VALUES ($1, $2, $3)`, c.id, user.ID, payload.text)
	case "set_status":
		err = h.setStatus(ctx, c, payload.status, user.ID)
	case "reply":
		data, err := h.reply(ctx, c, payload.text, user.ID)
		if err != nil {
			return err
		}
		return kit.OK(w, data)
	}
	if err != nil {
		return err
	}
	return kit.Success(w)
}

func (h *handler) setStatus(ctx context.Context, c conversationRef, status, agentID string) error {
	if _, err := h.db.Exec(ctx, `UPDATE crm.wa_conversations SET status = $2 WHERE id = $1`, c.id, status); err != nil {
		return err
	}
	if status != "resolved" {
		return nil
	}
	csat, err := onResolved(ctx, h.db, c.id, h.now())
	if err != nil || csat == nil {
		return err
	}
	h.sendWhatsApp(ctx, c.phone, *csat, textMeta{messageType: "system", sentByUserID: agentID, conversationID: c.id})
	return nil
}

func (h *handler) setComplaint(ctx context.Context, c conversationRef, p conversationAction) error {
	if _, err := h.db.Exec(ctx, `UPDATE crm.wa_conversations
        SET is_complaint = $2,
            category = COALESCE($3, category),
            priority = COALESCE($4, priority)
      WHERE id = $1`, c.id, p.isComplaint, p.category, p.priority); err != nil {
		return err
	}
	// A complaint pings the owner once per conversation (dedup on its id),
	// without failing or delaying the CS action.
	if p.isComplaint {
		category, priority := p.category, p.priority
		if category == nil {
			category = c.category
		}
		if priority == nil {
			priority = c.priority
		}
		phone := ""
		if c.phone != nil {
			phone = *c.phone
		}
		h.Notifier.Fire("komplain", c.id, domain.KomplainMessage(c.displayName, phone, category, priority))
	}
	return nil
}

// reply sends the agent's message on the conversation's channel (502 when
// the channel refuses), then stops the SLA clock and updates the preview.
// The data is {messageId}: absent when WhatsApp gave no id, null when
// Instagram gave none.
func (h *handler) reply(ctx context.Context, c conversationRef, message, agentID string) (*kit.Row, error) {
	data := kit.NewRow()
	if c.channel == "instagram" {
		id, err := h.replyInstagram(ctx, c, message)
		if err != nil {
			return nil, err
		}
		data.Set("messageId", id)
	} else {
		res := h.sendWhatsApp(ctx, c.phone, message, textMeta{messageType: "chat", sentByUserID: agentID, conversationID: c.id})
		if !res.Success {
			return nil, sendFailed(res.Reason)
		}
		if res.MessageID != nil {
			data.Set("messageId", *res.MessageID)
		}
	}
	if err := onAgentReply(ctx, h.db, c.id, h.now()); err != nil {
		return nil, err
	}
	_, err := h.db.Exec(ctx, `UPDATE crm.wa_conversations
        SET last_message_at = now(),
            last_message_preview = $2,
            status = CASE WHEN status IN ('open','resolved') THEN 'in_progress' ELSE status END,
            assigned_user_id = COALESCE(assigned_user_id, $3)
      WHERE id = $1`, c.id, domain.MessagePreview(&message, nil), agentID)
	return data, err
}

func sendFailed(reason string) error {
	if reason == "" {
		reason = "Gagal mengirim balasan"
	}
	return httpx.Status(http.StatusBadGateway, reason)
}

// replyInstagram refuses (409) outside Meta's 24-hour window, sends through
// the Graph API and records the reply; a failed record is only logged
// because the message already went out.
func (h *handler) replyInstagram(ctx context.Context, c conversationRef, message string) (*string, error) {
	var last *time.Time
	if err := h.db.QueryRow(ctx, `SELECT max(created_at) FROM crm.wa_messages
      WHERE conversation_id = $1 AND direction = 'in'`, c.id).Scan(&last); err != nil {
		return nil, err
	}
	now := h.now()
	if !domain.WithinReplyWindow(last, now) {
		return nil, httpx.Conflict("Jendela balas 24 jam Instagram sudah lewat. Tunggu pesan berikutnya dari pelanggan.")
	}
	sent := h.Instagram.SendText(ctx, h.db, c.externalID, message)
	if !sent.Success {
		return nil, sendFailed(sent.Reason)
	}
	_, err := recordMessage(ctx, h.db, domain.Inbound{
		Channel: "instagram", ExternalID: c.externalID, Direction: "out",
		Body: &message, ProviderMessageID: sent.MessageID, SentAt: &now,
	})
	if err != nil {
		h.log.Error("Balasan Instagram terkirim tetapi gagal dicatat", "error", err)
	}
	return sent.MessageID, nil
}
