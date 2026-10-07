package whatsapp

import (
	"context"

	"nuhabit/backend/internal/platform/database"
)

// logOutbound is logOutboundMessage: one crm.wa_messages row linked to the
// member whose phone matches. An OTP body is never stored. Failures are
// logged, never returned.
func (c *Client) logOutbound(ctx context.Context, q database.Querier, phone, messageType, body, sentByUserID string, res Result) {
	var customerID *string
	err := q.QueryRow(ctx, `SELECT id::text FROM pos.pos_customers
		WHERE regexp_replace(COALESCE(phone,''), '\D', '', 'g') IN ($1, '0' || substring($1 from 3))
		LIMIT 1`, phone).Scan(&customerID)
	if err != nil && !database.IsNoRows(err) {
		c.Log.Error("[wa-log] Gagal mencatat pesan keluar", "error", err.Error())
		return
	}
	status, errReason := "sent", (*string)(nil)
	if !res.Success {
		status, errReason = "failed", nullable(firstSet(res.Reason, "Unknown error"))
	}
	storedBody := &body
	if messageType == "otp" {
		storedBody = nil
	}
	if _, err := q.Exec(ctx, `INSERT INTO crm.wa_messages
		  (conversation_id, direction, message_type, phone, customer_id, body,
		   status, provider, provider_message_id, error_reason, sent_by_user_id)
		VALUES (NULL, 'out', $1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING`,
		messageType, phone, customerID, storedBody, status, nullable(res.Provider), nullable(res.MessageID),
		errReason, nullable(sentByUserID)); err != nil {
		c.Log.Error("[wa-log] Gagal mencatat pesan keluar", "error", err.Error())
	}
}
