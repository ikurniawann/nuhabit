package inbox

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/inbox/domain"
	"nuhabit/backend/internal/platform/database"
)

// Writes to crm.wa_conversations and crm.wa_messages shared by the inbox
// routes (ports of lib/whatsapp/store.ts and lib/crm/cs-server.ts).

// customerIDByPhone links a phone to a member: digits equal, or the 62
// prefix written as 0.
func customerIDByPhone(ctx context.Context, q database.Querier, phone *string) (*string, error) {
	var id *string
	err := q.QueryRow(ctx, `SELECT id::text FROM pos.pos_customers
      WHERE regexp_replace(COALESCE(phone,''), '\D', '', 'g')
            IN ($1, '0' || substring($1 from 3))
      LIMIT 1`, phone).Scan(&id)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return id, err
}

// textMeta is sendWhatsAppText's meta argument.
type textMeta struct {
	messageType    string // notification | chat | broadcast | system
	sentByUserID   string
	conversationID string
}

// sendWhatsApp mirrors sendWhatsAppText: dispatch, then log the outbound
// message (logging never fails the send). A conversation without a phone
// sends to an empty target, as the TS passes null through.
func (h *handler) sendWhatsApp(ctx context.Context, phone *string, message string, meta textMeta) SendResult {
	target := ""
	if phone != nil {
		target = *phone
	}
	res := h.WhatsApp.SendText(ctx, h.db, target, message)
	if err := h.logOutbound(ctx, phone, message, res, meta); err != nil {
		h.log.Error("[wa-log] Gagal mencatat pesan keluar", "error", err)
	}
	return res
}

func (h *handler) logOutbound(ctx context.Context, phone *string, body string, res SendResult, meta textMeta) error {
	customerID, err := customerIDByPhone(ctx, h.db, phone)
	if err != nil {
		return err
	}
	status, reason := "sent", (*string)(nil)
	if !res.Success {
		status, reason = "failed", &res.Reason
		if res.Reason == "" {
			unknown := "Unknown error"
			reason = &unknown
		}
	}
	_, err = h.db.Exec(ctx, `INSERT INTO crm.wa_messages
         (conversation_id, direction, message_type, phone, customer_id, body,
          status, provider, provider_message_id, error_reason, sent_by_user_id)
       VALUES ($1, 'out', $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL
       DO NOTHING`,
		nilIfEmpty(meta.conversationID), meta.messageType, phone, customerID, body,
		status, nilIfEmpty(res.Provider), res.MessageID, reason, nilIfEmpty(meta.sentByUserID))
	return err
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// errEcho rolls back recordMessage when the message was already stored.
var errEcho = errors.New("inbox: message already recorded")

// recordMessage mirrors recordGatewayMessage: upsert the conversation and
// insert the message in one transaction; a provider message id seen
// before (an echo) leaves both untouched and reports stored=false.
func recordMessage(ctx context.Context, db database.DB, m domain.Inbound) (bool, error) {
	err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
		var customerID *string
		if m.Phone != nil {
			id, err := customerIDByPhone(ctx, tx, m.Phone)
			if err != nil {
				return err
			}
			customerID = id
		}
		var conversationID string
		if err := tx.QueryRow(ctx, `INSERT INTO crm.wa_conversations
         (channel, external_id, phone, customer_id, display_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (channel, external_id) DO UPDATE
         SET customer_id = COALESCE(crm.wa_conversations.customer_id, EXCLUDED.customer_id),
             display_name = COALESCE(EXCLUDED.display_name, crm.wa_conversations.display_name)
       RETURNING id::text`, m.Channel, m.ExternalID, m.Phone, customerID, m.PushName).Scan(&conversationID); err != nil {
			return err
		}
		status := "sent"
		if m.Direction == "in" {
			status = "received"
		}
		tag, err := tx.Exec(ctx, `INSERT INTO crm.wa_messages
         (conversation_id, direction, message_type, channel, external_id, phone,
          customer_id, body, media_type, status, provider, provider_message_id,
          wa_from_me, created_at)
       VALUES ($1, $2, 'chat', $11, $12, $3, $4, $5, $6, $7, 'gateway', $8, $9,
               COALESCE($10, now()))
       ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL
       DO NOTHING`,
			conversationID, m.Direction, m.Phone, customerID, m.Body, m.MediaType, status,
			m.ProviderMessageID, m.Direction == "out", m.SentAt, m.Channel, m.ExternalID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errEcho
		}
		preview := domain.MessagePreview(m.Body, m.MediaType)
		if m.Direction == "in" {
			_, err = tx.Exec(ctx, `UPDATE crm.wa_conversations
            SET unread_count = unread_count + 1,
                last_message_at = COALESCE($2, now()),
                last_message_preview = $3,
                status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END
          WHERE id = $1`, conversationID, m.SentAt, preview)
		} else {
			_, err = tx.Exec(ctx, `UPDATE crm.wa_conversations
            SET last_message_at = COALESCE($2, now()),
                last_message_preview = $3
          WHERE id = $1`, conversationID, m.SentAt, preview)
		}
		return err
	})
	if errors.Is(err, errEcho) {
		return false, nil
	}
	return err == nil, err
}

// csatSettings mirrors the CSAT half of getCsSettings (crm_settings cs_*).
func csatSettings(ctx context.Context, q database.Querier) (enabled bool, text string, err error) {
	enabled = true
	text = "Terima kasih sudah menghubungi kami. Boleh beri penilaian layanan kami? Balas dengan angka 1-5 (5 = sangat puas)."
	rows, err := q.Query(ctx, `SELECT key, value FROM crm.crm_settings WHERE key IN ('cs_csat_enabled', 'cs_csat_text')`)
	if err != nil {
		return false, "", err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var raw []byte
		if err := rows.Scan(&key, &raw); err != nil {
			return false, "", err
		}
		var v any
		_ = json.Unmarshal(raw, &v)
		switch key {
		case "cs_csat_enabled":
			switch x := v.(type) {
			case bool:
				enabled = x
			case string:
				enabled = x == "true"
			}
		case "cs_csat_text":
			if s, ok := v.(string); ok && domain.JSTrim(s) != "" {
				text = s
			}
		}
	}
	return enabled, text, rows.Err()
}

// onAgentReply stops the SLA clock and records the first response time once.
func onAgentReply(ctx context.Context, q database.Querier, conversationID string, at time.Time) error {
	_, err := q.Exec(ctx, `UPDATE crm.wa_conversations
        SET first_response_at = COALESCE(first_response_at, $2),
            first_response_seconds = COALESCE(
              first_response_seconds,
              CASE WHEN awaiting_since IS NOT NULL
                   THEN GREATEST(0, EXTRACT(EPOCH FROM ($2::timestamptz - awaiting_since))::int)
              END
            ),
            awaiting_since = NULL,
            sla_response_breached = false,
            escalated_at = NULL
      WHERE id = $1`, conversationID, at)
	return err
}

// onResolved records the resolution time and, when CSAT is on and the
// conversation was never rated, returns the rating request to send.
func onResolved(ctx context.Context, q database.Querier, conversationID string, at time.Time) (*string, error) {
	enabled, text, err := csatSettings(ctx, q)
	if err != nil {
		return nil, err
	}
	var score *int32
	err = q.QueryRow(ctx, `UPDATE crm.wa_conversations
        SET resolved_at = $2,
            resolution_seconds = GREATEST(
              0, EXTRACT(EPOCH FROM ($2::timestamptz - created_at))::int
            ),
            awaiting_since = NULL,
            csat_asked_at = CASE WHEN $3 THEN $2 ELSE csat_asked_at END
      WHERE id = $1
      RETURNING csat_score`, conversationID, at, enabled).Scan(&score)
	if err != nil && !database.IsNoRows(err) {
		return nil, err
	}
	if !enabled || score != nil {
		return nil, nil
	}
	return &text, nil
}
