package gymcomplaints

import (
	"context"
	"strings"

	"nuhabit/backend/internal/modules/gymcomplaints/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// "Jadikan tiket" in the CRM inbox: a ticket from a conversation, prefilled
// from the conversation's contact, member and complaint flags. The inbox
// table belongs to crm; this module reads it and only sets is_complaint on a
// conversation that becomes a ticket.

// conversation is what a ticket takes from an inbox conversation.
type conversation struct {
	ID, Channel, Priority    string
	Phone, CustomerID, Name  *string
	Category, LastMessage    *string
	IsComplaint, SLABreached bool
}

func loadConversation(ctx context.Context, q Q, id string) (*conversation, error) {
	var c conversation
	err := q.QueryRow(ctx, `SELECT id::text, channel, priority, phone, customer_id::text, display_name, category,
	       last_message_preview, is_complaint, sla_response_breached
	  FROM crm.wa_conversations WHERE id = $1`, id).
		Scan(&c.ID, &c.Channel, &c.Priority, &c.Phone, &c.CustomerID, &c.Name, &c.Category, &c.LastMessage, &c.IsComplaint, &c.SLABreached)
	if database.IsNoRows(err) {
		return nil, httpx.NotFound("Percakapan tidak ditemukan")
	}
	return &c, err
}

// Suggestion is the ticket "Jadikan tiket" proposes before staff edit it.
type Suggestion struct {
	Category     string  `json:"category"`
	Priority     string  `json:"priority"`
	Title        string  `json:"title"`
	Description  *string `json:"description"`
	CustomerID   *string `json:"customer_id"`
	ContactName  *string `json:"contact_name"`
	ContactPhone *string `json:"contact_phone"`
	IsComplaint  bool    `json:"is_complaint"`
	SLABreached  bool    `json:"sla_breached"`
}

func (c conversation) suggestion() Suggestion {
	return Suggestion{
		Category:     domain.CategoryFromInbox(c.Category),
		Priority:     string(domain.PriorityFromInbox(c.Priority, c.SLABreached)),
		Description:  trimmed(c.LastMessage),
		CustomerID:   c.CustomerID,
		ContactName:  trimmed(c.Name),
		ContactPhone: trimmed(c.Phone),
		IsComplaint:  c.IsComplaint,
		SLABreached:  c.SLABreached,
	}
}

// ConversationView is the inbox panel: the conversation's unconfirmed
// ticket, if any, and the prefill for a new one.
type ConversationView struct {
	Ticket     *Ticket    `json:"ticket"`
	Suggestion Suggestion `json:"suggestion"`
}

func (s *Service) ForConversation(ctx context.Context, id string) (ConversationView, error) {
	c, err := loadConversation(ctx, s.db, id)
	if err != nil {
		return ConversationView{}, err
	}
	out := ConversationView{Suggestion: c.suggestion()}
	t, err := scanTicket(s.db.QueryRow(ctx, ticketSelect+` WHERE k.conversation_id = $1 AND k.status <> 'confirmed'
	  ORDER BY k.created_at DESC LIMIT 1`, id), s.now())
	if database.IsNoRows(err) {
		return out, nil
	}
	out.Ticket = &t
	return out, err
}

// conversationTaken is the 409 for a conversation that already has an
// unconfirmed ticket; the params name it for the inbox to open.
func conversationTaken(ctx context.Context, q Q, conversationID string) error {
	var id, code string
	err := q.QueryRow(ctx, `SELECT id::text, code FROM gym.complaints WHERE conversation_id = $1 AND status <> 'confirmed'
	  ORDER BY created_at DESC LIMIT 1`, conversationID).Scan(&id, &code)
	if err != nil && !database.IsNoRows(err) {
		return err
	}
	return httpx.Coded(409, "COMPLAINT_EXISTS", "Percakapan ini sudah punya tiket "+code, map[string]any{"id": id, "code": code})
}

// FromConversation opens a wa_inbox ticket for a conversation. in carries
// what staff changed in the prefill; the rest comes from the conversation.
func (s *Service) FromConversation(ctx context.Context, userID, conversationID string, in NewTicket) (Created, error) {
	var out Created
	err := s.inTx(ctx, func(q Q) error {
		c, err := loadConversation(ctx, q, conversationID)
		if err != nil {
			return err
		}
		if _, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('gym.complaints:conversation:' || $1))`, conversationID); err != nil {
			return err
		}
		var taken bool
		if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM gym.complaints WHERE conversation_id = $1 AND status <> 'confirmed')`,
			conversationID).Scan(&taken); err != nil {
			return err
		}
		if taken {
			return conversationTaken(ctx, q, conversationID)
		}
		sug := c.suggestion()
		in.Source, in.ConversationID, in.by = domain.SourceInbox, &c.ID, staffActor(userID)
		if in.Category == "" {
			in.Category = sug.Category
		}
		if in.Priority == "" {
			in.Priority = sug.Priority
		}
		if strings.TrimSpace(in.Description) == "" && sug.Description != nil {
			in.Description = *sug.Description
		}
		in.CustomerID = or(in.CustomerID, sug.CustomerID)
		in.ContactName = or(trimmed(in.ContactName), sug.ContactName)
		in.ContactPhone = or(trimmed(in.ContactPhone), sug.ContactPhone)
		if out, err = s.create(ctx, q, in); err != nil {
			return err
		}
		_, err = q.Exec(ctx, `UPDATE crm.wa_conversations SET is_complaint = true, updated_at = now()
		  WHERE id = $1 AND NOT is_complaint`, conversationID)
		return err
	})
	return out, err
}
